//! Screen capture on macOS, through the system's own area selection (the
//! same as Cmd+Ctrl+Shift+4): an area screenshot goes straight to the
//! clipboard (Alt+Shift+S); for text (Alt+Shift+T) the area is saved to a
//! temporary file, read with Vision's text recognition and the text copied.

use std::{fs, path::Path, process::Command, sync::Mutex, thread};

use objc2::AnyThread;
use objc2_foundation::{NSArray, NSDictionary, NSString, NSURL};
use objc2_vision::{
    VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::clipboard::sys as clipboard;

const SCREENCAPTURE: &str = "/usr/sbin/screencapture";

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
        match mode {
            Mode::Shot => {
                // Blocks until the area is picked or the selection is cancelled (Esc).
                if Command::new(SCREENCAPTURE).args(["-i", "-c", "-x"]).status().is_err() {
                    notify(&app, "Не удалось сделать снимок", "");
                }
            }
            Mode::Text => copy_text(&app),
        }
        *app.state::<Capture>().mode.lock().unwrap() = None;
    });
}

fn copy_text(app: &AppHandle) {
    let file = std::env::temp_dir().join(format!("lumen-text-{}.png", std::process::id()));
    let _ = fs::remove_file(&file);
    if Command::new(SCREENCAPTURE).args(["-i", "-x"]).arg(&file).status().is_err() {
        notify(app, "Не удалось сделать снимок", "");
        return;
    }
    // No file: the selection was cancelled.
    if !file.exists() {
        return;
    }
    // Recognition can take a while the first time (the model loads).
    notify(app, "Распознаю текст…", "");
    let text = recognize(&file);
    let _ = fs::remove_file(&file);
    match text {
        Some(text) if text.trim().is_empty() => notify(app, "Текст не найден", "Попробуй выделить крупнее"),
        Some(text) => {
            let chars = text.chars().filter(|c| !c.is_whitespace()).count();
            // Announce first, so the UI shows this rather than the generic
            // "copied" notice that the clipboard change triggers.
            notify(app, "Текст распознан", &format!("{chars} симв."));
            if let Err(e) = clipboard::write_text(&text) {
                notify(app, "Не удалось скопировать текст", &e);
            }
        }
        None => notify(app, "Распознавание недоступно", "Vision не смог прочитать снимок"),
    }
}

/// Vision's text recognition on an image file; lines joined with newlines,
/// top to bottom.
///
/// The accurate recogniser reads Russian and English, with the language
/// detected. On some macOS builds (27.0.x) its neural-engine model can fail
/// to load, sometimes after a long wait; then the fast one still reads Latin
/// text.
fn recognize(file: &Path) -> Option<String> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(file.to_str()?));
    let english = NSArray::from_retained_slice(&[NSString::from_str("en-US")]);
    for level in [VNRequestTextRecognitionLevel::Accurate, VNRequestTextRecognitionLevel::Fast] {
        let request = VNRecognizeTextRequest::new();
        request.setRecognitionLevel(level);
        request.setUsesLanguageCorrection(true);
        if level == VNRequestTextRecognitionLevel::Accurate {
            request.setAutomaticallyDetectsLanguage(true);
        } else {
            request.setRecognitionLanguages(&english);
        }
        let handler = unsafe {
            VNImageRequestHandler::initWithURL_options(VNImageRequestHandler::alloc(), &url, &NSDictionary::new())
        };
        let requests = NSArray::from_slice(&[AsRef::<VNRequest>::as_ref(&*request)]);
        match handler.performRequests_error(&requests) {
            Ok(()) => return Some(lines(&request)),
            Err(e) => eprintln!("text recognition ({level:?}): {}", e.localizedDescription()),
        }
    }
    None
}

fn lines(request: &VNRecognizeTextRequest) -> String {
    let Some(results) = request.results() else {
        return String::new();
    };
    results
        .iter()
        .filter_map(|o| o.topCandidates(1).firstObject())
        .map(|t| t.string().to_string())
        .collect::<Vec<_>>()
        .join("\n")
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

