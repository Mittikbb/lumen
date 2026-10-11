//! HTTP from the backend goes through the same proxy as the user's other apps:
//! HTTPS_PROXY / ALL_PROXY if set, otherwise the Windows proxy from Internet
//! Options (what VPN clients such as v2rayN switch on). Without it, requests
//! to blocked hosts like discord.com just time out.

use std::time::Duration;

use crate::registry::{self, HKEY_CURRENT_USER};

const TIMEOUT: Duration = Duration::from_secs(20);
const INTERNET_SETTINGS: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

pub fn agent() -> ureq::Agent {
    let mut builder = ureq::AgentBuilder::new().timeout(TIMEOUT);
    if let Some(proxy) = system_proxy().and_then(|p| ureq::Proxy::new(p).ok()) {
        builder = builder.proxy(proxy);
    }
    builder.build()
}

fn system_proxy() -> Option<String> {
    for var in ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] {
        if let Ok(value) = std::env::var(var) {
            if !value.trim().is_empty() {
                return Some(value);
            }
        }
    }
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
