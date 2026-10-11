//! App icons for the launcher, taken from the same shell source the Start menu
//! uses (`shell:AppsFolder\<AppID>`), so classic and Store apps both work.

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

/// Pixel size requested from the shell; displayed at ~22 px, so this stays
/// crisp on high-DPI screens.
const ICON_SIZE: i32 = 64;

/// The app's icon as a PNG data URL.
pub fn icon_data_url(app_id: &str) -> Option<String> {
    pixels::png_data_url(&extract(app_id)?)
}

fn extract(app_id: &str) -> Option<RgbaImage> {
    unsafe {
        // Shell APIs need COM on this thread; repeated calls are harmless.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let path = HSTRING::from(format!("shell:AppsFolder\\{app_id}"));
        let factory: IShellItemImageFactory = SHCreateItemFromParsingName(&path, None).ok()?;
        let bitmap = factory
            .GetImage(
                SIZE {
                    cx: ICON_SIZE,
                    cy: ICON_SIZE,
                },
                SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
            )
            .ok()?;
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
