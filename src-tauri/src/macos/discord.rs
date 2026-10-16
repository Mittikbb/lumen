//! Discord voice on macOS: not wired up yet. The RPC protocol is the same as
//! on Windows, only over a Unix socket (`$TMPDIR/discord-ipc-0`) instead of a
//! named pipe; until it's ported Discord stays "off".

use tauri::{AppHandle, State};

const UNSUPPORTED: &str = "Discord пока не поддерживается на macOS";

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    state: String,
    message: Option<String>,
}

#[derive(Default)]
pub struct Discord;

/// Settings changed: nothing to reconnect.
pub fn restart(_app: &AppHandle) {}

#[tauri::command]
pub fn discord_status(_discord: State<Discord>) -> Status {
    Status {
        state: "off".into(),
        message: Some(UNSUPPORTED.into()),
    }
}

#[tauri::command]
pub fn discord_voice(_discord: State<Discord>, action: String) -> Result<(), String> {
    let _ = action;
    Err(UNSUPPORTED.into())
}

pub fn toggle_mute(_app: &AppHandle) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

#[tauri::command]
pub fn discord_forget(_app: AppHandle) {}
