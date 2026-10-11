use serde::{Deserialize, Serialize};
use windows::core::{Interface, PWSTR, BOOL};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    Endpoints::IAudioEndpointVolume,
    eMultimedia, eRender,
    IAudioSessionControl2, IAudioSessionManager2,
    IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VolumeState {
    pub volume: f32,
    pub muted: bool,
    pub is_app_volume: bool,
    pub app_name: Option<String>,
}

fn get_process_name(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 512];
        let mut size = buffer.len() as u32;
        let res = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);

        if res.is_ok() && size > 0 {
            let full_path = String::from_utf16_lossy(&buffer[..size as usize]);
            let file_name = full_path
                .rsplit(|c| c == '\\' || c == '/')
                .next()
                .unwrap_or(&full_path)
                .to_string();
            Some(file_name)
        } else {
            None
        }
    }
}

fn matches_app(target_app: &str, proc_name: &str) -> bool {
    let t = target_app.to_lowercase();
    let p = proc_name.to_lowercase();
    if t == p {
        return true;
    }
    let t_stem = t.strip_suffix(".exe").unwrap_or(&t);
    let p_stem = p.strip_suffix(".exe").unwrap_or(&p);
    if t_stem == p_stem {
        return true;
    }
    // Check Telegram / AyuGram forks
    if (t_stem.contains("ayugram") || t_stem.contains("telegram") || t_stem.contains("telega"))
        && (p_stem.contains("ayugram") || p_stem.contains("telegram") || p_stem.contains("telega"))
    {
        return true;
    }
    // Check Spotify
    if t_stem.contains("spotify") && p_stem.contains("spotify") {
        return true;
    }
    // Check Chrome / Edge / Firefox / Yandex
    if t_stem.contains("chrome") && p_stem.contains("chrome") {
        return true;
    }
    if t_stem.contains("yandex") && p_stem.contains("yandex") {
        return true;
    }
    if t_stem.contains("msedge") && p_stem.contains("msedge") {
        return true;
    }
    if t_stem.contains("firefox") && p_stem.contains("firefox") {
        return true;
    }
    false
}

fn get_default_device() -> windows::core::Result<IMMDevice> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)
    }
}

fn get_master_volume(device: &IMMDevice) -> windows::core::Result<(f32, bool)> {
    unsafe {
        let endpoint_vol: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
        let level = endpoint_vol.GetMasterVolumeLevelScalar()?;
        let mute = endpoint_vol.GetMute()?;
        Ok((level, mute.as_bool()))
    }
}

fn set_master_volume(device: &IMMDevice, level: f32) -> windows::core::Result<()> {
    unsafe {
        let endpoint_vol: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
        endpoint_vol.SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), core::ptr::null())
    }
}

fn set_master_mute(device: &IMMDevice, mute: bool) -> windows::core::Result<()> {
    unsafe {
        let endpoint_vol: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
        endpoint_vol.SetMute(mute, core::ptr::null())
    }
}

fn find_app_sessions(device: &IMMDevice, app: &str) -> Vec<ISimpleAudioVolume> {
    let mut matching_volumes = Vec::new();
    unsafe {
        let session_manager: Result<IAudioSessionManager2, _> = device.Activate(CLSCTX_ALL, None);
        if let Ok(manager) = session_manager {
            if let Ok(enumerator) = manager.GetSessionEnumerator() {
                if let Ok(count) = enumerator.GetCount() {
                    for i in 0..count {
                        if let Ok(control) = enumerator.GetSession(i) {
                            if let Ok(control2) = control.cast::<IAudioSessionControl2>() {
                                if let Ok(pid) = control2.GetProcessId() {
                                    if let Some(proc_name) = get_process_name(pid) {
                                        if matches_app(app, &proc_name) {
                                            if let Ok(vol) = control.cast::<ISimpleAudioVolume>() {
                                                matching_volumes.push(vol);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    matching_volumes
}

#[tauri::command]
pub fn media_get_volume(app: Option<String>, force_master: Option<bool>) -> Result<VolumeState, String> {
    let device = get_default_device().map_err(|e| e.to_string())?;

    if force_master != Some(true) {
        if let Some(ref target_app) = app {
            if !target_app.trim().is_empty() {
                let sessions = find_app_sessions(&device, target_app);
                if let Some(first) = sessions.first() {
                    let level = unsafe { first.GetMasterVolume().unwrap_or(1.0) };
                    let mute = unsafe { first.GetMute().unwrap_or(BOOL::from(false)) };
                    return Ok(VolumeState {
                        volume: level,
                        muted: mute.as_bool(),
                        is_app_volume: true,
                        app_name: Some(target_app.clone()),
                    });
                }
            }
        }
    }

    let (level, muted) = get_master_volume(&device).map_err(|e| e.to_string())?;
    Ok(VolumeState {
        volume: level,
        muted,
        is_app_volume: false,
        app_name: None,
    })
}

#[tauri::command]
pub fn media_set_volume(
    level: f32,
    app: Option<String>,
    force_master: Option<bool>,
) -> Result<VolumeState, String> {
    let clamped = level.clamp(0.0, 1.0);
    let device = get_default_device().map_err(|e| e.to_string())?;

    if force_master != Some(true) {
        if let Some(ref target_app) = app {
            if !target_app.trim().is_empty() {
                let sessions = find_app_sessions(&device, target_app);
                if !sessions.is_empty() {
                    let mut muted = false;
                    for s in &sessions {
                        unsafe {
                            let _ = s.SetMasterVolume(clamped, core::ptr::null());
                            if let Ok(m) = s.GetMute() {
                                muted = m.as_bool();
                            }
                        }
                    }
                    return Ok(VolumeState {
                        volume: clamped,
                        muted,
                        is_app_volume: true,
                        app_name: Some(target_app.clone()),
                    });
                }
            }
        }
    }

    set_master_volume(&device, clamped).map_err(|e| e.to_string())?;
    let (_, muted) = get_master_volume(&device).map_err(|e| e.to_string())?;
    Ok(VolumeState {
        volume: clamped,
        muted,
        is_app_volume: false,
        app_name: None,
    })
}

#[tauri::command]
pub fn media_toggle_mute(app: Option<String>, force_master: Option<bool>) -> Result<VolumeState, String> {
    let device = get_default_device().map_err(|e| e.to_string())?;

    if force_master != Some(true) {
        if let Some(ref target_app) = app {
            if !target_app.trim().is_empty() {
                let sessions = find_app_sessions(&device, target_app);
                if let Some(first) = sessions.first() {
                    let curr_mute = unsafe { first.GetMute().map(|m| m.as_bool()).unwrap_or(false) };
                    let level = unsafe { first.GetMasterVolume().unwrap_or(1.0) };
                    let new_mute = !curr_mute;
                    for s in &sessions {
                        unsafe {
                            let _ = s.SetMute(new_mute, core::ptr::null());
                        }
                    }
                    return Ok(VolumeState {
                        volume: level,
                        muted: new_mute,
                        is_app_volume: true,
                        app_name: Some(target_app.clone()),
                    });
                }
            }
        }
    }

    let (level, curr_mute) = get_master_volume(&device).map_err(|e| e.to_string())?;
    let new_mute = !curr_mute;
    set_master_mute(&device, new_mute).map_err(|e| e.to_string())?;
    Ok(VolumeState {
        volume: level,
        muted: new_mute,
        is_app_volume: false,
        app_name: None,
    })
}
