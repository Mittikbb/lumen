//! The game card on macOS: when a game comes to the front fullscreen, the
//! island pops out for a few seconds with the Mac's load. A game is an app
//! that says so in its Info.plist (LSApplicationCategoryType *-games) or one
//! from a Steam library. CPU and memory come from Mach, the GPU from the
//! IOAccelerator's statistics. Frame rates aren't readable from outside a
//! game on macOS (Windows counts them with ETW), so `fps` stays empty.

use std::{
    ffi::{CStr, c_void},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

use objc2::rc::Retained;
use objc2_app_kit::NSRunningApplication;
use objc2_foundation::{NSDictionary, NSNumber, NSObject, NSString};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// How long the island shows the game.
const SHOW: Duration = Duration::from_secs(6);
const SAMPLE: Duration = Duration::from_secs(1);

#[derive(Clone, Serialize)]
struct Game {
    name: String,
}

#[derive(Clone, Serialize)]
struct Stats {
    fps: Option<u32>,
    cpu: u32,
    gpu: Option<u32>,
    ram: u32,
}

/// The name to show if the app `pid` is a game.
pub fn game_name(pid: u32, _title: &str) -> Option<String> {
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32)?;
    let bundle = app.bundleURL()?.path()?.to_string();
    let in_steam = bundle.contains("/steamapps/common/");
    if !in_steam && !category(&bundle).is_some_and(|c| c.ends_with("-games")) {
        return None;
    }
    app.localizedName().map(|n| n.to_string())
}

/// The App Store category the app declares, e.g. "public.app-category.action-games".
fn category(bundle: &str) -> Option<String> {
    let plist = std::fs::read(format!("{bundle}/Contents/Info.plist")).ok()?;
    let data = objc2_foundation::NSData::with_bytes(&plist);
    let value = unsafe {
        objc2_foundation::NSPropertyListSerialization::propertyListWithData_options_format_error(
            &data,
            objc2_foundation::NSPropertyListReadOptions::Immutable,
            std::ptr::null_mut(),
        )
    }
    .ok()?;
    let dict = value.downcast::<NSDictionary>().ok()?;
    let category = dict.objectForKey(&NSString::from_str("LSApplicationCategoryType"))?;
    Some(category.downcast::<NSString>().ok()?.to_string().to_lowercase())
}

/// "Показать" in the settings: the same card with this Mac's load.
#[tauri::command]
pub fn games_preview(app: AppHandle, pid: Option<u32>) {
    thread::spawn(move || show(&app, pid.unwrap_or(0), "Пример игры".into()));
}

static SHOWING: AtomicBool = AtomicBool::new(false);

/// Pops the island out with the stats, updated every second, for [`SHOW`].
/// Blocks for that long; does nothing while already showing. (The island
/// floats above the menu bar level, so a game can't cover it.)
pub fn show(app: &AppHandle, _pid: u32, name: String) {
    if SHOWING.swap(true, Ordering::Relaxed) {
        return;
    }
    let _ = app.emit("lumen://game", Some(Game { name }));
    let mut cpu = Cpu::new();
    let started = Instant::now();
    while started.elapsed() < SHOW {
        thread::sleep(SAMPLE);
        let stats = Stats {
            fps: None,
            cpu: cpu.sample(),
            gpu: gpu(),
            ram: ram(),
        };
        let _ = app.emit("lumen://game-stats", stats);
    }
    let _ = app.emit("lumen://game", None::<Game>);
    SHOWING.store(false, Ordering::Relaxed);
}

unsafe extern "C" {
    fn mach_host_self() -> u32;
    fn host_statistics(host: u32, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
    fn host_statistics64(host: u32, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
    fn sysctlbyname(name: *const std::ffi::c_char, old: *mut c_void, old_len: *mut usize, new: *mut c_void, new_len: usize) -> i32;
    static vm_page_size: usize;
}

/// Busy share of all cores since the last sample.
struct Cpu {
    last: [u32; 4],
}

impl Cpu {
    fn new() -> Self {
        Self { last: Self::ticks() }
    }

    /// user, system, idle, nice (HOST_CPU_LOAD_INFO).
    fn ticks() -> [u32; 4] {
        const HOST_CPU_LOAD_INFO: i32 = 3;
        let mut ticks = [0u32; 4];
        let mut count = 4;
        unsafe { host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, ticks.as_mut_ptr().cast(), &mut count) };
        ticks
    }

    fn sample(&mut self) -> u32 {
        let now = Self::ticks();
        let delta: Vec<u64> = now.iter().zip(self.last).map(|(n, l)| n.wrapping_sub(l) as u64).collect();
        self.last = now;
        let total: u64 = delta.iter().sum();
        let busy = delta[0] + delta[1] + delta[3];
        if total == 0 { 0 } else { (busy * 100 / total) as u32 }
    }
}

/// Memory in use (apps, wired, compressed), percent of the total.
fn ram() -> u32 {
    /// `vm_statistics64` from <mach/vm_statistics.h>.
    #[repr(C, align(8))]
    #[derive(Default)]
    struct VmStats {
        free: u32,
        active: u32,
        inactive: u32,
        wired: u32,
        counters: [u64; 9],
        purgeable: u32,
        speculative: u32,
        more_counters: [u64; 4],
        compressor: u32,
        throttled: u32,
        external: u32,
        internal: u32,
        uncompressed_in_compressor: u64,
    }
    const HOST_VM_INFO64: i32 = 4;
    let mut stats = VmStats::default();
    let mut count = (size_of::<VmStats>() / 4) as u32;
    let mut total = 0u64;
    let mut len = size_of::<u64>();
    unsafe {
        if host_statistics64(mach_host_self(), HOST_VM_INFO64, (&raw mut stats).cast(), &mut count) != 0
            || sysctlbyname(c"hw.memsize".as_ptr(), (&raw mut total).cast(), &mut len, std::ptr::null_mut(), 0) != 0
            || total == 0
        {
            return 0;
        }
        let used = (stats.internal.saturating_sub(stats.purgeable) as u64 + stats.wired as u64 + stats.compressor as u64)
            * vm_page_size as u64;
        (used * 100 / total).min(100) as u32
    }
}

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOServiceMatching(name: *const std::ffi::c_char) -> *mut c_void;
    fn IOServiceGetMatchingService(main_port: u32, matching: *mut c_void) -> u32;
    fn IORegistryEntryCreateCFProperty(entry: u32, key: &NSString, allocator: *const c_void, options: u32) -> *mut NSObject;
    fn IOObjectRelease(object: u32) -> i32;
}

/// GPU load as Activity Monitor shows it ("Device Utilization %").
fn gpu() -> Option<u32> {
    const ACCELERATOR: &CStr = c"IOAccelerator";
    unsafe {
        let service = IOServiceGetMatchingService(0, IOServiceMatching(ACCELERATOR.as_ptr()));
        if service == 0 {
            return None;
        }
        let stats = IORegistryEntryCreateCFProperty(service, &NSString::from_str("PerformanceStatistics"), std::ptr::null(), 0);
        IOObjectRelease(service);
        let stats = Retained::from_raw(stats)?.downcast::<NSDictionary>().ok()?;
        let busy = stats.objectForKey(&NSString::from_str("Device Utilization %"))?;
        Some(busy.downcast::<NSNumber>().ok()?.unsignedIntValue().min(100))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_load() {
        let mut cpu = Cpu::new();
        thread::sleep(Duration::from_millis(200));
        assert!(cpu.sample() <= 100);
        let ram = ram();
        assert!(ram > 0 && ram <= 100, "ram {ram}");
        assert!(gpu().is_some_and(|g| g <= 100));
    }
}
