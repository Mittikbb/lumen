//! Bluetooth devices coming and going (headphones, a keyboard, a mouse, a
//! gamepad), for a short show on the island. Connected devices are polled
//! every couple of seconds; the battery charge, when the device reports one,
//! comes from the property Windows keeps on its device node.

use std::{collections::HashMap, thread, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::{
    Devices::{
        Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice, BluetoothMajorClass},
        Enumeration::DeviceInformation,
    },
    Win32::Devices::{
        DeviceAndDriverInstallation::{
            DIGCF_ALLCLASSES, DIGCF_PRESENT, SP_DEVINFO_DATA, SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo,
            SetupDiGetClassDevsW, SetupDiGetDevicePropertyW,
        },
        Properties::{DEVPKEY_Device_FriendlyName, DEVPROPTYPE},
    },
    Win32::Foundation::DEVPROPKEY,
    core::GUID,
};

const POLL: Duration = Duration::from_secs(2);
/// Battery level of a Bluetooth device, in percent (a byte), on its device node.
const BATTERY: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0x104ea319_6ee2_4701_bd47_8ddbf425bbe5),
    pid: 2,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BluetoothEvent {
    connected: bool,
    name: String,
    /// "audio", "keyboard", "mouse", "gamepad", "phone" or "device".
    kind: &'static str,
    battery: Option<u8>,
}

pub fn spawn_watcher(app: AppHandle) {
    thread::spawn(move || {
        // What was connected at the last look; None until the first one, so
        // devices already there at start aren't announced.
        let mut known: Option<HashMap<String, (String, &'static str)>> = None;
        loop {
            if let Ok(now) = connected(known.as_ref()) {
                if let Some(before) = &known {
                    for (name, (_, kind)) in now.iter().filter(|(n, _)| !before.contains_key(*n)) {
                        let battery = battery_of(name);
                        let _ = app.emit("lumen://bluetooth", event(true, name, kind, battery));
                    }
                    for (name, (_, kind)) in before.iter().filter(|(n, _)| !now.contains_key(*n)) {
                        let _ = app.emit("lumen://bluetooth", event(false, name, kind, None));
                    }
                }
                known = Some(now);
            }
            thread::sleep(POLL);
        }
    });
}

fn event(connected: bool, name: &str, kind: &'static str, battery: Option<u8>) -> BluetoothEvent {
    BluetoothEvent { connected, name: name.to_string(), kind, battery }
}

/// Connected devices by name (classic and Low Energy; a device that speaks
/// both shows up once), with their id and kind. Kinds of devices already in
/// `before` are kept rather than asked for again.
fn connected(
    before: Option<&HashMap<String, (String, &'static str)>>,
) -> windows::core::Result<HashMap<String, (String, &'static str)>> {
    let mut found = HashMap::new();
    let classic = BluetoothDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected)?;
    for info in DeviceInformation::FindAllAsyncAqsFilter(&classic)?.join()? {
        let name = info.Name()?.to_string();
        if name.is_empty() {
            continue;
        }
        let id = info.Id()?.to_string();
        let known = before
            .and_then(|b| b.get(&name))
            .filter(|(was, _)| *was == id)
            .map(|&(_, kind)| kind);
        let kind = known.unwrap_or_else(|| {
            BluetoothDevice::FromIdAsync(&id.as_str().into())
                .and_then(|op| op.join())
                .map(|device| kind_of(&device))
                .unwrap_or("device")
        });
        found.insert(name, (id, kind));
    }
    let low_energy = BluetoothLEDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected)?;
    for info in DeviceInformation::FindAllAsyncAqsFilter(&low_energy)?.join()? {
        let name = info.Name()?.to_string();
        if !name.is_empty() && !found.contains_key(&name) {
            found.insert(name, (info.Id()?.to_string(), "device"));
        }
    }
    Ok(found)
}

/// What a classic device is, from its class of device.
fn kind_of(device: &BluetoothDevice) -> &'static str {
    let Ok(class) = device.ClassOfDevice() else {
        return "device";
    };
    match class.MajorClass() {
        Ok(BluetoothMajorClass::AudioVideo) => "audio",
        Ok(BluetoothMajorClass::Phone) => "phone",
        Ok(BluetoothMajorClass::Peripheral) => {
            // Minor class bits 6–7: keyboard / pointing; bits 2–5: joystick, gamepad.
            let raw = class.RawValue().unwrap_or(0);
            match ((raw >> 6) & 0b11, (raw >> 2) & 0b1111) {
                (0b01, _) | (0b11, _) => "keyboard",
                (0b10, _) => "mouse",
                (_, 0b0001) | (_, 0b0010) => "gamepad",
                _ => "device",
            }
        }
        _ => "device",
    }
}

/// The charge of a device named `name`, if one of its device nodes reports
/// it (headphones keep it on their hands-free node, named after them).
fn battery_of(name: &str) -> Option<u8> {
    let wanted = name.to_lowercase();
    unsafe {
        let set = SetupDiGetClassDevsW(None, None, None, DIGCF_ALLCLASSES | DIGCF_PRESENT).ok()?;
        let mut level = None;
        let mut index = 0;
        loop {
            let mut data = SP_DEVINFO_DATA { cbSize: size_of::<SP_DEVINFO_DATA>() as u32, ..Default::default() };
            if SetupDiEnumDeviceInfo(set, index, &mut data).is_err() {
                break;
            }
            index += 1;
            let mut kind = DEVPROPTYPE::default();
            let mut byte = [0u8; 1];
            if SetupDiGetDevicePropertyW(set, &data, &BATTERY, &mut kind, Some(&mut byte), None, 0).is_err() {
                continue;
            }
            let mut text = [0u8; 512];
            let mut size = 0u32;
            if SetupDiGetDevicePropertyW(set, &data, &DEVPKEY_Device_FriendlyName, &mut kind, Some(&mut text), Some(&mut size), 0)
                .is_err()
            {
                continue;
            }
            let wide: Vec<u16> = text[..size as usize].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            let friendly = String::from_utf16_lossy(&wide).trim_end_matches('\0').to_lowercase();
            if friendly.contains(&wanted) || wanted.contains(&friendly) {
                level = Some(byte[0].min(100));
                break;
            }
        }
        let _ = SetupDiDestroyDeviceInfoList(set);
        level
    }
}
