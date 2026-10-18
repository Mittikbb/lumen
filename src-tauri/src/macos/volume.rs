//! A player's own volume on macOS. There's no per-app mixer like Windows'
//! audio sessions, so this goes through the players that take AppleScript
//! (Spotify, Music); for the rest the island shows no slider. The first use
//! asks for permission to control the player (Privacy & Security →
//! Automation). Mute is volume 0, remembering the level to go back to.

use std::{collections::HashMap, process::Command, sync::Mutex};

use serde::Serialize;

/// Players whose volume can be read and set, by bundle id.
const SCRIPTABLE: [&str; 2] = ["com.spotify.client", "com.apple.Music"];
const UNSUPPORTED: &str = "Этот плеер не даёт менять свою громкость";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeState {
    pub volume: f32,
    pub muted: bool,
}

/// Levels (0..=100) to go back to on unmute, by player.
static MUTED: Mutex<Option<HashMap<String, i64>>> = Mutex::new(None);

#[tauri::command]
pub async fn media_get_volume(app: String) -> Result<VolumeState, String> {
    blocking(move || read(&app)).await
}

#[tauri::command]
pub async fn media_set_volume(app: String, level: f32) -> Result<VolumeState, String> {
    blocking(move || {
        let level = (level.clamp(0.0, 1.0) * 100.0).round() as i64;
        forget_mute(&app);
        set(&app, level)?;
        read(&app)
    })
    .await
}

#[tauri::command]
pub async fn media_toggle_mute(app: String) -> Result<VolumeState, String> {
    blocking(move || {
        let current = level(&app)?;
        let back = MUTED.lock().unwrap().get_or_insert_default().remove(&app);
        match back {
            Some(level) if current == 0 => set(&app, level)?,
            _ => {
                MUTED.lock().unwrap().get_or_insert_default().insert(app.clone(), current.max(1));
                set(&app, 0)?;
            }
        }
        read(&app)
    })
    .await
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

fn read(app: &str) -> Result<VolumeState, String> {
    let level = level(app)?;
    let muted = level == 0 && MUTED.lock().unwrap().get_or_insert_default().contains_key(app);
    Ok(VolumeState { volume: level as f32 / 100.0, muted })
}

fn forget_mute(app: &str) {
    MUTED.lock().unwrap().get_or_insert_default().remove(app);
}

fn level(app: &str) -> Result<i64, String> {
    let out = script(app, "get sound volume")?;
    out.trim().parse().map_err(|_| format!("unexpected answer: {out}"))
}

fn set(app: &str, level: i64) -> Result<(), String> {
    script(app, &format!("set sound volume to {}", level.clamp(0, 100))).map(|_| ())
}

/// Runs `command` in the player, only if it's running (AppleScript would
/// start it otherwise).
fn script(app: &str, command: &str) -> Result<String, String> {
    if !SCRIPTABLE.contains(&app) {
        return Err(UNSUPPORTED.into());
    }
    let source = format!(
        "if application id \"{app}\" is running then\n tell application id \"{app}\" to {command}\nelse\n error \"not running\"\nend if"
    );
    let output = Command::new("/usr/bin/osascript")
        .args(["-e", &source])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
