mod audio;
mod clipboard;
mod launcher;
mod media;
mod overlay;
mod pixels;
mod shelf;
mod shell_image;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch just exits.
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(overlay::HitRegion::default())
        .manage(overlay::Focus::default())
        .manage(media::MediaState::default())
        .manage(clipboard::History::default())
        .manage(launcher::Launcher::default())
        .manage(shelf::Shelf::default())
        .invoke_handler(tauri::generate_handler![
            overlay::set_hit_region,
            overlay::overlay_take_focus,
            overlay::overlay_release_focus,
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
            shelf::shelf_list,
            shelf::shelf_add,
            shelf::shelf_remove,
            shelf::shelf_clear,
            shelf::shelf_open,
            shelf::shelf_reveal,
            shelf::shelf_thumb,
            shelf::shelf_drag,
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
            shelf::init(app.handle());
            tray::init(app.handle())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
