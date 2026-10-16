//! "Now playing" via Windows System Media Transport Controls (SMTC) — the same
//! source the Windows volume flyout uses, so it works with Spotify, Yandex Music,
//! browsers and most other players.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
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
    /// Album art as a data URL; only re-read when the track changes, and
    /// shared rather than copied between polls.
    art: Option<Arc<str>>,
}

/// What goes out on `lumen://media`. The cover, a data URL of up to a few
/// hundred KB, is left out while it stays the same: the position changes
/// twice a second, and every event is parsed again by each window.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaEvent<'a> {
    title: &'a str,
    artist: &'a str,
    app: &'a str,
    playing: bool,
    position_ms: u64,
    duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    art: Option<&'a Option<Arc<str>>>,
}

impl NowPlaying {
    fn event(&self, with_art: bool) -> MediaEvent<'_> {
        MediaEvent {
            title: &self.title,
            artist: &self.artist,
            app: &self.app,
            playing: self.playing,
            position_ms: self.position_ms,
            duration_ms: self.duration_ms,
            art: with_art.then_some(&self.art),
        }
    }
}

#[derive(Default)]
pub struct MediaState(Mutex<Option<NowPlaying>>);

const POLL: Duration = Duration::from_millis(500);
/// New players are looked for every this many polls.
const LOOK_FOR_PLAYERS: u32 = 10;
/// Offset between the Windows FILETIME epoch (1601) and the Unix epoch, in 100 ns ticks.
const FILETIME_UNIX_OFFSET: i64 = 116_444_736_000_000_000;

/// How long the track has been playing, for players that report no timeline
/// (Telegram, AyuGram): counted by us from when the track came on.
struct Clock {
    key: String,
    elapsed: Duration,
    playing: bool,
    seen: Instant,
    /// False for a track that was already on when Lumen started: we don't
    /// know how far into it the player is.
    synced: bool,
}

impl Clock {
    fn new(key: &str, playing: bool, synced: bool) -> Self {
        Self {
            key: key.to_string(),
            elapsed: Duration::ZERO,
            playing,
            seen: Instant::now(),
            synced,
        }
    }

    /// Time into the track, if known.
    fn tick(&mut self, key: &str, playing: bool) -> Option<Duration> {
        let now = Instant::now();
        if self.key != key {
            *self = Self::new(key, playing, true);
        } else if self.playing {
            self.elapsed += now - self.seen;
        }
        self.playing = playing;
        self.seen = now;
        self.synced.then_some(self.elapsed)
    }
}

/// Clocks of the players that need one, by app id.
#[derive(Default)]
struct Clocks {
    by_app: HashMap<String, Clock>,
    /// Set after the first poll: tracks seen from then on started while
    /// Lumen was watching.
    started: bool,
}

impl Clocks {
    fn tick(&mut self, app: &str, key: &str, playing: bool) -> Option<Duration> {
        let started = self.started;
        self.by_app
            .entry(app.to_string())
            .or_insert_with(|| Clock::new(key, playing, started))
            .tick(key, playing)
    }
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
        let mut art: Option<Arc<str>> = None;
        let mut clocks = Clocks::default();
        let mut polls = 0u32;

        loop {
            if polls % LOOK_FOR_PLAYERS == 0 {
                let _ = remember_players(&app);
            }
            polls = polls.wrapping_add(1);
            let now = match read_now_playing(&app, &mut art_key, &mut art, &mut clocks) {
                Ok(now) => now,
                Err(_) => {
                    // Ask for a fresh manager next time, in case this one went
                    // stale (Explorer restarted).
                    forget_manager();
                    None
                }
            };
            clocks.started = true;
            let state = app.state::<MediaState>();
            let mut last = state.0.lock().unwrap();
            if *last != now {
                let art_changed = last.as_ref().map(|l| &l.art) != now.as_ref().map(|n| &n.art);
                *last = now;
                let event = last.as_ref().map(|n| n.event(art_changed));
                let _ = app.emit("lumen://media", event);
            }
            thread::sleep(POLL);
        }
    });
}

/// The player the island shows: the one Windows calls current, unless the
/// user hid it; then another one, preferring one that's playing.
fn shown_session(app: &AppHandle) -> windows::core::Result<Option<Session>> {
    let hidden = settings::read(app, |s| s.players.hidden.clone());
    let shown = |s: &Session| {
        s.SourceAppUserModelId()
            .map(|id| {
                let id = id.to_string();
                !hidden.iter().any(|h| *h == id)
            })
            .unwrap_or(false)
    };
    let manager = manager()?;
    if let Ok(current) = manager.GetCurrentSession() {
        if shown(&current) {
            return Ok(Some(current));
        }
    }
    let others: Vec<Session> = manager.GetSessions()?.into_iter().filter(shown).collect();
    let playing = others.iter().find(|s| is_playing(s)).cloned();
    Ok(playing.or_else(|| others.into_iter().next()))
}

/// The SMTC session manager, asked for once and kept: RequestAsync is a
/// cross-process call, and the watcher would otherwise make it twice a second.
/// The manager stays live, sessions coming and going included.
static MANAGER: Mutex<Option<SessionManager>> = Mutex::new(None);

fn manager() -> windows::core::Result<SessionManager> {
    let mut cached = MANAGER.lock().unwrap();
    if let Some(manager) = cached.as_ref() {
        return Ok(manager.clone());
    }
    let manager = SessionManager::RequestAsync()?.join()?;
    *cached = Some(manager.clone());
    Ok(manager)
}

fn forget_manager() {
    *MANAGER.lock().unwrap() = None;
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
    let known = settings::read(app, |s| s.players.known.clone());
    let manager = manager()?;
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
    art: &mut Option<Arc<str>>,
    clocks: &mut Clocks,
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
        art_key.clone_from(&key);
        *art = props
            .Thumbnail()
            .ok()
            .and_then(|t| read_art(&t).ok())
            .map(Arc::from);
    }

    let playing = session.GetPlaybackInfo()?.PlaybackStatus()? == PlaybackStatus::Playing;
    let player = session.SourceAppUserModelId()?.to_string();

    let timeline = session.GetTimelineProperties()?;
    let duration = timeline.EndTime()?.Duration - timeline.StartTime()?.Duration;
    let (position_ms, duration_ms) = if duration > 0 {
        // Players only report position on state changes, so extrapolate from
        // the last update while playing.
        let mut position = timeline.Position()?.Duration;
        if playing {
            let updated = timeline.LastUpdatedTime()?.UniversalTime;
            if updated > 0 {
                position += (now_filetime() - updated).max(0);
            }
        }
        let position = position.clamp(0, duration);
        ((position / 10_000) as u64, (duration / 10_000) as u64)
    } else {
        // Telegram and AyuGram report no timeline at all: count the time
        // ourselves; the length stays unknown.
        let elapsed = clocks.tick(&player, &key, playing);
        (elapsed.map_or(0, |e| e.as_millis() as u64), 0)
    };

    Ok(Some(NowPlaying {
        title,
        artist,
        app: player,
        playing,
        position_ms,
        duration_ms,
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
