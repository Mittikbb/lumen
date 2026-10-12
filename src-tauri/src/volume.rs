//! Volume of the player that's playing right now, through its audio sessions
//! in the Windows mixer. Only the player itself is touched, never the
//! system volume: when its session can't be found the slider is hidden.

use serde::Serialize;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume,
    MMDeviceEnumerator, eMultimedia, eRender,
};
use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::core::{Interface, PWSTR};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeState {
    pub volume: f32,
    pub muted: bool,
}

const NOT_FOUND: &str = "у плеера нет своей громкости в микшере";

fn process_name(pid: u32) -> Option<String> {
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
        res.ok()?;
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        path.rsplit('\\').next().map(String::from)
    }
}

/// Whether a media session's app id (SMTC) and an audio session's process
/// belong to the same player.
fn matches_app(app: &str, process: &str) -> bool {
    let app = app.to_lowercase();
    let process = process.to_lowercase();
    let app = app.strip_suffix(".exe").unwrap_or(&app);
    let process = process.strip_suffix(".exe").unwrap_or(&process);
    if app == process {
        return true;
    }
    // Store apps and forks report ids like "SpotifyAB.SpotifyMusic_...!Spotify"
    // or "AyuGram", so compare by family.
    const FAMILIES: &[&[&str]] = &[
        &["telegram", "ayugram", "telega"],
        &["spotify"],
        &["chrome"],
        &["yandex"],
        &["msedge"],
        // Firefox's media sessions come under this app id.
        &["firefox", "308046b0af4a39cb"],
    ];
    FAMILIES.iter().any(|names| {
        names.iter().any(|n| app.contains(n)) && names.iter().any(|n| process.contains(n))
    })
}

/// Every audio session of the player on the default output device.
fn player_sessions(app: &str) -> windows::core::Result<Vec<ISimpleAudioVolume>> {
    let mut found = Vec::new();
    unsafe {
        // Runs on a worker thread; repeated calls are harmless.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = devices.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let sessions = manager.GetSessionEnumerator()?;
        for i in 0..sessions.GetCount()? {
            let Ok(control) = sessions.GetSession(i) else {
                continue;
            };
            let Ok(pid) = control.cast::<IAudioSessionControl2>().and_then(|c| c.GetProcessId())
            else {
                continue;
            };
            if process_name(pid).is_some_and(|name| matches_app(app, &name))
                && let Ok(volume) = control.cast::<ISimpleAudioVolume>()
            {
                found.push(volume);
            }
        }
    }
    Ok(found)
}

/// Runs `f` on the player's sessions off the main thread.
async fn with_player<F>(app: String, f: F) -> Result<VolumeState, String>
where
    F: FnOnce(&[ISimpleAudioVolume]) -> windows::core::Result<VolumeState> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let sessions = player_sessions(&app).map_err(|e| e.to_string())?;
        if sessions.is_empty() {
            return Err(NOT_FOUND.to_string());
        }
        f(&sessions).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read(session: &ISimpleAudioVolume) -> windows::core::Result<VolumeState> {
    unsafe {
        Ok(VolumeState {
            volume: session.GetMasterVolume()?,
            muted: session.GetMute()?.as_bool(),
        })
    }
}

#[tauri::command]
pub async fn media_get_volume(app: String) -> Result<VolumeState, String> {
    with_player(app, |sessions| read(&sessions[0])).await
}

#[tauri::command]
pub async fn media_set_volume(app: String, level: f32) -> Result<VolumeState, String> {
    let level = if level.is_finite() { level.clamp(0.0, 1.0) } else { 0.0 };
    with_player(app, move |sessions| {
        for session in sessions {
            unsafe { session.SetMasterVolume(level, std::ptr::null())? };
        }
        read(&sessions[0])
    })
    .await
}

#[tauri::command]
pub async fn media_toggle_mute(app: String) -> Result<VolumeState, String> {
    with_player(app, |sessions| {
        let mute = !read(&sessions[0])?.muted;
        for session in sessions {
            unsafe { session.SetMute(mute, std::ptr::null())? };
        }
        read(&sessions[0])
    })
    .await
}
