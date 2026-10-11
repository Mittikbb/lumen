//! Icons and thumbnails from the Windows shell, the same source Explorer and
//! the Start menu use. Works for apps (`shell:AppsFolder\<AppID>`, classic and
//! Store) and for files and folders (real previews for images, video, PDF...).

use std::ffi::c_void;

use image::RgbaImage;
use windows::{
    Win32::{
        Foundation::SIZE,
        Graphics::Gdi::{
            BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS,
            DeleteDC, DeleteObject, GetDIBits, GetObjectW, HGDIOBJ,
        },
        System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx},
        UI::Shell::{
            IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
            SIIGBF_ICONONLY,
        },
    },
    core::HSTRING,
};

use crate::pixels;

/// Launcher icons are shown at ~22 px; 64 keeps them crisp on high-DPI screens.
const APP_ICON_SIZE: i32 = 64;

/// An installed app's icon as a PNG data URL.
pub fn app_icon(app_id: &str) -> Option<String> {
    let name = format!("shell:AppsFolder\\{app_id}");
    pixels::png_data_url(&extract(&name, APP_ICON_SIZE, true)?)
}

/// A file's or folder's preview, falling back to its icon.
pub fn file_thumbnail(path: &str, size: i32) -> Option<RgbaImage> {
    extract(path, size, false)
}

/// `parsing_name` is anything the shell resolves: a path or a `shell:` URL.
fn extract(parsing_name: &str, size: i32, icon_only: bool) -> Option<RgbaImage> {
    unsafe {
        // Shell APIs need COM on this thread; repeated calls are harmless.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let name = HSTRING::from(parsing_name);
        let factory: IShellItemImageFactory = SHCreateItemFromParsingName(&name, None).ok()?;
        // Without ICONONLY the shell returns a real preview when it has one.
        let flags = if icon_only {
            SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK
        } else {
            SIIGBF_BIGGERSIZEOK
        };
        let bitmap = factory.GetImage(SIZE { cx: size, cy: size }, flags).ok()?;
        let object = HGDIOBJ(bitmap.0);

        let mut info = BITMAP::default();
        let read = GetObjectW(
            object,
            size_of::<BITMAP>() as i32,
            Some(&mut info as *mut BITMAP as *mut c_void),
        );
        let (w, h) = (info.bmWidth, info.bmHeight.abs());
        if read == 0 || w <= 0 || h <= 0 {
            let _ = DeleteObject(object);
            return None;
        }

        let mut header = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bgra = vec![0u8; (w * h * 4) as usize];
        let dc = CreateCompatibleDC(None);
        let lines = GetDIBits(
            dc,
            bitmap,
            0,
            h as u32,
            Some(bgra.as_mut_ptr() as *mut c_void),
            &mut header,
            DIB_RGB_COLORS,
        );
        let _ = DeleteDC(dc);
        let _ = DeleteObject(object);
        if lines == 0 {
            return None;
        }

        Some(to_rgba(w as u32, h as u32, &bgra))
    }
}

/// Shell bitmaps are BGRA with premultiplied alpha; PNG wants straight alpha.
fn to_rgba(w: u32, h: u32, bgra: &[u8]) -> RgbaImage {
    let opaque = bgra.chunks_exact(4).all(|p| p[3] == 0);
    RgbaImage::from_fn(w, h, |x, y| {
        let i = ((y * w + x) * 4) as usize;
        let (b, g, r, a) = (bgra[i], bgra[i + 1], bgra[i + 2], bgra[i + 3]);
        if opaque {
            // Old-style icons without an alpha channel.
            return image::Rgba([r, g, b, 255]);
        }
        let un = |c: u8| {
            if a == 0 {
                0
            } else {
                ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8
            }
        };
        image::Rgba([un(r), un(g), un(b), a])
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpremultiplies_alpha() {
        // Half-transparent pure red, premultiplied: (B, G, R, A) = (0, 0, 128, 128).
        let img = to_rgba(1, 1, &[0, 0, 128, 128]);
        assert_eq!(img.get_pixel(0, 0).0, [255, 0, 0, 128]);
    }

    #[test]
    fn treats_all_zero_alpha_as_opaque() {
        let img = to_rgba(1, 1, &[10, 20, 30, 0]);
        assert_eq!(img.get_pixel(0, 0).0, [30, 20, 10, 255]);
    }
}
