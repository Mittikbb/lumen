import { DEFAULT_SETTINGS, Settings, SettingsPatch } from "./useSettings";

/**
 * Island presets: each sets the whole feel at once (look, shape, what the
 * collapsed island shows, motion and notices). "Свечение" and "Перелив" are
 * filled in so far; the rest are placeholders shown as "скоро".
 */
export interface Preset {
  id: string;
  name: string;
  description: string;
  /** Settings it applies; `null` while the preset is still a placeholder. */
  patch: SettingsPatch | null;
  /** Classes for the little capsule drawn on its card. */
  preview: string;
}

const { look, island, collapsed, motion, notices } = DEFAULT_SETTINGS;

export const PRESETS: Preset[] = [
  {
    id: "glow",
    name: "Свечение",
    description: "Тёплое свечение, пульс в такт музыке, мягкая форма",
    patch: { look, island, collapsed, motion, notices },
    preview: "glow",
  },
  {
    id: "flow",
    name: "Перелив",
    description: "Цвета свечения переливаются вдоль капсулы",
    patch: { look: { ...look, style: "flow" }, island, collapsed, motion, notices },
    preview: "flow",
  },
  {
    id: "minimal",
    name: "Минимал",
    description: "Без свечения, компактный, только часы",
    patch: null,
    preview: "minimal",
  },
  {
    id: "glass",
    name: "Стекло",
    description: "Полупрозрачная капсула с размытием фона",
    patch: null,
    preview: "glass",
  },
  {
    id: "neon",
    name: "Неон",
    description: "Яркий контур и насыщенные цвета",
    patch: null,
    preview: "neon",
  },
  {
    id: "gaming",
    name: "Игровой",
    description: "Прячется в играх, минимум анимаций",
    patch: null,
    preview: "gaming",
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

export const isActive = (preset: Preset, settings: Settings) => !!preset.patch && matches(settings, preset.patch);
