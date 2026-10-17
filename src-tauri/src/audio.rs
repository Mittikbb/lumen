//! Audio-reactive levels. Captures whatever the system is playing (loopback on
//! the default output device: WASAPI on Windows, a Core Audio process tap on
//! macOS 14.2+), splits it into frequency bands and streams normalised 0..1
//! levels to the UI ~60 times a second.
//!
//! Two paths with different latency needs:
//! - the equaliser bars come from an FFT over ~43 ms of audio (needs the
//!   frequency resolution, and bars may lag a little);
//! - the glow's kick detection runs on a low-passed copy of the signal over
//!   only the last ~16 ms, so flashes land on the beat.

use std::{
    collections::VecDeque,
    f32::consts::PI,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{FftPlanner, num_complex::Complex};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::overlay;

const FFT_SIZE: usize = 2048;
const FRAME: Duration = Duration::from_millis(16);
/// Kick detection window, seconds.
const KICK_WINDOW: f32 = 0.016;
/// Low-pass cutoff for the kick path, Hz.
const KICK_CUTOFF: f32 = 140.0;
/// Below this RMS the kick path counts as silence.
const KICK_FLOOR: f32 = 0.002;
const DEVICE_CHECK: Duration = Duration::from_secs(2);

/// Equaliser bands in Hz: bass, low-mids, mids, highs.
const BANDS: [(f32, f32); 4] = [
    (30.0, 150.0),
    (150.0, 500.0),
    (500.0, 2000.0),
    (2000.0, 8000.0),
];

/// Music carries far less energy in the highs than in the bass; these weights
/// even the bands out (measured: ~0.01 / 0.004 / 0.0008 / 0.0003 on typical tracks).
const TILT: [f32; 4] = [1.0, 2.5, 12.0, 30.0];

/// Below this (tilt-corrected) band magnitude we treat the signal as silence,
/// so auto-gain doesn't blow up noise into full-height bars.
const NOISE_FLOOR: f32 = 0.0008;
/// Auto-gain never goes below this, so quiet passages stay small.
const MIN_PEAK: f32 = 0.006;

#[derive(Clone, Serialize, PartialEq)]
struct Levels {
    /// Kick-driven pulse for the glow: fast attack, quick decay, high sensitivity.
    beat: f32,
    /// Equaliser bars: calmer than the glow.
    bands: [f32; 4],
}

/// Recent audio shared between the capture callback and the analyser.
#[derive(Default)]
struct Buffers {
    /// Mono mix for the FFT.
    mono: VecDeque<f32>,
    /// Low-passed mono mix for kick detection.
    bass: VecDeque<f32>,
    /// Bumped on every delivery, so the analyser can tell new audio from old.
    writes: u64,
}

/// Two cascaded one-pole low-pass filters (12 dB/oct).
struct LowPass {
    a: f32,
    y1: f32,
    y2: f32,
}

impl LowPass {
    fn new(cutoff: f32, sample_rate: f32) -> Self {
        Self {
            a: 1.0 - (-2.0 * PI * cutoff / sample_rate).exp(),
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn next(&mut self, x: f32) -> f32 {
        self.y1 += self.a * (x - self.y1);
        self.y2 += self.a * (self.y1 - self.y2);
        self.y2
    }
}

pub fn spawn_analyser(app: AppHandle) {
    thread::spawn(move || {
        loop {
            // (Re)open the capture on the current default output device. Runs again
            // whenever the device changes (headphones plugged in) or the stream dies.
            // Each attempt gets a fresh thread: a capture that died can leave COM on
            // its thread unusable, and every reopen there then fails.
            let handle = app.clone();
            match thread::spawn(move || run_capture(&handle)).join() {
                Ok(Err(e)) => eprintln!("audio capture: {e}"),
                Err(_) => eprintln!("audio capture: thread panicked"),
                Ok(Ok(())) => {}
            }
            let _ = app.emit(
                "lumen://audio",
                Levels {
                    beat: 0.0,
                    bands: [0.0; 4],
                },
            );
            thread::sleep(DEVICE_CHECK);
        }
    });
}

fn run_capture(app: &AppHandle) -> Result<(), String> {
    let host = cpal::default_host();
    let default = host.default_output_device().ok_or("no output device")?;
    let device_id = default.id().map_err(|e| e.to_string())?;
    // Open the actual endpoint rather than cpal's "follow the default" device: its
    // async activation can start failing for good, while plain activation keeps
    // working. Device changes are caught by the check below anyway.
    let device = host
        .output_devices()
        .ok()
        .and_then(|mut all| all.find(|d| d.id().ok().as_ref() == Some(&device_id)))
        .unwrap_or(default);
    let supported = device.default_output_config().map_err(|e| e.to_string())?;
    let config = supported.config();
    let channels = config.channels.max(1) as usize;
    let sample_rate = config.sample_rate as f32;

    let kick_len = ((sample_rate * KICK_WINDOW) as usize).max(64);
    let buffers = Arc::new(Mutex::new(Buffers::default()));
    let failed = Arc::new(AtomicBool::new(false));

    let sink = buffers.clone();
    let mut lowpass = LowPass::new(KICK_CUTOFF, sample_rate);
    let fail_flag = failed.clone();
    let stream = device
        .build_input_stream_raw(
            config,
            supported.sample_format(),
            move |data: &cpal::Data, _: &_| {
                let mut buf = sink.lock().unwrap();
                let mut push = |x: f32| {
                    buf.mono.push_back(x);
                    buf.bass.push_back(lowpass.next(x));
                };
                if let Some(frames) = data.as_slice::<f32>() {
                    frames
                        .chunks(channels)
                        .for_each(|f| push(f.iter().sum::<f32>() / channels as f32));
                } else if let Some(frames) = data.as_slice::<i16>() {
                    frames.chunks(channels).for_each(|f| {
                        push(
                            f.iter().map(|&s| s as f32 / i16::MAX as f32).sum::<f32>()
                                / channels as f32,
                        )
                    });
                }
                trim(&mut buf.mono, FFT_SIZE);
                trim(&mut buf.bass, kick_len);
                buf.writes = buf.writes.wrapping_add(1);
            },
            move |e: cpal::Error| {
                use cpal::ErrorKind::*;
                // Glitches (xruns), rerouting and refused realtime priority keep
                // the stream alive; only a dead stream needs rebuilding.
                if matches!(
                    e.kind(),
                    DeviceNotAvailable | StreamInvalidated | HostUnavailable | BackendError
                ) {
                    fail_flag.store(true, Ordering::Relaxed);
                }
            },
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;

    let mut analyser = Analyser::new(sample_rate);
    let mut last_check = Instant::now();
    let mut was_silent = false;
    // Reused every frame rather than allocated anew.
    let mut window = Vec::with_capacity(FFT_SIZE);
    let mut last_writes = None;

    loop {
        thread::sleep(FRAME);

        if failed.load(Ordering::Relaxed) {
            return Err("stream error".into());
        }
        if last_check.elapsed() > DEVICE_CHECK {
            last_check = Instant::now();
            let current = host.default_output_device().and_then(|d| d.id().ok());
            if current.as_ref() != Some(&device_id) {
                return Ok(());
            }
        }

        let (fresh, kick_rms) = {
            let buf = buffers.lock().unwrap();
            let n = buf.bass.len().max(1) as f32;
            let rms = (buf.bass.iter().map(|x| x * x).sum::<f32>() / n).sqrt();
            // Nothing new arrived (players that stop sending on pause): the
            // window is the one analysed last frame.
            let fresh = last_writes != Some(buf.writes);
            if fresh {
                last_writes = Some(buf.writes);
                window.clear();
                window.extend(buf.mono.iter().copied());
            }
            (fresh, rms)
        };
        let levels = analyser.process(&window, fresh, kick_rms);
        // Nobody sees the levels while the island is hidden behind a
        // fullscreen app; the first frame back is always sent.
        if overlay::hidden() {
            was_silent = false;
            continue;
        }
        let silent = levels.beat < 0.01 && levels.bands.iter().all(|&b| b < 0.01);
        // Stream while there's sound, plus one final zero frame on going quiet.
        if !(silent && was_silent) {
            let _ = app.emit("lumen://audio", &levels);
        }
        was_silent = silent;
    }
}

fn trim(buf: &mut VecDeque<f32>, len: usize) {
    let excess = buf.len().saturating_sub(len);
    buf.drain(..excess);
}

struct Analyser {
    fft: Arc<dyn rustfft::Fft<f32>>,
    /// FFT buffer and its scratch space, kept between frames.
    spectrum: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    /// Band magnitudes of the last window, reused while the audio stands still.
    raw: [f32; 4],
    hann: Vec<f32>,
    bins: [(usize, usize); 4],
    /// Slowly decaying per-band peaks used as automatic gain.
    peaks: [f32; 4],
    bands: [f32; 4],
    beat: f32,
    /// Running average of kick-path energy; a kick is energy well above it.
    kick_avg: f32,
}

impl Analyser {
    fn new(sample_rate: f32) -> Self {
        let hz_per_bin = sample_rate / FFT_SIZE as f32;
        let bins = BANDS.map(|(lo, hi)| {
            let lo = (lo / hz_per_bin).floor().max(1.0) as usize;
            let hi = ((hi / hz_per_bin).ceil() as usize).clamp(lo + 1, FFT_SIZE / 2);
            (lo, hi)
        });
        let fft = FftPlanner::new().plan_fft_forward(FFT_SIZE);
        let zero = Complex::new(0.0, 0.0);
        Self {
            spectrum: vec![zero; FFT_SIZE],
            scratch: vec![zero; fft.get_inplace_scratch_len()],
            raw: [0.0; 4],
            fft,
            hann: (0..FFT_SIZE)
                .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / (FFT_SIZE - 1) as f32).cos())
                .collect(),
            bins,
            peaks: [MIN_PEAK; 4],
            bands: [0.0; 4],
            beat: 0.0,
            kick_avg: 0.0,
        }
    }

    /// `fresh`: whether `samples` changed since the last call; the FFT of the
    /// same window is skipped, and so is the FFT of pure silence (all zero).
    fn process(&mut self, samples: &[f32], fresh: bool, kick_rms: f32) -> Levels {
        if fresh {
            self.raw = if samples.iter().all(|&s| s == 0.0) {
                [0.0; 4]
            } else {
                self.band_magnitudes(samples)
            };
        }
        let raw = self.raw;

        for band in 0..4 {
            // Auto-gain: peaks jump up instantly and sink back over ~5 s.
            self.peaks[band] = (self.peaks[band] * 0.9965).max(raw[band]).max(MIN_PEAK);
            let level = if raw[band] < NOISE_FLOOR {
                0.0
            } else {
                (raw[band] / self.peaks[band]).min(1.0)
            };
            // Bars: softened curve and smoothing on both edges, so they read
            // calmer than the glow.
            let target = level.powf(1.3) * 0.9;
            let speed = if target > self.bands[band] { 0.35 } else { 0.1 };
            self.bands[band] += (target - self.bands[band]) * speed;
        }

        // Beat: how far the low end jumps above its recent average, so the glow
        // swells on kicks rather than following volume. Near-instant attack keeps
        // it on the beat; the gentle ~0.3 s release keeps it from strobing.
        self.kick_avg += (kick_rms - self.kick_avg) * 0.04;
        let kick = if kick_rms < KICK_FLOOR {
            0.0
        } else {
            (kick_rms / self.kick_avg.max(KICK_FLOOR) - 1.0).clamp(0.0, 1.0)
        };
        let pulse = (kick * 1.6).min(1.0).max(self.bands[0] * 0.45);
        self.beat = if pulse > self.beat {
            self.beat + (pulse - self.beat) * 0.85
        } else {
            self.beat * 0.94
        };

        Levels {
            beat: round(self.beat),
            bands: self.bands.map(round),
        }
    }

    fn band_magnitudes(&mut self, samples: &[f32]) -> [f32; 4] {
        let spectrum = &mut self.spectrum;
        spectrum.fill(Complex::new(0.0, 0.0));
        let offset = FFT_SIZE - samples.len().min(FFT_SIZE);
        for (i, &s) in samples.iter().take(FFT_SIZE).enumerate() {
            spectrum[offset + i].re = s * self.hann[offset + i];
        }
        self.fft.process_with_scratch(spectrum, &mut self.scratch);

        let mut raw = [0.0f32; 4];
        for (band, &(lo, hi)) in self.bins.iter().enumerate() {
            let sum: f32 = spectrum[lo..hi].iter().map(|c| c.norm()).sum();
            raw[band] = sum / (hi - lo) as f32 / FFT_SIZE as f32 * 4.0 * TILT[band];
        }
        raw
    }
}

fn round(v: f32) -> f32 {
    (v * 100.0).round() / 100.0
}
