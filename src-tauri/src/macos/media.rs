//! "Now playing" on macOS: not wired up yet (Windows reads SMTC). The island
//! simply never gets a track; the commands answer as if nothing is playing.
//! The way in is MediaRemote (private) or AppleScript per player.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Clone, Serialize)]
pub struct NowPlaying {}

#[derive(Default)]
pub struct MediaState(Mutex<Option<NowPlaying>>);

#[tauri::command]
pub fn media_state(state: State<MediaState>) -> Option<NowPlaying> {
    state.0.lock().unwrap().clone()
}

/// Nothing to control while no player is seen.
#[tauri::command]
pub fn media_control(_app: AppHandle, _action: String) -> Result<(), String> {
    Ok(())
}
