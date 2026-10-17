/** What an addon may ask for in its manifest; the user grants each one. */
export type Permission = "notify" | "clipboard" | "links" | "media" | "network" | "foreground" | "hotkeys";

export interface AddonTab {
  label: string;
  /** The expanded island's height on this tab, px. */
  height?: number | null;
}

/** An addon folder as the backend read it; a broken one has `error`. */
export interface AddonInfo {
  id: string;
  folder: string;
  name: string;
  version: string;
  author: string | null;
  description: string | null;
  main: string;
  icon: string | null;
  permissions: Permission[];
  /** Hosts for "network": "api.example.com" or "*.example.com". */
  network: string[];
  tab: AddonTab | null;
  search: boolean;
  /** Raw manifest "settings"; see settingFields. */
  settings: unknown[];
  /** Changes whenever one of its files does. */
  stamp: number;
  error: string | null;
}

/** One of an addon's own settings, shown under it in Аддоны. */
export type SettingField =
  | { key: string; type: "toggle"; label: string; hint?: string; default?: boolean }
  | { key: string; type: "text"; label: string; hint?: string; default?: string; placeholder?: string; secret?: boolean }
  | { key: string; type: "number"; label: string; hint?: string; default?: number; min?: number; max?: number; step?: number }
  | {
      key: string;
      type: "select";
      label: string;
      hint?: string;
      default?: string;
      options: { value: string; label: string }[];
    };

/** A search result an addon hands back. */
export interface SearchItem {
  id: string;
  title: string;
  hint?: string;
  icon?: string;
  /** Enter copies this (with "clipboard"). */
  copy?: string;
  /** Enter opens this link (with "links"). */
  open?: string;
}

/** A lasting line in the collapsed island, e.g. a build or a countdown. */
export interface Activity {
  title: string;
  detail?: string;
  /** 0..1 for a bar along the bottom edge. */
  progress?: number | null;
  icon?: string;
}

/** Saved in settings.json as `addons`. */
export interface AddonPrefs {
  /**
   * Switched-on addons and what the user granted them: their permissions
   * plus "network:<host>" for each host. Missing or null is off.
   */
  enabled: Record<string, string[] | null>;
  /** Each addon's own settings. */
  config: Record<string, Record<string, unknown>>;
}
