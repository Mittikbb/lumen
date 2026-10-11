//! Update check: compares this build with the latest GitHub release, on demand
//! from the settings and in the background (shortly after start, then every
//! few hours), and tells the island once when a newer version is out.

use std::{sync::Mutex, thread, time::Duration};

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{net, settings};

const LATEST_URL: &str = "https://api.github.com/repos/Mittikbb/lumen/releases/latest";
const FIRST_CHECK: Duration = Duration::from_secs(20);
const EVERY: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current: String,
    latest: String,
    available: bool,
    /// Release page with the notes.
    url: String,
    /// The installer, when the release has one.
    download: Option<String>,
    notes: String,
}

#[derive(Default)]
pub struct Updates {
    last: Mutex<Option<UpdateInfo>>,
    /// Version the island was already told about this session.
    announced: Mutex<Option<String>>,
}

/// Checks right now. Async so the network wait stays off the UI thread.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateInfo, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || check(&handle))
        .await
        .map_err(|e| e.to_string())?
}

/// The result of the last check, if any.
#[tauri::command]
pub fn update_last(updates: State<Updates>) -> Option<UpdateInfo> {
    updates.last.lock().unwrap().clone()
}

pub fn spawn_checker(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(FIRST_CHECK);
        loop {
            if settings::get(&app).updates.auto {
                if let Ok(info) = check(&app) {
                    announce(&app, &info);
                }
            }
            thread::sleep(EVERY);
        }
    });
}

fn check(app: &AppHandle) -> Result<UpdateInfo, String> {
    let release: Value = net::agent()
        .get(LATEST_URL)
        .set("User-Agent", "Lumen")
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Не удалось проверить обновления: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;

    let current = app.package_info().version.to_string();
    let latest = release["tag_name"]
        .as_str()
        .ok_or("GitHub не вернул версию")?
        .trim_start_matches('v')
        .to_string();
    let download = release["assets"].as_array().and_then(|assets| {
        assets
            .iter()
            .find(|a| {
                a["name"]
                    .as_str()
                    .is_some_and(|n| n.ends_with("-setup.exe"))
            })
            .and_then(|a| a["browser_download_url"].as_str())
            .map(String::from)
    });
    let info = UpdateInfo {
        available: newer(&latest, &current),
        url: release["html_url"].as_str().unwrap_or_default().into(),
        notes: release["body"].as_str().unwrap_or_default().into(),
        download,
        current,
        latest,
    };
    *app.state::<Updates>().last.lock().unwrap() = Some(info.clone());
    let _ = app.emit("lumen://update", &info);
    Ok(info)
}

/// A one-time notice on the island per new version.
fn announce(app: &AppHandle, info: &UpdateInfo) {
    if !info.available {
        return;
    }
    let updates = app.state::<Updates>();
    let mut announced = updates.announced.lock().unwrap();
    if announced.as_deref() == Some(info.latest.as_str()) {
        return;
    }
    *announced = Some(info.latest.clone());
    let _ = app.emit(
        "lumen://notice",
        json!({
            "title": format!("Вышел Lumen {}", info.latest),
            "detail": "скачать в настройках",
            "kind": "update",
        }),
    );
}

/// Whether version `a` ("0.4.2") is newer than `b`.
fn newer(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.split(['.', '-'])
            .map_while(|part| part.parse().ok())
            .collect()
    };
    parse(a) > parse(b)
}

#[cfg(test)]
mod tests {
    use super::newer;

    #[test]
    fn compares_versions() {
        assert!(newer("0.4.1", "0.4.0"));
        assert!(newer("0.10.0", "0.9.9"));
        assert!(!newer("0.4.0", "0.4.0"));
        assert!(!newer("0.3.0", "0.4.1"));
    }
}
