//! "Start with Windows as administrator": a Task Scheduler task that runs
//! Lumen with the highest privileges at sign-in. The Run key can't do this:
//! Windows silently skips Run entries that need elevation. Creating and
//! removing the task needs admin rights, so both go through a UAC prompt.

use std::{fs, os::windows::process::CommandExt, process::Command};

use windows::{
    Win32::{
        Foundation::{CloseHandle, HWND},
        System::Threading::{GetExitCodeProcess, INFINITE, WaitForSingleObject},
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
/// (UAC declined, no admin rights). `parent` owns the UAC prompt.
pub fn create(parent: Option<HWND>) -> bool {
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
    let ok = run_elevated(
        &format!("/Create /TN \"{TASK}\" /XML \"{}\" /F", path.display()),
        parent,
    );
    let _ = fs::remove_file(&path);
    ok && exists()
}

/// Removes the task; false if it's still there.
pub fn remove(parent: Option<HWND>) -> bool {
    run_elevated(&format!("/Delete /TN \"{TASK}\" /F"), parent);
    !exists()
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
