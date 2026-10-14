//! File shelf: drop files on the island to park them, drag them out later into
//! any app. The shelf keeps references (paths), not copies, and survives
//! restarts.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, Runtime, State, Window, WindowEvent};
use tauri_plugin_opener::OpenerExt;

use crate::{pixels, settings, shell_image};

/// Tile previews are ~56 px; 128 stays sharp on high-DPI screens.
const THUMB_SIZE: i32 = 128;
/// Size of the picture under the cursor while dragging a file out.
const DRAG_IMAGE_SIZE: i32 = 96;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    id: u64,
    path: String,
    name: String,
    is_dir: bool,
    /// Unix ms.
    added: u64,
    /// Whether the file is still there; refreshed whenever the list is read.
    #[serde(default)]
    exists: bool,
}

#[derive(Default)]
pub struct Shelf {
    items: Mutex<Vec<Item>>,
    file: Mutex<Option<PathBuf>>,
    /// Thumbnails as data URLs by path.
    thumbs: Mutex<HashMap<String, Option<String>>>,
    /// Files from the last drop on the island, the only ones the shelf takes:
    /// the page can't shelve a path of its choosing and then open it.
    dropped: Mutex<HashSet<String>>,
}

impl Shelf {
    fn snapshot(&self) -> Vec<Item> {
        let mut items = self.items.lock().unwrap().clone();
        for item in &mut items {
            item.exists = Path::new(&item.path).exists();
        }
        items
    }

    fn changed(&self, app: &AppHandle) {
        let items = self.snapshot();
        if let Some(path) = self.file.lock().unwrap().as_ref() {
            if let Ok(json) = serde_json::to_string(&items) {
                let _ = fs::write(path, json);
            }
        }
        let _ = app.emit("lumen://shelf", items);
    }

    fn holds(&self, path: &str) -> bool {
        self.items.lock().unwrap().iter().any(|i| i.path == path)
    }

    fn path_of(&self, id: u64) -> Option<String> {
        let items = self.items.lock().unwrap();
        items.iter().find(|i| i.id == id).map(|i| i.path.clone())
    }
}

pub fn init(app: &AppHandle) {
    let shelf = app.state::<Shelf>();
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("shelf.json");
        if let Some(saved) = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<Item>>(&s).ok())
        {
            *shelf.items.lock().unwrap() = saved;
        }
        *shelf.file.lock().unwrap() = Some(path);
    }
}

/// Remembers what the user dropped on the island. Runs before the page hears
/// of the drop and asks to shelve it. The island is a webview window, so the
/// drop comes as a window event, not a webview one.
pub fn on_drop<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event else {
        return;
    };
    if window.label() != "main" {
        return;
    }
    let shelf = window.state::<Shelf>();
    let mut dropped = shelf.dropped.lock().unwrap();
    dropped.clear();
    dropped.extend(paths.iter().map(|p| p.to_string_lossy().into_owned()));
}

#[tauri::command]
pub fn shelf_list(shelf: State<Shelf>) -> Vec<Item> {
    shelf.snapshot()
}

/// Adds dropped files to the front of the shelf. Returns the names added.
#[tauri::command]
pub fn shelf_add(paths: Vec<String>, app: AppHandle, shelf: State<Shelf>) -> Vec<String> {
    let dropped = std::mem::take(&mut *shelf.dropped.lock().unwrap());
    let mut added = Vec::new();
    {
        let mut items = shelf.items.lock().unwrap();
        let mut id = now_ms();
        for path in paths {
            let p = Path::new(&path);
            if !dropped.contains(&path) || !p.exists() {
                continue;
            }
            items.retain(|i| i.path != path);
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            added.push(name.clone());
            items.insert(
                0,
                Item {
                    id,
                    path: path.clone(),
                    name,
                    is_dir: p.is_dir(),
                    added: id,
                    exists: true,
                },
            );
            id += 1; // unique ids within one drop
        }
        items.truncate(settings::get(&app).shelf.limit.max(1));
    }
    shelf.changed(&app);
    added
}

#[tauri::command]
pub fn shelf_remove(id: u64, app: AppHandle, shelf: State<Shelf>) {
    shelf.items.lock().unwrap().retain(|i| i.id != id);
    shelf.changed(&app);
}

#[tauri::command]
pub fn shelf_clear(app: AppHandle, shelf: State<Shelf>) {
    shelf.items.lock().unwrap().clear();
    shelf.changed(&app);
}

#[tauri::command]
pub fn shelf_open(id: u64, app: AppHandle, shelf: State<Shelf>) -> Result<(), String> {
    let path = shelf.path_of(id).ok_or("not on the shelf")?;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn shelf_reveal(id: u64, app: AppHandle, shelf: State<Shelf>) -> Result<(), String> {
    let path = shelf.path_of(id).ok_or("not on the shelf")?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| e.to_string())
}

/// Preview for a shelf tile, cached; extracted on a worker thread.
#[tauri::command]
pub async fn shelf_thumb(path: String, app: AppHandle) -> Option<String> {
    if !app.state::<Shelf>().holds(&path) {
        return None;
    }
    if let Some(cached) = app.state::<Shelf>().thumbs.lock().unwrap().get(&path) {
        return cached.clone();
    }
    let key = path.clone();
    let thumb = tauri::async_runtime::spawn_blocking(move || {
        shell_image::file_thumbnail(&key, THUMB_SIZE).and_then(|img| pixels::png_data_url(&img))
    })
    .await
    .ok()
    .flatten();
    app.state::<Shelf>()
        .thumbs
        .lock()
        .unwrap()
        .insert(path, thumb.clone());
    thumb
}

/// Starts a system drag of shelf files, so they can be dropped into any app.
#[tauri::command]
pub fn shelf_drag(ids: Vec<u64>, app: AppHandle, shelf: State<Shelf>) -> Result<(), String> {
    let paths: Vec<PathBuf> = ids
        .iter()
        .filter_map(|&id| shelf.path_of(id))
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .collect();
    let Some(first) = paths.first() else {
        return Err("nothing to drag".into());
    };
    let image = shell_image::file_thumbnail(&first.to_string_lossy(), DRAG_IMAGE_SIZE)
        .and_then(|img| pixels::encode_png(&img))
        .unwrap_or_default();

    let window = app.get_webview_window("main").ok_or("no window")?;
    let handle = app.clone();
    // OLE drag and drop has to run on the UI thread.
    app.run_on_main_thread(move || {
        let done = handle.clone();
        let started = drag::start_drag(
            &window,
            drag::DragItem::Files(paths),
            drag::Image::Raw(image),
            // Tells the UI the outgoing drag is over, dropped or cancelled.
            move |_, _| {
                let _ = done.emit("lumen://shelf-drag-end", ());
            },
            drag::Options::default(),
        );
        if started.is_err() {
            let _ = handle.emit("lumen://shelf-drag-end", ());
        }
    })
    .map_err(|e| e.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}
