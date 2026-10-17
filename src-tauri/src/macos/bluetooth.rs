//! Bluetooth devices coming and going on macOS (headphones, a keyboard, a
//! mouse, a gamepad), for a short show on the island.
//!
//! IOBluetooth would need Bluetooth access, and a process without the
//! permission's usage string (a dev build started from some terminals) is
//! killed outright when it asks. So Lumen only counts the Bluetooth
//! connections in the I/O Registry every couple of seconds, which needs no
//! permission, and when that count changes (and every half minute in case
//! it missed one) asks `system_profiler` for the connected devices, their
//! kinds and battery levels.

use std::{
    collections::HashMap,
    ffi::{CStr, c_void},
    process::Command,
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

const POLL: Duration = Duration::from_secs(2);
const RESYNC: Duration = Duration::from_secs(30);
/// One per connected device (and a couple for the controller itself).
const CONNECTION_CLASS: &CStr = c"IOBluetoothDevice";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BluetoothEvent {
    connected: bool,
    name: String,
    /// "audio", "keyboard", "mouse", "gamepad", "phone" or "device".
    kind: &'static str,
    battery: Option<u8>,
}

struct Device {
    kind: &'static str,
    battery: Option<u8>,
}

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOServiceMatching(name: *const std::ffi::c_char) -> *mut c_void;
    fn IOServiceGetMatchingServices(main_port: u32, matching: *mut c_void, existing: *mut u32) -> i32;
    fn IOIteratorNext(iterator: u32) -> u32;
    fn IOObjectRelease(object: u32) -> i32;
}

pub fn spawn_watcher(app: AppHandle) {
    thread::spawn(move || {
        // What was connected at the last look; None until the first one, so
        // devices already there at start aren't announced.
        let mut known: Option<HashMap<String, Device>> = None;
        let mut count = None;
        let mut synced = Instant::now();
        loop {
            let now_count = connections();
            if known.is_none() || now_count != count || synced.elapsed() >= RESYNC {
                count = now_count;
                synced = Instant::now();
                if let Some(now) = connected() {
                    if let Some(before) = &known {
                        for (name, device) in now.iter().filter(|(n, _)| !before.contains_key(*n)) {
                            let _ = app.emit("lumen://bluetooth", event(true, name, device.kind, device.battery));
                        }
                        for (name, device) in before.iter().filter(|(n, _)| !now.contains_key(*n)) {
                            let _ = app.emit("lumen://bluetooth", event(false, name, device.kind, None));
                        }
                    }
                    known = Some(now);
                }
            }
            thread::sleep(POLL);
        }
    });
}

fn event(connected: bool, name: &str, kind: &'static str, battery: Option<u8>) -> BluetoothEvent {
    BluetoothEvent { connected, name: name.to_string(), kind, battery }
}

/// How many Bluetooth connection nodes the I/O Registry has.
fn connections() -> Option<u32> {
    unsafe {
        let matching = IOServiceMatching(CONNECTION_CLASS.as_ptr());
        if matching.is_null() {
            return None;
        }
        let mut iterator = 0;
        // Takes the matching dictionary; 0 is the default main port.
        if IOServiceGetMatchingServices(0, matching, &mut iterator) != 0 {
            return None;
        }
        let mut count = 0;
        loop {
            let service = IOIteratorNext(iterator);
            if service == 0 {
                break;
            }
            count += 1;
            IOObjectRelease(service);
        }
        IOObjectRelease(iterator);
        Some(count)
    }
}

/// Connected devices by name, from `system_profiler`.
fn connected() -> Option<HashMap<String, Device>> {
    let output = Command::new("/usr/sbin/system_profiler")
        .args(["SPBluetoothDataType", "-json"])
        .output()
        .ok()?;
    let report: Value = serde_json::from_slice(&output.stdout).ok()?;
    let controller = report.get("SPBluetoothDataType")?.get(0)?;
    let mut devices = HashMap::new();
    // A list of one-key objects: [{ "AirPods": { ... } }, ...].
    let list = controller.get("device_connected").and_then(Value::as_array);
    for entry in list.into_iter().flatten().filter_map(Value::as_object) {
        for (name, info) in entry {
            devices.insert(
                name.clone(),
                Device {
                    kind: kind_of(info.get("device_minorType").and_then(Value::as_str).unwrap_or("")),
                    battery: battery_of(info),
                },
            );
        }
    }
    Some(devices)
}

fn kind_of(minor_type: &str) -> &'static str {
    let t = minor_type.to_lowercase();
    if ["headphone", "headset", "speaker", "audio", "earbud", "hifi"].iter().any(|w| t.contains(w)) {
        "audio"
    } else if t.contains("keyboard") {
        "keyboard"
    } else if ["mouse", "trackpad", "pointing"].iter().any(|w| t.contains(w)) {
        "mouse"
    } else if ["gamepad", "joystick", "game"].iter().any(|w| t.contains(w)) {
        "gamepad"
    } else if t.contains("phone") {
        "phone"
    } else {
        "device"
    }
}

/// The charge in percent: the device's own, or for earbuds the lower of the
/// two ("80%" strings in the report).
fn battery_of(info: &Value) -> Option<u8> {
    let level = |key: &str| {
        info.get(key)?
            .as_str()?
            .trim()
            .trim_end_matches('%')
            .trim()
            .parse::<u8>()
            .ok()
    };
    level("device_batteryLevelMain")
        .or_else(|| level("device_batteryLevel"))
        .or_else(|| match (level("device_batteryLevelLeft"), level("device_batteryLevelRight")) {
            (Some(l), Some(r)) => Some(l.min(r)),
            (one, other) => one.or(other),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_kinds_and_battery() {
        assert_eq!(kind_of("Headphones"), "audio");
        assert_eq!(kind_of("Mouse"), "mouse");
        assert_eq!(kind_of("Keyboard"), "keyboard");
        let earbuds = serde_json::json!({ "device_batteryLevelLeft": "80%", "device_batteryLevelRight": "64 %" });
        assert_eq!(battery_of(&earbuds), Some(64));
        assert_eq!(battery_of(&serde_json::json!({ "device_batteryLevelMain": "100%" })), Some(100));
    }

    #[test]
    fn counts_and_lists() {
        assert!(connections().is_some());
        assert!(connected().is_some());
    }
}
