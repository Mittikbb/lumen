//! Tray icon: the only visible handle on Lumen besides the island itself, with
//! the "start with Windows" toggle and quit.

use std::fs;

use tauri::{
    AppHandle, Manager,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_autostart::ManagerExt;

/// Marks that autostart was set up once, so a user's "off" choice sticks.
const AUTOSTART_MARKER: &str = "autostart-configured";

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    enable_autostart_on_first_run(app);

    // Dev builds would register the temporary debug executable, so the toggle
    // only works in installed (release) builds.
    let release = !cfg!(debug_assertions);
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        if release {
            "Запускать вместе с Windows"
        } else {
            "Автозапуск (только в установленной версии)"
        },
        release,
        release && app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&autostart, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Lumen")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "autostart" => {
                let manager = app.autolaunch();
                let on = manager.is_enabled().unwrap_or(false);
                let _ = if on {
                    manager.disable()
                } else {
                    manager.enable()
                };
                let _ = autostart.set_checked(manager.is_enabled().unwrap_or(false));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
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
