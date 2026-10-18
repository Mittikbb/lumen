//! Tray icon (the menu bar on macOS): the only visible handle on Lumen besides
//! the island itself, with settings, the "start with Windows" toggle and quit.

use std::fs;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, Wry,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_autostart::ManagerExt;

#[cfg(windows)]
use crate::registry;
use crate::{logon_task, settings};

/// Where Windows keeps per-user autostart entries.
#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// Marks that autostart was set up once, so a user's "off" choice sticks.
const AUTOSTART_MARKER: &str = "autostart-configured";

/// How Lumen starts with Windows: `admin` means through the elevated
/// logon task instead of the Run key.
#[derive(Clone, Copy, Serialize)]
pub struct Autostart {
    pub on: bool,
    pub admin: bool,
}

/// The menu's autostart checkbox, kept in sync when the settings window flips it.
struct AutostartItem(CheckMenuItem<Wry>);

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    prepare_autostart(app);
    if !cfg!(debug_assertions) {
        // Asks schtasks: off the startup path.
        std::thread::spawn(logon_task::refresh);
    }

    // Dev builds would register the temporary debug executable, so the toggle
    // only works in installed (release) builds.
    let release = !cfg!(debug_assertions);
    let autostart_item = CheckMenuItem::with_id(
        app,
        "autostart",
        if release {
            if cfg!(target_os = "macos") {
                "Открывать при входе в систему"
            } else {
                "Запускать вместе с Windows"
            }
        } else {
            "Автозапуск (только в установленной версии)"
        },
        release,
        autostart(app).is_some_and(|a| a.on),
        None::<&str>,
    )?;
    let open_settings = MenuItem::with_id(app, "settings", "Настройки…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open_settings,
            &autostart_item,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    app.manage(AutostartItem(autostart_item));

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Lumen")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => {
                let _ = settings::open(app);
            }
            "autostart" => {
                // Turning off the admin task waits on a UAC prompt: not here,
                // on the UI thread.
                let app = app.clone();
                std::thread::spawn(move || {
                    let on = autostart(&app).is_some_and(|a| a.on);
                    set_autostart(&app, !on);
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Whether and how Lumen starts with Windows; `None` in dev builds.
pub fn autostart(app: &AppHandle) -> Option<Autostart> {
    if cfg!(debug_assertions) {
        return None;
    }
    let admin = logon_task::exists();
    let on = admin || app.autolaunch().is_enabled().unwrap_or(false);
    Some(Autostart { on, admin })
}

/// Turns autostart on or off and returns the resulting state. Turning it off
/// also removes the admin task, which asks for UAC.
pub fn set_autostart(app: &AppHandle, on: bool) -> Option<Autostart> {
    if cfg!(debug_assertions) {
        return None;
    }
    let manager = app.autolaunch();
    if on {
        if !logon_task::exists() {
            let _ = manager.enable();
        }
    } else {
        let _ = manager.disable();
        if logon_task::exists() {
            logon_task::remove(app);
        }
    }
    publish(app)
}

/// Switches autostart between the Run key and the elevated logon task. Blocks
/// until the user answers the UAC prompt; declining it changes nothing.
pub fn set_autostart_admin(app: &AppHandle, admin: bool) -> Option<Autostart> {
    if cfg!(debug_assertions) {
        return None;
    }
    let manager = app.autolaunch();
    if admin {
        // Only one of the two may start Lumen.
        if logon_task::create(app) {
            let _ = manager.disable();
        }
    } else if logon_task::remove(app) {
        let _ = manager.enable();
    }
    publish(app)
}

/// Syncs the tray checkbox and the settings window with the current state.
fn publish(app: &AppHandle) -> Option<Autostart> {
    let now = autostart(app)?;
    if let Some(item) = app.try_state::<AutostartItem>() {
        let _ = item.0.set_checked(now.on);
    }
    let _ = app.emit("lumen://autostart", now);
    Some(now)
}

/// Turns autostart on at the first run. Later runs fix the entry only if it
/// points at another exe (after a reinstall into another folder it would keep
/// starting a copy that's gone). Rewriting it on every start would look like
/// malware persistence: Kaspersky flagged 0.4.3 as PDM:Trojan.Win32.Generic.
fn prepare_autostart(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let marker = dir.join(AUTOSTART_MARKER);
    let manager = app.autolaunch();
    if marker.exists() {
        if autostart_is_stale(app) && manager.is_enabled().unwrap_or(false) {
            let _ = manager.enable();
        }
        return;
    }
    if manager.enable().is_ok() {
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(marker, "");
    }
}

/// The login item on macOS names the app bundle, which moves as a whole.
#[cfg(not(windows))]
fn autostart_is_stale(_app: &AppHandle) -> bool {
    false
}

/// Whether the autostart entry exists but starts some other exe.
#[cfg(windows)]
fn autostart_is_stale(app: &AppHandle) -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let name = &app.package_info().name;
    let Some(entry) = registry::string(registry::HKEY_CURRENT_USER, RUN_KEY, Some(name.as_str())) else {
        return false;
    };
    let target = entry.trim().trim_start_matches('"').to_lowercase();
    !target.starts_with(&exe.to_string_lossy().to_lowercase())
}
