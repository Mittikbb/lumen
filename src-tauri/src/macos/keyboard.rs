//! The keyboard layout and Caps Lock on macOS, for the drop below the island.
//! The layout comes from Text Input Sources when the system says it changed
//! (no polling, no keyboard hook); Caps Lock is read a few times a second.
//! A layout that changes together with the app in front (macOS can switch
//! it per document) isn't the user switching it, so it's taken in silently.

use std::{
    ptr::NonNull,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_app_kit::NSWorkspace;
use objc2_core_graphics::{CGEventFlags, CGEventSource, CGEventSourceStateID};
use objc2_foundation::{
    NSArray, NSDistributedNotificationCenter, NSNotification, NSObject, NSOperationQueue, NSString,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const POLL: Duration = Duration::from_millis(120);
/// A layout change this soon after another app came to the front came with it.
const FOLLOWS_APP: Duration = Duration::from_millis(1000);
const CHANGED: &str = "com.apple.Carbon.TISNotifySelectedKeyboardInputSourceChanged";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyboardEvent {
    /// "layout" or "caps": what just changed.
    kind: &'static str,
    /// The layout's language, e.g. "RU" or "EN".
    layout: String,
    caps: bool,
}

struct Seen {
    layout: String,
    caps: bool,
    /// The app in front and since when.
    front: (i32, Instant),
}

static SEEN: Mutex<Option<Seen>> = Mutex::new(None);

#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn TISCopyCurrentKeyboardInputSource() -> *mut NSObject;
    fn TISGetInputSourceProperty(source: *const NSObject, key: &NSString) -> *const AnyObject;
    static kTISPropertyInputSourceLanguages: &'static NSString;
}

/// Runs on the main thread (setup): Text Input Sources insist on it.
pub fn spawn_watcher(app: AppHandle) {
    *SEEN.lock().unwrap() = Some(Seen {
        layout: language(),
        caps: caps_lock(),
        front: (front_pid(), Instant::now()),
    });

    let handle = app.clone();
    let block = RcBlock::new(move |_: NonNull<NSNotification>| layout_changed(&handle));
    let observer = unsafe {
        NSDistributedNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(&NSString::from_str(CHANGED)),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    };
    // Watches for as long as Lumen runs.
    std::mem::forget(observer);

    thread::spawn(move || {
        loop {
            thread::sleep(POLL);
            let caps = caps_lock();
            let pid = front_pid();
            let event = {
                let mut seen = SEEN.lock().unwrap();
                let Some(seen) = seen.as_mut() else { continue };
                if pid != seen.front.0 {
                    seen.front = (pid, Instant::now());
                }
                (caps != seen.caps).then(|| {
                    seen.caps = caps;
                    KeyboardEvent { kind: "caps", layout: seen.layout.clone(), caps }
                })
            };
            if let Some(event) = event {
                let _ = app.emit("lumen://keyboard", event);
            }
        }
    });
}

fn layout_changed(app: &AppHandle) {
    let layout = language();
    let event = {
        let mut seen = SEEN.lock().unwrap();
        let Some(seen) = seen.as_mut() else { return };
        if layout == seen.layout {
            return;
        }
        seen.layout.clone_from(&layout);
        let pid = front_pid();
        let with_app = pid != seen.front.0 || seen.front.1.elapsed() < FOLLOWS_APP;
        (!with_app).then(|| KeyboardEvent { kind: "layout", layout, caps: seen.caps })
    };
    if let Some(event) = event {
        let _ = app.emit("lumen://keyboard", event);
    }
}

/// "RU" for Russian, "EN" for ABC or U.S., and so on. Main thread only.
fn language() -> String {
    unsafe {
        let Some(source) = Retained::from_raw(TISCopyCurrentKeyboardInputSource()) else {
            return String::new();
        };
        let languages = TISGetInputSourceProperty(&*source, kTISPropertyInputSourceLanguages)
            as *const NSArray<NSString>;
        languages
            .as_ref()
            .and_then(|l| l.firstObject())
            .map(|lang| lang.to_string().split('-').next().unwrap_or_default().to_uppercase())
            .unwrap_or_default()
    }
}

fn caps_lock() -> bool {
    CGEventSource::flags_state(CGEventSourceStateID::CombinedSessionState).contains(CGEventFlags::MaskAlphaShift)
}

fn front_pid() -> i32 {
    NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map_or(0, |app| app.processIdentifier())
}
