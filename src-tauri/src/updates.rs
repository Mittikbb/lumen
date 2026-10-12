//! Updates through the Tauri updater: the latest release carries a signed
//! manifest (latest.json), checked on demand from the settings and in the
//! background (shortly after start, then every few hours). A new version is
//! installed in one go — download, check the signature, run the installer
//! with just a progress bar, start again — from the settings at any time, or
//! by itself at start if the user allows. Mid-session the island only says
//! it's out, so Lumen never restarts under the user's hands.

use std::{sync::Mutex, thread, time::Duration};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State, Url};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

use crate::{net, settings};

const RELEASE_PAGE: &str = "https://github.com/Mittikbb/lumen/releases/tag/v";
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
    notes: String,
}

#[derive(Default)]
pub struct Updates {
    last: Mutex<Option<UpdateInfo>>,
    /// Version the island was already told about this session.
    announced: Mutex<Option<String>>,
}

/// Checks right now.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateInfo, String> {
    find(&app).await.map(|(info, _)| info)
}

/// The result of the last check, if any.
#[tauri::command]
pub fn update_last(updates: State<Updates>) -> Option<UpdateInfo> {
    updates.last.lock().unwrap().clone()
}

/// Installs the latest version now and starts it.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let (_, update) = find(&app).await?;
    install(&app, update.ok_or("Уже стоит последняя версия")?).await
}

pub fn spawn_checker(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(FIRST_CHECK);
        let mut at_start = true;
        loop {
            let prefs = settings::get(&app).updates;
            if prefs.auto
                && let Ok((info, update)) = tauri::async_runtime::block_on(find(&app))
            {
                // Right after start nothing is going on yet: a good moment to
                // update by itself. Dev builds never replace themselves.
                match update {
                    Some(update) if at_start && prefs.install && !cfg!(debug_assertions) => {
                        let _ = tauri::async_runtime::block_on(install(&app, update));
                    }
                    _ => announce(&app, &info, prefs.install),
                }
            }
            at_start = false;
            thread::sleep(EVERY);
        }
    });
}

/// The updater, through the same proxy as the rest of Lumen's traffic.
fn updater(app: &AppHandle) -> Result<Updater, String> {
    let mut builder = app.updater_builder();
    // Dev builds can be pointed at a test manifest.
    let test = std::env::var("LUMEN_UPDATE_URL").ok().filter(|_| cfg!(debug_assertions));
    if let Some(url) = test.and_then(|u| u.parse::<Url>().ok()) {
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    } else if let Some(proxy) = net::system_proxy().and_then(|p| p.parse::<Url>().ok()) {
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(|e| e.to_string())
}

async fn find(app: &AppHandle) -> Result<(UpdateInfo, Option<Update>), String> {
    let update = updater(app)?
        .check()
        .await
        .map_err(|e| format!("Не удалось проверить обновления: {e}"))?;
    let current = app.package_info().version.to_string();
    let latest = update.as_ref().map_or_else(|| current.clone(), |u| u.version.clone());
    let info = UpdateInfo {
        available: update.is_some(),
        url: format!("{RELEASE_PAGE}{latest}"),
        notes: update.as_ref().and_then(|u| u.body.clone()).unwrap_or_default(),
        current,
        latest,
    };
    *app.state::<Updates>().last.lock().unwrap() = Some(info.clone());
    let _ = app.emit("lumen://update", &info);
    Ok((info, update))
}

/// Downloads with progress for the settings, installs and starts again. On
/// Windows the installer takes over and closes Lumen itself.
async fn install(app: &AppHandle, update: Update) -> Result<(), String> {
    let progress = app.clone();
    let mut downloaded = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk;
                let _ = progress.emit("lumen://update-progress", json!({ "downloaded": downloaded, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|e| format!("Не удалось обновить: {e}"))?;
    app.restart()
}

/// A one-time notice on the island per new version.
fn announce(app: &AppHandle, info: &UpdateInfo, installs: bool) {
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
            "detail": if installs { "встанет при следующем запуске" } else { "обновить в настройках" },
            "kind": "update",
        }),
    );
}
