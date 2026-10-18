//! Secrets at rest on macOS (the Discord app secret and access token, the
//! clipboard history), sealed with AES-256-GCM under a key kept in the user's
//! login Keychain. Like DPAPI on Windows: a copy of the files taken to another
//! account or Mac, from a backup or a synced folder, can't be read.
//!
//! The key goes through the system's `security` tool, which then owns the
//! Keychain item: Lumen's own binary changes with every build and update,
//! and an item it owned would ask for the login password after each one.

use std::{
    io::Write,
    process::{Command, Stdio},
    sync::OnceLock,
};

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, Generate, Key, KeyInit},
};
use base64::{Engine, engine::general_purpose::STANDARD};

/// Marks a sealed value; anything without it is a plain one from before.
const PREFIX: &str = "keychain:";
/// What Windows' DPAPI sealed: can't be opened here.
const WINDOWS_PREFIX: &str = "dpapi:";
const SECURITY: &str = "/usr/bin/security";
const SERVICE: &str = "dev.lumen.app";
const ACCOUNT: &str = "secrets-key";
const NONCE_LEN: usize = 12;

/// `plain` sealed as `keychain:<base64>`; empty stays empty.
pub fn seal(plain: &str) -> Option<String> {
    if plain.is_empty() {
        return Some(String::new());
    }
    Some(format!("{PREFIX}{}", STANDARD.encode(seal_bytes(plain.as_bytes())?)))
}

/// The plain value of a sealed one, or the value itself if it was never
/// sealed. `None` when it can't be opened (another user or Mac, or Windows).
pub fn open(stored: &str) -> Option<String> {
    if stored.starts_with(WINDOWS_PREFIX) {
        return None;
    }
    let Some(encoded) = stored.strip_prefix(PREFIX) else {
        return Some(stored.to_string());
    };
    String::from_utf8(open_bytes(&STANDARD.decode(encoded).ok()?)?).ok()
}

/// Whether a stored value is sealed, so an old plain one gets sealed now.
pub fn is_sealed(stored: &str) -> bool {
    stored.starts_with(PREFIX)
}

/// Bytes sealed as they are, for files: nonce, then ciphertext and tag.
pub fn seal_bytes(plain: &[u8]) -> Option<Vec<u8>> {
    let nonce = Nonce::generate();
    let sealed = cipher()?.encrypt(&nonce, plain).ok()?;
    Some([nonce.as_slice(), &sealed].concat())
}

/// The plain bytes of sealed ones.
pub fn open_bytes(sealed: &[u8]) -> Option<Vec<u8>> {
    if sealed.len() < NONCE_LEN {
        return None;
    }
    let (nonce, data) = sealed.split_at(NONCE_LEN);
    cipher()?.decrypt(&Nonce::try_from(nonce).ok()?, data).ok()
}

/// The cipher under the Keychain key, made on first use; `None` if the
/// Keychain can't be reached (then nothing gets written).
fn cipher() -> Option<&'static Aes256Gcm> {
    static CIPHER: OnceLock<Option<Aes256Gcm>> = OnceLock::new();
    CIPHER
        .get_or_init(|| {
            let key = stored_key().or_else(new_key)?;
            Some(Aes256Gcm::new(&Key::<Aes256Gcm>::try_from(key.as_slice()).ok()?))
        })
        .as_ref()
}

fn stored_key() -> Option<Vec<u8>> {
    let output = Command::new(SECURITY)
        .args(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"])
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let key = from_hex(String::from_utf8(output.stdout).ok()?.trim())?;
    (key.len() == 32).then_some(key)
}

/// Makes a key and keeps it in the Keychain. It goes in through `security`'s
/// stdin, never its arguments, which other processes can see.
fn new_key() -> Option<Vec<u8>> {
    let key = Key::<Aes256Gcm>::generate().to_vec();
    let hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
    let mut child = Command::new(SECURITY)
        .arg("-i")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let command = format!(
        "add-generic-password -U -s {SERVICE} -a {ACCOUNT} -l Lumen -w {hex}\n"
    );
    child.stdin.take()?.write_all(command.as_bytes()).ok()?;
    child.wait().ok()?;
    // Read back, so a key that didn't make it in is never used.
    stored_key().filter(|stored| *stored == key)
}

fn from_hex(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok())
        .collect()
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
        assert_eq!(open("dpapi:AAAA"), None);
    }

    #[test]
    fn seals_and_opens_bytes() {
        let png = b"\x89PNG\r\n\x1a\nnot really an image";
        let sealed = seal_bytes(png).unwrap();
        assert!(!sealed.starts_with(b"\x89PNG"));
        assert_eq!(open_bytes(&sealed).as_deref(), Some(&png[..]));
        assert_eq!(open_bytes(png), None);
    }
}
