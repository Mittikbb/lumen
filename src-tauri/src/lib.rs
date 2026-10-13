mod audio;
mod browser;
mod capture;
mod clipboard;
mod discord;
mod downloads;
mod hotkeys;
mod launcher;
mod media;
mod net;
mod overlay;
mod pixels;
mod registry;
mod settings;
mod shelf;
mod shell_image;
mod tray;
mod updates;
mod volume;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch (e.g. from the Start menu)
        // exits and opens the settings in the running instance instead.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = settings::open(app);
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(overlay::HitRegion::default())
        .manage(overlay::Focus::default())
        .manage(overlay::AnchorState::default())
        .manage(overlay::Dragging::default())
        .manage(media::MediaState::default())
        .manage(clipboard::History::default())
        .manage(launcher::Launcher::default())
        .manage(shelf::Shelf::default())
        .manage(capture::Capture::default())
        .manage(settings::Store::default())
        .manage(hotkeys::Bindings::default())
        .manage(discord::Discord::default())
        .manage(updates::Updates::default())
        .manage(downloads::Downloads::default())
        .invoke_handler(tauri::generate_handler![
            overlay::set_hit_region,
            overlay::overlay_take_focus,
            overlay::overlay_release_focus,
            overlay::overlay_monitors,
            overlay::overlay_anchor,
            overlay::overlay_drag_start,
            overlay::overlay_drag_by,
            overlay::overlay_drag_end,
            media::media_state,
            media::media_control,
            volume::media_get_volume,
            volume::media_set_volume,
            volume::media_toggle_mute,
            clipboard::clipboard_history,
            clipboard::clipboard_paste,
            clipboard::clipboard_delete,
            clipboard::clipboard_pin,
            clipboard::clipboard_clear,
            launcher::launcher_open,
            launcher::launcher_close,
            launcher::launcher_apps,
            launcher::launcher_ai_app,
            launcher::launcher_ai_apps,
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
            capture::capture_start,
            capture::capture_mode,
            capture::capture_cancel,
            capture::capture_finish,
            settings::settings_get,
            settings::settings_update,
            settings::settings_autostart,
            settings::settings_set_autostart,
            settings::settings_open,
            browser::browser_list,
            discord::discord_status,
            discord::discord_voice,
            discord::discord_forget,
            updates::update_check,
            updates::update_last,
            updates::update_install,
            hotkeys::hotkeys_suspend,
            hotkeys::hotkeys_busy,
            downloads::downloads_reveal,
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window is missing");

            settings::init(app.handle());
            overlay::dock_to_top(&window)?;
            overlay::spawn_cursor_tracker(app.handle().clone());
            overlay::spawn_fullscreen_watch(app.handle().clone());
            media::spawn_watcher(app.handle().clone());
            audio::spawn_analyser(app.handle().clone());
            clipboard::spawn_watcher(app.handle().clone());
            launcher::init(app.handle());
            hotkeys::init(app.handle())?;
            shelf::init(app.handle());
            tray::init(app.handle())?;
            discord::init(app.handle());
            updates::spawn_checker(app.handle().clone());
            downloads::spawn_watcher(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
