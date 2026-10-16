//! Downloads in progress, seen from the Downloads folder: browsers write to a
//! temporary file next to the final one (Chrome, Edge, Yandex and Opera to
//! `name.crdownload`, Firefox to `name.part`) and rename it when done. While
//! one is there the island shows its name, size and speed; once it's renamed
//! it says the file is in, then lets it go. Off unless switched on.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use windows::Win32::{
    System::Com::CoTaskMemFree,
    UI::Shell::{FOLDERID_Downloads, KNOWN_FOLDER_FLAG, SHGetKnownFolderPath},
};

use crate::settings;

const POLL: Duration = Duration::from_millis(700);
/// Temporary files of downloads in progress.
const PARTIAL: [&str; 3] = ["crdownload", "part", "partial"];
/// Chrome's name before it knows the real one: "Unconfirmed 123456.crdownload".
const UNCONFIRMED: &str = "Unconfirmed ";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    /// The temporary file's path, which tells downloads apart.
    id: String,
    /// The file's name when done; `None` while the browser hasn't chosen it.
    name: Option<String>,
    bytes: u64,
    /// Bytes per second, smoothed.
    speed: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finished {
    name: String,
    path: String,
    bytes: u64,
}

/// Files that finished downloading this session, the only ones the island
/// may reveal.
#[derive(Default)]
pub struct Downloads(Mutex<Vec<PathBuf>>);

/// What the watcher remembers about a temporary file between polls.
struct Seen {
    bytes: u64,
    at: Instant,
    speed: f64,
    /// The final path, once the temporary name gave it away.
    target: Option<PathBuf>,
}

/// Shows the finished file in Explorer.
#[tauri::command]
pub fn downloads_reveal(path: String, app: AppHandle, done: State<Downloads>) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !done.0.lock().unwrap().contains(&path) {
        return Err("not a download".into());
    }
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

pub fn spawn_watcher(app: AppHandle) {
    thread::spawn(move || {
        let mut seen: HashMap<PathBuf, Seen> = HashMap::new();
        let mut last_sent = String::new();
        loop {
            thread::sleep(POLL);
            let dir = match settings::read(&app, |s| s.downloads.enabled).then(downloads_dir).flatten() {
                Some(dir) => dir,
                None => {
                    if !seen.is_empty() || !last_sent.is_empty() {
                        seen.clear();
                        last_sent.clear();
                        let _ = app.emit("lumen://downloads", Vec::<Download>::new());
                    }
                    continue;
                }
            };
            let now = Instant::now();
            let mut active = Vec::new();
            for (path, bytes) in partial_files(&dir) {
                let target = final_path(&path);
                let entry = seen.entry(path.clone()).or_insert(Seen {
                    bytes,
                    at: now,
                    speed: 0.0,
                    target: None,
                });
                let secs = now.duration_since(entry.at).as_secs_f64();
                if secs > 0.0 {
                    let rate = bytes.saturating_sub(entry.bytes) as f64 / secs;
                    entry.speed = if entry.speed == 0.0 { rate } else { entry.speed * 0.6 + rate * 0.4 };
                }
                entry.bytes = bytes;
                entry.at = now;
                if target.is_some() {
                    entry.target = target.clone();
                }
                active.push(Download {
                    id: path.to_string_lossy().into_owned(),
                    name: target.and_then(|t| t.file_name().map(|n| n.to_string_lossy().into_owned())),
                    bytes,
                    speed: entry.speed as u64,
                });
            }

            // Gone temporary files: renamed into place (done) or cancelled.
            let gone: Vec<PathBuf> = seen.keys().filter(|p| !p.exists()).cloned().collect();
            for path in gone {
                let Some(was) = seen.remove(&path) else { continue };
                let Some(target) = was.target.filter(|t| t.exists()) else { continue };
                let bytes = fs::metadata(&target).map(|m| m.len()).unwrap_or(was.bytes);
                app.state::<Downloads>().0.lock().unwrap().push(target.clone());
                let _ = app.emit(
                    "lumen://download-done",
                    Finished {
                        name: target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                        path: target.to_string_lossy().into_owned(),
                        bytes,
                    },
                );
            }

            let key = serde_json::to_string(&active).unwrap_or_default();
            if key != last_sent {
                last_sent = key;
                let _ = app.emit("lumen://downloads", &active);
            }
        }
    });
}

/// The temporary files of downloads in progress in `dir`, with their sizes.
fn partial_files(dir: &Path) -> Vec<(PathBuf, u64)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|x| x.to_str())
                .is_some_and(|x| PARTIAL.iter().any(|p| x.eq_ignore_ascii_case(p)))
        })
        .filter_map(|e| Some((e.path(), e.metadata().ok()?.len())))
        .collect()
}

/// Where a temporary file ends up: itself without the extra extension, unless
/// the browser hasn't named it yet.
fn final_path(partial: &Path) -> Option<PathBuf> {
    let stem = partial.file_stem()?.to_string_lossy();
    if stem.starts_with(UNCONFIRMED) || stem.is_empty() {
        return None;
    }
    Some(partial.with_file_name(stem.as_ref()))
}

fn downloads_dir() -> Option<PathBuf> {
    unsafe {
        let path = SHGetKnownFolderPath(&FOLDERID_Downloads, KNOWN_FOLDER_FLAG(0), None).ok()?;
        let dir = path.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(path.0 as _));
        dir
    }
}
