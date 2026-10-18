//! The Windows logon task's twin: macOS has no "start as administrator", so
//! there's never a task and the admin switch stays hidden.

use tauri::AppHandle;

pub fn exists() -> bool {
    false
}

pub fn create(_app: &AppHandle) -> bool {
    false
}

pub fn remove(_app: &AppHandle) -> bool {
    true
}

pub fn refresh() {}
