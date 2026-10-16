//! Screen capture on macOS. An area screenshot goes through the system's own
//! selection (`screencapture -i -c`, the same as Cmd+Ctrl+Shift+4), which
//! puts the picture on the clipboard. Text from the screen isn't wired up yet:
//! it needs Vision's text recognition.

use std::{process::Command, sync::Mutex, thread};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Shot,
    Text,
}

/// The mode of the selection in progress.
#[derive(Default)]
pub struct Capture {
    mode: Mutex<Option<Mode>>,
}

#[derive(Deserialize)]
pub struct Selection {}

#[derive(Clone, Serialize)]
struct Notice {
    title: String,
    detail: String,
}

pub fn start(app: &AppHandle, mode: Mode) {
    if mode == Mode::Text {
        notify(app, "Текст с экрана", "Пока не поддерживается на macOS");
        return;
    }
    {
        let capture = app.state::<Capture>();
        let mut current = capture.mode.lock().unwrap();
        if current.is_some() {
            return;
        }
        *current = Some(mode);
    }
    let app = app.clone();
    thread::spawn(move || {
        // Blocks until the area is picked or the selection is cancelled (Esc).
        let status = Command::new("/usr/sbin/screencapture").args(["-i", "-c", "-x"]).status();
        *app.state::<Capture>().mode.lock().unwrap() = None;
        if status.is_err() {
            notify(&app, "Не удалось сделать снимок", "");
        }
    });
}

/// The system selection handles Esc itself.
pub fn cancel(_app: &AppHandle) {}

#[tauri::command]
pub async fn capture_start(app: AppHandle, mode: Mode) {
    start(&app, mode);
}

#[tauri::command]
pub fn capture_mode(capture: State<Capture>) -> Option<Mode> {
    *capture.mode.lock().unwrap()
}

#[tauri::command]
pub fn capture_cancel(app: AppHandle) {
    cancel(&app);
}

/// There's no selection window of Lumen's own on macOS.
#[tauri::command]
pub fn capture_finish(_app: AppHandle, _selection: Selection) {}

fn notify(app: &AppHandle, title: &str, detail: &str) {
    let _ = app.emit(
        "lumen://notice",
        Notice {
            title: title.into(),
            detail: detail.into(),
        },
    );
}
