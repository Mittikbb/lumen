//! The keyboard layout and Caps Lock, for the drop below the island. Only the
//! state is read, a few times a second (no keyboard hook): the layout of the
//! window in front and the Caps Lock toggle. A layout that changes because
//! another window came to the front isn't the user switching it, so it's
//! taken in silently.

use std::{thread, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Globalization::LCIDToLocaleName,
    UI::{
        Input::KeyboardAndMouse::{GetKeyState, GetKeyboardLayout, VK_CAPITAL},
        WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
    },
};

const POLL: Duration = Duration::from_millis(120);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyboardEvent {
    /// "layout" or "caps": what just changed.
    kind: &'static str,
    /// The layout's language, e.g. "RU" or "EN".
    layout: String,
    caps: bool,
}

pub fn spawn_watcher(app: AppHandle) {
    thread::spawn(move || {
        let mut last: Option<(isize, u16, bool)> = None;
        loop {
            thread::sleep(POLL);
            let (window, lang, caps) = unsafe {
                let window = GetForegroundWindow();
                let thread = GetWindowThreadProcessId(window, None);
                let layout = GetKeyboardLayout(thread);
                (window.0 as isize, (layout.0 as usize & 0xffff) as u16, GetKeyState(VK_CAPITAL.0 as i32) & 1 != 0)
            };
            if let Some((was_window, was_lang, was_caps)) = last {
                let kind = if caps != was_caps {
                    Some("caps")
                } else if lang != was_lang && window == was_window && lang != 0 {
                    Some("layout")
                } else {
                    None
                };
                if let Some(kind) = kind {
                    let _ = app.emit("lumen://keyboard", KeyboardEvent { kind, layout: language(lang), caps });
                }
            }
            last = Some((window, lang, caps));
        }
    });
}

/// "RU" for 0x0419 (ru-RU), "EN" for 0x0409 and so on.
fn language(lang: u16) -> String {
    let mut name = [0u16; 85];
    let len = unsafe { LCIDToLocaleName(lang as u32, Some(&mut name), 0) };
    if len <= 1 {
        return format!("{lang:04X}");
    }
    let name = String::from_utf16_lossy(&name[..len as usize - 1]);
    name.split('-').next().unwrap_or(&name).to_uppercase()
}
