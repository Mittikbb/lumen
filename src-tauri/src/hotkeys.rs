//! Global hotkeys: one handler that routes each shortcut to its feature.

use std::{thread, time::Duration};

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::{capture, launcher};

const RETRY: Duration = Duration::from_secs(5);

fn launcher_key() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT), Code::Space)
}
fn screenshot_key() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyS)
}
fn text_key() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyT)
}
/// Esc is only registered while a screen selection is open, so it stays free
/// for every other app the rest of the time.
pub fn escape_key() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                if *shortcut == launcher_key() {
                    launcher::toggle(app);
                } else if *shortcut == screenshot_key() {
                    capture::start(app, capture::Mode::Shot);
                } else if *shortcut == text_key() {
                    capture::start(app, capture::Mode::Text);
                } else if *shortcut == escape_key() {
                    capture::cancel(app);
                }
            })
            .build(),
    )?;

    for key in [launcher_key(), screenshot_key(), text_key()] {
        let handle = app.clone();
        // Another tool (e.g. PowerToys Run) may hold a key; keep trying so it
        // starts working as soon as it's freed.
        thread::spawn(move || {
            while let Err(e) = handle.global_shortcut().register(key) {
                eprintln!("hotkey {key} is busy, retrying: {e}");
                thread::sleep(RETRY);
            }
        });
    }
    Ok(())
}
