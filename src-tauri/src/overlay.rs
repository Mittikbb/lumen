//! The overlay window: a transparent, always-on-top strip at the top of the
//! primary monitor. Only the island itself should catch the mouse, so the
//! window stays click-through and we poll the cursor to turn hit-testing on
//! while the pointer is over the island's rectangle.

use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, State, WebviewWindow};
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow},
    UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetSystemMetrics, GetWindowRect,
        GetWindowThreadProcessId, IsZoomed, SetForegroundWindow, SM_CXVIRTUALSCREEN,
        SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    },
};

use crate::settings;

/// Island bounds in CSS pixels relative to the window, reported by the frontend.
#[derive(Clone, Copy, Default, Deserialize)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
pub struct HitRegion(Mutex<Rect>);

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
/// Headroom above the island inside the overlay window to prevent glow clipping.
pub const HEADROOM: f64 = 110.0;

#[tauri::command]
pub fn set_hit_region(rect: Rect, region: State<HitRegion>) {
    *region.0.lock().unwrap() = rect;
}

#[derive(Default)]
pub struct VisibilityState {
    pub hidden: AtomicBool,
    pub token: AtomicU64,
}

/// Requests the island to play its exit animation and hides the window when done.
pub fn hide_island(app: &AppHandle) {
    let state = app.state::<VisibilityState>();
    if state.hidden.swap(true, Ordering::SeqCst) {
        return;
    }
    let token = state.token.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("lumen://visibility", false);
        let app_handle = app.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(320));
            let state = app_handle.state::<VisibilityState>();
            if state.token.load(Ordering::SeqCst) == token && state.hidden.load(Ordering::SeqCst) {
                if let Some(w) = app_handle.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
        });
    }
}

/// Restores the island window and triggers its entrance spring animation.
pub fn show_island(app: &AppHandle) {
    let state = app.state::<VisibilityState>();
    state.token.fetch_add(1, Ordering::SeqCst);
    let was_hidden = state.hidden.swap(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        let not_visible = !window.is_visible().unwrap_or(true);
        if was_hidden || not_visible {
            let _ = window.show();
            let _ = window.emit("lumen://visibility", true);
        }
    }
}

#[tauri::command]
pub fn overlay_show_island(app: AppHandle) {
    show_island(&app);
}

#[tauri::command]
pub fn overlay_hide_island(app: AppHandle) {
    hide_island(&app);
}

#[derive(Default)]
pub struct DragState {
    pub is_dragging: AtomicBool,
}

#[tauri::command]
pub fn overlay_start_drag(app: AppHandle) -> Result<(i32, i32), String> {
    let state = app.state::<DragState>();
    state.is_dragging.store(true, Ordering::SeqCst);
    let window = app
        .get_webview_window("main")
        .ok_or("main window is missing")?;
    let _ = window.set_ignore_cursor_events(false);
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    Ok((pos.x, pos.y))
}

#[tauri::command]
pub fn overlay_drag_by(app: AppHandle, dx: f64, dy: f64) -> Result<(i32, i32), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window is missing")?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let current = window.outer_position().map_err(|e| e.to_string())?;
    let new_x = current.x + (dx * scale).round() as i32;
    let new_y = current.y + (dy * scale).round() as i32;

    let (vs_left, vs_top, vs_width, vs_height) = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    };
    let min_x = vs_left - 300;
    let max_x = vs_left + vs_width - 660;
    let min_y = vs_top - (HEADROOM * scale).round() as i32;
    let max_y = vs_top + vs_height - 60;

    let clamped_x = new_x.clamp(min_x, max_x);
    let clamped_y = new_y.clamp(min_y, max_y);

    window
        .set_position(PhysicalPosition::new(clamped_x, clamped_y))
        .map_err(|e| e.to_string())?;
    Ok((clamped_x, clamped_y))
}

#[tauri::command]
pub fn overlay_end_drag(app: AppHandle) -> Result<(i32, i32), String> {
    let state = app.state::<DragState>();
    state.is_dragging.store(false, Ordering::SeqCst);
    let window = app
        .get_webview_window("main")
        .ok_or("main window is missing")?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let _ = settings::settings_update(
        app.clone(),
        serde_json::json!({
            "display": { "x": pos.x, "y": pos.y }
        }),
    );
    Ok((pos.x, pos.y))
}

#[tauri::command]
pub fn overlay_reset_position(app: AppHandle) -> Result<(), String> {
    let _ = settings::settings_update(
        app.clone(),
        serde_json::json!({
            "display": { "x": null, "y": null }
        }),
    );
    redock(&app);
    Ok(())
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
    show_island(app);
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

/// Places the island window along the top edge of its monitor, or restores
/// its custom position if one was saved.
fn place(window: &WebviewWindow) -> tauri::Result<()> {
    let display = settings::get(window.app_handle()).display;
    if let (Some(x), Some(y)) = (display.x, display.y) {
        window.set_position(PhysicalPosition::new(x, y))
    } else {
        let Some(monitor) = target_monitor(window)? else {
            return Ok(());
        };
        let size = window.outer_size()?;
        let scale = window.scale_factor()?;
        let area = monitor.position();
        let x = area.x + (monitor.size().width as i32 - size.width as i32) / 2;
        let y = area.y - (HEADROOM * scale).round() as i32;
        window.set_position(PhysicalPosition::new(x, y))
    }
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
        let mut was_inside = false;
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
            let rect = *app.state::<HitRegion>().0.lock().unwrap();

            let inside = x >= rect.x - HIT_PADDING
                && x <= rect.x + rect.w + HIT_PADDING
                && y >= rect.y - HIT_PADDING
                && y <= rect.y + rect.h + HIT_PADDING;
            let near = x >= rect.x - NEAR_ZONE
                && x <= rect.x + rect.w + NEAR_ZONE
                && y >= rect.y - NEAR_ZONE
                && y <= rect.y + rect.h + NEAR_ZONE;

            let is_dragging = app.state::<DragState>().is_dragging.load(Ordering::SeqCst);
            if is_dragging {
                was_inside = true;
            } else if inside != was_inside {
                let _ = window.set_ignore_cursor_events(!inside);
                was_inside = inside;
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

/// Hides the island while a fullscreen app (a game, a video) is in front on
/// its monitor, if the setting allows, and brings it back afterwards.
pub fn spawn_fullscreen_watch(app: AppHandle) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_millis(200));
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            let Ok(hwnd) = window.hwnd() else {
                continue;
            };
            let display = settings::get(&app).display;
            let hide = (display.hide_fullscreen && fullscreen_in_front(HWND(hwnd.0)))
                || (display.hide_maximized && maximized_in_front(HWND(hwnd.0)));

            let is_hidden = app.state::<VisibilityState>().hidden.load(Ordering::SeqCst);
            if hide && !is_hidden {
                hide_island(&app);
            } else if !hide && is_hidden {
                show_island(&app);
            }
        }
    });
}

/// Whether another app's window fills the whole monitor the island is on.
fn fullscreen_in_front(island: HWND) -> bool {
    unsafe {
        let front = GetForegroundWindow();
        if front.is_invalid() {
            return false;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(front, Some(&mut pid));
        if pid == std::process::id() {
            return false;
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
            return false;
        }

        let monitor = MonitorFromWindow(front, MONITOR_DEFAULTTONEAREST);
        if monitor != MonitorFromWindow(island, MONITOR_DEFAULTTONEAREST) {
            return false;
        }
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let mut rect = RECT::default();
        if !GetMonitorInfoW(monitor, &mut info).as_bool()
            || GetWindowRect(front, &mut rect).is_err()
        {
            return false;
        }
        let screen = info.rcMonitor;
        rect.left <= screen.left
            && rect.top <= screen.top
            && rect.right >= screen.right
            && rect.bottom >= screen.bottom
    }
}

/// Whether another app's window is maximized or fills the work area of the monitor.
fn maximized_in_front(island: HWND) -> bool {
    unsafe {
        let front = GetForegroundWindow();
        if front.is_invalid() {
            return false;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(front, Some(&mut pid));
        if pid == std::process::id() {
            return false;
        }
        // The desktop and taskbar aren't user windows.
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
            return false;
        }

        let monitor = MonitorFromWindow(front, MONITOR_DEFAULTTONEAREST);
        if monitor != MonitorFromWindow(island, MONITOR_DEFAULTTONEAREST) {
            return false;
        }

        if IsZoomed(front).as_bool() {
            return true;
        }

        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let mut rect = RECT::default();
        if !GetMonitorInfoW(monitor, &mut info).as_bool()
            || GetWindowRect(front, &mut rect).is_err()
        {
            return false;
        }

        let work = info.rcWork;
        rect.left <= work.left
            && rect.top <= work.top
            && rect.right >= work.right
            && rect.bottom >= work.bottom
    }
}
