//! "Игры": when a game takes the screen, the island pops out for a few
//! seconds with its FPS and how loaded the PC is, then goes on as usual (the
//! fullscreen watch in overlay.rs hides it next if it should).
//!
//! FPS counts the frames the game presents, from the DXGI and Direct3D 9 ETW
//! providers. A trace session needs admin rights or the Performance Log Users
//! group; without them the FPS is left out and the rest still shows.

use std::{
    ffi::c_void,
    sync::atomic::{AtomicBool, AtomicU32, Ordering},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use windows::{
    Win32::{
        Foundation::{CloseHandle, ERROR_SUCCESS, FILETIME, HWND},
        UI::WindowsAndMessaging::{HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SetWindowPos},
        System::{
            Diagnostics::Etw::{
                CONTROLTRACE_HANDLE, CloseTrace, ControlTraceW, EVENT_CONTROL_CODE_ENABLE_PROVIDER, EVENT_RECORD,
                EVENT_TRACE_CONTROL_STOP, EVENT_TRACE_LOGFILEW, EVENT_TRACE_PROPERTIES, EVENT_TRACE_REAL_TIME_MODE,
                EnableTraceEx2, OpenTraceW, PROCESS_TRACE_MODE_EVENT_RECORD, PROCESS_TRACE_MODE_REAL_TIME,
                PROCESSTRACE_HANDLE, ProcessTrace, StartTraceW, TRACE_LEVEL_VERBOSE, WNODE_FLAG_TRACED_GUID,
            },
            Performance::{
                PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA,
                PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
                PdhOpenQueryW,
            },
            SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX},
            Threading::{
                GetSystemTimes, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
                QueryFullProcessImageNameW,
            },
        },
    },
    core::{GUID, PCWSTR, PWSTR, w},
};

/// How long the island shows the game.
const SHOW: Duration = Duration::from_secs(6);
const SAMPLE: Duration = Duration::from_secs(1);

/// Fullscreen apps that aren't games: browsers, video players, slideshows.
const NOT_GAMES: &[&str] = &[
    "chrome", "msedge", "firefox", "opera", "opera_gx", "brave", "browser", "vivaldi", "arc", "iexplore",
    "vlc", "mpc-hc", "mpc-hc64", "mpc-be", "mpc-be64", "potplayer", "potplayermini", "potplayermini64", "mpv",
    "wmplayer", "video.ui", "microsoft.media.player", "kmplayer", "powerpnt", "explorer",
    "applicationframehost", "telegram", "discord", "obs64", "lumen",
];

#[derive(Clone, Serialize)]
struct Game {
    name: String,
}

#[derive(Clone, Serialize)]
struct Stats {
    /// `None` when frames can't be counted (no rights for a trace session).
    fps: Option<u32>,
    cpu: u32,
    gpu: Option<u32>,
    ram: u32,
}

/// The name to show if the process in front looks like a game.
pub fn game_name(pid: u32, title: &str) -> Option<String> {
    let Some(exe) = exe_stem(pid) else {
        eprintln!("games: can't read process {pid}");
        return None;
    };
    if NOT_GAMES.contains(&exe.to_lowercase().as_str()) {
        return None;
    }
    let title = title.trim();
    Some(if title.is_empty() { exe } else { title.to_string() })
}

pub(crate) fn exe_stem(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut path = [0u16; 1024];
        let mut len = path.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(path.as_mut_ptr()), &mut len);
        let _ = CloseHandle(process);
        ok.ok()?;
        let path = String::from_utf16_lossy(&path[..len as usize]);
        let file = path.rsplit('\\').next()?;
        Some(file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file).to_string())
    }
}

/// "Показать" in the settings: the same card with this PC's load (and the
/// FPS of `pid`, if given).
#[tauri::command]
pub fn games_preview(app: AppHandle, pid: Option<u32>) {
    thread::spawn(move || show(&app, pid.unwrap_or(0), "Пример игры".into()));
}

static SHOWING: AtomicBool = AtomicBool::new(false);

/// Pops the island out with the game's stats, updated every second, for
/// [`SHOW`]. Blocks for that long; does nothing while already showing.
pub fn show(app: &AppHandle, pid: u32, name: String) {
    if SHOWING.swap(true, Ordering::Relaxed) {
        return;
    }
    raise(app);
    let _ = app.emit("lumen://game", Some(Game { name }));
    let mut frames = Frames::start(pid);
    let mut cpu = Cpu::new();
    let gpu = Gpu::new();
    let started = Instant::now();
    while started.elapsed() < SHOW {
        thread::sleep(SAMPLE);
        raise(app);
        let stats = Stats {
            fps: frames.as_mut().map(Frames::per_second),
            cpu: cpu.sample(),
            gpu: gpu.as_ref().and_then(Gpu::sample),
            ram: ram(),
        };
        let _ = app.emit("lumen://game-stats", stats);
    }
    let _ = app.emit("lumen://game", None::<Game>);
    drop(frames);
    SHOWING.store(false, Ordering::Relaxed);
}

/// Games often make their window topmost too, and being newer it ends up
/// over the island: put the island back on top (without taking the focus).
fn raise(app: &AppHandle) {
    let Some(hwnd) = app.get_webview_window("main").and_then(|w| w.hwnd().ok()) else {
        return;
    };
    unsafe {
        let _ = SetWindowPos(
            HWND(hwnd.0),
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
}

/// Busy share of all cores since the last sample.
struct Cpu {
    last: (u64, u64),
}

impl Cpu {
    fn new() -> Self {
        Self { last: Self::times() }
    }

    /// (idle, total) in 100 ns ticks.
    fn times() -> (u64, u64) {
        let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
        unsafe {
            let _ = GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user));
        }
        let ticks = |t: FILETIME| (t.dwHighDateTime as u64) << 32 | t.dwLowDateTime as u64;
        // Kernel time includes the idle time.
        (ticks(idle), ticks(kernel) + ticks(user))
    }

    fn sample(&mut self) -> u32 {
        let now = Self::times();
        let idle = now.0.saturating_sub(self.last.0);
        let total = now.1.saturating_sub(self.last.1);
        self.last = now;
        if total == 0 {
            return 0;
        }
        (100 - idle * 100 / total).min(100) as u32
    }
}

fn ram() -> u32 {
    let mut status = MEMORYSTATUSEX {
        dwLength: size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    unsafe {
        let _ = GlobalMemoryStatusEx(&mut status);
    }
    status.dwMemoryLoad
}

/// 3D load of the GPU, from the same counters Task Manager shows.
struct Gpu {
    query: PDH_HQUERY,
    counter: PDH_HCOUNTER,
}

// The PDH handles are only touched from the thread that made them.
unsafe impl Send for Gpu {}

impl Gpu {
    fn new() -> Option<Self> {
        unsafe {
            let mut query = PDH_HQUERY::default();
            if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != ERROR_SUCCESS.0 {
                return None;
            }
            let mut counter = PDH_HCOUNTER::default();
            if PdhAddEnglishCounterW(query, w!("\\GPU Engine(*engtype_3D)\\Utilization Percentage"), 0, &mut counter)
                != ERROR_SUCCESS.0
            {
                PdhCloseQuery(query);
                return None;
            }
            PdhCollectQueryData(query);
            Some(Self { query, counter })
        }
    }

    fn sample(&self) -> Option<u32> {
        unsafe {
            if PdhCollectQueryData(self.query) != ERROR_SUCCESS.0 {
                return None;
            }
            let (mut size, mut count) = (0u32, 0u32);
            if PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, None) != PDH_MORE_DATA {
                return None;
            }
            // Items followed by their names, so in whole items with room to spare.
            let mut items =
                vec![PDH_FMT_COUNTERVALUE_ITEM_W::default(); size as usize / size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>() + 1];
            if PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, Some(items.as_mut_ptr()))
                != ERROR_SUCCESS.0
            {
                return None;
            }
            let busy: f64 = items[..count as usize].iter().map(|i| i.FmtValue.Anonymous.doubleValue).sum();
            Some(busy.round().clamp(0.0, 100.0) as u32)
        }
    }
}

impl Drop for Gpu {
    fn drop(&mut self) {
        unsafe {
            PdhCloseQuery(self.query);
        }
    }
}

const SESSION: PCWSTR = w!("Lumen FPS");
/// Microsoft-Windows-DXGI and its Present_Start event.
const DXGI: GUID = GUID::from_u128(0xca11c036_0102_4a2d_a6ad_f03cfed5d3c9);
const DXGI_PRESENT: u16 = 42;
/// Microsoft-Windows-D3D9 and its Present_Start event.
const D3D9: GUID = GUID::from_u128(0x783aca0a_790e_4d7f_8451_aa850511c6b9);
const D3D9_PRESENT: u16 = 1;

/// The process whose frames count, and how many it presented since the last read.
static TARGET: AtomicU32 = AtomicU32::new(0);
static PRESENTED: AtomicU32 = AtomicU32::new(0);

/// A real-time trace session counting one process's presented frames.
struct Frames {
    session: CONTROLTRACE_HANDLE,
    last: Instant,
}

impl Frames {
    fn start(pid: u32) -> Option<Self> {
        TARGET.store(pid, Ordering::Relaxed);
        PRESENTED.store(0, Ordering::Relaxed);
        unsafe {
            // A session left over from a crash would make the start fail.
            stop(CONTROLTRACE_HANDLE::default());
            let mut props = Properties::new();
            let mut session = CONTROLTRACE_HANDLE::default();
            let err = StartTraceW(&mut session, SESSION, props.as_mut_ptr());
            if err != ERROR_SUCCESS {
                eprintln!("games: no frame counting ({err:?})");
                return None;
            }
            for provider in [DXGI, D3D9] {
                let _ = EnableTraceEx2(
                    session,
                    &provider,
                    EVENT_CONTROL_CODE_ENABLE_PROVIDER.0,
                    TRACE_LEVEL_VERBOSE as u8,
                    u64::MAX,
                    0,
                    0,
                    None,
                );
            }
            let mut name: Vec<u16> = "Lumen FPS\0".encode_utf16().collect();
            let mut logfile = EVENT_TRACE_LOGFILEW {
                LoggerName: PWSTR(name.as_mut_ptr()),
                ..Default::default()
            };
            logfile.Anonymous1.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
            logfile.Anonymous2.EventRecordCallback = Some(on_event);
            let trace = OpenTraceW(&mut logfile);
            if trace.Value == u64::MAX {
                stop(session);
                return None;
            }
            let trace = trace.Value;
            // Runs until the session stops.
            thread::spawn(move || {
                let handle = PROCESSTRACE_HANDLE { Value: trace };
                let _ = ProcessTrace(&[handle], None, None);
                let _ = CloseTrace(handle);
            });
            Some(Self { session, last: Instant::now() })
        }
    }

    /// Frames per second since the last read.
    fn per_second(&mut self) -> u32 {
        let frames = PRESENTED.swap(0, Ordering::Relaxed);
        let elapsed = self.last.elapsed().as_secs_f64().max(0.001);
        self.last = Instant::now();
        (frames as f64 / elapsed).round() as u32
    }
}

impl Drop for Frames {
    fn drop(&mut self) {
        TARGET.store(0, Ordering::Relaxed);
        unsafe { stop(self.session) };
    }
}

unsafe extern "system" fn on_event(record: *mut EVENT_RECORD) {
    let header = unsafe { &(*record).EventHeader };
    let present = (header.ProviderId == DXGI && header.EventDescriptor.Id == DXGI_PRESENT)
        || (header.ProviderId == D3D9 && header.EventDescriptor.Id == D3D9_PRESENT);
    if present && header.ProcessId == TARGET.load(Ordering::Relaxed) {
        PRESENTED.fetch_add(1, Ordering::Relaxed);
    }
}

unsafe fn stop(session: CONTROLTRACE_HANDLE) {
    let mut props = Properties::new();
    unsafe {
        let _ = ControlTraceW(session, SESSION, props.as_mut_ptr(), EVENT_TRACE_CONTROL_STOP);
    }
}

/// EVENT_TRACE_PROPERTIES with room for the session name after it.
struct Properties(Vec<u64>);

impl Properties {
    fn new() -> Self {
        let size = size_of::<EVENT_TRACE_PROPERTIES>() + 64 * 2;
        let mut buf = vec![0u64; size.div_ceil(8)];
        let props = buf.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES;
        unsafe {
            (*props).Wnode.BufferSize = size as u32;
            (*props).Wnode.Flags = WNODE_FLAG_TRACED_GUID;
            // QPC timestamps.
            (*props).Wnode.ClientContext = 1;
            (*props).LogFileMode = EVENT_TRACE_REAL_TIME_MODE;
            (*props).LoggerNameOffset = size_of::<EVENT_TRACE_PROPERTIES>() as u32;
        }
        Self(buf)
    }

    fn as_mut_ptr(&mut self) -> *mut EVENT_TRACE_PROPERTIES {
        self.0.as_mut_ptr() as *mut c_void as *mut EVENT_TRACE_PROPERTIES
    }
}
