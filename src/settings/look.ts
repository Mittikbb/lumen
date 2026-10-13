import { useEffect, useMemo } from "react";
import { useGlowFromArt } from "../media/useGlowFromArt";
import type { Accent, GlowLevel, GlowPace, Look } from "./useSettings";

/** Glow palettes: two tones each, the same pair the album art would give. */
export const ACCENTS: Record<Exclude<Accent, "custom">, { label: string; a: string; b: string }> = {
  sunset: { label: "Закат", a: "rgb(247, 178, 103)", b: "rgb(242, 92, 84)" },
  rose: { label: "Роза", a: "rgb(255, 154, 196)", b: "rgb(226, 86, 160)" },
  violet: { label: "Аметист", a: "rgb(190, 158, 255)", b: "rgb(132, 92, 246)" },
  midnight: { label: "Полночь", a: "rgb(18, 12, 30)", b: "rgb(175, 75, 255)" },
  ocean: { label: "Океан", a: "rgb(124, 196, 255)", b: "rgb(84, 118, 248)" },
  mint: { label: "Мята", a: "rgb(128, 232, 196)", b: "rgb(46, 186, 150)" },
  ice: { label: "Иней", a: "rgb(236, 238, 245)", b: "rgb(160, 168, 190)" },
};

/** Opacity (k) and reach (r) of the halo for each strength. */
export const GLOW_LEVELS: Record<GlowLevel, { label: string; k: number; r: number }> = {
  off: { label: "Выкл", k: 0, r: 1 },
  soft: { label: "Мягкое", k: 0.5, r: 0.75 },
  normal: { label: "Обычное", k: 1, r: 1 },
  bright: { label: "Яркое", k: 1.45, r: 1.3 },
};

/** How long one breath or flow of the glow takes, against the usual pace. */
export const GLOW_PACES: Record<GlowPace, { label: string; t: number }> = {
  slow: { label: "Медленно", t: 1.6 },
  normal: { label: "Обычно", t: 1 },
  fast: { label: "Быстро", t: 0.6 },
};

/** The palette's two tones: a built-in one, or your own. */
export function palette(look: Look | undefined) {
  if (look?.accent === "custom") return { label: "Свой", a: look.customA, b: look.customB };
  return ACCENTS[(look?.accent ?? "sunset") as Exclude<Accent, "custom">] ?? ACCENTS.sunset;
}

/**
 * Applies the look to the page: glow strength, reach, pace and colours, taken
 * from the album art when allowed, otherwise from the chosen palette.
 * `playing`: whether music plays, for a glow that only shows with music.
 */
export function useLook(look: Look | undefined, art?: string | null, playing = true) {
  const { a, b } = palette(look);
  // A stable object, or the art would be re-read on every render.
  const accent = useMemo(() => ({ a, b }), [a, b]);
  useGlowFromArt(look?.artColors === false ? null : art, accent);

  const level = GLOW_LEVELS[look?.glow ?? "normal"] ?? GLOW_LEVELS.normal;
  const dark = !!look?.musicOnly && !playing;
  const spread = look?.spread ?? 1;
  const pace = (GLOW_PACES[look?.pace ?? "normal"] ?? GLOW_PACES.normal).t;
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--glow-k", String(dark ? 0 : level.k));
    root.setProperty("--glow-r", String(level.r * spread));
    root.setProperty("--glow-t", String(pace));
  }, [level, dark, spread, pace]);
}
