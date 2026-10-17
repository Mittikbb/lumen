//! Thin layer over the Win32 clipboard: reading and writing text and images,
//! privacy flags, the owning app, and the Ctrl+V keystroke.

use std::{thread, time::Duration};

use image::RgbaImage;
use windows::{
    Win32::{
        Foundation::{CloseHandle, HANDLE, HGLOBAL},
        System::{
            DataExchange::{
                CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardOwner,
                GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
                RegisterClipboardFormatW, SetClipboardData,
            },
            Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock},
            Ole::{CF_DIB, CF_UNICODETEXT},
            Threading::{
                OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
                QueryFullProcessImageNameW,
            },
        },
        UI::{
            Input::KeyboardAndMouse::{
                INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput,
                VIRTUAL_KEY, VK_CONTROL, VK_V,
            },
            WindowsAndMessaging::GetWindowThreadProcessId,
        },
    },
    core::{PWSTR, w},
};

use crate::pixels as img;

pub enum Content {
    Text(String),
    Image(RgbaImage),
}

/// Goes up whenever anything is copied.
pub fn sequence() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

/// Reads what's on the clipboard, unless it's empty or marked private.
/// Text wins when both are present (e.g. cells copied from Excel).
pub fn read() -> Option<(Content, Option<String>)> {
    let _guard = ClipboardGuard::open()?;
    if is_private() {
        return None;
    }
    let content = if available(CF_UNICODETEXT.0 as u32) {
        let bytes = read_bytes(CF_UNICODETEXT.0 as u32)?;
        let wide: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .take_while(|&c| c != 0)
            .collect();
        Content::Text(String::from_utf16_lossy(&wide))
    } else if let Some(png) = available(png_format())
        .then(|| read_bytes(png_format()))
        .flatten()
    {
        // Browsers and modern apps offer PNG, which keeps transparency.
        Content::Image(img::decode_png(&png)?)
    } else if available(CF_DIB.0 as u32) {
        Content::Image(img::from_dib(&read_bytes(CF_DIB.0 as u32)?)?)
    } else {
        return None;
    };
    Some((content, owner_app()))
}

pub fn write_text(text: &str) -> Result<(), String> {
    let wide: Vec<u8> = text
        .encode_utf16()
        .chain(Some(0))
        .flat_map(u16::to_le_bytes)
        .collect();
    let _guard = ClipboardGuard::open().ok_or("clipboard is busy")?;
    unsafe { EmptyClipboard() }.map_err(|e| e.message())?;
    set(CF_UNICODETEXT.0 as u32, &wide)
}

/// Puts an image on the clipboard as both a classic DIB (understood by every
/// app) and PNG (keeps transparency in apps that support it).
pub fn write_image(image: &RgbaImage, png: &[u8]) -> Result<(), String> {
    let dib = img::to_dib(image);
    let _guard = ClipboardGuard::open().ok_or("clipboard is busy")?;
    unsafe { EmptyClipboard() }.map_err(|e| e.message())?;
    set(CF_DIB.0 as u32, &dib)?;
    set(png_format(), png)
}

pub fn send_ctrl_v() {
    let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                ..Default::default()
            },
        },
    };
    let inputs = [
        key(VK_CONTROL, false),
        key(VK_V, false),
        key(VK_V, true),
        key(VK_CONTROL, true),
    ];
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

fn png_format() -> u32 {
    unsafe { RegisterClipboardFormatW(w!("PNG")) }
}

fn available(format: u32) -> bool {
    format != 0 && unsafe { IsClipboardFormatAvailable(format) }.is_ok()
}

/// Copies a clipboard format's raw bytes. Clipboard must be open.
fn read_bytes(format: u32) -> Option<Vec<u8>> {
    unsafe {
        let handle = GetClipboardData(format).ok()?;
        let global = HGLOBAL(handle.0);
        let ptr = GlobalLock(global) as *const u8;
        if ptr.is_null() {
            return None;
        }
        let bytes = std::slice::from_raw_parts(ptr, GlobalSize(global)).to_vec();
        let _ = GlobalUnlock(global);
        Some(bytes)
    }
}

/// Hands a copy of `bytes` to the clipboard. Clipboard must be open and emptied.
fn set(format: u32, bytes: &[u8]) -> Result<(), String> {
    unsafe {
        let global = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|e| e.message())?;
        let ptr = GlobalLock(global) as *mut u8;
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        let _ = GlobalUnlock(global);
        // On success the clipboard owns the memory.
        SetClipboardData(format, Some(HANDLE(global.0))).map_err(|e| e.message())?;
    }
    Ok(())
}

/// Password managers and other apps mark sensitive content with these
/// standard formats so clipboard history tools skip it.
fn is_private() -> bool {
    let excluded = unsafe {
        [
            RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing")),
            RegisterClipboardFormatW(w!("Clipboard Viewer Ignore")),
        ]
    };
    if excluded.into_iter().any(available) {
        return true;
    }
    // "CanIncludeInClipboardHistory" holds a DWORD; 0 means "don't keep".
    let can_include = unsafe { RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory")) };
    available(can_include)
        && read_bytes(can_include).is_some_and(|b| b.len() >= 4 && b[..4] == [0, 0, 0, 0])
}

/// Executable name of the clipboard owner, e.g. "chrome".
fn owner_app() -> Option<String> {
    unsafe {
        let hwnd = GetClipboardOwner().ok()?;
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(process);
        ok.ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let file = path.rsplit('\\').next()?;
        Some(
            file.trim_end_matches(".exe")
                .trim_end_matches(".EXE")
                .to_string(),
        )
    }
}

/// Opens the clipboard (retrying while another app holds it) and closes it on drop.
struct ClipboardGuard;

impl ClipboardGuard {
    fn open() -> Option<Self> {
        for _ in 0..10 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                return Some(Self);
            }
            thread::sleep(Duration::from_millis(15));
        }
        None
    }
}

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}
