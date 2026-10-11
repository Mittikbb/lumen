//! Clipboard history: watches the Windows clipboard for new text and images,
//! remembers the last entries (persisted to disk) and pastes a chosen one into
//! whatever app has focus. Lumen's window never takes focus, so the user's app
//! stays active.

pub(crate) mod win;

use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;

use crate::pixels;
use win::Content;

const MAX_ENTRIES: usize = 60;
const MAX_IMAGES: usize = 20;
const MAX_TEXT: usize = 20_000;
const POLL: Duration = Duration::from_millis(250);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: u64,
    /// Empty for images.
    text: String,
    #[serde(default)]
    image: Option<ClipImage>,
    /// Executable the content was copied from, e.g. "chrome".
    app: Option<String>,
    /// Unix time in ms.
    at: u64,
    #[serde(default)]
    pinned: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipImage {
    width: u32,
    height: u32,
    /// Small PNG preview as a data URL.
    thumb: String,
    /// Full-size PNG in the history's image folder.
    file: String,
    hash: u64,
}

#[derive(Default)]
pub struct History {
    entries: Mutex<Vec<Entry>>,
    /// App data folder: `clipboard.json` plus `clips/` with full-size images.
    dir: Mutex<Option<PathBuf>>,
}

impl History {
    fn snapshot(&self) -> Vec<Entry> {
        self.entries.lock().unwrap().clone()
    }

    fn images_dir(&self) -> Option<PathBuf> {
        self.dir.lock().unwrap().as_ref().map(|d| d.join("clips"))
    }

    /// Persists and broadcasts the current list.
    fn changed(&self, app: &AppHandle) {
        let entries = self.snapshot();
        if let Some(dir) = self.dir.lock().unwrap().as_ref() {
            if let Ok(json) = serde_json::to_string(&entries) {
                let _ = fs::write(dir.join("clipboard.json"), json);
            }
        }
        let _ = app.emit("lumen://clipboard", entries);
    }

    /// Removes entries matching `drop`, deleting their image files.
    fn remove_where(&self, drop: impl Fn(&Entry) -> bool) {
        let images = self.images_dir();
        self.entries.lock().unwrap().retain(|e| {
            let gone = drop(e);
            if gone {
                if let (Some(dir), Some(img)) = (&images, &e.image) {
                    let _ = fs::remove_file(dir.join(&img.file));
                }
            }
            !gone
        });
    }

    /// Adds content to the top; an identical existing entry is moved up instead.
    fn push(&self, content: Content, app: Option<String>) {
        let at = now_ms();
        let (text, image) = match content {
            Content::Text(text) => {
                if text.trim().is_empty() || text.len() > MAX_TEXT {
                    return;
                }
                (text, None)
            }
            Content::Image(rgba) => {
                let hash = pixels::hash(&rgba);
                if self.move_to_top(|e| e.image.as_ref().is_some_and(|i| i.hash == hash), at) {
                    return;
                }
                match self.store_image(&rgba, hash, at) {
                    Some(img) => (String::new(), Some(img)),
                    None => return,
                }
            }
        };
        if image.is_none() && self.move_to_top(|e| e.image.is_none() && e.text == text, at) {
            return;
        }

        {
            let mut entries = self.entries.lock().unwrap();
            entries.push(Entry {
                id: at,
                text,
                image,
                app,
                at,
                pinned: false,
            });
            sort(&mut entries);
        }
        self.trim();
    }

    /// Bumps a matching entry to "just now". Returns whether one was found.
    fn move_to_top(&self, matches: impl Fn(&Entry) -> bool, at: u64) -> bool {
        let mut entries = self.entries.lock().unwrap();
        let Some(entry) = entries.iter_mut().find(|e| matches(e)) else {
            return false;
        };
        entry.at = at;
        sort(&mut entries);
        true
    }

    fn store_image(&self, rgba: &image::RgbaImage, hash: u64, at: u64) -> Option<ClipImage> {
        let dir = self.images_dir()?;
        fs::create_dir_all(&dir).ok()?;
        let file = format!("{at}.png");
        fs::write(dir.join(&file), pixels::encode_png(rgba)?).ok()?;
        Some(ClipImage {
            width: rgba.width(),
            height: rgba.height(),
            thumb: pixels::thumbnail(rgba)?,
            file,
            hash,
        })
    }

    /// Drops the oldest unpinned entries beyond the text and image limits.
    fn trim(&self) {
        let entries = self.snapshot();
        let mut total = 0;
        let mut images = 0;
        let mut excess = Vec::new();
        // `entries` is newest first within each group, so walk it in order.
        for e in &entries {
            total += 1;
            images += e.image.is_some() as usize;
            if !e.pinned && (total > MAX_ENTRIES || (e.image.is_some() && images > MAX_IMAGES)) {
                excess.push(e.id);
            }
        }
        if !excess.is_empty() {
            self.remove_where(|e| excess.contains(&e.id));
        }
    }
}

/// Pinned entries first, each group newest first.
fn sort(entries: &mut [Entry]) {
    entries.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.at.cmp(&a.at)));
}

#[tauri::command]
pub fn clipboard_history(history: State<History>) -> Vec<Entry> {
    history.snapshot()
}

#[tauri::command]
pub fn clipboard_paste(id: u64, history: State<History>) -> Result<(), String> {
    let entry = history
        .snapshot()
        .into_iter()
        .find(|e| e.id == id)
        .ok_or("entry not found")?;

    match &entry.image {
        Some(img) => {
            let path = history.images_dir().ok_or("no data dir")?.join(&img.file);
            let png = fs::read(path).map_err(|e| e.to_string())?;
            let rgba = pixels::decode_png(&png).ok_or("broken image")?;
            win::write_image(&rgba, &png)?;
        }
        None => win::write_text(&entry.text)?,
    }
    // The watcher sees the new clipboard content and moves the entry to the top.
    thread::sleep(Duration::from_millis(40));
    win::send_ctrl_v();
    Ok(())
}

#[tauri::command]
pub fn clipboard_delete(id: u64, app: AppHandle, history: State<History>) {
    history.remove_where(|e| e.id == id);
    history.changed(&app);
}

#[tauri::command]
pub fn clipboard_pin(id: u64, app: AppHandle, history: State<History>) {
    {
        let mut entries = history.entries.lock().unwrap();
        if let Some(e) = entries.iter_mut().find(|e| e.id == id) {
            e.pinned = !e.pinned;
        }
        sort(&mut entries);
    }
    history.changed(&app);
}

#[tauri::command]
pub fn clipboard_clear(app: AppHandle, history: State<History>) {
    history.remove_where(|e| !e.pinned);
    history.changed(&app);
}

pub fn spawn_watcher(app: AppHandle) {
    let history = app.state::<History>();
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = fs::create_dir_all(&dir);
        if let Some(saved) = fs::read_to_string(dir.join("clipboard.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<Entry>>(&s).ok())
        {
            *history.entries.lock().unwrap() = saved;
        }
        *history.dir.lock().unwrap() = Some(dir);
    }

    thread::spawn(move || {
        let mut seq = unsafe { GetClipboardSequenceNumber() };
        loop {
            thread::sleep(POLL);
            let current = unsafe { GetClipboardSequenceNumber() };
            if current == seq {
                continue;
            }
            seq = current;

            if let Some((content, source)) = win::read() {
                let history = app.state::<History>();
                history.push(content, source);
                history.changed(&app);
            }
        }
    });
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}
