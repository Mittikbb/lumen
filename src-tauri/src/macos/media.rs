//! "Now playing" on macOS, from MediaRemote: the source of the Now Playing
//! widget in Control Center, so it works with Music, Spotify, Telegram,
//! browsers and most other players.
//!
//! MediaRemote answers only Apple's own processes since macOS 15.4, so the
//! reading is done by a small helper (src/macos/mediaremote.m, built by
//! build.rs) that runs inside /usr/bin/perl. It streams the track as JSON
//! lines and takes play/pause/skip commands on stdin; when Lumen quits, its
//! stdin closes and it exits.

use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::settings;

/// The helper library, built for both architectures.
const HELPER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/mediaremote.dylib"));
const PERL: &str = "/usr/bin/perl";
/// Loads the helper into perl and hands it the thread; it never returns.
const LOADER: &str = r#"use DynaLoader;
my $lib = DynaLoader::dl_load_file($ARGV[0], 0) or die DynaLoader::dl_error();
my $entry = DynaLoader::dl_find_symbol($lib, "lumen_mediaremote_stream") or die "no entry point";
DynaLoader::dl_install_xsub("main::stream", $entry);
stream();"#;

const POLL: Duration = Duration::from_millis(500);
/// Wait before starting the helper again after it stopped.
const RESTART: Duration = Duration::from_secs(5);

#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    title: String,
    artist: String,
    /// Bundle id of the player, e.g. "com.spotify.client".
    app: String,
    playing: bool,
    position_ms: u64,
    duration_ms: u64,
    /// Album art as a data URL, shared rather than copied between polls.
    art: Option<Arc<str>>,
}

/// What goes out on `lumen://media`; the cover only when it changed (see
/// media.rs on Windows).
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

/// A line from the helper; `{}` (all defaults) when nothing plays.
#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Track {
    title: String,
    artist: String,
    app: String,
    playing: bool,
    /// Seconds; 0 when the player doesn't say.
    duration: f64,
    /// Seconds into the track at `at` (Unix ms).
    elapsed: f64,
    at: f64,
    rate: f64,
    /// Base64, only in the line where the cover changed.
    artwork: Option<String>,
    artwork_id: u64,
}

/// How long the track has been playing, for players that report no elapsed
/// time (Telegram, AyuGram): counted by us from when the track came on.
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

#[derive(Default)]
pub struct MediaState {
    shown: Mutex<Option<NowPlaying>>,
    /// Our own count for the shown track; `None` before the first poll.
    clock: Mutex<Option<Clock>>,
    /// The latest track from the helper and its cover.
    track: Mutex<Option<(Track, Option<Arc<str>>)>>,
    /// The helper's stdin, for commands.
    commands: Mutex<Option<ChildStdin>>,
}

/// Title, artist and player of the track that's playing right now.
pub fn playing_track(app: &AppHandle) -> Option<(String, String, String)> {
    let state = app.state::<MediaState>();
    let shown = state.shown.lock().unwrap();
    shown
        .as_ref()
        .filter(|n| n.playing)
        .map(|n| (n.title.clone(), n.artist.clone(), n.app.clone()))
}

#[tauri::command]
pub fn media_state(state: State<MediaState>) -> Option<NowPlaying> {
    state.shown.lock().unwrap().clone()
}

#[tauri::command]
pub fn media_control(app: AppHandle, action: String) -> Result<(), String> {
    if !["toggle", "next", "previous"].contains(&action.as_str()) {
        return Ok(());
    }
    let state = app.state::<MediaState>();
    let mut commands = state.commands.lock().unwrap();
    let stdin = commands.as_mut().ok_or("media helper isn't running")?;
    writeln!(stdin, "{action}").map_err(|e| e.to_string())
}

pub fn spawn_watcher(app: AppHandle) {
    let reader = app.clone();
    thread::spawn(move || run_helper(&reader));

    thread::spawn(move || {
        loop {
            let now = shown_track(&app);
            let state = app.state::<MediaState>();
            let mut last = state.shown.lock().unwrap();
            if *last != now {
                let art_changed = last.as_ref().map(|l| &l.art) != now.as_ref().map(|n| &n.art);
                *last = now;
                let event = last.as_ref().map(|n| n.event(art_changed));
                let _ = app.emit("lumen://media", event);
            }
            drop(last);
            thread::sleep(POLL);
        }
    });
}

/// Keeps the helper running and its latest track in the state.
fn run_helper(app: &AppHandle) {
    let helper = match install_helper(app) {
        Ok(path) => path,
        Err(e) => {
            eprintln!("media helper: {e}");
            return;
        }
    };
    loop {
        let child = Command::new(PERL)
            .args(["-e", LOADER])
            .arg(&helper)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn();
        let mut child = match child {
            Ok(child) => child,
            Err(e) => {
                eprintln!("media helper: can't start {PERL}: {e}");
                return;
            }
        };
        let state = app.state::<MediaState>();
        *state.commands.lock().unwrap() = child.stdin.take();

        let mut art: Option<(u64, Arc<str>)> = None;
        for line in BufReader::new(child.stdout.take().unwrap()).lines() {
            let Ok(line) = line else { break };
            let Ok(mut track) = serde_json::from_str::<Track>(&line) else {
                continue;
            };
            if let Some(data) = track.artwork.take() {
                art = data_url(&data).map(|url| (track.artwork_id, Arc::from(url)));
            }
            let cover = art
                .as_ref()
                .filter(|(id, _)| *id == track.artwork_id && track.artwork_id != 0)
                .map(|(_, url)| url.clone());
            let empty = track.title.is_empty() && track.artist.is_empty();
            if !empty && !track.app.is_empty() {
                remember_player(app, &track.app);
            }
            *state.track.lock().unwrap() = (!empty).then_some((track, cover));
        }

        *state.commands.lock().unwrap() = None;
        *state.track.lock().unwrap() = None;
        let _ = child.wait();
        thread::sleep(RESTART);
    }
}

/// Writes the helper next to Lumen's caches (perl needs it as a file),
/// unless the same one is already there.
fn install_helper(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("mediaremote.dylib");
    if fs::read(&path).ok().as_deref() != Some(HELPER) {
        fs::write(&path, HELPER).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// The track the island shows: the helper's, unless its player is hidden in
/// the settings, with the position carried forward while it plays.
fn shown_track(app: &AppHandle) -> Option<NowPlaying> {
    let state = app.state::<MediaState>();
    let track = state.track.lock().unwrap();
    let (track, art) = track.as_ref()?;
    if settings::read(app, |s| s.players.hidden.contains(&track.app)) {
        return None;
    }
    let key = format!("{}\u{1f}{}\u{1f}{}", track.app, track.title, track.artist);
    let counted = {
        let mut clock = state.clock.lock().unwrap();
        // A track already on at the first poll started before Lumen did.
        let clock = clock.get_or_insert_with(|| Clock::new(&key, track.playing, false));
        clock.tick(&key, track.playing)
    };
    let mut position = if track.elapsed > 0.0 {
        // Players report where they were at `at`; carry it forward.
        let mut position = track.elapsed;
        if track.playing && track.at > 0.0 {
            let rate = if track.rate > 0.0 { track.rate } else { 1.0 };
            position += (now_ms() - track.at).max(0.0) / 1000.0 * rate;
        }
        position
    } else {
        counted.map_or(0.0, |d| d.as_secs_f64())
    };
    if track.duration > 0.0 {
        position = position.min(track.duration);
    }
    Some(NowPlaying {
        title: track.title.clone(),
        artist: track.artist.clone(),
        app: track.app.clone(),
        playing: track.playing,
        position_ms: (position * 1000.0) as u64,
        duration_ms: (track.duration.max(0.0) * 1000.0) as u64,
        art: art.clone(),
    })
}

/// Adds a player to the known ones, so it can be named or hidden in settings.
fn remember_player(app: &AppHandle, id: &str) {
    if !settings::read(app, |s| s.players.known.iter().any(|k| k == id)) {
        settings::remember_player(app, id);
    }
}

/// The cover as a data URL, typed by its bytes.
fn data_url(base64: &str) -> Option<String> {
    let bytes = STANDARD.decode(base64).ok()?;
    let mime = match bytes.as_slice() {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xff, 0xd8, 0xff, ..] => "image/jpeg",
        [b'G', b'I', b'F', ..] => "image/gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        [b'I', b'I', 42, 0, ..] | [b'M', b'M', 0, 42, ..] => "image/tiff",
        _ => "image/jpeg",
    };
    Some(format!("data:{mime};base64,{base64}"))
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The helper loads into perl and answers with a line Lumen can read:
    /// the track, or `{}` when nothing plays.
    #[test]
    fn helper_streams_from_perl() {
        let path = std::env::temp_dir().join(format!("lumen-mediaremote-{}.dylib", std::process::id()));
        fs::write(&path, HELPER).unwrap();
        let mut child = Command::new(PERL)
            .args(["-e", LOADER])
            .arg(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        // Closing stdin ends the helper.
        drop(child.stdin.take());
        assert!(child.wait().unwrap().success());
        let _ = fs::remove_file(&path);
        assert!(serde_json::from_str::<Track>(&line).is_ok(), "unreadable line: {line}");
    }

    #[test]
    fn cover_is_typed_by_its_bytes() {
        let png = STANDARD.encode(b"\x89PNG\r\n\x1a\n");
        assert!(data_url(&png).unwrap().starts_with("data:image/png;base64,"));
    }
}
