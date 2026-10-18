//! Addons: third-party JavaScript that extends the island. Each one is a
//! folder in `<app data>/addons/` with a `manifest.json` and a script.
//!
//! An addon runs in a sandboxed iframe of the island window, served from the
//! `lumenaddon` scheme below. The sandbox gives it an opaque origin: no Tauri
//! IPC (its scripts are injected into the main frame only and need the invoke
//! key), no cookies or storage, and a CSP that lets it load nothing but its
//! own files. Everything it can do goes through `window.lumen` (sdk.js), a
//! postMessage bridge to the island, which checks the permissions the user
//! granted. The few things that need the backend (its storage, the network)
//! are re-checked here against the manifest and the settings.
//!
//! The folder is polled every couple of seconds, so a dropped-in or edited
//! addon shows up (and reloads) without restarting Lumen.

use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, UriSchemeContext,
    http::{Request, Response, StatusCode, header},
};
use tauri_plugin_opener::OpenerExt;

use crate::{clipboard::sys as clipboard, hotkeys, net, settings};

mod front;
mod terminal;

/// The URI scheme addon files are served from.
pub const SCHEME: &str = "lumenaddon";
/// The newest addon API this Lumen speaks (`"lumen"` in the manifest).
const API_VERSION: u32 = 1;
const SDK: &str = include_str!("sdk.js");
/// Every permission an addon may ask for; see docs/addons.md.
const PERMISSIONS: [&str; 8] = [
    "notify", "clipboard", "links", "media", "network", "foreground", "hotkeys", "terminal",
];
const POLL: Duration = Duration::from_secs(2);
/// An addon's stored data, serialized.
const STORAGE_LIMIT: usize = 1024 * 1024;
const RESPONSE_LIMIT: u64 = 5 * 1024 * 1024;
/// Both spellings of the scheme's origin: WebView2 serves custom schemes as
/// http://<scheme>.localhost, WebKit as <scheme>://localhost.
const ORIGINS: &str = "http://lumenaddon.localhost lumenaddon://localhost";
/// Its own scripts and pictures, nothing else: no network, frames or workers.
const CSP: &str = "default-src 'none'; script-src {ORIGINS}; img-src {ORIGINS} data:; style-src 'unsafe-inline'";

/// An addon as the frontend sees it. A broken one keeps its folder name as
/// its id and says what's wrong in `error`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonInfo {
    id: String,
    folder: String,
    name: String,
    version: String,
    author: Option<String>,
    description: Option<String>,
    main: String,
    icon: Option<String>,
    permissions: Vec<String>,
    network: Vec<String>,
    tab: Option<Tab>,
    search: bool,
    /// Queries starting with this belong to the addon alone (manifest
    /// `"search": { "prefix": "-" }`).
    search_prefix: Option<String>,
    settings: Vec<Value>,
    /// Newest modification time of its files; changes when it's edited.
    stamp: u64,
    error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tab {
    label: String,
    /// The expanded island's height on this tab, px.
    height: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    lumen: Option<u32>,
    author: Option<String>,
    description: Option<String>,
    #[serde(default = "default_main")]
    main: String,
    icon: Option<String>,
    #[serde(default)]
    permissions: Vec<String>,
    #[serde(default)]
    network: Vec<String>,
    tab: Option<Tab>,
    /// `true`, or `{ "prefix": "-" }`.
    #[serde(default)]
    search: Value,
    #[serde(default)]
    settings: Vec<Value>,
}

impl Manifest {
    /// Whether it answers in search, and the prefix it owns, if any.
    fn search(&self) -> Result<(bool, Option<String>), String> {
        match &self.search {
            Value::Null | Value::Bool(false) => Ok((false, None)),
            Value::Bool(true) => Ok((true, None)),
            Value::Object(o) => match o.get("prefix").and_then(Value::as_str) {
                Some(p) if (1..=8).contains(&p.chars().count()) && !p.contains(char::is_whitespace) => {
                    Ok((true, Some(p.to_string())))
                }
                _ => Err("search.prefix: от 1 до 8 символов без пробелов".into()),
            },
            _ => Err("search: true или { \"prefix\": \"…\" }".into()),
        }
    }
}

fn default_main() -> String {
    "main.js".into()
}

#[derive(Default)]
pub struct Addons {
    list: Mutex<Vec<(AddonInfo, PathBuf)>>,
}

impl Addons {
    /// The folder of a working addon.
    fn dir(&self, id: &str) -> Option<(AddonInfo, PathBuf)> {
        self.list
            .lock()
            .unwrap()
            .iter()
            .find(|(info, _)| info.id == id && info.error.is_none())
            .cloned()
    }
}

fn root(app: &AppHandle<impl Runtime>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("addons"))
}

fn data_file(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("addon-data");
    let _ = fs::create_dir_all(&dir);
    Some(dir.join(format!("{id}.json")))
}

/// Creates the addons folder and starts watching it.
pub fn init(app: &AppHandle) {
    if let Some(dir) = root(app) {
        let _ = fs::create_dir_all(dir);
    }
    rescan(app);
    let app = app.clone();
    thread::spawn(move || {
        let mut seen = signature(&app);
        loop {
            thread::sleep(POLL);
            let now = signature(&app);
            if now != seen {
                seen = now;
                let list = rescan(&app);
                let _ = app.emit("lumen://addons", list);
            }
        }
    });
}

/// Reads every addon folder again and returns the list.
fn rescan(app: &AppHandle) -> Vec<AddonInfo> {
    let found = root(app).map(|dir| scan(&dir)).unwrap_or_default();
    let list = found.iter().map(|(info, _)| info.clone()).collect();
    *app.state::<Addons>().list.lock().unwrap() = found;
    list
}

fn scan(root: &Path) -> Vec<(AddonInfo, PathBuf)> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.join("manifest.json").is_file())
        .collect();
    dirs.sort();
    let mut ids = HashSet::new();
    dirs.into_iter()
        .map(|dir| {
            let mut info = load(&dir);
            if info.error.is_none() && !ids.insert(info.id.clone()) {
                info.error = Some(format!("Аддон с id «{}» уже есть в другой папке", info.id));
            }
            (info, dir)
        })
        .collect()
}

fn load(dir: &Path) -> AddonInfo {
    let folder = dir.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let stamp = newest(dir);
    let broken = |error: String| AddonInfo {
        id: folder.clone(),
        folder: folder.clone(),
        name: folder.clone(),
        version: String::new(),
        author: None,
        description: None,
        main: default_main(),
        icon: None,
        permissions: Vec::new(),
        network: Vec::new(),
        tab: None,
        search: false,
        search_prefix: None,
        settings: Vec::new(),
        stamp,
        error: Some(error),
    };
    let text = match fs::read_to_string(dir.join("manifest.json")) {
        Ok(text) => text,
        Err(e) => return broken(format!("Не читается manifest.json: {e}")),
    };
    let manifest: Manifest = match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
        Ok(m) => m,
        Err(e) => return broken(format!("Ошибка в manifest.json: {e}")),
    };
    if let Err(e) = validate(&manifest, dir) {
        return broken(e);
    }
    let (search, search_prefix) = match manifest.search() {
        Ok(search) => search,
        Err(e) => return broken(e),
    };
    // Commands come only from queries typed for the addon, after its prefix.
    if search_prefix.is_none() && manifest.permissions.iter().any(|p| p == "terminal") {
        return broken("Разрешению terminal нужен свой префикс: \"search\": { \"prefix\": \"…\" }".into());
    }
    AddonInfo {
        id: manifest.id,
        folder,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        description: manifest.description,
        main: manifest.main,
        icon: manifest.icon,
        permissions: manifest.permissions,
        network: manifest.network.iter().map(|h| h.to_ascii_lowercase()).collect(),
        tab: manifest.tab,
        search,
        search_prefix,
        settings: manifest.settings,
        stamp,
        error: None,
    }
}

fn validate(m: &Manifest, dir: &Path) -> Result<(), String> {
    let id_ok = (1..=64).contains(&m.id.len())
        && m.id.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && m.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "-_.".contains(c));
    if !id_ok {
        return Err("id: только латиница в нижнем регистре, цифры, «-», «_» и «.»".into());
    }
    if m.name.trim().is_empty() || m.name.chars().count() > 40 {
        return Err("name: от 1 до 40 символов".into());
    }
    if m.lumen.unwrap_or(1) > API_VERSION {
        return Err("Нужна более новая версия Lumen".into());
    }
    if let Some(p) = m.permissions.iter().find(|p| !PERMISSIONS.contains(&p.as_str())) {
        return Err(format!("Неизвестное разрешение «{p}»"));
    }
    let network = m.permissions.iter().any(|p| p == "network");
    if network && m.network.is_empty() {
        return Err("Разрешению network нужен список адресов в «network»".into());
    }
    if !network && !m.network.is_empty() {
        return Err("Адреса в «network» без разрешения network".into());
    }
    if let Some(h) = m.network.iter().find(|h| !host_pattern_ok(h)) {
        return Err(format!("Адрес «{h}»: нужно имя хоста, например api.example.com или *.example.com"));
    }
    if let Some(tab) = &m.tab
        && (tab.label.trim().is_empty() || tab.label.chars().count() > 16)
    {
        return Err("tab.label: от 1 до 16 символов".into());
    }
    if !m.main.ends_with(".js") || safe_path(&m.main).is_none() || !dir.join(&m.main).is_file() {
        return Err(format!("Нет скрипта «{}»", m.main));
    }
    Ok(())
}

/// "api.example.com" or "*.example.com".
fn host_pattern_ok(pattern: &str) -> bool {
    let host = pattern.strip_prefix("*.").unwrap_or(pattern);
    host.contains('.')
        && host
            .split('.')
            .all(|l| !l.is_empty() && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
}

fn host_matches(pattern: &str, host: &str) -> bool {
    match pattern.strip_prefix("*.") {
        Some(domain) => host.strip_suffix(domain).is_some_and(|sub| sub.ends_with('.') && sub.len() > 1),
        None => host == pattern,
    }
}

/// A relative path that stays inside the addon's folder.
fn safe_path(path: &str) -> Option<PathBuf> {
    if path.is_empty() || path.contains(['\\', ':']) {
        return None;
    }
    let path = Path::new(path);
    path.components()
        .all(|c| matches!(c, Component::Normal(_)))
        .then(|| path.to_path_buf())
}

/// Newest modification time of the files in an addon's folder and one level below.
fn newest(dir: &Path) -> u64 {
    let mtime = |p: &Path| {
        fs::metadata(p)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64)
    };
    let mut newest = mtime(dir);
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        newest = newest.max(mtime(&path));
        if path.is_dir() {
            for inner in fs::read_dir(&path).into_iter().flatten().flatten() {
                newest = newest.max(mtime(&inner.path()));
            }
        }
    }
    newest
}

/// What the folder looks like, cheaply: each addon folder and its newest file.
fn signature(app: &AppHandle) -> Vec<(PathBuf, u64)> {
    let Some(root) = root(app) else {
        return Vec::new();
    };
    let mut sig: Vec<_> = fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .map(|p| {
            let stamp = newest(&p);
            (p, stamp)
        })
        .collect();
    sig.sort();
    sig
}

/// What the user allowed this addon, from the settings: `addons.enabled.<id>`
/// lists granted permissions (and "network:<host>" entries); missing or null
/// means it's switched off.
fn granted(app: &AppHandle, id: &str) -> Option<Vec<String>> {
    settings::read(app, |s| {
        let list = s.rest.get("addons")?.get("enabled")?.get(id)?.as_array()?;
        Some(list.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
    })
}

/// Serves `lumenaddon://localhost/<id>/<file>`: the page an addon runs in
/// (`<id>/`), the SDK, and the addon's own files.
pub fn protocol<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = percent_decode(request.uri().path());
    let mut parts = path.trim_start_matches('/').splitn(2, '/');
    let id = parts.next().unwrap_or_default();
    let rest = parts.next();
    let app = ctx.app_handle();
    let Some((info, dir)) = app.state::<Addons>().dir(id) else {
        return status(StatusCode::NOT_FOUND);
    };
    match rest {
        // Without the slash, the page's relative links would miss the folder.
        None => Response::builder()
            .status(StatusCode::MOVED_PERMANENTLY)
            .header(header::LOCATION, format!("{id}/"))
            .body(Vec::new())
            .unwrap(),
        Some("") => {
            let page = format!(
                "<!doctype html><meta charset=\"utf-8\"><title>{id}</title>\
                 <script src=\"__lumen/sdk.js\"></script><script src=\"{}\"></script>",
                info.main.replace('"', "%22")
            );
            let mut response = file_response(page.into_bytes(), "text/html; charset=utf-8");
            // Sandboxed even if something ever loads it outside the island's iframe.
            let csp = format!("{}; sandbox allow-scripts", CSP.replace("{ORIGINS}", ORIGINS));
            response
                .headers_mut()
                .insert(header::CONTENT_SECURITY_POLICY, csp.parse().unwrap());
            response
        }
        Some("__lumen/sdk.js") => file_response(SDK.as_bytes().to_vec(), "text/javascript; charset=utf-8"),
        Some(file) => {
            let Some(relative) = safe_path(file) else {
                return status(StatusCode::FORBIDDEN);
            };
            match fs::read(dir.join(relative)) {
                Ok(bytes) => file_response(bytes, content_type(file)),
                Err(_) => status(StatusCode::NOT_FOUND),
            }
        }
    }
}

fn file_response(body: Vec<u8>, kind: &str) -> Response<Vec<u8>> {
    Response::builder()
        .header(header::CONTENT_TYPE, kind)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_SECURITY_POLICY, CSP.replace("{ORIGINS}", ORIGINS))
        .body(body)
        .unwrap()
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(code).body(Vec::new()).unwrap()
}

fn content_type(file: &str) -> &'static str {
    let ext = file.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
    match ext.as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn percent_decode(s: &str) -> String {
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2]))
        {
            out.push(hi << 4 | lo);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
pub fn addons_list(app: AppHandle) -> Vec<AddonInfo> {
    rescan(&app)
}

/// Opens the addons folder in Explorer (Finder on macOS).
#[tauri::command]
pub fn addons_open_folder(app: AppHandle) -> Result<(), String> {
    let dir = root(&app).ok_or("no app data folder")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Everything an addon stored, as an object.
#[tauri::command]
pub fn addons_storage_get(app: AppHandle, id: String) -> Value {
    data_file(&app, &id)
        .filter(|_| app.state::<Addons>().dir(&id).is_some())
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Map::new()))
}

/// Replaces what an addon stored; refuses more than 1 MB.
#[tauri::command]
pub fn addons_storage_set(app: AppHandle, id: String, data: Value) -> Result<(), String> {
    if app.state::<Addons>().dir(&id).is_none() || granted(&app, &id).is_none() {
        return Err("addon is not enabled".into());
    }
    if !data.is_object() {
        return Err("storage must be an object".into());
    }
    let json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    if json.len() > STORAGE_LIMIT {
        return Err("storage is over 1 MB".into());
    }
    let path = data_file(&app, &id).ok_or("no app data folder")?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| e.to_string())
}

/// Copies text an addon handed over (the island checked its permission).
#[tauri::command]
pub fn addons_copy(text: String) -> Result<(), String> {
    clipboard::write_text(&text)
}

/// Watches the app in front while an addon with "foreground" runs.
#[tauri::command]
pub fn addons_watch_front(app: AppHandle, on: bool) {
    front::watch(&app, on);
}

/// The app in front right now (the island checked the permission).
#[tauri::command]
pub fn addons_front() -> Option<front::Front> {
    front::current()
}

/// Lets go of Lumen's shortcuts while an addon with "hotkeys" asks to, and
/// takes them back once none does (the island keeps count).
#[tauri::command]
pub fn addons_pause_hotkeys(app: AppHandle, paused: bool) {
    hotkeys::pause(&app, paused);
}

/// Runs a command the user chose in a new terminal window, for an addon
/// allowed "terminal".
#[tauri::command]
pub fn addons_terminal(app: AppHandle, id: String, command: String, shell: Option<String>) -> Result<(), String> {
    let (info, _) = app.state::<Addons>().dir(&id).ok_or("addon not found")?;
    let allowed = granted(&app, &id).ok_or("addon is not enabled")?;
    if !info.permissions.iter().any(|p| p == "terminal") || !allowed.iter().any(|p| p == "terminal") {
        return Err("permission \"terminal\" is not granted".into());
    }
    let command = command.trim();
    // As long as the island shows whole in the result's row (host.ts COMMAND_MAX).
    if command.is_empty() || command.chars().count() > 300 || command.contains(['\r', '\n']) {
        return Err("bad command".into());
    }
    terminal::open(command, shell.as_deref().unwrap_or("powershell"))
}

#[derive(Deserialize)]
pub struct FetchRequest {
    url: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: Vec<(String, String)>,
    #[serde(default)]
    body: Option<String>,
}

#[derive(Serialize)]
pub struct FetchResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

/// An HTTPS request on an addon's behalf, through the system proxy, to one of
/// the hosts its manifest names and the user allowed.
#[tauri::command]
pub async fn addons_fetch(app: AppHandle, id: String, request: FetchRequest) -> Result<FetchResponse, String> {
    let (info, _) = app.state::<Addons>().dir(&id).ok_or("addon not found")?;
    let allowed = granted(&app, &id).ok_or("addon is not enabled")?;
    let url = tauri::Url::parse(&request.url).map_err(|e| format!("bad url: {e}"))?;
    if url.scheme() != "https" {
        return Err("only https:// is allowed".into());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let permitted = allowed.iter().any(|p| p == "network")
        && info
            .network
            .iter()
            .any(|p| host_matches(p, &host) && allowed.iter().any(|g| g.strip_prefix("network:") == Some(p)));
    if !permitted {
        return Err(format!("{host} is not in the addon's allowed hosts"));
    }
    let method = request.method.unwrap_or_else(|| "GET".into()).to_ascii_uppercase();
    if !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].contains(&method.as_str()) {
        return Err(format!("method {method} is not allowed"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        // No redirects: one could lead off the allowed hosts.
        let mut req = net::builder().redirects(0).build().request(&method, url.as_str());
        for (name, value) in &request.headers {
            let lower = name.to_ascii_lowercase();
            if ["host", "cookie", "connection", "content-length", "transfer-encoding"].contains(&lower.as_str()) {
                continue;
            }
            req = req.set(name, value);
        }
        let result = match &request.body {
            Some(body) => req.send_string(body),
            None => req.call(),
        };
        let response = match result {
            Ok(r) | Err(ureq::Error::Status(_, r)) => r,
            Err(e) => return Err(e.to_string()),
        };
        let status = response.status();
        let headers = response
            .headers_names()
            .into_iter()
            .filter_map(|name| response.header(&name).map(|v| (name.clone(), v.to_string())))
            .collect();
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(RESPONSE_LIMIT)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        Ok(FetchResponse {
            status,
            headers,
            body: String::from_utf8_lossy(&bytes).into_owned(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_patterns() {
        assert!(host_pattern_ok("api.example.com"));
        assert!(host_pattern_ok("*.example.com"));
        assert!(!host_pattern_ok("example"));
        assert!(!host_pattern_ok("https://example.com"));
        assert!(!host_pattern_ok("*.example.com/path"));
        assert!(host_matches("api.example.com", "api.example.com"));
        assert!(!host_matches("api.example.com", "evil.api.example.com"));
        assert!(host_matches("*.example.com", "a.example.com"));
        assert!(!host_matches("*.example.com", "example.com"));
        assert!(!host_matches("*.example.com", "badexample.com"));
    }

    #[test]
    fn paths_stay_inside() {
        assert!(safe_path("main.js").is_some());
        assert!(safe_path("img/icon.png").is_some());
        assert!(safe_path("../secret").is_none());
        assert!(safe_path("/etc/passwd").is_none());
        assert!(safe_path("C:\\Windows").is_none());
        assert!(safe_path("a/../../b").is_none());
        assert!(safe_path("a\\..\\..\\b").is_none());
        assert!(safe_path("").is_none());
    }

    #[test]
    fn decodes_percent() {
        assert_eq!(percent_decode("/notes/my%20file.png"), "/notes/my file.png");
        assert_eq!(percent_decode("/a%2"), "/a%2");
        assert_eq!(percent_decode("/%D0%B0"), "/а");
    }
}
