//! Data for the "h:" search, from the lackyhy/Protocol-list repository: its
//! lumen.json (HTTP codes and protocols, rebuilt there on every push) is
//! downloaded through the system proxy, so edits to the repository reach
//! Lumen without a new release. Nothing is written to disk: the last copy
//! lives in memory until Lumen quits, and until the first download (or
//! without a network) the frontend's built-in list is used.

use std::{
    io::Read,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::net;

/// Tried in order; jsDelivr is there for networks where GitHub's raw files
/// don't load (it may lag behind by a few hours).
const SOURCES: [&str; 2] = [
    "https://raw.githubusercontent.com/lackyhy/Protocol-list/main/.github/lumen.json",
    "https://cdn.jsdelivr.net/gh/lackyhy/Protocol-list@main/.github/lumen.json",
];
const LIMIT: u64 = 2 * 1024 * 1024;

/// The last download: `{ fetchedAt, index }`.
#[derive(Default)]
pub struct Lookup(Mutex<Option<Value>>);

/// Drops the file earlier builds kept the list in.
pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::remove_file(dir.join("protocol-list.json"));
    }
}

/// The copy downloaded since Lumen started, or `None`.
#[tauri::command]
pub fn lookup_cached(lookup: State<Lookup>) -> Option<Value> {
    lookup.0.lock().unwrap().clone()
}

/// Downloads lumen.json again, keeps it in memory and tells every window
/// (`lumen://lookup`); returns it.
#[tauri::command]
pub async fn lookup_refresh(app: AppHandle) -> Result<Value, String> {
    let index = tauri::async_runtime::spawn_blocking(download)
        .await
        .map_err(|e| e.to_string())??;
    let fetched_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64);
    let copy = json!({ "fetchedAt": fetched_at, "index": index });
    *app.state::<Lookup>().0.lock().unwrap() = Some(copy.clone());
    let _ = app.emit("lumen://lookup", &copy);
    Ok(copy)
}

fn download() -> Result<Value, String> {
    let agent = net::agent();
    let mut last = String::new();
    for url in SOURCES {
        let response = match agent.get(url).call() {
            Ok(r) => r,
            Err(e) => {
                last = e.to_string();
                continue;
            }
        };
        let mut body = String::new();
        if let Err(e) = response.into_reader().take(LIMIT).read_to_string(&mut body) {
            last = e.to_string();
            continue;
        }
        match serde_json::from_str::<Value>(&body) {
            Ok(index) if index["http"].is_array() && index["protocols"].is_array() => return Ok(index),
            Ok(_) => last = format!("{url}: not a lumen.json"),
            Err(e) => last = format!("{url}: {e}"),
        }
    }
    Err(last)
}
