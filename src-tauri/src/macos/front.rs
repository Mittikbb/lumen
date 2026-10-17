//! The app in front on macOS. Lumen's island borrows keyboard focus (and,
//! once clicked, the front) only for a moment; this remembers whose it was so
//! it can be handed back.

use std::sync::atomic::{AtomicI32, Ordering};

use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};

/// The last app other than Lumen seen in front, by pid; 0 for none.
static PREVIOUS: AtomicI32 = AtomicI32::new(0);

/// The app in front with its name, unless that's Lumen itself.
pub fn other_app() -> Option<(i32, String)> {
    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let pid = app.processIdentifier();
    if pid == std::process::id() as i32 {
        return None;
    }
    let name = app.localizedName().map(|n| n.to_string()).unwrap_or_default();
    Some((pid, name))
}

/// Notes the app in front, if it isn't Lumen.
pub fn remember() {
    if let Some((pid, _)) = other_app() {
        PREVIOUS.store(pid, Ordering::Relaxed);
    }
}

pub fn previous() -> i32 {
    PREVIOUS.load(Ordering::Relaxed)
}

/// Brings an app to the front.
pub fn activate(pid: i32) -> bool {
    pid != 0
        && NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
            .is_some_and(|app| app.activateWithOptions(NSApplicationActivationOptions::empty()))
}

/// If Lumen ended up in front (a click on the island activates it), the app
/// the user was in comes back.
pub fn give_back() {
    if other_app().is_none() {
        activate(previous());
    }
}
