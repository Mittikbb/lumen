//! Small read-only helpers for the Windows registry.

use windows::{
    Win32::{
        Foundation::ERROR_SUCCESS,
        System::Registry::{
            HKEY, KEY_READ, REG_ROUTINE_FLAGS, RRF_RT_REG_DWORD, RRF_RT_REG_SZ, RegCloseKey,
            RegEnumKeyExW, RegGetValueW, RegOpenKeyExW,
        },
    },
    core::{HSTRING, PCWSTR, PWSTR},
};

pub use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

/// Names of a key's subkeys.
pub fn subkeys(root: HKEY, path: &str) -> Vec<String> {
    let mut names = Vec::new();
    unsafe {
        let mut key = HKEY::default();
        if RegOpenKeyExW(root, &HSTRING::from(path), None, KEY_READ, &mut key) != ERROR_SUCCESS {
            return names;
        }
        for index in 0.. {
            let mut buf = [0u16; 256];
            let mut len = buf.len() as u32;
            let status = RegEnumKeyExW(
                key,
                index,
                Some(PWSTR(buf.as_mut_ptr())),
                &mut len,
                None,
                None,
                None,
                None,
            );
            if status != ERROR_SUCCESS {
                break;
            }
            names.push(String::from_utf16_lossy(&buf[..len as usize]));
        }
        let _ = RegCloseKey(key);
    }
    names
}

/// A string value; `None` for the key's default (unnamed) value.
pub fn string(root: HKEY, path: &str, name: Option<&str>) -> Option<String> {
    let mut buf = [0u16; 1024];
    let size = read(
        root,
        path,
        name,
        RRF_RT_REG_SZ,
        buf.as_mut_ptr().cast(),
        buf.len() * 2,
    )?;
    let len = (size / 2).saturating_sub(1);
    Some(String::from_utf16_lossy(&buf[..len]))
}

pub fn dword(root: HKEY, path: &str, name: &str) -> Option<u32> {
    let mut value = 0u32;
    read(
        root,
        path,
        Some(name),
        RRF_RT_REG_DWORD,
        (&mut value as *mut u32).cast(),
        4,
    )?;
    Some(value)
}

/// Reads a value into `data`; returns the number of bytes written.
fn read(
    root: HKEY,
    path: &str,
    name: Option<&str>,
    kind: REG_ROUTINE_FLAGS,
    data: *mut std::ffi::c_void,
    capacity: usize,
) -> Option<usize> {
    let name = name.map(HSTRING::from);
    let mut size = capacity as u32;
    let status = unsafe {
        RegGetValueW(
            root,
            &HSTRING::from(path),
            name.as_ref().map_or(PCWSTR::null(), |n| PCWSTR(n.as_ptr())),
            kind,
            None,
            Some(data),
            Some(&mut size),
        )
    };
    (status == ERROR_SUCCESS).then_some(size as usize)
}
