import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";

interface Levels {
  beat: number;
  bands: [number, number, number, number];
}

/**
 * The latest levels, for canvases that draw every frame (the oscilloscope,
 * the beat sparks) without going through React or CSS.
 */
export const audioLevels: Levels = { beat: 0, bands: [0, 0, 0, 0] };

/** How long without sound before falling back to the idle animations. */
const QUIET_MS = 700;

/**
 * Feeds live audio levels into CSS variables (--beat, --b0..--b3) on <html>,
 * bypassing React so 30 updates a second don't re-render anything.
 * Returns whether sound is currently coming through.
 */
export function useAudioLevels(): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    const root = document.documentElement.style;
    let quietTimer = 0;

    const unlisten = listen<Levels>("lumen://audio", ({ payload }) => {
      audioLevels.beat = payload.beat;
      audioLevels.bands = payload.bands;
      root.setProperty("--beat", String(payload.beat));
      payload.bands.forEach((b, i) => root.setProperty(`--b${i}`, String(b)));

      const audible = payload.beat > 0.01 || payload.bands.some((b) => b > 0.01);
      if (audible) {
        setActive(true);
        clearTimeout(quietTimer);
        quietTimer = window.setTimeout(() => setActive(false), QUIET_MS);
      }
    });

    return () => {
      clearTimeout(quietTimer);
      unlisten.then((off) => off());
    };
  }, []);

  return active;
}
