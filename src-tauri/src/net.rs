//! HTTP from the backend goes through the same proxy as the user's other apps:
//! HTTPS_PROXY / ALL_PROXY if set, otherwise the Windows proxy from Internet
//! Options (what VPN clients such as v2rayN switch on). Without it, requests
//! to blocked hosts like discord.com just time out. On macOS the system proxy
//! comes from Network settings (what VPN clients switch on there).

use std::time::Duration;

#[cfg(windows)]
use crate::registry::{self, HKEY_CURRENT_USER};

const TIMEOUT: Duration = Duration::from_secs(20);
#[cfg(windows)]
const INTERNET_SETTINGS: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

#[cfg_attr(not(windows), allow(dead_code))] // for Discord, not on macOS yet
pub fn agent() -> ureq::Agent {
    let mut builder = ureq::AgentBuilder::new().timeout(TIMEOUT);
    if let Some(proxy) = system_proxy().and_then(|p| ureq::Proxy::new(p).ok()) {
        builder = builder.proxy(proxy);
    }
    builder.build()
}

pub fn system_proxy() -> Option<String> {
    for var in ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] {
        if let Ok(value) = std::env::var(var) {
            if !value.trim().is_empty() {
                return Some(value);
            }
        }
    }
    os_proxy()
}

/// The proxy set in System Settings → Network: HTTPS, then HTTP, then SOCKS.
#[cfg(target_os = "macos")]
fn os_proxy() -> Option<String> {
    use objc2_foundation::{NSDictionary, NSNumber, NSObject, NSString};

    #[link(name = "CFNetwork", kind = "framework")]
    unsafe extern "C" {
        fn CFNetworkCopySystemProxySettings() -> *mut NSDictionary<NSString, NSObject>;
    }
    let settings = unsafe { objc2::rc::Retained::from_raw(CFNetworkCopySystemProxySettings())? };
    let value = |key: &str| settings.objectForKey(&NSString::from_str(key));
    let number = |key: &str| {
        value(key)?
            .downcast::<NSNumber>()
            .ok()
            .map(|n| n.integerValue())
    };
    let host = |key: &str| value(key)?.downcast::<NSString>().ok().map(|h| h.to_string());
    for (kind, scheme) in [("HTTPS", "http"), ("HTTP", "http"), ("SOCKS", "socks5")] {
        if number(&format!("{kind}Enable")) != Some(1) {
            continue;
        }
        let (Some(host), Some(port)) = (host(&format!("{kind}Proxy")), number(&format!("{kind}Port"))) else {
            continue;
        };
        return Some(format!("{scheme}://{host}:{port}"));
    }
    None
}

#[cfg(windows)]
fn os_proxy() -> Option<String> {
    windows_proxy()
}

#[cfg(windows)]
fn windows_proxy() -> Option<String> {
    if registry::dword(HKEY_CURRENT_USER, INTERNET_SETTINGS, "ProxyEnable")? == 0 {
        return None;
    }
    let server = registry::string(HKEY_CURRENT_USER, INTERNET_SETTINGS, Some("ProxyServer"))?;
    // Either "host:port" for everything, or per scheme:
    // "http=host:port;https=host:port;socks=host:port".
    if !server.contains('=') {
        return Some(if server.contains("://") {
            server
        } else {
            format!("http://{server}")
        });
    }
    let entry = |scheme: &str| {
        server.split(';').find_map(|e| {
            e.trim()
                .strip_prefix(&format!("{scheme}="))
                .map(str::to_string)
        })
    };
    entry("https")
        .or_else(|| entry("http"))
        .map(|address| format!("http://{address}"))
        .or_else(|| entry("socks").map(|address| format!("socks5://{address}")))
}
