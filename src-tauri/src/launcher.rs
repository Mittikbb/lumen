//! Alt+Space launcher: the island turns into a search box for apps, maths,
//! unit conversion, web search and asking the AI app.
//!
//! The overlay window is normally non-focusable so it never steals focus. While
//! the launcher is open it temporarily accepts focus to receive typing, and
//! hands focus back to the previous window when closed.

use std::{
    collections::HashMap,
    os::windows::process::CommandExt,
    process::Command,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use windows::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow},
};

use crate::{clipboard::win as clipboard, shell_image};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// The app list is refreshed on open when older than this.
const APPS_TTL: Duration = Duration::from_secs(300);
const HOTKEY_RETRY: Duration = Duration::from_secs(5);

/// AI apps to open, in order of preference (matched by Start menu name).
const AI_APPS: [&str; 4] = ["Claude", "ChatGPT", "Gemini", "Copilot"];

#[derive(Clone, Serialize, Deserialize)]
pub struct App {
    #[serde(rename(deserialize = "Name"))]
    name: String,
    /// Start menu AppID: an AUMID for Store apps, a path for classic ones.
    #[serde(rename(deserialize = "AppID"))]
    id: String,
}

#[derive(Default)]
pub struct Launcher {
    apps: Mutex<Vec<App>>,
    loaded: Mutex<Option<Instant>>,
    open: Mutex<bool>,
    /// Window that had focus before the launcher opened, as a raw HWND.
    previous: Mutex<isize>,
    /// App icons as PNG data URLs by AppID; `None` when the shell has none.
    icons: Mutex<HashMap<String, Option<String>>>,
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let alt_space = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if *shortcut == alt_space && event.state() == ShortcutState::Pressed {
                    let open = *app.state::<Launcher>().open.lock().unwrap();
                    if open {
                        close(app, true);
                    } else {
                        let _ = open_launcher(app);
                    }
                }
            })
            .build(),
    )?;

    // Another tool (e.g. PowerToys Run) may hold Alt+Space; keep trying so the
    // launcher starts working as soon as it's freed.
    let handle = app.clone();
    thread::spawn(move || {
        loop {
            match handle.global_shortcut().register(alt_space) {
                Ok(()) => break,
                Err(e) => eprintln!("Alt+Space is busy, retrying: {e}"),
            }
            thread::sleep(HOTKEY_RETRY);
        }
    });

    let handle = app.clone();
    thread::spawn(move || refresh_apps(&handle));
    Ok(())
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

/// Name of the preferred installed AI app, if any.
#[tauri::command]
pub fn launcher_ai_app(launcher: State<Launcher>) -> Option<App> {
    let apps = launcher.apps.lock().unwrap();
    AI_APPS
        .iter()
        .find_map(|name| apps.iter().find(|a| a.name.starts_with(name)))
        .cloned()
}

/// Icon for an app, from cache or extracted on a worker thread.
#[tauri::command]
pub async fn launcher_icon(app: AppHandle, id: String) -> Option<String> {
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

#[tauri::command]
pub fn launcher_run(app: AppHandle, id: String) -> Result<(), String> {
    close(&app, false);
    Command::new("explorer.exe")
        .arg(format!("shell:AppsFolder\\{id}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launcher_open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only web links are allowed".into());
    }
    close(&app, false);
    // Prefer Chrome; fall back to the default browser if it isn't installed.
    let opener = app.opener();
    opener
        .open_url(&url, Some("chrome"))
        .or_else(|_| opener.open_url(&url, None::<&str>))
        .map_err(|e| e.to_string())
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
    if !question.trim().is_empty() {
        clipboard::write_text(&question)?;
    }
    launcher_run(app, id)
}

fn open_launcher(app: &AppHandle) -> tauri::Result<()> {
    let launcher = app.state::<Launcher>();
    let window = app
        .get_webview_window("main")
        .expect("main window is missing");
    {
        let mut open = launcher.open.lock().unwrap();
        if !*open {
            *launcher.previous.lock().unwrap() = unsafe { GetForegroundWindow() }.0 as isize;
        }
        *open = true;
    }
    window.set_focusable(true)?;
    window.set_focus()?;
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
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focusable(false);
    }
    if restore_focus {
        let previous = *launcher.previous.lock().unwrap();
        if previous != 0 {
            let _ = unsafe { SetForegroundWindow(HWND(previous as *mut _)) };
        }
    }
}

/// Loads the Start menu app list (classic and Store apps) via PowerShell.
fn refresh_apps(app: &AppHandle) {
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let Ok(output) = output else { return };
    let json = String::from_utf8_lossy(&output.stdout);
    // A single app comes back as an object rather than an array.
    let parsed = serde_json::from_str::<Vec<App>>(&json)
        .or_else(|_| serde_json::from_str::<App>(&json).map(|a| vec![a]));
    let Ok(mut apps) = parsed else { return };

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
