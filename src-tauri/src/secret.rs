//! Secrets at rest (the Discord app secret and access token), sealed with
//! DPAPI for the current Windows user: a copy of the file taken to another
//! account or PC, from a backup or a synced profile, can't be read.

use std::{ptr, slice};

use base64::{Engine, engine::general_purpose::STANDARD};
use windows::Win32::{
    Foundation::{HLOCAL, LocalFree},
    Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    },
};

/// Marks a sealed value; anything without it is a plain one from before.
const PREFIX: &str = "dpapi:";
/// Ties the sealed data to Lumen, so it isn't opened by accident elsewhere.
const ENTROPY: &[u8] = b"Lumen secret";

/// `plain` sealed as `dpapi:<base64>`; empty stays empty.
pub fn seal(plain: &str) -> Option<String> {
    if plain.is_empty() {
        return Some(String::new());
    }
    let sealed = crypt(plain.as_bytes(), true)?;
    Some(format!("{PREFIX}{}", STANDARD.encode(sealed)))
}

/// The plain value of a sealed one, or the value itself if it was never
/// sealed. `None` when it can't be opened (another user or PC).
pub fn open(stored: &str) -> Option<String> {
    let Some(encoded) = stored.strip_prefix(PREFIX) else {
        return Some(stored.to_string());
    };
    let plain = crypt(&STANDARD.decode(encoded).ok()?, false)?;
    String::from_utf8(plain).ok()
}

fn crypt(data: &[u8], protect: bool) -> Option<Vec<u8>> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: ENTROPY.len() as u32,
        pbData: ENTROPY.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    unsafe {
        let done = if protect {
            CryptProtectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        } else {
            CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        };
        done.ok()?;
        let bytes = slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(Some(HLOCAL(output.pbData as _)));
        Some(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seals_and_opens() {
        let sealed = seal("секрет 123").unwrap();
        assert!(sealed.starts_with(PREFIX));
        assert!(!sealed.contains("123"));
        assert_eq!(open(&sealed).as_deref(), Some("секрет 123"));
    }

    #[test]
    fn plain_values_pass_through() {
        assert_eq!(open("old plain secret").as_deref(), Some("old plain secret"));
        assert_eq!(seal("").as_deref(), Some(""));
    }

    #[test]
    fn tampered_data_does_not_open() {
        let mut sealed = seal("секрет").unwrap();
        sealed.truncate(sealed.len() - 4);
        sealed.push_str("AAAA");
        assert_eq!(open(&sealed), None);
    }
}
