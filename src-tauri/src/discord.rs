//! Discord over its local RPC pipe: the voice channel you're in shows on the
//! island (who's there, who's talking, mute and deafen), and the track that's
//! playing becomes your Discord status.
//!
//! RPC needs the user's own Discord application (client id and secret from the
//! Developer Portal). Voice access is granted once in Discord; the token is kept
//! in discord-token.json. A synchronous pipe can't be read and written at the
//! same time, so one thread does all the I/O and polls for incoming frames.

use std::{
    collections::VecDeque,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::windows::io::AsRawHandle,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};
use windows::Win32::{Foundation::HANDLE, System::Pipes::PeekNamedPipe};

use crate::{
    media, net,
    settings::{self, DiscordPrefs},
};

const RETRY: Duration = Duration::from_secs(5);
const TICK: Duration = Duration::from_millis(40);
const PRESENCE_EVERY: Duration = Duration::from_secs(2);
const TOKEN_URL: &str = "https://discord.com/api/oauth2/token";
/// Must be listed under OAuth2 → Redirects of the user's Discord application.
const REDIRECT_URI: &str = "http://127.0.0.1";
const SCOPES: [&str; 3] = ["rpc", "rpc.voice.read", "rpc.voice.write"];
const NOT_RUNNING: &str = "Discord не запущен";

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;
const OP_PING: u32 = 3;
const OP_PONG: u32 = 4;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// "off", "connecting", "waiting" (Discord isn't running), "authorize"
    /// (waiting for the user to allow access in Discord), "ready" or "error".
    state: String,
    /// What went wrong, or a hint while waiting.
    message: Option<String>,
    /// The Discord account Lumen is connected to.
    user: Option<String>,
    voice: Option<Voice>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Voice {
    channel: String,
    members: Vec<Member>,
    /// Your own microphone and sound, as set in Discord.
    mute: bool,
    deaf: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    id: String,
    name: String,
    avatar: String,
    speaking: bool,
    muted: bool,
    deafened: bool,
}

enum Command {
    ToggleMute,
    ToggleDeaf,
    Leave,
}

#[derive(Default)]
pub struct Discord {
    status: Mutex<Status>,
    /// Bumped on every restart, so the old connection thread winds down.
    generation: AtomicU64,
    commands: Mutex<Option<Sender<Command>>>,
}

pub fn init(app: &AppHandle) {
    restart(app);
}

/// (Re)connects with the current settings, or disconnects if Discord is off.
pub fn restart(app: &AppHandle) {
    let discord = app.state::<Discord>();
    let generation = discord.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let prefs = settings::get(app).discord;
    if !prefs.enabled || prefs.client_id.trim().is_empty() {
        *discord.commands.lock().unwrap() = None;
        set_status(app, "off", None);
        return;
    }
    let (tx, rx) = mpsc::channel();
    *discord.commands.lock().unwrap() = Some(tx);
    let app = app.clone();
    thread::spawn(move || run(app, generation, prefs, rx));
}

#[tauri::command]
pub fn discord_status(discord: State<Discord>) -> Status {
    discord.status.lock().unwrap().clone()
}

/// "mute", "deaf" or "leave" for the current voice channel.
#[tauri::command]
pub fn discord_voice(discord: State<Discord>, action: String) -> Result<(), String> {
    let command = match action.as_str() {
        "mute" => Command::ToggleMute,
        "deaf" => Command::ToggleDeaf,
        "leave" => Command::Leave,
        _ => return Err(format!("unknown action {action}")),
    };
    let commands = discord.commands.lock().unwrap();
    let tx = commands.as_ref().ok_or("Discord не подключён")?;
    tx.send(command).map_err(|e| e.to_string())
}

/// Forgets the saved access, so Discord asks for it again.
#[tauri::command]
pub fn discord_forget(app: AppHandle) {
    if let Some(path) = token_path(&app) {
        let _ = fs::remove_file(path);
    }
    restart(&app);
}

fn alive(app: &AppHandle, generation: u64) -> bool {
    app.state::<Discord>().generation.load(Ordering::SeqCst) == generation
}

fn update_status(app: &AppHandle, change: impl FnOnce(&mut Status)) {
    let discord = app.state::<Discord>();
    let status = {
        let mut status = discord.status.lock().unwrap();
        change(&mut status);
        status.clone()
    };
    let _ = app.emit("lumen://discord", status);
}

fn set_status(app: &AppHandle, state: &str, message: Option<String>) {
    update_status(app, |s| {
        s.state = state.into();
        s.message = message;
        if state != "ready" {
            s.voice = None;
        }
        if state == "off" {
            s.user = None;
        }
    });
}

/// Connection loop: reconnects until the settings change or Lumen exits.
fn run(app: AppHandle, generation: u64, prefs: DiscordPrefs, rx: Receiver<Command>) {
    while alive(&app, generation) {
        set_status(&app, "connecting", None);
        let result = Pipe::connect().and_then(|mut pipe| {
            let mut session = Session {
                app: &app,
                generation,
                prefs: &prefs,
                pipe: &mut pipe,
                voice: None,
                track: None,
            };
            session.serve(&rx)
        });
        if !alive(&app, generation) {
            return;
        }
        match result {
            Ok(()) => return,
            Err(e) if e == NOT_RUNNING => set_status(&app, "waiting", Some(e)),
            Err(e) => set_status(&app, "error", Some(e)),
        }
        let until = Instant::now() + RETRY;
        while Instant::now() < until {
            if !alive(&app, generation) {
                return;
            }
            thread::sleep(TICK);
        }
    }
}

struct Pipe {
    file: File,
    nonce: u64,
    /// Events read while waiting for a reply, handled afterwards.
    backlog: VecDeque<Value>,
}

impl Pipe {
    fn connect() -> Result<Self, String> {
        let mut permission_denied = false;
        for i in 0..10 {
            let path = format!(r"\\.\pipe\discord-ipc-{i}");
            match OpenOptions::new().read(true).write(true).open(path) {
                Ok(file) => {
                    return Ok(Self {
                        file,
                        nonce: 0,
                        backlog: VecDeque::new(),
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                    permission_denied = true;
                }
                Err(_) => {}
            }
        }
        if permission_denied {
            Err("Discord запущен от имени администратора. Запустите Lumen от администратора или Discord без прав администратора".into())
        } else {
            Err(NOT_RUNNING.into())
        }
    }

    fn send(&mut self, op: u32, body: &Value) -> Result<(), String> {
        let body = body.to_string();
        let mut frame = Vec::with_capacity(8 + body.len());
        frame.extend_from_slice(&op.to_le_bytes());
        frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
        frame.extend_from_slice(body.as_bytes());
        self.file.write_all(&frame).map_err(closed)
    }

    fn pending(&self) -> Result<bool, String> {
        let mut available = 0u32;
        unsafe {
            PeekNamedPipe(
                HANDLE(self.file.as_raw_handle()),
                None,
                0,
                None,
                Some(&mut available),
                None,
            )
        }
        .map_err(|_| "Discord закрыл соединение".to_string())?;
        Ok(available > 0)
    }

    /// The next message, if one has arrived; answers pings on the way.
    fn poll(&mut self) -> Result<Option<Value>, String> {
        if let Some(event) = self.backlog.pop_front() {
            return Ok(Some(event));
        }
        while self.pending()? {
            let mut header = [0u8; 8];
            self.file.read_exact(&mut header).map_err(closed)?;
            let op = u32::from_le_bytes(header[..4].try_into().unwrap());
            let len = u32::from_le_bytes(header[4..].try_into().unwrap()) as usize;
            let mut body = vec![0u8; len];
            self.file.read_exact(&mut body).map_err(closed)?;
            let value: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
            match op {
                OP_FRAME => return Ok(Some(value)),
                OP_CLOSE => {
                    let reason = value["message"].as_str().unwrap_or("соединение закрыто");
                    return Err(format!("Discord: {reason}"));
                }
                OP_PING => self.send(OP_PONG, &value)?,
                _ => {}
            }
        }
        Ok(None)
    }
}

fn closed(_: std::io::Error) -> String {
    "Discord закрыл соединение".into()
}

struct Session<'a> {
    app: &'a AppHandle,
    generation: u64,
    prefs: &'a DiscordPrefs,
    pipe: &'a mut Pipe,
    /// `None` when voice is off or not authorised.
    voice: Option<Voice>,
    /// Channel whose events we're subscribed to.
    track: Option<(String, String)>,
}

impl Session<'_> {
    fn serve(&mut self, rx: &Receiver<Command>) -> Result<(), String> {
        let client_id = self.prefs.client_id.trim().to_string();
        self.pipe
            .send(OP_HANDSHAKE, &json!({ "v": 1, "client_id": client_id }))?;
        let ready = self.wait_for(|m| m["evt"] == "READY")?;
        let user = ready["data"]["user"]["global_name"]
            .as_str()
            .or(ready["data"]["user"]["username"].as_str())
            .map(String::from);
        update_status(self.app, |s| s.user = user);

        let mut voice_note = None;
        if self.prefs.voice {
            if self.prefs.client_secret.trim().is_empty() {
                voice_note = Some("Для звонков нужен секрет приложения".to_string());
            } else {
                self.authenticate()?;
                self.start_voice()?;
            }
        }
        set_status(self.app, "ready", voice_note);
        self.publish_voice();

        let mut track: Option<(String, String)> = None;
        let mut last_presence = Instant::now() - PRESENCE_EVERY;
        loop {
            if !alive(self.app, self.generation) {
                return Ok(());
            }
            while let Some(message) = self.pipe.poll()? {
                self.handle_event(message)?;
            }
            while let Ok(command) = rx.try_recv() {
                self.run_command(command)?;
            }
            if self.prefs.presence && last_presence.elapsed() >= PRESENCE_EVERY {
                last_presence = Instant::now();
                // Spotify sets its own Discord status; don't double it.
                let now = media::playing_track(self.app)
                    .filter(|(_, _, player)| !player.to_lowercase().contains("spotify"))
                    .map(|(title, artist, _)| (title, artist));
                if now != track {
                    self.set_activity(now.as_ref())?;
                    track = now;
                }
            }
            thread::sleep(TICK);
        }
    }

    /// Sends a command and waits for its reply; events arriving meanwhile are
    /// kept for later.
    fn request(&mut self, cmd: &str, args: Value) -> Result<Value, String> {
        self.pipe.nonce += 1;
        let nonce = self.pipe.nonce.to_string();
        self.pipe.send(
            OP_FRAME,
            &json!({ "cmd": cmd, "args": args, "nonce": nonce }),
        )?;
        let reply = self.wait_for(|m| m["nonce"] == nonce.as_str())?;
        if reply["evt"] == "ERROR" {
            let message = reply["data"]["message"].as_str().unwrap_or("ошибка");
            return Err(format!("Discord: {message}"));
        }
        Ok(reply["data"].clone())
    }

    fn subscribe(&mut self, evt: &str, args: Value) -> Result<(), String> {
        self.pipe.nonce += 1;
        let nonce = self.pipe.nonce.to_string();
        self.pipe.send(
            OP_FRAME,
            &json!({ "cmd": "SUBSCRIBE", "evt": evt, "args": args, "nonce": nonce }),
        )?;
        self.wait_for(|m| m["nonce"] == nonce.as_str()).map(|_| ())
    }

    fn unsubscribe(&mut self, evt: &str, args: Value) -> Result<(), String> {
        self.pipe.nonce += 1;
        let nonce = self.pipe.nonce.to_string();
        self.pipe.send(
            OP_FRAME,
            &json!({ "cmd": "UNSUBSCRIBE", "evt": evt, "args": args, "nonce": nonce }),
        )?;
        self.wait_for(|m| m["nonce"] == nonce.as_str()).map(|_| ())
    }

    fn wait_for(&mut self, matches: impl Fn(&Value) -> bool) -> Result<Value, String> {
        let mut skipped = VecDeque::new();
        let result = loop {
            if !alive(self.app, self.generation) {
                break Err("остановлено".into());
            }
            match self.pipe.poll() {
                Ok(Some(message)) if matches(&message) => break Ok(message),
                Ok(Some(message)) => skipped.push_back(message),
                Ok(None) => thread::sleep(TICK),
                Err(e) => break Err(e),
            }
        };
        // Keep unrelated messages in order, ahead of anything still queued.
        while let Some(message) = skipped.pop_back() {
            self.pipe.backlog.push_front(message);
        }
        result
    }

    /// Logs in with the saved token, asking Discord for access the first time.
    fn authenticate(&mut self) -> Result<(), String> {
        let mut token = load_token(self.app, self.prefs);
        if let Some(t) = &token {
            if t.expires_at <= unix_now() + 60 {
                token = refresh(self.prefs, &t.refresh_token).ok();
            }
        }
        for attempt in 0..2 {
            let current = match token.take() {
                Some(t) => t,
                None => {
                    set_status(
                        self.app,
                        "authorize",
                        Some("Подтверди доступ в окне Discord".into()),
                    );
                    // No redirect here: RPC refuses one. Discord takes the redirect
                    // registered on the app, so it must have exactly one.
                    let code = self
                        .request(
                            "AUTHORIZE",
                            json!({ "client_id": self.prefs.client_id.trim(), "scopes": SCOPES }),
                        )
                        .map_err(|e| {
                            if e.contains("redirect_uri") {
                                format!("В Developer Portal → OAuth2 → Redirects должен быть ровно один адрес {REDIRECT_URI} — добавь его и нажми Save Changes")
                            } else {
                                e
                            }
                        })?;
                    let code = code["code"]
                        .as_str()
                        .ok_or("Discord не выдал код доступа")?;
                    exchange(self.prefs, code)?
                }
            };
            save_token(self.app, &current);
            match self.request(
                "AUTHENTICATE",
                json!({ "access_token": current.access_token }),
            ) {
                Ok(_) => return Ok(()),
                // A stale token: forget it and ask again once.
                Err(e) if attempt == 0 => {
                    eprintln!("discord: {e}, asking for access again");
                }
                Err(e) => return Err(e),
            }
        }
        Err("Не удалось войти в Discord".into())
    }

    fn start_voice(&mut self) -> Result<(), String> {
        self.subscribe("VOICE_CHANNEL_SELECT", json!({}))?;
        self.subscribe("VOICE_SETTINGS_UPDATE", json!({}))?;
        let settings = self.request("GET_VOICE_SETTINGS", json!({}))?;
        let channel = self.request("GET_SELECTED_VOICE_CHANNEL", json!({}))?;
        self.enter_channel(&channel)?;
        if let Some(voice) = &mut self.voice {
            voice.mute = settings["mute"].as_bool().unwrap_or(false);
            voice.deaf = settings["deaf"].as_bool().unwrap_or(false);
        }
        Ok(())
    }

    /// Switches event subscriptions to a channel (or none) and loads its members.
    fn enter_channel(&mut self, channel: &Value) -> Result<(), String> {
        const EVENTS: [&str; 5] = [
            "VOICE_STATE_CREATE",
            "VOICE_STATE_UPDATE",
            "VOICE_STATE_DELETE",
            "SPEAKING_START",
            "SPEAKING_STOP",
        ];
        if let Some((id, _)) = self.track.take() {
            for evt in EVENTS {
                let _ = self.unsubscribe(evt, json!({ "channel_id": id }));
            }
        }
        let (mute, deaf) = self
            .voice
            .as_ref()
            .map_or((false, false), |v| (v.mute, v.deaf));
        let Some(id) = channel["id"].as_str().map(String::from) else {
            self.voice = Some(Voice {
                mute,
                deaf,
                ..Default::default()
            });
            return Ok(());
        };
        for evt in EVENTS {
            self.subscribe(evt, json!({ "channel_id": id }))?;
        }
        let name = channel["name"]
            .as_str()
            .filter(|n| !n.is_empty())
            .unwrap_or("Личный звонок")
            .to_string();
        let members = channel["voice_states"]
            .as_array()
            .map(|states| states.iter().filter_map(member).collect())
            .unwrap_or_default();
        self.track = Some((id, name.clone()));
        self.voice = Some(Voice {
            channel: name,
            members,
            mute,
            deaf,
        });
        Ok(())
    }

    fn handle_event(&mut self, message: Value) -> Result<(), String> {
        let data = &message["data"];
        let Some(evt) = message["evt"].as_str() else {
            return Ok(());
        };
        match evt {
            "VOICE_CHANNEL_SELECT" => {
                let channel = match data["channel_id"].as_str() {
                    Some(id) => self.request("GET_CHANNEL", json!({ "channel_id": id }))?,
                    None => Value::Null,
                };
                self.enter_channel(&channel)?;
            }
            "VOICE_STATE_CREATE" | "VOICE_STATE_UPDATE" => {
                if let (Some(voice), Some(m)) = (&mut self.voice, member(data)) {
                    match voice.members.iter_mut().find(|x| x.id == m.id) {
                        Some(existing) => {
                            let speaking = existing.speaking;
                            *existing = Member { speaking, ..m };
                        }
                        None => voice.members.push(m),
                    }
                }
            }
            "VOICE_STATE_DELETE" => {
                if let (Some(voice), Some(id)) = (&mut self.voice, data["user"]["id"].as_str()) {
                    voice.members.retain(|m| m.id != id);
                }
            }
            "SPEAKING_START" | "SPEAKING_STOP" => {
                let speaking = evt == "SPEAKING_START";
                if let (Some(voice), Some(id)) = (&mut self.voice, data["user_id"].as_str()) {
                    if let Some(m) = voice.members.iter_mut().find(|m| m.id == id) {
                        m.speaking = speaking;
                    }
                }
            }
            "VOICE_SETTINGS_UPDATE" => {
                if let Some(voice) = &mut self.voice {
                    voice.mute = data["mute"].as_bool().unwrap_or(voice.mute);
                    voice.deaf = data["deaf"].as_bool().unwrap_or(voice.deaf);
                }
            }
            _ => return Ok(()),
        }
        self.publish_voice();
        Ok(())
    }

    fn run_command(&mut self, command: Command) -> Result<(), String> {
        let Some(voice) = &self.voice else {
            return Ok(());
        };
        let (mute, deaf) = (voice.mute, voice.deaf);
        match command {
            Command::ToggleMute => {
                self.request("SET_VOICE_SETTINGS", json!({ "mute": !mute }))?;
            }
            Command::ToggleDeaf => {
                self.request("SET_VOICE_SETTINGS", json!({ "deaf": !deaf }))?;
            }
            Command::Leave => {
                self.request(
                    "SELECT_VOICE_CHANNEL",
                    json!({ "channel_id": null, "force": true }),
                )?;
            }
        }
        Ok(())
    }

    /// Shows the track as "Listening to …"; `None` clears the status.
    fn set_activity(&mut self, track: Option<&(String, String)>) -> Result<(), String> {
        let pid = std::process::id();
        let Some((title, artist)) = track else {
            return self
                .request("SET_ACTIVITY", json!({ "pid": pid }))
                .map(|_| ());
        };
        // Discord wants 2..128 characters in each field.
        let field = |s: &str| {
            let s: String = s.chars().take(128).collect();
            if s.chars().count() < 2 {
                format!("{s}  ")
            } else {
                s
            }
        };
        let mut activity = json!({ "type": 2, "details": field(title) });
        if !artist.is_empty() {
            activity["state"] = json!(field(artist));
        }
        self.request("SET_ACTIVITY", json!({ "pid": pid, "activity": activity }))
            .map(|_| ())
    }

    /// Sends the voice state to the island when it changed.
    fn publish_voice(&self) {
        let voice = self.voice.clone().filter(|v| !v.channel.is_empty());
        update_status(self.app, |s| s.voice = voice);
    }
}

/// A channel member from a voice state.
fn member(state: &Value) -> Option<Member> {
    let user = &state["user"];
    let id = user["id"].as_str()?.to_string();
    let name = state["nick"]
        .as_str()
        .filter(|n| !n.is_empty())
        .or(user["global_name"].as_str())
        .or(user["username"].as_str())
        .unwrap_or("?")
        .to_string();
    let avatar = match user["avatar"].as_str() {
        Some(hash) => format!("https://cdn.discordapp.com/avatars/{id}/{hash}.png?size=64"),
        None => {
            let index = (id.parse::<u64>().unwrap_or(0) >> 22) % 6;
            format!("https://cdn.discordapp.com/embed/avatars/{index}.png")
        }
    };
    let voice = &state["voice_state"];
    let flag = |key: &str| voice[key].as_bool().unwrap_or(false);
    Some(Member {
        id,
        name,
        avatar,
        speaking: false,
        muted: flag("self_mute") || flag("mute"),
        deafened: flag("self_deaf") || flag("deaf"),
    })
}

#[derive(Serialize, Deserialize)]
struct Token {
    client_id: String,
    access_token: String,
    refresh_token: String,
    /// Unix seconds.
    expires_at: u64,
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
}

fn exchange(prefs: &DiscordPrefs, code: &str) -> Result<Token, String> {
    token_request(
        prefs,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", REDIRECT_URI),
        ],
    )
}

fn refresh(prefs: &DiscordPrefs, refresh_token: &str) -> Result<Token, String> {
    token_request(
        prefs,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ],
    )
}

fn token_request(prefs: &DiscordPrefs, fields: &[(&str, &str)]) -> Result<Token, String> {
    let client_id = prefs.client_id.trim();
    let mut form = vec![
        ("client_id", client_id),
        ("client_secret", prefs.client_secret.trim()),
    ];
    form.extend_from_slice(fields);
    let reply: TokenReply = match net::agent().post(TOKEN_URL).send_form(&form) {
        Ok(response) => response.into_json().map_err(|e| e.to_string())?,
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            return Err(format!("Discord не выдал доступ ({code}): {body}"));
        }
        Err(e) => return Err(format!("Нет связи с Discord: {e}")),
    };
    Ok(Token {
        client_id: client_id.into(),
        access_token: reply.access_token,
        refresh_token: reply.refresh_token,
        expires_at: unix_now() + reply.expires_in,
    })
}

fn token_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("discord-token.json"))
}

/// The saved token, if it belongs to the configured application.
fn load_token(app: &AppHandle, prefs: &DiscordPrefs) -> Option<Token> {
    let token: Token = serde_json::from_str(&fs::read_to_string(token_path(app)?).ok()?).ok()?;
    (token.client_id == prefs.client_id.trim()).then_some(token)
}

fn save_token(app: &AppHandle, token: &Token) {
    if let (Some(path), Ok(json)) = (token_path(app), serde_json::to_string(token)) {
        let _ = fs::write(path, json);
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}
