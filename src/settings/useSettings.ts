import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";
import type { City } from "../weather/useWeather";

export type GlowLevel = "off" | "soft" | "normal" | "bright";
export type Accent = "sunset" | "rose" | "violet" | "midnight" | "ocean" | "mint" | "ice" | "custom";
export type Speed = "slow" | "normal" | "fast";
export type Bounce = "calm" | "normal" | "springy";
export type SearchEngine = "google" | "yandex" | "duckduckgo" | "bing";

/** Shortcuts as `Alt+Shift+KeyS`: modifiers plus a KeyboardEvent.code. */
/** Shortcuts as "Alt+Shift+KeyS"; an empty one is switched off. */
export interface Hotkeys {
  launcher: string;
  screenshot: string;
  text: string;
  /** Your Discord mic on or off. */
  mic: string;
  /** The playing track. */
  play: string;
  next: string;
  previous: string;
}

/** "glow" breathes around the capsule; "flow" ("Перелив") runs its colours sideways along it. */
export type GlowStyle = "glow" | "flow";
/** How fast the glow breathes or flows. */
export type GlowPace = "slow" | "normal" | "fast";

export interface Look {
  glow: GlowLevel;
  style: GlowStyle;
  /** How far the glow reaches, on top of its strength (1 = as is). */
  spread: number;
  pace: GlowPace;
  /** Glow only while music plays. */
  musicOnly: boolean;
  /** Glow palette when there's no album art to take colours from. */
  accent: Accent;
  /** The two tones of the "custom" palette, as #rrggbb. */
  customA: string;
  customB: string;
  /** Tint the glow with the album art of the playing track. */
  artColors: boolean;
  /** Pulse with the music instead of breathing at a fixed pace. */
  beat: boolean;
  /** Stretch toward an approaching pointer. */
  lean: boolean;
}

/** Shape and hover behaviour of the island (CSS px and ms). */
export interface IslandPrefs {
  width: number;
  height: number;
  expandedWidth: number;
  /** Corner radius of the expanded island. */
  radius: number;
  /** Gap between the top of the screen and the island. */
  offsetTop: number;
  /** "hover": opens when the pointer rests on it; "click": only on a click. */
  openOn: "hover" | "click";
  openDelay: number;
  closeDelay: number;
  /** How hard the collapsed island leans toward the pointer (0..2). */
  pull: number;
}

/** How a Discord call shows while the island is collapsed. */
export type CallStyle = "classic" | "right" | "drop";
/** How hard it is to tear the call drop off the island. */
export type DropPull = "soft" | "normal" | "tight";

/** The Discord call on the island; all but `style` are for the drop. */
export interface CallPrefs {
  style: CallStyle;
  /** What the drop announces; `self` is your own mic and sound. */
  notify: { joins: boolean; mic: boolean; sound: boolean; self: boolean };
  /** How long an announcement stays out, ms. */
  showMs: number;
  pull: DropPull;
  /** How close the pointer comes before the drop pops out, px. */
  reach: number;
  /** "discord" tints the drop's glow Discord blurple. */
  tint: "island" | "discord";
}

/** What the collapsed island shows at rest. */
export interface CollapsedPrefs {
  clock24: boolean;
  seconds: boolean;
  date: boolean;
  weather: boolean;
  track: boolean;
}

export interface NoticePrefs {
  copy: boolean;
  shelf: boolean;
  rain: boolean;
  /** A Bluetooth device connected or disconnected. */
  bluetooth: boolean;
  /** The keyboard layout switched (a drop below the island). */
  layout: boolean;
  /** Caps Lock switched (the same drop). */
  caps: boolean;
  /** Multiplier for how long notices stay (0.5..2). */
  duration: number;
}

export interface MotionPrefs {
  speed: Speed;
  bounce: Bounce;
  /** Blur content while it fades in and out. */
  blur: boolean;
  copyFlash: boolean;
  trackBump: boolean;
  /** No animations at all, for slow PCs. */
  reduced: boolean;
}

/** Backend: where the island lives. */
export interface DisplayPrefs {
  /** Monitor name; null for the primary one. */
  monitor: string | null;
  hideFullscreen: boolean;
  hideMaximized: boolean;
  /** Where the island was dragged (Ctrl + drag); null keeps it centred at the top. */
  position: { x: number; y: number } | null;
}

export interface ClipboardPrefs {
  limit: number;
  /** Unpinned entries older than this many days go; 0 keeps them. */
  keepDays: number;
  /** Executables whose copies aren't remembered. */
  ignore: string[];
}

export interface WeatherPrefs {
  units: "c" | "f";
  /** Rain chance (%) in the next hour worth a heads-up. */
  rainChance: number;
  refreshMinutes: number;
}

export interface DiscordPrefs {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  voice: boolean;
  presence: boolean;
}

/** What a finished timer sounds like. */
export interface TimerPrefs {
  sound: boolean;
  /** 0–1. */
  volume: number;
}

export interface MediaPrefs {
  volumeSlider: boolean;
}

/** Players by their SMTC app id. */
export interface PlayerPrefs {
  /** Players that have played something, in the order they first did. */
  known: string[];
  /** Players the island and the Discord status leave out. */
  hidden: string[];
  /** Your names for players; empty means the built-in one. */
  names: Record<string, string>;
}

export type CodeBorderColor = "code" | "theme";

export interface AdvancedPrefs {
  /** The hidden Расширенные section is shown (10 taps on the logo in О Lumen). */
  unlocked: boolean;
  /** HTTP codes and network protocols in search (h:404, h:dns, hHelp:). Off by default. */
  lookup: boolean;
  /** Edge and glow color of the droplet window on Enter: "code" (category color) or "theme" (program accent). */
  codeBorderColor: CodeBorderColor;
  /** Backdrop blur effect for the droplet card. */
  dropletGlassBlur: boolean;
}

export interface Settings {
  hotkeys: Hotkeys;
  /** Start menu AppID of the AI app; null picks the first one installed. */
  aiApp: string | null;
  /** StartMenuInternet key, "system" for the Windows default, null for Chrome if installed. */
  browser: string | null;
  /** Island tabs switched off; search always stays. */
  hiddenTabs: string[];
  city: City | null;
  look: Look;
  island: IslandPrefs;
  collapsed: CollapsedPrefs;
  call: CallPrefs;
  notices: NoticePrefs;
  motion: MotionPrefs;
  display: DisplayPrefs;
  clipboard: ClipboardPrefs;
  shelf: { limit: number };
  weather: WeatherPrefs;
  /** `apps`: how many programs a search lists at most. */
  search: { engine: SearchEngine; apps: number };
  timer: TimerPrefs;
  discord: DiscordPrefs;
  /** `install`: put a found update in by itself right after start. */
  updates: { auto: boolean; install: boolean };
  media: MediaPrefs;
  players: PlayerPrefs;
  /** Show downloads on the island; off by default. */
  downloads: { enabled: boolean };
  advanced: AdvancedPrefs;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends unknown[] | null ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type SettingsPatch = DeepPartial<Settings>;

/** Defaults; the backend's match for the groups it reads. */
export const DEFAULT_SETTINGS: Settings = {
  hotkeys: {
    launcher: "Alt+Space",
    screenshot: "Alt+Shift+KeyS",
    text: "Alt+Shift+KeyT",
    mic: "",
    play: "",
    next: "",
    previous: "",
  },
  aiApp: null,
  browser: null,
  hiddenTabs: [],
  city: null,
  look: {
    glow: "normal",
    style: "glow",
    spread: 1,
    pace: "normal",
    musicOnly: false,
    customA: "#7cf0c8",
    customB: "#5a6cff",
    accent: "sunset",
    artColors: true,
    beat: true,
    lean: true,
  },
  island: {
    width: 220,
    height: 40,
    expandedWidth: 560,
    radius: 30,
    offsetTop: 12,
    openOn: "hover",
    openDelay: 120,
    closeDelay: 380,
    pull: 1,
  },
  collapsed: { clock24: true, seconds: false, date: false, weather: true, track: true },
  call: {
    style: "classic",
    notify: { joins: true, mic: true, sound: true, self: true },
    showMs: 2500,
    pull: "normal",
    reach: 120,
    tint: "island",
  },
  notices: { copy: true, shelf: true, rain: true, bluetooth: true, layout: true, caps: true, duration: 1 },
  motion: { speed: "normal", bounce: "normal", blur: true, copyFlash: true, trackBump: true, reduced: false },
  display: { monitor: null, hideFullscreen: true, hideMaximized: false, position: null },
  clipboard: { limit: 60, keepDays: 0, ignore: [] },
  shelf: { limit: 40 },
  weather: { units: "c", rainChance: 60, refreshMinutes: 15 },
  search: { engine: "google", apps: 5 },
  timer: { sound: true, volume: 0.6 },
  discord: { enabled: false, clientId: "", clientSecret: "", voice: true, presence: true },
  updates: { auto: true, install: true },
  media: { volumeSlider: true },
  players: { known: [], hidden: [], names: {} },
  downloads: { enabled: false },
  advanced: {
    unlocked: false,
    lookup: false,
    codeBorderColor: "code",
    dropletGlassBlur: true,
  },
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** `base` with `patch` laid over it: objects merge key by key, the rest is replaced. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = key in out ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

/** Saved settings may predate newer options; fill those in. */
const withDefaults = (saved: unknown): Settings => deepMerge(DEFAULT_SETTINGS, saved);

// Browser preview: no backend, so settings live in memory for the page.
let previewSettings = DEFAULT_SETTINGS;
const previewListeners = new Set<(s: Settings) => void>();

/** Saves part of the settings; rejects with a message if the backend refuses. */
export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  if (isTauri) return withDefaults(await invoke("settings_update", { patch }));
  previewSettings = deepMerge(previewSettings, patch);
  previewListeners.forEach((listener) => listener(previewSettings));
  return previewSettings;
}

/** Current settings, live across windows; null until loaded. */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(isTauri ? null : previewSettings);

  useEffect(() => {
    if (!isTauri) {
      previewListeners.add(setSettings);
      return () => {
        previewListeners.delete(setSettings);
      };
    }
    // A change broadcast while the first read is in flight wins over it.
    let changed = false;
    invoke("settings_get").then((s) => !changed && setSettings(withDefaults(s)));
    const unlisten = listen("lumen://settings", (e) => {
      changed = true;
      setSettings(withDefaults(e.payload));
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  return settings;
}

export const openSettings = () => isTauri && invoke("settings_open");

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Super"];
const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

const KEY_LABELS: Record<string, string> = {
  Super: "Win",
  Space: "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Delete: "Del",
  Insert: "Ins",
  PrintScreen: "PrtSc",
};

/** "Alt+Shift+KeyS" → ["Alt", "Shift", "S"]. */
export function shortcutParts(shortcut: string): string[] {
  if (!shortcut) return [];
  return shortcut.split("+").map((part) => {
    const label = part.replace(/^Key(?=[A-Z]$)/, "").replace(/^Digit(?=\d$)/, "").replace(/^Numpad/, "Num ");
    return KEY_LABELS[label] ?? label;
  });
}

/** "Alt+Shift+KeyS" → "Alt+Shift+S", for hints and tooltips. */
export const formatShortcut = (shortcut: string) => shortcutParts(shortcut).join("+");

/**
 * The shortcut a key press makes, in a stable modifier order; null while only
 * modifiers are held.
 */
export function shortcutFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (MODIFIER_CODES.test(e.code)) return null;
  const held = [e.ctrlKey, e.altKey, e.shiftKey, e.metaKey];
  return [...MODIFIERS.filter((_, i) => held[i]), e.code].join("+");
}

/** Modifiers currently held, for showing a combination as it's being pressed. */
export function heldModifiers(e: KeyboardEvent | React.KeyboardEvent): string[] {
  const held = [e.ctrlKey, e.altKey, e.shiftKey, e.metaKey];
  return MODIFIERS.filter((_, i) => held[i]).map((m) => KEY_LABELS[m] ?? m);
}
