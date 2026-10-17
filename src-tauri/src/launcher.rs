//! Alt+Space launcher: the island turns into a search box for apps, maths,
//! unit conversion, web search and asking the AI app.
//!
//! The overlay window is normally non-focusable so it never steals focus. While
//! the launcher is open it temporarily accepts focus to receive typing, and
//! hands focus back to the previous window when closed.

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::HashMap,
    process::Command,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{browser, clipboard::sys as clipboard, overlay, settings, shell_image};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// The app list is refreshed on open when older than this.
const APPS_TTL: Duration = Duration::from_secs(300);

/// AI apps to open, in order of preference (matched by Start menu name).
const AI_APPS: [&str; 4] = ["Claude", "ChatGPT", "Gemini", "Copilot"];

#[derive(Clone, Serialize, Deserialize)]
pub struct App {
    #[serde(rename(deserialize = "Name"))]
    name: String,
    /// Start menu AppID: an AUMID for Store apps, a path for classic ones.
    /// On macOS the path of the `.app` bundle.
    #[serde(rename(deserialize = "AppID"))]
    id: String,
}

#[derive(Default)]
pub struct Launcher {
    apps: Mutex<Vec<App>>,
    loaded: Mutex<Option<Instant>>,
    open: Mutex<bool>,
    /// App icons as PNG data URLs by AppID; `None` when the shell has none.
    icons: Mutex<HashMap<String, Option<String>>>,
}

pub fn init(app: &AppHandle) {
    let handle = app.clone();
    thread::spawn(move || refresh_apps(&handle));
}

/// Alt+Space: opens the launcher, or closes it if it's already open.
pub fn toggle(app: &AppHandle) {
    let open = *app.state::<Launcher>().open.lock().unwrap();
    if open {
        close(app, true);
    } else {
        let _ = open_launcher(app);
    }
}

#[tauri::command]
pub fn launcher_open(app: AppHandle) -> Result<(), String> {
    open_launcher(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launcher_close(app: AppHandle, restore_focus: bool) {
    close(&app, restore_focus);
}

#[tauri::command]
pub fn launcher_apps(launcher: State<Launcher>) -> Vec<App> {
    launcher.apps.lock().unwrap().clone()
}

/// The AI app to open: the one picked in settings if it's still installed,
/// otherwise the first known one.
#[tauri::command]
pub fn launcher_ai_app(app: AppHandle) -> Option<App> {
    let chosen = settings::get(&app).ai_app;
    let launcher = app.state::<Launcher>();
    let apps = launcher.apps.lock().unwrap();
    chosen
        .and_then(|id| apps.iter().find(|a| a.id == id).cloned())
        .or_else(|| known_ai_apps(&apps).into_iter().next())
}

/// Installed AI apps Lumen knows about, in order of preference.
#[tauri::command]
pub fn launcher_ai_apps(launcher: State<Launcher>) -> Vec<App> {
    known_ai_apps(&launcher.apps.lock().unwrap())
}

fn known_ai_apps(apps: &[App]) -> Vec<App> {
    AI_APPS
        .iter()
        .filter_map(|name| apps.iter().find(|a| a.name.starts_with(name)))
        .cloned()
        .collect()
}

/// Icon for an app, from cache or extracted on a worker thread.
#[tauri::command]
pub async fn launcher_icon(app: AppHandle, id: String) -> Option<String> {
    if !known_app(&app, &id) {
        return None;
    }
    if let Some(cached) = app.state::<Launcher>().icons.lock().unwrap().get(&id) {
        return cached.clone();
    }
    let key = id.clone();
    let icon = tauri::async_runtime::spawn_blocking(move || shell_image::app_icon(&key))
        .await
        .ok()
        .flatten();
    app.state::<Launcher>()
        .icons
        .lock()
        .unwrap()
        .insert(id, icon.clone());
    icon
}

/// Starts a Start menu app. Only ids from the app list are taken: the shell
/// would start any program path handed to it the same way.
#[tauri::command]
pub fn launcher_run(app: AppHandle, id: String) -> Result<(), String> {
    if !known_app(&app, &id) {
        return Err("not a Start menu app".into());
    }
    close(&app, false);
    start_app(&id).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn start_app(id: &str) -> Command {
    let mut command = Command::new("explorer.exe");
    command.arg(format!("shell:AppsFolder\\{id}"));
    command
}

#[cfg(target_os = "macos")]
fn start_app(id: &str) -> Command {
    let mut command = Command::new("/usr/bin/open");
    command.arg(id);
    command
}

#[tauri::command]
pub fn launcher_open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only web links are allowed".into());
    }
    close(&app, false);
    browser::open_url(&app, &url)
}

#[tauri::command]
pub fn launcher_copy(app: AppHandle, text: String) -> Result<(), String> {
    clipboard::write_text(&text)?;
    close(&app, true);
    Ok(())
}

/// Copies the question and opens the AI app, so it can be pasted with Ctrl+V.
#[tauri::command]
pub fn launcher_ask_ai(app: AppHandle, id: String, question: String) -> Result<(), String> {
    if !known_app(&app, &id) {
        return Err("not a Start menu app".into());
    }
    if !question.trim().is_empty() {
        clipboard::write_text(&question)?;
    }
    launcher_run(app, id)
}

/// Whether `id` is in the Start menu app list the launcher shows.
fn known_app(app: &AppHandle, id: &str) -> bool {
    app.state::<Launcher>().apps.lock().unwrap().iter().any(|a| a.id == id)
}

fn open_launcher(app: &AppHandle) -> tauri::Result<()> {
    let launcher = app.state::<Launcher>();
    *launcher.open.lock().unwrap() = true;
    overlay::take_focus(app)?;
    let _ = app.emit("lumen://launcher", true);

    let stale = launcher
        .loaded
        .lock()
        .unwrap()
        .is_none_or(|t| t.elapsed() > APPS_TTL);
    if stale {
        let handle = app.clone();
        thread::spawn(move || refresh_apps(&handle));
    }
    Ok(())
}

fn close(app: &AppHandle, restore_focus: bool) {
    let launcher = app.state::<Launcher>();
    {
        let mut open = launcher.open.lock().unwrap();
        if !*open {
            return;
        }
        *open = false;
    }
    let _ = app.emit("lumen://launcher", false);
    overlay::release_focus(app, restore_focus);
}

/// Loads the app list and warms the icon cache.
fn refresh_apps(app: &AppHandle) {
    let Some(mut apps) = installed_apps() else { return };

    apps.retain(|a| !is_noise(&a.name));
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps.dedup_by(|a, b| a.name == b.name && a.id == b.id);

    let launcher = app.state::<Launcher>();
    *launcher.apps.lock().unwrap() = apps.clone();
    *launcher.loaded.lock().unwrap() = Some(Instant::now());
    let _ = app.emit("lumen://apps", ());

    // Warm the icon cache so results show icons as soon as you type.
    for a in apps {
        if launcher.icons.lock().unwrap().contains_key(&a.id) {
            continue;
        }
        let icon = shell_image::app_icon(&a.id);
        launcher.icons.lock().unwrap().insert(a.id, icon);
    }
}

/// The Start menu app list (classic and Store apps), via PowerShell.
#[cfg(windows)]
fn installed_apps() -> Option<Vec<App>> {
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let json = String::from_utf8_lossy(&output.stdout);
    // A single app comes back as an object rather than an array.
    serde_json::from_str::<Vec<App>>(&json)
        .or_else(|_| serde_json::from_str::<App>(&json).map(|a| vec![a]))
        .ok()
}

/// The `.app` bundles in the Applications folders (and one level of
/// subfolders, where suites like Adobe's or Microsoft's keep theirs).
#[cfg(target_os = "macos")]
fn installed_apps() -> Option<Vec<App>> {
    use std::path::{Path, PathBuf};

    fn scan(dir: &Path, depth: u8, apps: &mut Vec<App>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            match name.strip_suffix(".app") {
                Some(stem) => apps.push(App {
                    name: stem.to_string(),
                    id: path.to_string_lossy().into_owned(),
                }),
                None if depth > 0 && path.is_dir() => scan(&path, depth - 1, apps),
                None => {}
            }
        }
    }

    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join("Applications"));
    }
    let mut apps = Vec::new();
    for dir in dirs {
        scan(&dir, 1, &mut apps);
    }
    Some(apps)
}

/// Uninstallers, docs and links that clutter app search.
fn is_noise(name: &str) -> bool {
    let n = name.to_lowercase();
    [
        "uninstall",
        "удалить",
        "удаление",
        "release notes",
        "documentation",
        "website",
        "manuals",
    ]
    .iter()
    .any(|w| n.contains(w))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn finds_mac_apps_with_icons() {
        let apps = installed_apps().unwrap();
        let calculator = apps
            .iter()
            .find(|a| a.name == "Calculator")
            .expect("Calculator.app ships with macOS");
        assert!(calculator.id.ends_with("/Calculator.app"));
        let icon = shell_image::app_icon(&calculator.id).expect("an app has an icon");
        assert!(icon.starts_with("data:image/png;base64,"));
    }
}
