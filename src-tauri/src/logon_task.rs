//! "Start with Windows as administrator": a Task Scheduler task that runs
//! Lumen with the highest privileges at sign-in. The Run key can't do this:
//! Windows silently skips Run entries that need elevation. Creating and
//! removing the task needs admin rights, so both go through a UAC prompt.
//! macOS has a twin in `macos/logon_task.rs` where none of this exists.

use std::{fs, os::windows::process::CommandExt, process::Command};

use tauri::{AppHandle, Manager};
use windows::{
    Win32::{
        Foundation::{CloseHandle, HANDLE, HWND},
        Globalization::{CP_OEMCP, MULTI_BYTE_TO_WIDE_CHAR_FLAGS, MultiByteToWideChar},
        Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation},
        System::Threading::{
            GetCurrentProcess, GetExitCodeProcess, INFINITE, OpenProcessToken, WaitForSingleObject,
        },
        UI::{
            Shell::{SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW},
            WindowsAndMessaging::SW_HIDE,
        },
    },
    core::{HSTRING, PCWSTR, w},
};

const TASK: &str = "Lumen";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Whether the task is registered. Reading it needs no elevation.
pub fn exists() -> bool {
    Command::new("schtasks.exe")
        .args(["/Query", "/TN", TASK])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .is_ok_and(|out| out.status.success())
}

/// Registers the task for the current exe; false if it didn't happen
/// (UAC declined, no admin rights). The prompt comes up over the settings.
pub fn create(app: &AppHandle) -> bool {
    register(|params| run_elevated(params, uac_parent(app)))
}

/// Removes the task; false if it's still there.
pub fn remove(app: &AppHandle) -> bool {
    run_elevated(&format!("/Delete /TN \"{TASK}\" /F"), uac_parent(app));
    !exists()
}

/// After Lumen moved to another folder the task would keep starting the old
/// exe, or nothing. Running elevated, it's rewritten for this exe without a
/// prompt; otherwise it's left as is, since a UAC prompt at startup would come
/// out of nowhere (switching the setting off and on fixes it then).
pub fn refresh() {
    let (Some(command), Ok(exe)) = (command(), std::env::current_exe()) else {
        return;
    };
    if command.eq_ignore_ascii_case(&exe.to_string_lossy()) {
        return;
    }
    if is_elevated() {
        register(schtasks);
    }
}

/// Writes the task XML for the current exe and hands `/Create` to `run`.
fn register(run: impl FnOnce(&str) -> bool) -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let dir = exe.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    let user = match (std::env::var("USERDOMAIN"), std::env::var("USERNAME")) {
        (Ok(domain), Ok(name)) => format!("{domain}\\{name}"),
        (_, Ok(name)) => name,
        _ => return false,
    };
    let xml = task_xml(&exe.to_string_lossy(), &dir, &user);

    // schtasks reads task XML as UTF-16 with a BOM.
    let path = std::env::temp_dir().join("lumen-logon-task.xml");
    let mut bytes = vec![0xFF, 0xFE];
    bytes.extend(xml.encode_utf16().flat_map(u16::to_le_bytes));
    if fs::write(&path, bytes).is_err() {
        return false;
    }
    let ok = run(&format!("/Create /TN \"{TASK}\" /XML \"{}\" /F", path.display()));
    let _ = fs::remove_file(&path);
    ok && exists()
}

/// The exe the task starts, or `None` if there's no task.
fn command() -> Option<String> {
    let out = Command::new("schtasks.exe")
        .args(["/Query", "/TN", TASK, "/XML"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .filter(|out| out.status.success())?;
    let xml = decode(&out.stdout);
    let start = xml.find("<Command>")? + "<Command>".len();
    let end = start + xml[start..].find("</Command>")?;
    Some(unescape(xml[start..end].trim()))
}

/// schtasks writes in the console's code page: UTF-8 where the system uses
/// it, else the OEM one (866 for Russian), which a Cyrillic user folder needs.
fn decode(bytes: &[u8]) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    unsafe {
        let flags = MULTI_BYTE_TO_WIDE_CHAR_FLAGS(0);
        let len = MultiByteToWideChar(CP_OEMCP, flags, bytes, None);
        let mut wide = vec![0u16; len.max(0) as usize];
        let len = MultiByteToWideChar(CP_OEMCP, flags, bytes, Some(&mut wide));
        String::from_utf16_lossy(&wide[..len.max(0) as usize])
    }
}

/// Whether Lumen runs elevated (started by the task, for one).
fn is_elevated() -> bool {
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut size = 0;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut TOKEN_ELEVATION as *mut _),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        )
        .is_ok();
        let _ = CloseHandle(token);
        ok && elevation.TokenIsElevated != 0
    }
}

/// schtasks right here, for when Lumen already has the rights.
fn schtasks(params: &str) -> bool {
    Command::new("schtasks.exe")
        .raw_arg(params)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .is_ok_and(|out| out.status.success())
}

/// The settings window, so the UAC prompt comes up over it.
fn uac_parent(app: &AppHandle) -> Option<HWND> {
    let hwnd = app.get_webview_window(crate::settings::WINDOW)?.hwnd().ok()?;
    Some(HWND(hwnd.0))
}

/// Starts at sign-in of this user only, with no time limit (the default would
/// stop Lumen after 72 hours) and on battery too.
fn task_xml(exe: &str, dir: &str, user: &str) -> String {
    let (exe, dir, user) = (escape(exe), escape(dir), escape(user));
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Запускает Lumen от имени администратора при входе в Windows</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{user}</UserId>
      <Delay>PT3S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>4</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{exe}</Command>
      <WorkingDirectory>{dir}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"#
    )
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Runs schtasks with `params` elevated (after the UAC prompt) and waits for
/// it; true if it exited with 0.
fn run_elevated(params: &str, parent: Option<HWND>) -> bool {
    let params = HSTRING::from(params);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        hwnd: parent.unwrap_or_default(),
        lpVerb: w!("runas"),
        lpFile: w!("schtasks.exe"),
        lpParameters: PCWSTR(params.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe {
        if ShellExecuteExW(&mut info).is_err() || info.hProcess.is_invalid() {
            return false;
        }
        WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = 1u32;
        let _ = GetExitCodeProcess(info.hProcess, &mut code);
        let _ = CloseHandle(info.hProcess);
        code == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_oem_paths() {
        // "Артем" in code page 866, as schtasks writes it to a pipe.
        let bytes = [b'<', b'C', b'>', 0x80, 0xE0, 0xE2, 0xA5, 0xAC];
        assert_eq!(decode(&bytes), "<C>Артем");
        assert_eq!(decode("<C>Артем".as_bytes()), "<C>Артем");
    }

    #[test]
    fn xml_round_trip() {
        let path = r"C:\Users\A&B 'x'\Lumen.exe";
        assert_eq!(unescape(&escape(path)), path);
    }
}
