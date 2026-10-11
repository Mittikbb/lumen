mod app_icons;
mod audio;
mod clipboard;
mod launcher;
mod media;
mod overlay;
mod pixels;

use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(overlay::HitRegion::default())
        .manage(media::MediaState::default())
        .manage(clipboard::History::default())
        .manage(launcher::Launcher::default())
        .invoke_handler(tauri::generate_handler![
            overlay::set_hit_region,
            media::media_state,
            media::media_control,
            clipboard::clipboard_history,
            clipboard::clipboard_paste,
            clipboard::clipboard_delete,
            clipboard::clipboard_pin,
            clipboard::clipboard_clear,
            launcher::launcher_open,
            launcher::launcher_close,
            launcher::launcher_apps,
            launcher::launcher_ai_app,
            launcher::launcher_icon,
            launcher::launcher_run,
            launcher::launcher_open_url,
            launcher::launcher_copy,
            launcher::launcher_ask_ai,
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window is missing");

            overlay::dock_to_top(&window)?;
            overlay::spawn_cursor_tracker(app.handle().clone());
            media::spawn_watcher(app.handle().clone());
            audio::spawn_analyser(app.handle().clone());
            clipboard::spawn_watcher(app.handle().clone());
            launcher::init(app.handle())?;

            let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Lumen")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
