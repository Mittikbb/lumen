import type { CSSProperties } from "react";
import { GLOW_LEVELS, palette } from "./look";
import { DEFAULT_SETTINGS, deepMerge, Look, Settings, SettingsPatch } from "./useSettings";

/**
 * Island presets: each sets the whole feel at once (look, shape, what the
 * collapsed island shows, motion and notices). They are all made of the same
 * dark capsule and glow as the rest of Lumen, only tuned differently, and each
 * patch covers the same groups so picking one undoes what another set.
 */
export interface Preset {
  id: string;
  name: string;
  description: string;
  patch: SettingsPatch;
}

const { look, island, motion, notices } = DEFAULT_SETTINGS;
// What the island shows at rest, but not the clock format, date or weather: those stay yours.
const { dot, track, viz, sparks, weatherFx } = DEFAULT_SETTINGS.collapsed;
const BASE = { look, island, collapsed: { dot, track, viz, sparks, weatherFx }, motion, notices };

/** The defaults of every group a preset covers, with `changes` on top. */
const preset = (changes: SettingsPatch): SettingsPatch => deepMerge(BASE, changes);

export const PRESETS: Preset[] = [
  {
    id: "glow",
    name: "Свечение",
    description: "Тёплое свечение, пульс в такт музыке, мягкая форма",
    patch: preset({}),
  },
  {
    id: "flow",
    name: "Перелив",
    description: "Цвета свечения переливаются вдоль капсулы",
    patch: preset({ look: { style: "flow" } }),
  },
  {
    id: "minimal",
    name: "Минимал",
    description: "Без свечения и точки, короткий: только часы и погода",
    patch: preset({
      look: { glow: "off", beat: false, lean: false },
      island: { width: 140, height: 34, pull: 0 },
      collapsed: { dot: false, track: false, weatherFx: false },
      motion: { bounce: "calm", blur: false, copyFlash: false },
    }),
  },
  {
    id: "smoke",
    name: "Дымка",
    description: "Полупрозрачная дымчатая капсула со светлой кромкой",
    patch: preset({
      look: { finish: "smoke", glow: "soft", accent: "ice", spread: 1.2 },
    }),
  },
  {
    id: "neon",
    name: "Неон",
    description: "Яркий контур в цветах свечения, вспыхивает в такт",
    patch: preset({ look: { finish: "neon", accent: "rose" } }),
  },
  {
    id: "gaming",
    name: "Игровой",
    description: "FPS и нагрузка при запуске игры, открывается по клику, минимум анимаций",
    patch: preset({
      games: { stats: true },
      look: { glow: "soft", accent: "mint", musicOnly: true, lean: false },
      island: { openOn: "click", pull: 0 },
      collapsed: { weatherFx: false },
      motion: {
        speed: "fast",
        bounce: "calm",
        blur: false,
        copyFlash: false,
        trackBump: false,
      },
      notices: { duration: 0.7 },
    }),
  },
];

/** Whether every value the patch sets is already in place, so manual tweaks un-select it. */
export function matches(current: unknown, patch: unknown): boolean {
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    const base = (current ?? {}) as Record<string, unknown>;
    return Object.entries(patch).every(([key, value]) => matches(base[key], value));
  }
  return JSON.stringify(current) === JSON.stringify(patch);
}

export const isActive = (preset: Preset, settings: Settings) => matches(settings, preset.patch);

const tint = (color: string, alpha: number) =>
  `color-mix(in srgb, ${color} ${Math.round(Math.min(alpha, 1) * 100)}%, transparent)`;

/**
 * The little capsule on a preset's card, drawn from the preset itself: its
 * palette, glow, style, capsule and width. `backdrop` is the card behind it.
 */
export function presetPreview(preset: Preset): {
  backdrop: string;
  capsule: CSSProperties;
} {
  const l = preset.patch.look as Look;
  const { a, b } = palette(l);
  const { k, r } = GLOW_LEVELS[l.glow];
  const width = Math.round(74 * ((preset.patch.island?.width ?? island.width) / island.width));
  const height = Math.round(18 * ((preset.patch.island?.height ?? island.height) / island.height));
  // A dimmer halo for a glow that waits for music.
  const s = k * (l.musicOnly ? 0.6 : 1);
  const blur = Math.round(12 * r * l.spread);
  const halo =
    s === 0
      ? ["0 0 0 1px rgba(255, 255, 255, 0.12)"]
      : l.style === "flow"
        ? [`-9px 0 ${blur}px 1px ${tint(a, 0.55 * s)}`, `9px 0 ${blur}px 1px ${tint(b, 0.6 * s)}`]
        : [`0 0 0 1px ${tint(a, 0.3 * s)}`, `0 0 ${blur}px 2px ${tint(b, 0.55 * s)}`];
  const finish =
    l.finish === "neon"
      ? [
          `inset 0 0 0 1.5px color-mix(in srgb, ${a} 55%, white)`,
          `inset 0 0 6px 1px ${tint(b, 0.6)}`,
          `0 0 0 0.5px color-mix(in srgb, ${a} 55%, white)`,
          `0 0 5px 1px ${tint(b, 0.8)}`,
          `0 0 ${blur + 6}px 3px ${tint(a, 0.35 * s)}`,
        ]
      : l.finish === "smoke"
        ? ["inset 0 1px 0 rgba(255, 255, 255, 0.22)", "inset 0 0 0 1px rgba(255, 255, 255, 0.1)", ...halo.slice(1)]
        : halo;
  return {
    backdrop: l.finish,
    capsule: {
      width,
      height,
      borderRadius: height / 2,
      boxShadow: finish.join(", "),
      ...(l.finish === "smoke" && { background: "rgb(11 11 14 / 0.55)" }),
    },
  };
}
