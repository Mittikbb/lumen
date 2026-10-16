//! The game card on macOS: not wired up yet (Windows counts frames with ETW
//! and reads the load from PDH). The settings' preview does nothing.

use tauri::AppHandle;

#[tauri::command]
pub fn games_preview(app: AppHandle, pid: Option<u32>) {
    let _ = (app, pid);
}
