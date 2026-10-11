//! Screen capture: select an area on screen, then either copy it as an image
//! (Alt+Shift+S) or recognise its text with the built-in Windows OCR and copy
//! that (Alt+Shift+T).
//!
//! A second, transparent window covers the monitor under the cursor for the
//! selection. It's hidden before grabbing pixels, so it never ends up in the
//! picture.

use std::{ffi::c_void, sync::Mutex, thread, time::Duration};

use image::RgbaImage;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use windows::{
    Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap},
    Media::Ocr::OcrEngine,
    Storage::Streams::DataWriter,
    Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BitBlt, CAPTUREBLT, CreateCompatibleBitmap,
        CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, HGDIOBJ,
        ReleaseDC, SRCCOPY, SelectObject,
    },
};

use crate::{clipboard::win as clipboard, hotkeys, pixels};

const WINDOW: &str = "capture";
/// Lets the compositor remove the selection window before pixels are read.
const HIDE_SETTLE: Duration = Duration::from_millis(80);

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Copy the area as an image.
    Shot,
    /// Recognise text in the area and copy it.
    Text,
}

#[derive(Default)]
pub struct Capture {
    mode: Mutex<Option<Mode>>,
    /// Physical position of the covered monitor and its scale factor.
    origin: Mutex<(i32, i32, f64)>,
}

/// Selection in the capture window's CSS pixels.
#[derive(Deserialize)]
pub struct Selection {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Clone, Serialize)]
struct Notice {
    title: String,
    detail: String,
}

/// Shows the selection overlay on the monitor under the cursor.
pub fn start(app: &AppHandle, mode: Mode) {
    if app.state::<Capture>().mode.lock().unwrap().is_some() {
        return;
    }
    if let Err(e) = show_overlay(app, mode) {
        eprintln!("capture: {e}");
        cancel(app);
    }
}

pub fn cancel(app: &AppHandle) {
    *app.state::<Capture>().mode.lock().unwrap() = None;
    let _ = app.global_shortcut().unregister(hotkeys::escape_key());
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.hide();
    }
}

/// Async on purpose: the first call creates the selection window, and doing
/// that from a sync command (inside the webview's IPC callback) deadlocks.
#[tauri::command]
pub async fn capture_start(app: AppHandle, mode: Mode) {
    start(&app, mode);
}

#[tauri::command]
pub fn capture_mode(capture: State<Capture>) -> Option<Mode> {
    *capture.mode.lock().unwrap()
}

#[tauri::command]
pub fn capture_cancel(app: AppHandle) {
    cancel(&app);
}

/// Called by the overlay when the user finishes dragging out an area.
#[tauri::command]
pub fn capture_finish(app: AppHandle, selection: Selection) {
    let Some(mode) = *app.state::<Capture>().mode.lock().unwrap() else {
        return;
    };
    let (ox, oy, scale) = *app.state::<Capture>().origin.lock().unwrap();
    cancel(&app);

    let x = ox + (selection.x * scale).round() as i32;
    let y = oy + (selection.y * scale).round() as i32;
    let w = (selection.w * scale).round() as i32;
    let h = (selection.h * scale).round() as i32;
    if w < 2 || h < 2 {
        return;
    }

    thread::spawn(move || {
        thread::sleep(HIDE_SETTLE);
        let Some(bgra) = grab(x, y, w, h) else {
            notify(&app, "Не удалось сделать снимок", "");
            return;
        };
        match mode {
            Mode::Shot => copy_image(&app, w as u32, h as u32, &bgra),
            Mode::Text => copy_text(&app, w as u32, h as u32, &bgra),
        }
    });
}

fn show_overlay(app: &AppHandle, mode: Mode) -> tauri::Result<()> {
    let cursor = app.cursor_position()?;
    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)?
        .or(app.primary_monitor()?)
        .ok_or(tauri::Error::WindowNotFound)?;
    let pos = *monitor.position();
    let size = *monitor.size();

    *app.state::<Capture>().origin.lock().unwrap() = (pos.x, pos.y, monitor.scale_factor());
    *app.state::<Capture>().mode.lock().unwrap() = Some(mode);

    let window = overlay_window(app)?;
    window.set_position(PhysicalPosition::new(pos.x, pos.y))?;
    window.set_size(PhysicalSize::new(size.width, size.height))?;
    let _ = window.emit("lumen://capture", mode);
    window.show()?;
    let _ = app.global_shortcut().register(hotkeys::escape_key());
    Ok(())
}

/// The selection window, created hidden on first use. Like the island it
/// never takes focus (Esc comes from a temporary global hotkey instead).
fn overlay_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(WINDOW) {
        return Ok(window);
    }
    WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html".into()))
        .title("Lumen capture")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .visible(false)
        .build()
}

/// Reads screen pixels as top-down BGRA.
fn grab(x: i32, y: i32, w: i32, h: i32) -> Option<Vec<u8>> {
    unsafe {
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, HGDIOBJ(bitmap.0));
        let copied = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY | CAPTUREBLT).is_ok();

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bgra = vec![0u8; (w * h * 4) as usize];
        SelectObject(mem, old);
        let lines = GetDIBits(
            mem,
            bitmap,
            0,
            h as u32,
            Some(bgra.as_mut_ptr() as *mut c_void),
            &mut info,
            DIB_RGB_COLORS,
        );
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);

        if !copied || lines == 0 {
            return None;
        }
        // The screen has no meaningful alpha; make every pixel opaque.
        bgra.chunks_exact_mut(4).for_each(|p| p[3] = 255);
        Some(bgra)
    }
}

fn copy_image(app: &AppHandle, w: u32, h: u32, bgra: &[u8]) {
    let rgba = RgbaImage::from_fn(w, h, |x, y| {
        let i = ((y * w + x) * 4) as usize;
        image::Rgba([bgra[i + 2], bgra[i + 1], bgra[i], 255])
    });
    let Some(png) = pixels::encode_png(&rgba) else {
        return notify(app, "Не удалось сделать снимок", "");
    };
    // The clipboard watcher picks it up, so the usual "copied" animation and
    // history entry follow.
    if let Err(e) = clipboard::write_image(&rgba, &png) {
        notify(app, "Не удалось скопировать снимок", &e);
    }
}

fn copy_text(app: &AppHandle, w: u32, h: u32, bgra: &[u8]) {
    match recognize(w, h, bgra) {
        Ok(text) if text.trim().is_empty() => {
            notify(app, "Текст не найден", "Попробуй выделить крупнее")
        }
        Ok(text) => {
            let chars = text.chars().filter(|c| !c.is_whitespace()).count();
            // Announce first, so the UI shows this rather than the generic
            // "copied" notice that the clipboard change triggers.
            notify(app, "Текст распознан", &format!("{chars} симв."));
            if let Err(e) = clipboard::write_text(&text) {
                notify(app, "Не удалось скопировать текст", &e);
            }
        }
        Err(_) => notify(
            app,
            "Распознавание недоступно",
            "Добавь язык с распознаванием текста в параметрах Windows",
        ),
    }
}

/// Windows OCR; lines joined with newlines.
///
/// Each recogniser only reads its own script well (the English one turns
/// Russian into "pa60TaK)T"), and the profile's first language may not match
/// the text. So every installed recogniser runs and the most plausible
/// result wins.
fn recognize(w: u32, h: u32, bgra: &[u8]) -> windows::core::Result<String> {
    let writer = DataWriter::new()?;
    writer.WriteBytes(bgra)?;
    let buffer = writer.DetachBuffer()?;
    let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        w as i32,
        h as i32,
        BitmapAlphaMode::Premultiplied,
    )?;

    let mut best: Option<(f32, String)> = None;
    for language in OcrEngine::AvailableRecognizerLanguages()? {
        let Ok(engine) = OcrEngine::TryCreateFromLanguage(&language) else {
            continue;
        };
        let result = engine.RecognizeAsync(&bitmap)?.join()?;
        let mut lines = Vec::new();
        for line in result.Lines()? {
            lines.push(line.Text()?.to_string());
        }
        let text = lines.join("\n");
        let score = plausibility(&text);
        if best.as_ref().is_none_or(|(s, _)| score > *s) {
            best = Some((score, text));
        }
    }
    best.map(|(_, text)| text)
        .ok_or_else(|| windows::core::Error::from_hresult(windows::core::HRESULT(-1)))
}

/// Share of words that look like real words: a single script (Cyrillic or
/// Latin) or a number, as opposed to OCR soup like "0T06paxaeTc*".
fn plausibility(text: &str) -> f32 {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return 0.0;
    }
    let good = words.iter().filter(|w| plausible_word(w)).count();
    good as f32 / words.len() as f32
}

fn plausible_word(word: &str) -> bool {
    // Ignore surrounding punctuation: "«слово»," or "(word)".
    let core = word.trim_matches(|c: char| !c.is_alphanumeric());
    if core.is_empty() {
        return true;
    }
    let cyrillic = core
        .chars()
        .any(|c| matches!(c, 'а'..='я' | 'А'..='Я' | 'ё' | 'Ё'));
    let latin = core.chars().any(|c| c.is_ascii_alphabetic());
    let digits = core.chars().any(|c| c.is_ascii_digit());
    let other = core
        .chars()
        .any(|c| !c.is_alphanumeric() && !matches!(c, '-' | '\'' | '.' | ',' | ':' | '/'));
    match (cyrillic, latin, digits) {
        _ if other => false,
        (true, false, false) | (false, true, false) => true,
        (false, false, true) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_real_words_over_ocr_soup() {
        let russian = "Скриншот выделения работает корректно, но затемнение фона";
        let soup = "CKPMHWOT BblAeneH\"e pa60TaK)T KoppeKTH0, HO 3aTeMHeH\"e $0Ha";
        assert!(plausibility(russian) > plausibility(soup));
    }

    #[test]
    fn plain_english_and_numbers_are_plausible() {
        assert_eq!(plausibility("Run npm install, then 2 + 2 = 4"), 1.0);
    }
}

fn notify(app: &AppHandle, title: &str, detail: &str) {
    let _ = app.emit(
        "lumen://notice",
        Notice {
            title: title.into(),
            detail: detail.into(),
        },
    );
}
