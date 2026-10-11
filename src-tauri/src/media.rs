//! "Now playing" via Windows System Media Transport Controls (SMTC) — the same
//! source the Windows volume flyout uses, so it works with Spotify, Yandex Music,
//! browsers and most other players.

use std::{
    collections::HashMap,
    io::Read,
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    },
    Storage::Streams::DataReader,
};

use crate::net;

#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    title: String,
    artist: String,
    /// AUMID of the player, e.g. "Spotify.exe".
    app: String,
    playing: bool,
    position_ms: u64,
    duration_ms: u64,
    /// Album art as a data URL; only re-read when the track changes.
    art: Option<String>,
}

#[derive(Default)]
pub struct MediaState(Mutex<Option<NowPlaying>>);

const POLL: Duration = Duration::from_millis(500);
/// Offset between the Windows FILETIME epoch (1601) and the Unix epoch, in 100 ns ticks.
const FILETIME_UNIX_OFFSET: i64 = 116_444_736_000_000_000;

static ART_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static DURATION_CACHE: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);

struct PlaybackTracker {
    key: String,
    accumulated_ms: u64,
    last_tick: Option<Instant>,
}

static PLAYBACK_TRACKER: Mutex<Option<PlaybackTracker>> = Mutex::new(None);

fn get_cached_art(key: &str) -> Option<String> {
    let mut lock = ART_CACHE.lock().ok()?;
    let map = lock.get_or_insert_with(HashMap::new);
    map.get(key).cloned()
}

fn set_cached_art(key: String, art: String) {
    if let Ok(mut lock) = ART_CACHE.lock() {
        let map = lock.get_or_insert_with(HashMap::new);
        if map.len() > 100 {
            map.clear();
        }
        map.insert(key, art);
    }
}

fn get_cached_duration(key: &str) -> Option<u64> {
    let mut lock = DURATION_CACHE.lock().ok()?;
    let map = lock.get_or_insert_with(HashMap::new);
    map.get(key).copied()
}

fn set_cached_duration(key: String, duration_ms: u64) {
    if let Ok(mut lock) = DURATION_CACHE.lock() {
        let map = lock.get_or_insert_with(HashMap::new);
        if map.len() > 100 {
            map.clear();
        }
        map.insert(key, duration_ms);
    }
}

fn update_local_position(key: &str, playing: bool, smtc_position_ms: u64) -> u64 {
    let mut lock = match PLAYBACK_TRACKER.lock() {
        Ok(l) => l,
        Err(_) => return smtc_position_ms,
    };
    let tracker = lock.get_or_insert_with(|| PlaybackTracker {
        key: key.to_string(),
        accumulated_ms: 0,
        last_tick: if playing { Some(Instant::now()) } else { None },
    });

    if tracker.key != key {
        tracker.key = key.to_string();
        tracker.accumulated_ms = 0;
        tracker.last_tick = if playing { Some(Instant::now()) } else { None };
    }

    if smtc_position_ms > 0 {
        tracker.accumulated_ms = smtc_position_ms;
        tracker.last_tick = if playing { Some(Instant::now()) } else { None };
        return smtc_position_ms;
    }

    if playing {
        let now = Instant::now();
        if let Some(prev) = tracker.last_tick {
            let elapsed = now.duration_since(prev).as_millis() as u64;
            // Cap single tick delta to prevent unexpected jumps
            tracker.accumulated_ms += elapsed.min(2000);
        }
        tracker.last_tick = Some(now);
    } else {
        tracker.last_tick = None;
    }

    tracker.accumulated_ms
}

/// Title, artist and player of the track that's playing right now.
pub fn playing_track(app: &AppHandle) -> Option<(String, String, String)> {
    let state = app.state::<MediaState>();
    let now = state.0.lock().unwrap();
    now.as_ref()
        .filter(|n| n.playing)
        .map(|n| (n.title.clone(), n.artist.clone(), n.app.clone()))
}

#[tauri::command]
pub fn media_state(state: State<MediaState>) -> Option<NowPlaying> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn media_control(action: String) -> Result<(), String> {
    let run = || -> windows::core::Result<()> {
        let Some(session) = current_session()? else {
            return Ok(());
        };
        let op = match action.as_str() {
            "toggle" => session.TryTogglePlayPauseAsync()?,
            "next" => session.TrySkipNextAsync()?,
            "previous" => session.TrySkipPreviousAsync()?,
            _ => return Ok(()),
        };
        op.join()?;
        Ok(())
    };
    run().map_err(|e| e.message())
}

pub fn spawn_watcher(app: AppHandle) {
    thread::spawn(move || {
        let mut art_key = String::new();
        let mut art: Option<String> = None;
        let mut art_attempts = 0u32;

        loop {
            let now = read_now_playing(&mut art_key, &mut art, &mut art_attempts).unwrap_or(None);
            let state = app.state::<MediaState>();
            let mut last = state.0.lock().unwrap();
            if *last != now {
                *last = now.clone();
                drop(last);
                let _ = app.emit("lumen://media", now);
            }
            thread::sleep(POLL);
        }
    });
}

fn current_session() -> windows::core::Result<Option<Session>> {
    let manager = SessionManager::RequestAsync()?.join()?;
    Ok(manager.GetCurrentSession().ok())
}

fn read_now_playing(
    art_key: &mut String,
    art: &mut Option<String>,
    art_attempts: &mut u32,
) -> windows::core::Result<Option<NowPlaying>> {
    let Some(session) = current_session()? else {
        return Ok(None);
    };

    let props = session.TryGetMediaPropertiesAsync()?.join()?;
    let title = props.Title()?.to_string();
    let artist = props.Artist()?.to_string();
    if title.is_empty() && artist.is_empty() {
        return Ok(None);
    }

    let key = format!("{title}\u{1f}{artist}");
    if *art_key != key {
        *art_key = key.clone();
        *art = None;
        *art_attempts = 0;
    }

    if art.is_none() {
        if let Some(cached) = get_cached_art(&key) {
            *art = Some(cached);
        }
    }

    // AyuGram and other players update the thumbnail asynchronously after metadata.
    // Retry multiple times if art has not been loaded yet.
    if art.is_none() && *art_attempts < 10 {
        *art_attempts += 1;
        if let Ok(thumb) = props.Thumbnail() {
            if let Some(image_data) = read_art(&thumb) {
                set_cached_art(key.clone(), image_data.clone());
                *art = Some(image_data);
            }
        }

        // If after 4 attempts (~2 seconds) SMTC still has no thumbnail, trigger online lookup
        if art.is_none() && *art_attempts == 4 {
            trigger_online_metadata_lookup(&title, &artist, key.clone());
        }
    }

    let playing = session.GetPlaybackInfo()?.PlaybackStatus()? == PlaybackStatus::Playing;

    // Players only report position on state changes, so extrapolate from the
    // last update while playing.
    let timeline = session.GetTimelineProperties()?;
    let duration = timeline.EndTime()?.Duration - timeline.StartTime()?.Duration;
    let mut position = timeline.Position()?.Duration;
    if playing {
        let updated = timeline.LastUpdatedTime()?.UniversalTime;
        if updated > 0 {
            position += (now_filetime() - updated).max(0);
        }
    }

    let mut duration_ms = (duration.max(0) / 10_000) as u64;
    if duration_ms == 0 {
        if let Some(cached_d) = get_cached_duration(&key) {
            duration_ms = cached_d;
        } else if *art_attempts == 4 {
            trigger_online_metadata_lookup(&title, &artist, key.clone());
        }
    }

    let smtc_pos_ms = (position / 10_000) as u64;
    let mut position_ms = update_local_position(&key, playing, smtc_pos_ms);
    if duration_ms > 0 {
        position_ms = position_ms.min(duration_ms);
    }

    Ok(Some(NowPlaying {
        title,
        artist,
        app: session.SourceAppUserModelId()?.to_string(),
        playing,
        position_ms,
        duration_ms,
        art: art.clone(),
    }))
}

fn read_art(
    thumb: &windows::Storage::Streams::IRandomAccessStreamReference,
) -> Option<String> {
    let stream = thumb.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.join().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;

    if bytes.is_empty() {
        return None;
    }

    // Trust the bytes over the declared type: Telegram reports
    // "image/jpeg,image/jpe,image/jpg", which breaks a data URL.
    let declared = stream.ContentType().map(|s| s.to_string()).unwrap_or_default();
    let mime = sniff_image(&bytes)
        .map(String::from)
        .or_else(|| declared.split(',').next().map(|t| t.trim().to_string()))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "image/png".into());
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn trigger_online_metadata_lookup(title: &str, artist: &str, key: String) {
    let title = title.to_string();
    let artist = artist.to_string();
    thread::spawn(move || {
        if let Some((art, duration_ms)) = fetch_online_metadata(&title, &artist) {
            if let Some(art) = art {
                set_cached_art(key.clone(), art);
            }
            if let Some(d) = duration_ms {
                set_cached_duration(key, d);
            }
        }
    });
}

fn fetch_online_metadata(title: &str, artist: &str) -> Option<(Option<String>, Option<u64>)> {
    let clean = |s: &str| {
        let s = s.trim();
        if let Some(idx) = s.find(|c| c == '(' || c == '[') {
            let prefix = s[..idx].trim();
            if !prefix.is_empty() {
                return prefix.to_string();
            }
        }
        s.to_string()
    };

    let clean_artist = clean(artist);
    let clean_title = clean(title);
    let query = format!("{clean_artist} {clean_title}");
    let query = query.trim();
    if query.is_empty() {
        return None;
    }

    let agent = net::agent();
    let itunes_url = format!(
        "https://itunes.apple.com/search?term={}&entity=song&limit=1",
        url_encode(query)
    );

    let mut artwork_url = None;
    let mut duration_ms = None;

    if let Ok(res) = agent.get(&itunes_url).call() {
        if let Ok(json) = res.into_json::<serde_json::Value>() {
            if let Some(item) = json["results"].get(0) {
                if let Some(u) = item["artworkUrl100"].as_str() {
                    artwork_url = Some(u.replace("100x100bb.jpg", "512x512bb.jpg"));
                }
                if let Some(d) = item["trackTimeMillis"].as_u64() {
                    duration_ms = Some(d);
                }
            }
        }
    }

    if artwork_url.is_none() || duration_ms.is_none() {
        let deezer_url = format!(
            "https://api.deezer.com/search?q={}&limit=1",
            url_encode(query)
        );
        if let Ok(res) = agent.get(&deezer_url).call() {
            if let Ok(json) = res.into_json::<serde_json::Value>() {
                if let Some(item) = json["data"].get(0) {
                    if artwork_url.is_none() {
                        artwork_url = item["album"]["cover_big"]
                            .as_str()
                            .or_else(|| item["album"]["cover_medium"].as_str())
                            .map(String::from);
                    }
                    if duration_ms.is_none() {
                        duration_ms = item["duration"].as_u64().map(|s| s * 1000);
                    }
                }
            }
        }
    }

    let art_data = if let Some(url) = artwork_url {
        if let Ok(img_res) = agent.get(&url).call() {
            let mut bytes = Vec::new();
            if img_res.into_reader().take(3_000_000).read_to_end(&mut bytes).is_ok() && !bytes.is_empty() {
                let mime = sniff_image(&bytes).unwrap_or("image/jpeg");
                Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    Some((art_data, duration_ms))
}

fn url_encode(input: &str) -> String {
    let mut encoded = String::new();
    for b in input.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(b as char);
            }
            b' ' => encoded.push('+'),
            b => {
                encoded.push_str(&format!("%{b:02X}"));
            }
        }
    }
    encoded
}

/// Image type from the file signature.
fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xff, 0xd8, 0xff, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', ..] => Some("image/gif"),
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => Some("image/webp"),
        [b'B', b'M', ..] => Some("image/bmp"),
        _ => None,
    }
}

fn now_filetime() -> i64 {
    let since_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    since_unix.as_nanos() as i64 / 100 + FILETIME_UNIX_OFFSET
}



