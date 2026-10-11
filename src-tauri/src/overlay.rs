//! The overlay window: a transparent, always-on-top strip at the top of the
//! primary monitor. Only the island itself should catch the mouse, so the
//! window stays click-through and we poll the cursor to turn hit-testing on
//! while the pointer is over the island's rectangle.

use std::{sync::Mutex, thread, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};

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

pub fn dock_to_top(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.primary_monitor()? else {
        return Ok(());
    };
    let size = window.outer_size()?;
    let area = monitor.position();
    let x = area.x + (monitor.size().width as i32 - size.width as i32) / 2;
    window.set_position(PhysicalPosition::new(x, area.y))?;
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
