//! Tray icon: the only visible handle on Lumen besides the island itself, with
//! settings, the "start with Windows" toggle and quit.

use std::fs;

use tauri::{
    AppHandle, Emitter, Manager, Wry,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_autostart::ManagerExt;

use crate::settings;

/// Marks that autostart was set up once, so a user's "off" choice sticks.
const AUTOSTART_MARKER: &str = "autostart-configured";

/// The menu's autostart checkbox, kept in sync when the settings window flips it.
struct AutostartItem(CheckMenuItem<Wry>);

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    enable_autostart_on_first_run(app);

    // Dev builds would register the temporary debug executable, so the toggle
    // only works in installed (release) builds.
    let release = !cfg!(debug_assertions);
    let autostart_item = CheckMenuItem::with_id(
        app,
        "autostart",
        if release {
            "Запускать вместе с Windows"
        } else {
            "Автозапуск (только в установленной версии)"
        },
        release,
        autostart(app).unwrap_or(false),
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
                let on = autostart(app).unwrap_or(false);
                set_autostart(app, !on);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Whether Lumen starts with Windows; `None` in dev builds.
pub fn autostart(app: &AppHandle) -> Option<bool> {
    if cfg!(debug_assertions) {
        return None;
    }
    Some(app.autolaunch().is_enabled().unwrap_or(false))
}

/// Turns autostart on or off and returns the resulting state.
pub fn set_autostart(app: &AppHandle, on: bool) -> Option<bool> {
    if cfg!(debug_assertions) {
        return None;
    }
    let manager = app.autolaunch();
    let _ = if on {
        manager.enable()
    } else {
        manager.disable()
    };
    let now = manager.is_enabled().unwrap_or(false);
    if let Some(item) = app.try_state::<AutostartItem>() {
        let _ = item.0.set_checked(now);
    }
    let _ = app.emit("lumen://autostart", now);
    Some(now)
}

fn enable_autostart_on_first_run(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let marker = dir.join(AUTOSTART_MARKER);
    if marker.exists() {
        return;
    }
    if app.autolaunch().enable().is_ok() {
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(marker, "");
    }
}
