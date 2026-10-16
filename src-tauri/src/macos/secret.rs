//! Secrets at rest on macOS: not wired up yet (Windows seals them with DPAPI;
//! here it should be a key in the login Keychain). Until then nothing is
//! sealed, so nothing secret reaches the disk: the clipboard history lives in
//! memory only and a Discord secret isn't saved. Plain values from before
//! still open.

/// Can't seal yet; empty stays empty.
pub fn seal(plain: &str) -> Option<String> {
    plain.is_empty().then(String::new)
}

/// A plain value as it is; one sealed with DPAPI on Windows doesn't open.
pub fn open(stored: &str) -> Option<String> {
    (!stored.starts_with("dpapi:")).then(|| stored.to_string())
}

pub fn seal_bytes(_plain: &[u8]) -> Option<Vec<u8>> {
    None
}

pub fn open_bytes(_sealed: &[u8]) -> Option<Vec<u8>> {
    None
}
