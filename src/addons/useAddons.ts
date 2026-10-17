import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";
import type { AddonInfo, AddonPrefs, SettingField } from "./types";

/** Addons in the addons folder, live as it changes. */
export function useAddonList(): AddonInfo[] {
  const [list, setList] = useState<AddonInfo[]>([]);
  useEffect(() => {
    if (!isTauri) return;
    let changed = false;
    invoke<AddonInfo[]>("addons_list").then((l) => !changed && setList(l));
    const unlisten = listen<AddonInfo[]>("lumen://addons", (e) => {
      changed = true;
      setList(e.payload);
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, []);
  return list;
}

export const openAddonsFolder = () => isTauri && invoke("addons_open_folder");

/** Everything an addon needs granted to run: its permissions and each host. */
export const required = (addon: AddonInfo): string[] => [
  ...addon.permissions,
  ...addon.network.map((host) => `network:${host}`),
];

export const granted = (addon: AddonInfo, prefs: AddonPrefs): string[] | null => {
  const list = prefs.enabled[addon.id];
  return Array.isArray(list) ? list : null;
};

/** Switched on, and nothing new asked for since. */
export function isActive(addon: AddonInfo, prefs: AddonPrefs): boolean {
  const list = granted(addon, prefs);
  return !addon.error && !!list && required(addon).every((p) => list.includes(p));
}

/** Switched on, but an update asks for something the user hasn't allowed yet. */
export function needsApproval(addon: AddonInfo, prefs: AddonPrefs): boolean {
  const list = granted(addon, prefs);
  return !addon.error && !!list && !required(addon).every((p) => list.includes(p));
}

const KEY = /^[\w.-]{1,40}$/;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The well-formed fields of manifest "settings"; the rest is skipped. */
export function settingFields(addon: AddonInfo): SettingField[] {
  const out: SettingField[] = [];
  for (const raw of addon.settings.slice(0, 30)) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Record<string, unknown>;
    const key = str(f.key);
    const label = str(f.label);
    if (!key || !KEY.test(key) || !label) continue;
    const base = { key, label: label.slice(0, 60), hint: str(f.hint)?.slice(0, 160) };
    if (f.type === "toggle") out.push({ ...base, type: "toggle", default: f.default === true });
    else if (f.type === "text")
      out.push({ ...base, type: "text", default: str(f.default), placeholder: str(f.placeholder), secret: f.secret === true });
    else if (f.type === "number")
      out.push({ ...base, type: "number", default: num(f.default), min: num(f.min), max: num(f.max), step: num(f.step) });
    else if (f.type === "select" && Array.isArray(f.options)) {
      const options = f.options
        .filter((o): o is { value: string; label?: string } => !!o && typeof o === "object" && typeof o.value === "string")
        .map((o) => ({ value: o.value, label: str(o.label) ?? o.value }));
      if (options.length) out.push({ ...base, type: "select", default: str(f.default), options });
    }
  }
  return out;
}

/** An addon's settings: its saved values over the manifest defaults. */
export function addonConfig(addon: AddonInfo, prefs: AddonPrefs): Record<string, unknown> {
  const saved = prefs.config[addon.id] ?? {};
  const out: Record<string, unknown> = {};
  for (const f of settingFields(addon)) {
    out[f.key] = f.key in saved ? saved[f.key] : (f.default ?? (f.type === "toggle" ? false : f.type === "number" ? 0 : ""));
  }
  return out;
}

const isWindows = navigator.userAgent.includes("Windows");

/** Where an addon's files are served; WebView2 maps custom schemes to http://<scheme>.localhost. */
export const addonBase = (id: string) =>
  `${isWindows ? "http://lumenaddon.localhost" : "lumenaddon://localhost"}/${encodeURIComponent(id)}/`;

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|ico)$/i;

/**
 * A picture an addon names: a data: image, or a file in its folder. Anything
 * else (a web address, a path out of the folder) is refused.
 */
export function addonAsset(id: string, src: unknown): string | null {
  if (typeof src !== "string" || src.length > 200_000) return null;
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml);/i.test(src)) return src;
  if (!IMAGE_FILE.test(src) || src.includes("\\") || src.includes(":")) return null;
  const parts = src.replace(/^\.\//, "").split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) return null;
  return addonBase(id) + parts.map(encodeURIComponent).join("/");
}

/** Whether `icon` names a picture rather than a glyph (an emoji, a letter). */
export const isPicture = (icon: string) => icon.startsWith("data:") || IMAGE_FILE.test(icon);
