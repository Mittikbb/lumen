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

        loop {
            let now = read_now_playing(&mut art_key, &mut art).unwrap_or(None);
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

    let mime = stream.ContentType()?.to_string();
    let mime = if mime.is_empty() {
        "image/png".into()
    } else {
        mime
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn now_filetime() -> i64 {
    let since_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    since_unix.as_nanos() as i64 / 100 + FILETIME_UNIX_OFFSET
}
