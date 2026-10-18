//! The app in front, for addons with the "foreground" permission. Watched
//! only while such an addon runs: a quick look a few times a second, sent to
//! the island as `lumen://front` whenever it changes.

use std::{
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const POLL: Duration = Duration::from_millis(250);

/// Bumped to stop the running watch (and start a new one).
static WATCH: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, PartialEq, Serialize)]
pub struct Front {
    /// The program's file name without ".exe", e.g. "dota2".
    app: String,
    /// The window's title (the app's name on macOS).
    title: String,
}

/// Starts or stops watching the app in front.
pub fn watch(app: &AppHandle, on: bool) {
    let generation = WATCH.fetch_add(1, Ordering::SeqCst) + 1;
    if !on {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        let mut last: Option<Front> = None;
        while WATCH.load(Ordering::SeqCst) == generation {
            // Lumen itself in front (the island took focus for typing) changes nothing.
            if let Some(now) = current()
                && last.as_ref() != Some(&now)
            {
                let _ = app.emit("lumen://front", &now);
                last = Some(now);
            }
            thread::sleep(POLL);
        }
    });
}

#[cfg(windows)]
pub fn current() -> Option<Front> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

    unsafe {
        let window = GetForegroundWindow();
        if window.is_invalid() {
            return None;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(window, Some(&mut pid));
        if pid == 0 || pid == std::process::id() {
            return None;
        }
        let app = crate::games::exe_stem(pid)?.to_lowercase();
        let mut title = [0u16; 512];
        let len = GetWindowTextW(window, &mut title).max(0) as usize;
        Some(Front { app, title: String::from_utf16_lossy(&title[..len]) })
    }
}

#[cfg(target_os = "macos")]
pub fn current() -> Option<Front> {
    use objc2_app_kit::NSWorkspace;

    let front = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    if front.processIdentifier() == std::process::id() as i32 {
        return None;
    }
    let app = front
        .executableURL()
        .and_then(|url| url.lastPathComponent())
        .map(|name| name.to_string().to_lowercase())
        .unwrap_or_default();
    let title = front.localizedName().map(|n| n.to_string()).unwrap_or_default();
    Some(Front { app, title })
}
