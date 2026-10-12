import { useEffect } from "react";
import { useGlowFromArt } from "../media/useGlowFromArt";
import type { Accent, GlowLevel, Look } from "./useSettings";

/** Glow palettes: two tones each, the same pair the album art would give. */
export const ACCENTS: Record<Accent, { label: string; a: string; b: string }> = {
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

/**
 * Applies the look to the page: glow strength and colours, taken from the
 * album art when allowed, otherwise from the chosen palette.
 */
export function useLook(look: Look | undefined, art?: string | null) {
  const accent = ACCENTS[look?.accent ?? "sunset"] ?? ACCENTS.sunset;
  useGlowFromArt(look?.artColors === false ? null : art, accent);

  const level = GLOW_LEVELS[look?.glow ?? "normal"] ?? GLOW_LEVELS.normal;
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--glow-k", String(level.k));
    root.setProperty("--glow-r", String(level.r));
  }, [level]);
}
