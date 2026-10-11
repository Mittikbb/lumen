import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";

export interface ClipImage {
  width: number;
  height: number;
  /** PNG data URL. */
  thumb: string;
}

export interface ClipEntry {
  id: number;
  /** Empty for images. */
  text: string;
  image: ClipImage | null;
  /** Executable the text came from, e.g. "chrome". */
  app: string | null;
  /** Unix ms. */
  at: number;
  pinned: boolean;
}

export const clipboard = {
  paste: (id: number) => isTauri && invoke("clipboard_paste", { id }),
  remove: (id: number) => isTauri && invoke("clipboard_delete", { id }),
  pin: (id: number) => isTauri && invoke("clipboard_pin", { id }),
  clear: () => isTauri && invoke("clipboard_clear"),
};

/** Clipboard history; `null` until the saved history has loaded. */
export function useClipboard(): ClipEntry[] | null {
  const [entries, setEntries] = useState<ClipEntry[] | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    invoke<ClipEntry[]>("clipboard_history").then(setEntries);
    const unlisten = listen<ClipEntry[]>("lumen://clipboard", (e) => setEntries(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  return entries;
}

/**
 * Calls `onCopy` with each entry that's genuinely new. Re-copying an old entry
 * (e.g. pasting from history) only moves it up and keeps its id, so it's ignored.
 */
export function useCopyEvents(entries: ClipEntry[] | null, onCopy: (entry: ClipEntry) => void) {
  const newest = useRef<number | null>(null);
  const callback = useRef(onCopy);
  callback.current = onCopy;

  useEffect(() => {
    if (!entries) return;
    const top = entries.reduce((max, e) => Math.max(max, e.id), 0);
    const seen = newest.current;
    newest.current = Math.max(top, seen ?? 0);
    if (seen === null || top <= seen) return;
    callback.current(entries.find((e) => e.id === top)!);
  }, [entries]);
}

/** One-line preview of an entry for notices. */
export function clipPreview(entry: ClipEntry) {
  if (entry.image) return `Изображение ${entry.image.width}×${entry.image.height}`;
  return entry.text.trim().replace(/\s+/g, " ");
}

export type ClipKind = "link" | "color" | "code" | "text";

const COLOR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;

export function clipKind(text: string): ClipKind {
  const t = text.trim();
  if (COLOR.test(t)) return "color";
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return "link";
  if (/[{};]\s*$|^\s*(import|const|let|function|def|class|npm|git|cd)\b/m.test(t)) return "code";
  return "text";
}

const APP_NAMES: Record<string, string> = {
  chrome: "Chrome",
  msedge: "Edge",
  firefox: "Firefox",
  browser: "Яндекс Браузер",
  code: "VS Code",
  windowsterminal: "Терминал",
  explorer: "Проводник",
  telegram: "Telegram",
  discord: "Discord",
  notepad: "Блокнот",
  winword: "Word",
  excel: "Excel",
  lumen: "Lumen",
};

export function appName(app: string | null) {
  if (!app) return null;
  return APP_NAMES[app.toLowerCase()] ?? app;
}

export function timeAgo(at: number, now = Date.now()) {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return d === 1 ? "вчера" : `${d} дн`;
}
