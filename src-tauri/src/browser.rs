//! Web browsers: the installed ones come from the list Windows keeps for
//! "Default apps" (StartMenuInternet), and links open in the one picked in
//! settings.

use std::{path::Path, process::Command};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::{
    registry::{self, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
    settings,
};

const CLIENTS: &str = r"SOFTWARE\Clients\StartMenuInternet";
/// Settings value for "the browser Windows uses by default".
const SYSTEM: &str = "system";

#[derive(Clone, Serialize)]
pub struct Browser {
    /// Registry key name, stable across updates (e.g. "Google Chrome").
    id: String,
    name: String,
    #[serde(skip)]
    exe: String,
}

#[derive(Serialize)]
pub struct Browsers {
    all: Vec<Browser>,
    /// What "automatic" resolves to: Chrome if installed, else the system default.
    auto: Option<Browser>,
}

#[tauri::command]
pub fn browser_list() -> Browsers {
    let all = installed();
    let auto = chrome(&all);
    Browsers { all, auto }
}

/// Opens a web link in the browser chosen in settings.
pub fn open_url(app: &AppHandle, url: &str) -> Result<(), String> {
    let all = installed();
    let browser = match settings::get(app).browser.as_deref() {
        Some(SYSTEM) => None,
        Some(id) => all.iter().find(|b| b.id == id).cloned(),
        None => chrome(&all),
    };
    if let Some(browser) = browser {
        if Command::new(&browser.exe).arg(url).spawn().is_ok() {
            return Ok(());
        }
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

fn chrome(all: &[Browser]) -> Option<Browser> {
    all.iter().find(|b| b.name.contains("Chrome")).cloned()
}

/// Browsers registered for the current user and machine-wide.
fn installed() -> Vec<Browser> {
    let mut all: Vec<Browser> = Vec::new();
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for id in registry::subkeys(root, CLIENTS) {
            // Internet Explorer is still registered on Windows 11 but only hands off to Edge.
            if all.iter().any(|b| b.id == id) || id.eq_ignore_ascii_case("IEXPLORE.EXE") {
                continue;
            }
            let key = format!(r"{CLIENTS}\{id}");
            let Some(command) = registry::string(root, &format!(r"{key}\shell\open\command"), None)
            else {
                continue;
            };
            // Uninstallers sometimes leave the registration behind.
            let Some(exe) = exe_path(&command).filter(|exe| Path::new(exe).exists()) else {
                continue;
            };
            let name = registry::string(root, &key, None).unwrap_or_else(|| id.clone());
            all.push(Browser { id, name, exe });
        }
    }
    all.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    all
}

/// `"C:\...\chrome.exe" --flag` → `C:\...\chrome.exe`.
fn exe_path(command: &str) -> Option<String> {
    let command = command.trim();
    let path = match command.strip_prefix('"') {
        Some(rest) => rest.split('"').next()?,
        None => {
            let end = command.to_lowercase().find(".exe")? + 4;
            &command[..end]
        }
    };
    Some(path.to_string())
}
