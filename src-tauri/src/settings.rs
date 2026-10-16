//! User settings: hotkeys, apps, the island's shape, look and behaviour, module
//! limits and Discord. Stored as settings.json next to the shelf and clipboard
//! history; every change is broadcast to all windows as `lumen://settings`.
//!
//! Only what the backend acts on is typed here. Preferences only the frontend
//! reads (island size, motion, clock, weather units...) pass through as-is.
//!
//! The settings window is a regular, focusable window, but like every Lumen
//! window it's created hidden and non-activating and only made focusable once
//! shown, so shell mods that restyle new windows leave it alone.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent, window::Color,
};

use crate::{discord, hotkeys, overlay, secret, tray};

pub const WINDOW: &str = "settings";

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub hotkeys: Hotkeys,
    /// Start menu AppID of the AI app; `None` picks the first one installed.
    pub ai_app: Option<String>,
    /// Browser for web links: a StartMenuInternet key, "system" for the
    /// Windows default, or `None` for Chrome when it's installed.
    pub browser: Option<String>,
    /// Island tabs the user switched off (search always stays).
    pub hidden_tabs: Vec<String>,
    pub city: Option<City>,
    pub look: Look,
    pub display: Display,
    pub clipboard: ClipboardPrefs,
    pub shelf: ShelfPrefs,
    pub discord: DiscordPrefs,
    pub updates: UpdatePrefs,
    pub players: PlayerPrefs,
    pub downloads: DownloadPrefs,
    pub games: GamePrefs,
    /// Frontend-only groups, kept untouched.
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

/// A game taking the screen: the island pops out with its FPS and the PC's
/// load for a few seconds (games.rs); off until switched on.
#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GamePrefs {
    pub stats: bool,
}

/// Downloads shown on the island; off until switched on.
#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DownloadPrefs {
    pub enabled: bool,
}

/// Media players by their SMTC app id: the ones seen playing, the ones the
/// island leaves out, and names the user gave them.
#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlayerPrefs {
    /// Players that have played something, in the order they first did.
    pub known: Vec<String>,
    /// Players the island (and the Discord status) ignores.
    pub hidden: Vec<String>,
    /// The user's names for players; empty means the built-in one.
    pub names: BTreeMap<String, String>,
}

/// Adds a player to the known ones the first time it plays something.
pub fn remember_player(app: &AppHandle, id: &str) {
    let mut known = get(app).players.known;
    if known.iter().any(|k| k == id) {
        return;
    }
    known.push(id.to_string());
    let _ = settings_update(app.clone(), serde_json::json!({ "players": { "known": known } }));
}

/// Where the island lives.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Display {
    /// Monitor name; `None` for the primary one.
    pub monitor: Option<String>,
    /// Hide while a fullscreen app (game, video) is in front.
    pub hide_fullscreen: bool,
    /// Hide while a window is maximized (zoomed) on the island's monitor.
    pub hide_maximized: bool,
    /// Where the island was dragged on its monitor; `None` keeps it centred
    /// along the top edge.
    pub position: Option<Position>,
}

impl Default for Display {
    fn default() -> Self {
        Self {
            monitor: None,
            hide_fullscreen: true,
            hide_maximized: false,
            position: None,
        }
    }
}

/// A dragged island's spot, relative to its monitor so it survives a change
/// of resolution or monitor.
#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Position {
    /// Island centre as a share of the monitor width (0 left, 1 right).
    pub x: f64,
    /// Island top below the monitor's top edge, in CSS px.
    pub y: f64,
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClipboardPrefs {
    /// Entries kept, pinned ones aside.
    pub limit: usize,
    /// Unpinned entries older than this many days are dropped; 0 keeps them.
    pub keep_days: u64,
    /// Executables (e.g. "keepass") whose copies aren't remembered.
    pub ignore: Vec<String>,
}

impl Default for ClipboardPrefs {
    fn default() -> Self {
        Self {
            limit: 60,
            keep_days: 0,
            ignore: Vec::new(),
        }
    }
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ShelfPrefs {
    pub limit: usize,
}

impl Default for ShelfPrefs {
    fn default() -> Self {
        Self { limit: 40 }
    }
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdatePrefs {
    /// Look for a new release in the background and announce it.
    pub auto: bool,
    /// Install a found update by itself right after start.
    pub install: bool,
}

impl Default for UpdatePrefs {
    fn default() -> Self {
        Self {
            auto: true,
            install: true,
        }
    }
}

/// The user's own Discord application, needed for the local RPC connection.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscordPrefs {
    pub enabled: bool,
    pub client_id: String,
    pub client_secret: String,
    /// Show the voice channel on the island.
    pub voice: bool,
    /// Show what's playing as the Discord status.
    pub presence: bool,
}

impl Default for DiscordPrefs {
    fn default() -> Self {
        Self {
            enabled: false,
            client_id: String::new(),
            client_secret: String::new(),
            voice: true,
            presence: true,
        }
    }
}

/// Shortcuts as `Alt+Shift+KeyS`: modifiers plus a W3C key code. An empty
/// one is switched off; the newer actions start that way.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Hotkeys {
    pub launcher: String,
    pub screenshot: String,
    pub text: String,
    /// Your Discord mic on or off.
    pub mic: String,
    /// The playing track: play or pause, next, previous.
    pub play: String,
    pub next: String,
    pub previous: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            launcher: "Alt+Space".into(),
            screenshot: "Alt+Shift+KeyS".into(),
            text: "Alt+Shift+KeyT".into(),
            mic: String::new(),
            play: String::new(),
            next: String::new(),
            previous: String::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct City {
    name: String,
    area: String,
    latitude: f64,
    longitude: f64,
}

/// The island's look; values are interpreted by the frontend.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Look {
    /// "off", "soft", "normal" or "bright".
    glow: String,
    /// "glow" breathes around the island, "flow" ("Перелив") runs along it.
    style: String,
    /// Glow palette when there's no album art to take colours from.
    accent: String,
    /// Tint the glow with the album art of the playing track.
    art_colors: bool,
    /// Pulse with the music instead of breathing at a fixed pace.
    beat: bool,
    /// Stretch toward an approaching pointer.
    lean: bool,
    /// Fields only the frontend reads (glow size, pace, own colours...),
    /// kept as they are so new ones don't need a change here.
    #[serde(flatten)]
    rest: Map<String, Value>,
}

impl Default for Look {
    fn default() -> Self {
        Self {
            glow: "normal".into(),
            style: "glow".into(),
            accent: "sunset".into(),
            art_colors: true,
            beat: true,
            lean: true,
            rest: Map::new(),
        }
    }
}

#[derive(Default)]
pub struct Store {
    settings: Mutex<Settings>,
    file: Mutex<Option<PathBuf>>,
}

/// Loads settings.json; call before anything reads the settings.
pub fn init(app: &AppHandle) {
    let store = app.state::<Store>();
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("settings.json");
    if let Some(mut saved) = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
    {
        let stored = std::mem::take(&mut saved.discord.client_secret);
        // One that can't be opened (profile from another PC) has to be entered again.
        saved.discord.client_secret = secret::open(&stored).unwrap_or_default();
        // A secret saved before secrets were sealed gets sealed now.
        if !stored.is_empty() && stored == saved.discord.client_secret {
            save(&path, &saved);
        }
        *store.settings.lock().unwrap() = saved;
    }
    *store.file.lock().unwrap() = Some(path);
}

/// Writes settings.json with the Discord app secret sealed.
fn save(path: &Path, settings: &Settings) {
    let mut on_disk = settings.clone();
    // Never in the clear: if sealing fails, the secret isn't kept at all.
    on_disk.discord.client_secret = secret::seal(&settings.discord.client_secret).unwrap_or_default();
    if let Ok(json) = serde_json::to_string_pretty(&on_disk) {
        let _ = fs::write(path, json);
    }
}

pub fn get(app: &AppHandle) -> Settings {
    app.state::<Store>().settings.lock().unwrap().clone()
}

/// A part of the settings, without cloning the rest: for loops that look
/// several times a second.
pub fn read<T>(app: &AppHandle, f: impl FnOnce(&Settings) -> T) -> T {
    f(&app.state::<Store>().settings.lock().unwrap())
}

#[tauri::command]
pub fn settings_get(store: State<Store>) -> Settings {
    store.settings.lock().unwrap().clone()
}

/// Merges `patch` (any subset of the settings, `null` resets a field) into the
/// current settings, applies and saves them.
#[tauri::command]
pub fn settings_update(app: AppHandle, patch: Value) -> Result<Settings, String> {
    let store = app.state::<Store>();
    let (prev, next) = {
        let mut current = store.settings.lock().unwrap();
        let mut value = serde_json::to_value(&*current).map_err(|e| e.to_string())?;
        merge(&mut value, patch);
        let next: Settings = serde_json::from_value(value).map_err(|e| e.to_string())?;
        if next.hotkeys != current.hotkeys {
            hotkeys::parse(&next.hotkeys)?;
        }
        (std::mem::replace(&mut *current, next.clone()), next)
    };

    if let Some(path) = store.file.lock().unwrap().as_ref() {
        save(path, &next);
    }
    if next.hotkeys != prev.hotkeys {
        hotkeys::apply(&app, &next.hotkeys)?;
    }
    // Clipboard and shelf limits apply on the next addition, so dragging a
    // slider down and back up never throws entries away.
    // The expanded size bounds where a dragged island may sit.
    if next.display.monitor != prev.display.monitor
        || next.display.position != prev.display.position
        || next.rest.get("island") != prev.rest.get("island")
    {
        overlay::redock(&app);
    }
    if next.discord != prev.discord {
        discord::restart(&app);
    }
    let _ = app.emit("lumen://settings", &next);
    Ok(next)
}

/// Autostart state; `None` in dev builds, where it can't be changed.
/// Async (here and below) since it asks schtasks, and switching the admin
/// task waits on a UAC prompt.
#[tauri::command]
pub async fn settings_autostart(app: AppHandle) -> Option<tray::Autostart> {
    blocking(move || tray::autostart(&app)).await
}

#[tauri::command]
pub async fn settings_set_autostart(app: AppHandle, on: bool) -> Option<tray::Autostart> {
    blocking(move || tray::set_autostart(&app, on)).await
}

#[tauri::command]
pub async fn settings_set_autostart_admin(app: AppHandle, admin: bool) -> Option<tray::Autostart> {
    blocking(move || tray::set_autostart_admin(&app, admin)).await
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Option<T> + Send + 'static) -> Option<T> {
    tauri::async_runtime::spawn_blocking(f).await.ok().flatten()
}

/// Async on purpose: a sync command runs inside the webview's IPC callback,
/// and creating another webview from there deadlocks on Windows.
#[tauri::command]
pub async fn settings_open(app: AppHandle) -> Result<(), String> {
    open(&app).map_err(|e| e.to_string())
}

/// Shows the settings window, or brings it forward if it's already open.
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(WINDOW) {
        window.unminimize()?;
        window.show()?;
        return bring_forward(&window);
    }

    let window = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html".into()))
        .title("Настройки Lumen")
        .inner_size(820.0, 620.0)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .shadow(true)
        // Matches the page background, so there's no white flash on open.
        .background_color(Color(11, 11, 14, 255))
        .center()
        .focusable(false)
        .visible(false)
        .build()?;

    // Closing the window mid-recording must not leave the hotkeys switched off.
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            hotkeys::suspend(&handle, false);
        }
    });

    window.show()?;
    window.set_focusable(true)?;
    bring_forward(&window)
}

/// Raises the window above the others even when Windows refuses to hand it
/// focus (a click on the non-activating island doesn't make Lumen the
/// foreground app), then asks for focus.
fn bring_forward(window: &WebviewWindow) -> tauri::Result<()> {
    window.set_always_on_top(true)?;
    window.set_always_on_top(false)?;
    window.set_focus()
}

/// JSON merge: objects are merged key by key, everything else is replaced.
fn merge(target: &mut Value, patch: Value) {
    match (target, patch) {
        (Value::Object(target), Value::Object(patch)) => {
            for (key, value) in patch {
                merge(target.entry(key).or_insert(Value::Null), value);
            }
        }
        (target, patch) => *target = patch,
    }
}
