//! Icons for apps and files on macOS, from NSWorkspace: the icon Finder shows.
//! (Windows asks the shell, which also gives picture previews; here that
//! would be QuickLook's thumbnails.)

use image::RgbaImage;
use objc2::{AnyThread, rc::Retained};
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSWorkspace};
use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

use crate::pixels;

/// Launcher icons are shown at ~22 px; 64 keeps them crisp on Retina screens.
const APP_ICON_SIZE: f64 = 64.0;

/// An app's icon as a PNG data URL; `app_id` is the path of its `.app`.
pub fn app_icon(app_id: &str) -> Option<String> {
    let png = icon_png(app_id, APP_ICON_SIZE)?;
    pixels::png_data_url(&pixels::decode_png(&png)?)
}

/// A file's or folder's icon.
pub fn file_thumbnail(path: &str, size: i32) -> Option<RgbaImage> {
    pixels::decode_png(&icon_png(path, size as f64)?)
}

/// The Finder icon of `path`, rendered `size` px square, as PNG.
fn icon_png(path: &str, size: f64) -> Option<Vec<u8>> {
    if !std::path::Path::new(path).exists() {
        return None;
    }
    let icon: Retained<NSImage> = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(path));
    let mut rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(size, size));
    // Picks the representation closest to the size asked for.
    let cg = unsafe { icon.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
    let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg);
    let png = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    Some(png.to_vec())
}
