//! "Now playing" via Windows System Media Transport Controls (SMTC) — the same
//! source the Windows volume flyout uses, so it works with Spotify, Yandex Music,
//! browsers and most other players.

use std::{
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::settings;
use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    },
    Storage::Streams::DataReader,
};

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
/// New players are looked for every this many polls.
const LOOK_FOR_PLAYERS: u32 = 10;
/// Offset between the Windows FILETIME epoch (1601) and the Unix epoch, in 100 ns ticks.
const FILETIME_UNIX_OFFSET: i64 = 116_444_736_000_000_000;

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
pub fn media_control(app: AppHandle, action: String) -> Result<(), String> {
    let run = || -> windows::core::Result<()> {
        let Some(session) = shown_session(&app)? else {
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
        let mut polls = 0u32;

        loop {
            if polls % LOOK_FOR_PLAYERS == 0 {
                let _ = remember_players(&app);
            }
            polls = polls.wrapping_add(1);
            let now = read_now_playing(&app, &mut art_key, &mut art).unwrap_or(None);
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

/// The player the island shows: the one Windows calls current, unless the
/// user hid it; then another one, preferring one that's playing.
fn shown_session(app: &AppHandle) -> windows::core::Result<Option<Session>> {
    let hidden = settings::get(app).players.hidden;
    let shown = |s: &Session| {
        s.SourceAppUserModelId()
            .map(|id| !hidden.iter().any(|h| *h == id.to_string()))
            .unwrap_or(false)
    };
    let manager = SessionManager::RequestAsync()?.join()?;
    if let Ok(current) = manager.GetCurrentSession() {
        if shown(&current) {
            return Ok(Some(current));
        }
    }
    let others: Vec<Session> = manager.GetSessions()?.into_iter().filter(shown).collect();
    let playing = others.iter().find(|s| is_playing(s)).cloned();
    Ok(playing.or_else(|| others.into_iter().next()))
}

fn is_playing(session: &Session) -> bool {
    session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .is_ok_and(|status| status == PlaybackStatus::Playing)
}

/// Adds players that have something on to the known ones, so they can be
/// named or hidden in the settings, hidden ones included.
fn remember_players(app: &AppHandle) -> windows::core::Result<()> {
    let known = settings::get(app).players.known;
    let manager = SessionManager::RequestAsync()?.join()?;
    for session in manager.GetSessions()? {
        let id = session.SourceAppUserModelId()?.to_string();
        if id.is_empty() || known.contains(&id) {
            continue;
        }
        let props = session.TryGetMediaPropertiesAsync()?.join()?;
        if !props.Title()?.is_empty() {
            settings::remember_player(app, &id);
        }
    }
    Ok(())
}

fn read_now_playing(
    app: &AppHandle,
    art_key: &mut String,
    art: &mut Option<String>,
) -> windows::core::Result<Option<NowPlaying>> {
    let Some(session) = shown_session(app)? else {
        return Ok(None);
    };

    let props = session.TryGetMediaPropertiesAsync()?.join()?;
    let title = props.Title()?.to_string();
    let artist = props.Artist()?.to_string();
    if title.is_empty() && artist.is_empty() {
        return Ok(None);
    }

    let key = format!("{title}\u{1f}{artist}");
    // Some players (Telegram, AyuGram) attach the cover a moment after the
    // title, so keep asking while a track has none yet.
    if *art_key != key || art.is_none() {
        *art_key = key;
        *art = props.Thumbnail().ok().and_then(|t| read_art(&t).ok());
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
    let position = position.clamp(0, duration.max(0));

    Ok(Some(NowPlaying {
        title,
        artist,
        app: session.SourceAppUserModelId()?.to_string(),
        playing,
        position_ms: (position / 10_000) as u64,
        duration_ms: (duration.max(0) / 10_000) as u64,
        art: art.clone(),
    }))
}

fn read_art(
    thumb: &windows::Storage::Streams::IRandomAccessStreamReference,
) -> windows::core::Result<String> {
    let stream = thumb.OpenReadAsync()?.join()?;
    let size = stream.Size()? as u32;
    let reader = DataReader::CreateDataReader(&stream)?;
    reader.LoadAsync(size)?.join()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes)?;
    if bytes.is_empty() {
        return Err(windows::core::Error::empty());
    }

    // Trust the bytes over the declared type: Telegram reports
    // "image/jpeg,image/jpe,image/jpg", which breaks a data URL.
    let declared = stream.ContentType()?.to_string();
    let mime = sniff_image(&bytes)
        .map(String::from)
        .or_else(|| declared.split(',').next().map(|t| t.trim().to_string()))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "image/png".into());
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
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
