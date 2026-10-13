//! Global hotkeys: one handler that routes each shortcut to its feature. The
//! shortcuts come from the settings and can be changed while Lumen runs.

use std::{
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

use crate::{capture, discord, launcher, media, settings};

const RETRY: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Launcher,
    Screenshot,
    Text,
    Mic,
    Play,
    Next,
    Previous,
}

#[derive(Default)]
pub struct Bindings {
    keys: Mutex<Vec<(Action, Shortcut)>>,
    /// Bumped on every change, so retry loops for old keys give up.
    generation: AtomicU64,
    /// While the settings window records a new shortcut, every key is let go
    /// so the pressed combination reaches it.
    suspended: AtomicBool,
    /// Serialises swaps and suspends, which arrive from parallel commands.
    op: Mutex<()>,
}

/// Esc is only registered while a screen selection is open, so it stays free
/// for every other app the rest of the time.
pub fn escape_key() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                if *shortcut == escape_key() {
                    capture::cancel(app);
                    return;
                }
                let action = app
                    .state::<Bindings>()
                    .keys
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|(_, key)| key == shortcut)
                    .map(|(action, _)| *action);
                match action {
                    Some(Action::Launcher) => launcher::toggle(app),
                    Some(Action::Screenshot) => capture::start(app, capture::Mode::Shot),
                    Some(Action::Text) => capture::start(app, capture::Mode::Text),
                    Some(Action::Mic) => {
                        if let Err(message) = discord::toggle_mute(app) {
                            let _ = app.emit("lumen://notice", json!({ "title": "Микрофон", "detail": message, "kind": "mic" }));
                        }
                    }
                    Some(Action::Play) => media_key(app, "toggle"),
                    Some(Action::Next) => media_key(app, "next"),
                    Some(Action::Previous) => media_key(app, "previous"),
                    None => {}
                }
            })
            .build(),
    )?;

    let hotkeys = settings::get(app).hotkeys;
    // Fall back to the defaults if the saved keys are somehow unusable.
    if apply(app, &hotkeys).is_err() {
        let _ = apply(app, &settings::Hotkeys::default());
    }
    Ok(())
}

/// Play, pause or skip the playing track, off the shortcut thread: the
/// player answers asynchronously.
fn media_key(app: &AppHandle, action: &'static str) {
    // The island shows an arrow on that side (or a play/pause mark).
    let _ = app.emit("lumen://media-key", action);
    let app = app.clone();
    thread::spawn(move || {
        let _ = media::media_control(app, action.into());
    });
}

/// Checks the shortcuts: each must parse, have a modifier and be unique.
/// Empty ones are switched off and skipped.
pub fn parse(hotkeys: &settings::Hotkeys) -> Result<Vec<(Action, Shortcut)>, String> {
    let mut keys: Vec<(Action, Shortcut)> = Vec::new();
    for (action, text) in [
        (Action::Launcher, &hotkeys.launcher),
        (Action::Screenshot, &hotkeys.screenshot),
        (Action::Text, &hotkeys.text),
        (Action::Mic, &hotkeys.mic),
        (Action::Play, &hotkeys.play),
        (Action::Next, &hotkeys.next),
        (Action::Previous, &hotkeys.previous),
    ] {
        if text.is_empty() {
            continue;
        }
        let key: Shortcut = text
            .parse()
            .map_err(|_| format!("Не получается разобрать сочетание «{text}»"))?;
        if key.mods.is_empty() {
            return Err("Нужен хотя бы один модификатор: Ctrl, Alt, Shift или Win".into());
        }
        if keys.iter().any(|(_, k)| *k == key) {
            return Err("Одно сочетание назначено на два действия".into());
        }
        keys.push((action, key));
    }
    Ok(keys)
}

/// Swaps the registered shortcuts for new ones.
pub fn apply(app: &AppHandle, hotkeys: &settings::Hotkeys) -> Result<(), String> {
    let keys = parse(hotkeys)?;
    let bindings = app.state::<Bindings>();
    let _op = bindings.op.lock().unwrap();
    let old = std::mem::replace(&mut *bindings.keys.lock().unwrap(), keys);
    let generation = bindings.generation.fetch_add(1, Ordering::SeqCst) + 1;
    unregister(app, &old);
    if !bindings.suspended.load(Ordering::SeqCst) {
        register(app, generation);
    }
    Ok(())
}

/// Lets go of every shortcut (`true`) or takes them back (`false`).
pub fn suspend(app: &AppHandle, on: bool) {
    let bindings = app.state::<Bindings>();
    let _op = bindings.op.lock().unwrap();
    if bindings.suspended.swap(on, Ordering::SeqCst) == on {
        return;
    }
    let generation = bindings.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let keys = bindings.keys.lock().unwrap().clone();
    if on {
        unregister(app, &keys);
        let _ = app.emit("lumen://hotkeys", ());
    } else {
        register(app, generation);
    }
}

#[tauri::command]
pub fn hotkeys_suspend(app: AppHandle, suspended: bool) {
    suspend(&app, suspended);
}

/// Actions whose shortcut is held by another app right now.
#[tauri::command]
pub fn hotkeys_busy(app: AppHandle) -> Vec<Action> {
    let bindings = app.state::<Bindings>();
    if bindings.suspended.load(Ordering::SeqCst) {
        return Vec::new();
    }
    let shortcuts = app.global_shortcut();
    let keys = bindings.keys.lock().unwrap();
    keys.iter()
        .filter(|(_, key)| !shortcuts.is_registered(*key))
        .map(|(action, _)| *action)
        .collect()
}

fn unregister(app: &AppHandle, keys: &[(Action, Shortcut)]) {
    let shortcuts = app.global_shortcut();
    for (_, key) in keys {
        if shortcuts.is_registered(*key) {
            let _ = shortcuts.unregister(*key);
        }
    }
}

fn register(app: &AppHandle, generation: u64) {
    let keys = app.state::<Bindings>().keys.lock().unwrap().clone();
    for (_, key) in keys {
        if app.global_shortcut().register(key).is_ok() {
            continue;
        }
        // Another tool (e.g. PowerToys Run) may hold a key; keep trying so it
        // starts working as soon as it's freed.
        eprintln!("hotkey {key} is busy, retrying");
        let handle = app.clone();
        thread::spawn(move || {
            loop {
                thread::sleep(RETRY);
                if handle.state::<Bindings>().generation.load(Ordering::SeqCst) != generation {
                    return;
                }
                if handle.global_shortcut().register(key).is_ok() {
                    let _ = handle.emit("lumen://hotkeys", ());
                    return;
                }
            }
        });
    }
    let _ = app.emit("lumen://hotkeys", ());
}
