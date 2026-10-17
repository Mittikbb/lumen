//! Shared image helpers: Windows DIB <-> RGBA, PNG, thumbnails, data URLs.

use std::{
    hash::{DefaultHasher, Hash, Hasher},
    io::Cursor,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use image::{ImageFormat, RgbaImage, imageops};

/// Images bigger than this (in pixels) are ignored.
const MAX_PIXELS: u64 = 50_000_000;
/// Thumbnail bounding box shown in the history list.
const THUMB: (u32, u32) = (192, 112);

// The clipboard's DIB format exists on Windows only.
#[cfg(windows)]
const BI_RGB: u32 = 0;
#[cfg(windows)]
const BI_BITFIELDS: u32 = 3;
#[cfg(windows)]
const HEADER_SIZE: usize = 40;

pub fn decode_png(bytes: &[u8]) -> Option<RgbaImage> {
    let image = image::load_from_memory_with_format(bytes, ImageFormat::Png).ok()?;
    let (w, h) = (image.width() as u64, image.height() as u64);
    (w * h <= MAX_PIXELS).then(|| image.into_rgba8())
}

pub fn encode_png(image: &RgbaImage) -> Option<Vec<u8>> {
    let mut out = Cursor::new(Vec::new());
    image.write_to(&mut out, ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

/// Small PNG preview as a data URL.
pub fn thumbnail(image: &RgbaImage) -> Option<String> {
    let scale = (THUMB.0 as f32 / image.width() as f32)
        .min(THUMB.1 as f32 / image.height() as f32)
        .min(1.0);
    let w = ((image.width() as f32 * scale).round() as u32).max(1);
    let h = ((image.height() as f32 * scale).round() as u32).max(1);
    png_data_url(&imageops::thumbnail(image, w, h))
}

/// The image as a `data:image/png;base64,...` URL.
pub fn png_data_url(image: &RgbaImage) -> Option<String> {
    let png = encode_png(image)?;
    Some(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}

/// Content hash used to recognise the same image copied twice.
pub fn hash(image: &RgbaImage) -> u64 {
    let mut h = DefaultHasher::new();
    image.dimensions().hash(&mut h);
    image.as_raw().hash(&mut h);
    h.finish()
}

/// Parses a CF_DIB blob (BITMAPINFOHEADER or a V4/V5 header, then pixels).
/// Handles the 24- and 32-bit uncompressed layouts screenshots and apps use.
#[cfg(windows)]
pub fn from_dib(dib: &[u8]) -> Option<RgbaImage> {
    let u32_at = |o: usize| Some(u32::from_le_bytes(dib.get(o..o + 4)?.try_into().ok()?));
    let header_size = u32_at(0)? as usize;
    let width = u32_at(4)? as i32;
    let height = u32_at(8)? as i32;
    let bpp = u16::from_le_bytes(dib.get(14..16)?.try_into().ok()?);
    let compression = u32_at(16)?;
    let colors_used = u32_at(32)? as usize;

    if width <= 0 || height == 0 || !(bpp == 24 || bpp == 32) {
        return None;
    }
    if compression != BI_RGB && compression != BI_BITFIELDS {
        return None;
    }
    let (w, h) = (width as u32, height.unsigned_abs());
    if w as u64 * h as u64 > MAX_PIXELS {
        return None;
    }

    // Plain headers followed by three colour masks when BI_BITFIELDS is used;
    // V4/V5 headers carry the masks inside.
    let masks = if compression == BI_BITFIELDS && header_size == HEADER_SIZE {
        12
    } else {
        0
    };
    let offset = header_size + masks + colors_used * 4;
    let stride = ((w as usize * bpp as usize + 31) / 32) * 4;
    let pixels = dib.get(offset..offset + stride * h as usize)?;
    let bottom_up = height > 0;

    let mut image = RgbaImage::new(w, h);
    let mut any_alpha = false;
    for y in 0..h {
        let src_row = if bottom_up { h - 1 - y } else { y } as usize;
        let row = &pixels[src_row * stride..];
        for x in 0..w {
            let p = &row[x as usize * (bpp as usize / 8)..];
            let a = if bpp == 32 { p[3] } else { 255 };
            any_alpha |= a != 0;
            image.put_pixel(x, y, image::Rgba([p[2], p[1], p[0], a]));
        }
    }
    // Many apps leave the alpha byte at zero for opaque 32-bit bitmaps.
    if bpp == 32 && !any_alpha {
        image.pixels_mut().for_each(|p| p[3] = 255);
    }
    Some(image)
}

/// Builds a 32-bit bottom-up CF_DIB blob.
#[cfg(windows)]
pub fn to_dib(image: &RgbaImage) -> Vec<u8> {
    let (w, h) = image.dimensions();
    let pixel_bytes = w as usize * h as usize * 4;
    let mut out = Vec::with_capacity(HEADER_SIZE + pixel_bytes);
    out.extend((HEADER_SIZE as u32).to_le_bytes());
    out.extend((w as i32).to_le_bytes());
    out.extend((h as i32).to_le_bytes()); // positive = bottom-up
    out.extend(1u16.to_le_bytes()); // planes
    out.extend(32u16.to_le_bytes()); // bits per pixel
    out.extend(BI_RGB.to_le_bytes());
    out.extend((pixel_bytes as u32).to_le_bytes());
    out.extend([0u8; 16]); // resolution and palette fields
    for y in (0..h).rev() {
        for x in 0..w {
            let [r, g, b, a] = image.get_pixel(x, y).0;
            out.extend([b, g, r, a]);
        }
    }
    out
}

// The tests cover the DIB format, which only Windows has.
#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn sample() -> RgbaImage {
        RgbaImage::from_fn(5, 3, |x, y| {
            image::Rgba([x as u8 * 40, y as u8 * 80, 7, 200])
        })
    }

    #[test]
    fn dib_round_trip() {
        let img = sample();
        assert_eq!(from_dib(&to_dib(&img)).unwrap(), img);
    }

    #[test]
    fn top_down_dib_with_empty_alpha_is_opaque() {
        let img = sample();
        let mut dib = to_dib(&img);
        // Flip to a top-down layout and zero the alpha bytes.
        dib[8..12].copy_from_slice(&(-(img.height() as i32)).to_le_bytes());
        let rows: Vec<Vec<u8>> = dib[HEADER_SIZE..]
            .chunks(5 * 4)
            .map(|r| r.to_vec())
            .collect();
        let mut body: Vec<u8> = rows.into_iter().rev().flatten().collect();
        body.iter_mut().skip(3).step_by(4).for_each(|a| *a = 0);
        dib.truncate(HEADER_SIZE);
        dib.extend(body);

        let parsed = from_dib(&dib).unwrap();
        assert_eq!(parsed.get_pixel(4, 0).0, [160, 0, 7, 255]);
        assert_eq!(parsed.get_pixel(0, 2).0, [0, 160, 7, 255]);
    }
}
