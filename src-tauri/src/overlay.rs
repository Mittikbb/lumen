//! The overlay window: a transparent, always-on-top strip at the top of the
//! primary monitor. Only the island itself should catch the mouse, so the
//! window stays click-through and we poll the cursor to turn hit-testing on
//! while the pointer is over the island's rectangle.

use std::{sync::Mutex, thread, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, State, WebviewWindow};
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow},
    UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
        SetForegroundWindow,
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

#[tauri::command]
pub fn set_hit_region(rect: Rect, region: State<HitRegion>) {
    *region.0.lock().unwrap() = rect;
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

/// Centres the island window along the top edge of its monitor.
fn place(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = target_monitor(window)? else {
        return Ok(());
    };
    let size = window.outer_size()?;
    let area = monitor.position();
    let x = area.x + (monitor.size().width as i32 - size.width as i32) / 2;
    window.set_position(PhysicalPosition::new(x, area.y))
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

            if inside != was_inside {
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
        let mut hidden = false;
        loop {
            thread::sleep(Duration::from_millis(500));
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            let Ok(hwnd) = window.hwnd() else {
                continue;
            };
            let hide =
                settings::get(&app).display.hide_fullscreen && fullscreen_in_front(HWND(hwnd.0));
            if hide != hidden {
                let _ = if hide { window.hide() } else { window.show() };
                hidden = hide;
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
