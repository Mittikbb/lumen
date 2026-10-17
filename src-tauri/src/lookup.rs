//! Data for the "h:" search, from the lackyhy/Protocol-list repository: its
//! lumen.json (HTTP codes and protocols, rebuilt there on every push) is
//! downloaded through the system proxy and kept in the app data folder, so
//! edits to the repository reach Lumen without a new release. Until the first
//! download, and without a network, the frontend's built-in list is used.

use std::{
    fs,
    io::Read,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

use crate::net;

/// Tried in order; jsDelivr is there for networks where GitHub's raw files
/// don't load (it may lag behind by a few hours).
const SOURCES: [&str; 2] = [
    "https://raw.githubusercontent.com/lackyhy/Protocol-list/main/lumen.json",
    "https://cdn.jsdelivr.net/gh/lackyhy/Protocol-list@main/lumen.json",
];
const LIMIT: u64 = 2 * 1024 * 1024;

fn cache_file(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("protocol-list.json"))
}

/// The last download: `{ fetchedAt, index }`, or `None` before the first.
#[tauri::command]
pub fn lookup_cached(app: AppHandle) -> Option<Value> {
    let text = fs::read_to_string(cache_file(&app)?).ok()?;
    serde_json::from_str(&text).ok()
}

/// Downloads lumen.json again, saves it and tells every window
/// (`lumen://lookup`); returns what it saved.
#[tauri::command]
pub async fn lookup_refresh(app: AppHandle) -> Result<Value, String> {
    let index = tauri::async_runtime::spawn_blocking(download)
        .await
        .map_err(|e| e.to_string())??;
    let fetched_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64);
    let cached = json!({ "fetchedAt": fetched_at, "index": index });
    if let Some(path) = cache_file(&app) {
        let _ = fs::write(path, cached.to_string());
    }
    let _ = app.emit("lumen://lookup", &cached);
    Ok(cached)
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
