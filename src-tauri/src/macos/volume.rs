//! Per-player volume on macOS: not wired up yet (Windows uses the WASAPI
//! session of the player). There's no per-app volume in Core Audio; it would
//! take an audio tap or the player's own AppleScript.

use serde::Serialize;

pub const UNSUPPORTED: &str = "Громкость плеера пока не поддерживается на macOS";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeState {
    pub volume: f32,
    pub muted: bool,
}

#[tauri::command]
pub async fn media_get_volume(app: String) -> Result<VolumeState, String> {
    let _ = app;
    Err(UNSUPPORTED.into())
}

#[tauri::command]
pub async fn media_set_volume(app: String, level: f32) -> Result<VolumeState, String> {
    let _ = (app, level);
    Err(UNSUPPORTED.into())
}

#[tauri::command]
pub async fn media_toggle_mute(app: String) -> Result<VolumeState, String> {
    let _ = app;
    Err(UNSUPPORTED.into())
}
