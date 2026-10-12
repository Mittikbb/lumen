//! The overlay window: a transparent, always-on-top strip at the top of the
//! primary monitor. Only the island itself should catch the mouse, so the
//! window stays click-through and we poll the cursor to turn hit-testing on
//! while the pointer is over the island's rectangle.

use std::{
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, State, WebviewWindow};
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow},
    UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsZoomed,
        SetForegroundWindow,
    },
};

use crate::settings;

/// Bounds in CSS pixels relative to the window, reported by the frontend.
#[derive(Clone, Copy, Default, Deserialize)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Rect {
    fn contains(&self, x: f64, y: f64, margin: f64) -> bool {
        x >= self.x - margin
            && x <= self.x + self.w + margin
            && y >= self.y - margin
            && y <= self.y + self.h + margin
    }
}

/// What catches the mouse: the island first, then anything clickable beside
/// it (the call drop).
#[derive(Default)]
pub struct HitRegion(Mutex<Vec<Rect>>);

#[derive(Clone, Serialize)]
struct CursorEvent {
    x: f64,
    y: f64,
    inside: bool,
}

/// Distance (CSS px) around the island within which the frontend gets cursor
/// updates, so the island can lean toward an approaching pointer.
const NEAR_ZONE: f64 = 220.0;
/// Extra margin so the pointer doesn't flicker in and out on the edge.
const HIT_PADDING: f64 = 4.0;
/// Room above a dragged-down island so its glow isn't cut by the window edge
/// (it reaches ~85 px at the brightest setting).
const GLOW_ROOM: f64 = 90.0;
/// Gap between a dragged island's widest panel and the monitor edge.
const EDGE: f64 = 8.0;

/// Where the island sits inside the window (centre `x`, top `y`, CSS px), or
/// `None` while it keeps its usual place, centred at the top.
#[derive(Clone, Copy, PartialEq, Serialize)]
pub struct Anchor {
    x: f64,
    y: f64,
}

#[derive(Default)]
pub struct AnchorState(Mutex<Option<Anchor>>);

/// Set while the island is being dragged with Ctrl held.
#[derive(Default)]
pub struct Dragging(AtomicBool);

#[tauri::command]
pub fn set_hit_region(rects: Vec<Rect>, region: State<HitRegion>) {
    *region.0.lock().unwrap() = rects;
}

/// Keyboard focus is borrowed only while the user types into the island
/// (launcher, city search) and then handed back.
#[derive(Default)]
pub struct Focus {
    taken: Mutex<bool>,
    /// Window that had focus before, as a raw HWND.
    previous: Mutex<isize>,
}

/// Lets the normally non-activating window take keyboard focus.
pub fn take_focus(app: &AppHandle) -> tauri::Result<()> {
    let focus = app.state::<Focus>();
    {
        let mut taken = focus.taken.lock().unwrap();
        if !*taken {
            *focus.previous.lock().unwrap() = unsafe { GetForegroundWindow() }.0 as isize;
        }
        *taken = true;
    }
    let window = app
        .get_webview_window("main")
        .expect("main window is missing");
    window.set_focusable(true)?;
    window.set_focus()
}

/// Makes the window non-activating again, optionally refocusing the app the
/// user was in before.
pub fn release_focus(app: &AppHandle, restore: bool) {
    let focus = app.state::<Focus>();
    {
        let mut taken = focus.taken.lock().unwrap();
        if !*taken {
            return;
        }
        *taken = false;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focusable(false);
    }
    let previous = *focus.previous.lock().unwrap();
    if restore && previous != 0 {
        let _ = unsafe { SetForegroundWindow(HWND(previous as *mut _)) };
    }
}

#[tauri::command]
pub fn overlay_take_focus(app: AppHandle) -> Result<(), String> {
    take_focus(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn overlay_release_focus(app: AppHandle, restore_focus: bool) {
    release_focus(&app, restore_focus);
}

#[derive(Serialize)]
pub struct MonitorInfo {
    name: String,
    width: u32,
    height: u32,
    primary: bool,
}

/// Monitors to choose from in settings.
#[tauri::command]
pub fn overlay_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|m| m.name().cloned());
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|m| {
            let name = m.name()?.clone();
            Some(MonitorInfo {
                primary: primary.as_ref() == Some(&name),
                width: m.size().width,
                height: m.size().height,
                name,
            })
        })
        .collect()
}

/// The monitor picked in settings, falling back to the primary one.
fn target_monitor(window: &WebviewWindow) -> tauri::Result<Option<Monitor>> {
    let wanted = settings::get(window.app_handle()).display.monitor;
    let chosen = wanted.and_then(|name| {
        window
            .available_monitors()
            .ok()?
            .into_iter()
            .find(|m| m.name() == Some(&name))
    });
    Ok(chosen.or(window.primary_monitor()?))
}

/// Puts the window on its monitor: centred along the top edge, or around
/// the spot the island was dragged to. The window never leaves the monitor
/// (it would spill onto a neighbour with another scale); a dragged island
/// moves inside it instead, and is kept where its widest panel still fits.
fn place(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = target_monitor(window)? else {
        return Ok(());
    };
    let settings = settings::get(window.app_handle());
    let scale = monitor.scale_factor();
    let origin = monitor.position();
    let screen = monitor.size().to_logical::<f64>(scale);
    let win = window.outer_size()?.to_logical::<f64>(window.scale_factor()?);

    let (left, top, anchor) = match settings.display.position {
        None => ((screen.width - win.width) / 2.0, 0.0, None),
        Some(spot) => {
            let half = widest_island(&settings) / 2.0 + EDGE;
            let x = fit(spot.x * screen.width, half, screen.width - half);
            // Low enough that the tallest panel still fits in the window.
            let y = fit(spot.y, 0.0, screen.height - (win.height - GLOW_ROOM));
            let left = fit(x - win.width / 2.0, 0.0, screen.width - win.width);
            let top = fit(y - GLOW_ROOM, 0.0, screen.height - win.height);
            (left, top, Some(Anchor { x: x - left, y: y - top }))
        }
    };

    *window.state::<AnchorState>().0.lock().unwrap() = anchor;
    let _ = window.emit("lumen://anchor", anchor);
    window.set_position(PhysicalPosition::new(
        origin.x + (left * scale).round() as i32,
        origin.y + (top * scale).round() as i32,
    ))
}

/// Width of the island's widest panel: the expanded width plus the call tab
/// (`CALL_TAB_WIDTH` in Island.tsx), with the frontend's default.
fn widest_island(settings: &settings::Settings) -> f64 {
    let expanded = settings
        .rest
        .get("island")
        .and_then(|island| island.get("expandedWidth"))
        .and_then(Value::as_f64)
        .unwrap_or(560.0);
    expanded + 80.0
}

/// `value` within `min..=max`, or the middle when the range is empty (a
/// monitor narrower than the window).
fn fit(value: f64, min: f64, max: f64) -> f64 {
    if max < min {
        (min + max) / 2.0
    } else {
        value.clamp(min, max)
    }
}

#[tauri::command]
pub fn overlay_anchor(state: State<AnchorState>) -> Option<Anchor> {
    *state.0.lock().unwrap()
}

/// Ctrl + drag on the island: the window follows the pointer and keeps
/// catching the mouse even if the pointer outruns the island.
#[tauri::command]
pub fn overlay_drag_start(app: AppHandle) {
    app.state::<Dragging>().0.store(true, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_ignore_cursor_events(false);
    }
}

/// Moves the window by a pointer step in CSS px.
#[tauri::command]
pub fn overlay_drag_by(app: AppHandle, dx: f64, dy: f64) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("no island window")?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let at = window.outer_position().map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(
            at.x + (dx * scale).round() as i32,
            at.y + (dy * scale).round() as i32,
        ))
        .map_err(|e| e.to_string())
}

/// Drop: remembers the island's spot (centre `x`, top `y`, CSS px inside the
/// window) on the monitor it's over; saving it docks the window there.
#[tauri::command]
pub fn overlay_drag_end(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    app.state::<Dragging>().0.store(false, Ordering::SeqCst);
    let window = app.get_webview_window("main").ok_or("no island window")?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let at = window.outer_position().map_err(|e| e.to_string())?;
    let (px, py) = (at.x as f64 + x * scale, at.y as f64 + y * scale);

    // The monitor under the island, or the closest one if it's in a gap.
    let distance = |m: &Monitor| {
        let (o, s) = (m.position(), m.size());
        let dx = (o.x as f64 - px).max(px - (o.x as f64 + s.width as f64)).max(0.0);
        let dy = (o.y as f64 - py).max(py - (o.y as f64 + s.height as f64)).max(0.0);
        dx * dx + dy * dy
    };
    let monitor = window
        .available_monitors()
        .map_err(|e| e.to_string())?
        .into_iter()
        .min_by(|a, b| distance(a).total_cmp(&distance(b)))
        .ok_or("no monitors")?;

    let (origin, size, scale) = (monitor.position(), monitor.size(), monitor.scale_factor());
    // Dropped past an edge: keep the spot on the monitor (place() fits the rest).
    let spot = settings::Position {
        x: ((px - origin.x as f64) / size.width as f64).clamp(0.0, 1.0),
        y: ((py - origin.y as f64) / scale).clamp(0.0, size.height as f64 / scale),
    };
    settings::settings_update(
        app.clone(),
        json!({ "display": { "monitor": monitor.name(), "position": spot } }),
    )
    .map(|_| ())
}

/// Moves the island after the monitor setting changed.
pub fn redock(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = place(&window);
    }
}

pub fn dock_to_top(window: &WebviewWindow) -> tauri::Result<()> {
    place(window)?;
    window.set_ignore_cursor_events(true)?;
    // The window is created hidden and non-focusable (WS_EX_NOACTIVATE), and is
    // only shown once styled and in place. Shell mods that restyle every new
    // window on show (e.g. Windhawk "Translucent Windows") skip such windows.
    window.show()?;
    Ok(())
}

pub fn spawn_cursor_tracker(app: AppHandle) {
    thread::spawn(move || {
        let mut was_catching = false;
        let mut was_near = false;

        loop {
            thread::sleep(Duration::from_millis(16));

            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            let (Ok(cursor), Ok(origin), Ok(scale)) = (
                app.cursor_position(),
                window.outer_position(),
                window.scale_factor(),
            ) else {
                continue;
            };

            let x = (cursor.x - origin.x as f64) / scale;
            let y = (cursor.y - origin.y as f64) / scale;
            let rects = app.state::<HitRegion>().0.lock().unwrap().clone();
            let island = rects.first().copied().unwrap_or_default();

            // `inside` tells the frontend the pointer is over the island; the
            // window also catches it over the rest (the drop), for clicks.
            let inside = island.contains(x, y, HIT_PADDING);
            let catches = rects.iter().any(|r| r.contains(x, y, HIT_PADDING));
            let near = island.contains(x, y, NEAR_ZONE);

            // While dragging, the window keeps the mouse (see overlay_drag_start).
            if app.state::<Dragging>().0.load(Ordering::SeqCst) {
                was_catching = true;
            } else if catches != was_catching {
                let _ = window.set_ignore_cursor_events(!catches);
                was_catching = catches;
            }
            // Keep streaming while the pointer is close, plus one final event on
            // leaving the zone so the island can relax back to its rest shape.
            if near || was_near {
                let _ = window.emit("lumen://cursor", CursorEvent { x, y, inside });
            }
            was_near = near;
        }
    });
}

/// Hides the island while a fullscreen app (a game, a video) or, if asked, a
/// maximized window is in front on its monitor, and brings it back afterwards.
pub fn spawn_fullscreen_watch(app: AppHandle) {
    thread::spawn(move || {
        let mut hidden = false;
        loop {
            thread::sleep(Duration::from_millis(500));
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            let Ok(hwnd) = window.hwnd() else {
                continue;
            };
            let display = settings::get(&app).display;
            let hide = (display.hide_fullscreen || display.hide_maximized) && {
                let cover = cover_in_front(HWND(hwnd.0));
                (display.hide_fullscreen && cover.fullscreen)
                    || (display.hide_maximized && cover.maximized)
            };
            if hide != hidden {
                let _ = if hide { window.hide() } else { window.show() };
                hidden = hide;
            }
        }
    });
}

/// How another app's window in front covers the island's monitor.
#[derive(Default)]
struct Cover {
    /// Fills the whole monitor, taskbar included.
    fullscreen: bool,
    /// Maximized, or fills the work area.
    maximized: bool,
}

fn cover_in_front(island: HWND) -> Cover {
    unsafe {
        let front = GetForegroundWindow();
        if front.is_invalid() {
            return Cover::default();
        }
        let mut pid = 0;
        GetWindowThreadProcessId(front, Some(&mut pid));
        if pid == std::process::id() {
            return Cover::default();
        }
        // The desktop and taskbar cover the screen too, but aren't "fullscreen".
        let mut class = [0u16; 64];
        let len = GetClassNameW(front, &mut class) as usize;
        let class = String::from_utf16_lossy(&class[..len]);
        if [
            "Progman",
            "WorkerW",
            "Shell_TrayWnd",
            "Shell_SecondaryTrayWnd",
        ]
        .contains(&class.as_str())
        {
            return Cover::default();
        }

        let monitor = MonitorFromWindow(front, MONITOR_DEFAULTTONEAREST);
        if monitor != MonitorFromWindow(island, MONITOR_DEFAULTTONEAREST) {
            return Cover::default();
        }
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let mut rect = RECT::default();
        if !GetMonitorInfoW(monitor, &mut info).as_bool()
            || GetWindowRect(front, &mut rect).is_err()
        {
            return Cover::default();
        }
        let covers = |area: RECT| {
            rect.left <= area.left
                && rect.top <= area.top
                && rect.right >= area.right
                && rect.bottom >= area.bottom
        };
        Cover {
            fullscreen: covers(info.rcMonitor),
            maximized: IsZoomed(front).as_bool() || covers(info.rcWork),
        }
    }
}
