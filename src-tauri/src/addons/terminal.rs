//! Runs a command in a new window of the system's terminal, for addons with
//! the "terminal" permission. The command shows and runs in plain sight, and
//! the window stays open with its output.
//!
//! On Windows the shell gets a console of its own, which Windows opens in the
//! user's default terminal app (Windows Terminal or the classic console).
//! On macOS it's a new Terminal window.

use std::process::Command;

#[cfg(windows)]
pub fn open(command: &str, shell: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

    let mut process = match shell {
        // cmd takes the rest of its command line as is.
        "cmd" => {
            let mut c = Command::new("cmd.exe");
            c.raw_arg(format!("/K {command}"));
            c
        }
        "pwsh" => powershell("pwsh.exe", command),
        _ => powershell("powershell.exe", command),
    };
    if let Some(home) = std::env::var_os("USERPROFILE") {
        process.current_dir(home);
    }
    let spawned = process.creation_flags(CREATE_NEW_CONSOLE).spawn();
    match spawned {
        Ok(_) => Ok(()),
        // PowerShell 7 isn't installed: the built-in one will do.
        Err(_) if shell == "pwsh" => open(command, "powershell"),
        Err(e) => Err(e.to_string()),
    }
}

/// PowerShell that echoes the command, runs it and stays open. It's passed
/// encoded, so no quote in it can be misread on the way.
#[cfg(windows)]
fn powershell(exe: &str, command: &str) -> Command {
    use base64::{Engine, engine::general_purpose::STANDARD};

    let script = format!(
        "Write-Host ('> ' + '{}') -ForegroundColor DarkGray\n{command}",
        command.replace('\'', "''")
    );
    let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut c = Command::new(exe);
    c.args(["-NoLogo", "-NoExit", "-EncodedCommand", &STANDARD.encode(utf16)]);
    c
}

#[cfg(target_os = "macos")]
pub fn open(command: &str, _shell: &str) -> Result<(), String> {
    let quoted = command.replace('\\', "\\\\").replace('"', "\\\"");
    Command::new("osascript")
        .args([
            "-e",
            &format!("tell application \"Terminal\" to do script \"{quoted}\""),
            "-e",
            "tell application \"Terminal\" to activate",
        ])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
