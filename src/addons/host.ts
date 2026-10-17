import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";
import { launcher } from "../launcher/useLauncher";
import type { NowPlaying } from "../media/useMedia";
import { addonBase, addonConfig, isActive } from "./useAddons";
import type { Activity, AddonInfo, AddonPrefs, Permission, SearchItem } from "./types";

/**
 * The island's side of the addons: one sandboxed, hidden iframe per switched
 * on addon, and the broker for everything it asks over postMessage. Each call
 * is checked against the permissions the user granted before it reaches the
 * backend or the island. Lives only in the island window.
 */

interface Frame {
  addon: AddonInfo;
  el: HTMLIFrameElement;
  granted: Set<string>;
  /** The settings last sent to it, as JSON. */
  config: string;
  ready: boolean;
  lastNotice: number;
  /** It asked to let go of Lumen's shortcuts. */
  pausing: boolean;
}

/** What a frame's SDK posts. */
interface Message {
  lumen: 1;
  call?: number;
  method?: string;
  args?: unknown[];
  response?: number;
  ok?: boolean;
  value?: unknown;
  error?: string;
}

export interface AddonNotice {
  addon: AddonInfo;
  title: string;
  detail: string;
}

const SEARCH_TIMEOUT_MS = 1500;
/** Addons are asked once typing pauses this long. */
const SEARCH_DEBOUNCE_MS = 120;
const SEARCH_ITEMS = 8;
/** At most one notice per addon this often. */
const NOTICE_GAP_MS = 2000;
const TEXT_MAX = 200;

const frames = new Map<string, Frame>();
const views = new Map<string, unknown>();
const activities = new Map<string, Activity & { addon: AddonInfo; at: number }>();
const stores = new Map<string, Promise<Record<string, unknown>>>();
/** Writes per addon, one after another. */
const writes = new Map<string, Promise<unknown>>();
const requests = new Map<number, (value: unknown) => void>();
const listeners = new Set<() => void>();
let requestSeq = 0;
let revision = 0;
let media: Pick<NowPlaying, "title" | "artist" | "app" | "playing"> | null = null;
let noticeSink: ((notice: AddonNotice) => void) | null = null;
let container: HTMLDivElement | null = null;
/** What the backend was last told: shortcuts let go, the app in front watched. */
let hotkeysPaused = false;
let watchingFront = false;

const changed = () => {
  revision++;
  listeners.forEach((l) => l());
};

const text = (v: unknown, max = TEXT_MAX) => (v == null ? "" : String(v)).slice(0, max);

function post(frame: Frame, message: Record<string, unknown>) {
  frame.el.contentWindow?.postMessage({ lumen: 1, ...message }, "*");
}

const emit = (frame: Frame, event: string, data?: unknown) => frame.ready && post(frame, { event, data });

const can = (frame: Frame, permission: Permission) =>
  frame.addon.permissions.includes(permission) && frame.granted.has(permission);

function need(frame: Frame, permission: Permission) {
  if (!can(frame, permission)) throw new Error(`permission "${permission}" is not granted`);
}

function holder(): HTMLDivElement {
  if (!container) {
    container = document.createElement("div");
    container.className = "addon-frames";
    container.setAttribute("aria-hidden", "true");
    document.body.appendChild(container);
    window.addEventListener("message", onMessage);
    // A reloaded island must not leave the shortcuts let go by an addon that's gone.
    invoke("addons_pause_hotkeys", { paused: false });
    listen<unknown>("lumen://front", (e) => {
      for (const frame of frames.values()) if (can(frame, "foreground")) emit(frame, "foreground", e.payload);
    });
  }
  return container;
}

/** Tells the backend whether any addon holds the shortcuts or needs the app in front. */
function syncBackend() {
  const paused = [...frames.values()].some((f) => f.pausing && can(f, "hotkeys"));
  if (paused !== hotkeysPaused) {
    hotkeysPaused = paused;
    invoke("addons_pause_hotkeys", { paused });
  }
  const watch = [...frames.values()].some((f) => can(f, "foreground"));
  if (watch !== watchingFront) {
    watchingFront = watch;
    invoke("addons_watch_front", { on: watch });
  }
}

function start(addon: AddonInfo, granted: string[], config: Record<string, unknown>) {
  const el = document.createElement("iframe");
  // Scripts only: an opaque origin, so no Tauri IPC, storage or cookies.
  el.setAttribute("sandbox", "allow-scripts");
  el.tabIndex = -1;
  el.title = addon.id;
  el.src = addonBase(addon.id);
  frames.set(addon.id, {
    addon,
    el,
    granted: new Set(granted),
    config: JSON.stringify(config),
    ready: false,
    lastNotice: 0,
    pausing: false,
  });
  holder().appendChild(el);
}

function stop(id: string) {
  frames.get(id)?.el.remove();
  frames.delete(id);
  views.delete(id);
  activities.delete(id);
  stores.delete(id);
}

/** Starts, stops and reloads frames to match the addons folder and the settings. */
export function syncAddons(list: AddonInfo[], prefs: AddonPrefs) {
  holder();
  const active = new Map(list.filter((a) => isActive(a, prefs)).map((a) => [a.id, a]));
  let touched = false;
  for (const id of [...frames.keys()]) {
    if (!active.has(id)) {
      stop(id);
      touched = true;
    }
  }
  for (const addon of active.values()) {
    const granted = prefs.enabled[addon.id] ?? [];
    const config = addonConfig(addon, prefs);
    const frame = frames.get(addon.id);
    if (!frame || frame.addon.stamp !== addon.stamp) {
      // New, or edited on disk: a fresh start.
      if (frame) stop(addon.id);
      start(addon, granted, config);
      touched = true;
      continue;
    }
    frame.addon = addon;
    frame.granted = new Set(granted);
    const json = JSON.stringify(config);
    if (json !== frame.config) {
      frame.config = json;
      emit(frame, "settings", config);
    }
  }
  syncBackend();
  if (touched) changed();
}

export function setAddonMedia(now: NowPlaying | null) {
  const next = now && { title: now.title, artist: now.artist, app: now.app, playing: now.playing };
  if (JSON.stringify(next) === JSON.stringify(media)) return;
  media = next;
  for (const frame of frames.values()) if (can(frame, "media")) emit(frame, "media", media);
}

/** Where addon notices go (the island shows them like its own). */
export function onAddonNotice(sink: ((notice: AddonNotice) => void) | null) {
  noticeSink = sink;
}

/** The addon's tab was shown or hidden. */
export function addonTabShown(id: string, shown: boolean) {
  const frame = frames.get(id);
  if (frame) emit(frame, shown ? "tab:show" : "tab:hide");
}

/** A button, list row or input in the addon's tab. */
export function addonAction(id: string, action: string, value?: unknown) {
  const frame = frames.get(id);
  if (frame) emit(frame, "action", { action, value });
}

/** What an addon's tab shows (its last render), or undefined before the first. */
export const addonView = (id: string) => views.get(id);

/** The newest live activity, if any addon has one. */
export function currentActivity() {
  let newest: (Activity & { addon: AddonInfo; at: number }) | null = null;
  for (const a of activities.values()) if (!newest || a.at > newest.at) newest = a;
  return newest;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Re-renders on any change to views and activities. */
export const useAddonRevision = () => useSyncExternalStore(subscribe, () => revision);

/** Whether some addon has a live activity; re-renders only when that flips. */
export const useHasActivity = () => useSyncExternalStore(subscribe, () => activities.size > 0);

/** Keeps the frames in step with the addons and the settings, and feeds them the music. */
export function useAddonHost(list: AddonInfo[], prefs: AddonPrefs | undefined, now: NowPlaying | null) {
  useEffect(() => {
    if (isTauri && prefs) syncAddons(list, prefs);
  }, [list, prefs]);
  useEffect(() => setAddonMedia(now), [now?.title, now?.artist, now?.app, now?.playing]);
}

export interface AddonResults {
  addon: AddonInfo;
  items: SearchItem[];
}

/** Asks every searching addon about `query`; each answer arrives on its own. */
export function searchAddons(query: string, onResults: (results: AddonResults) => void): () => void {
  let alive = true;
  for (const frame of frames.values()) {
    if (!frame.addon.search || !frame.ready) continue;
    const id = ++requestSeq;
    const timeout = setTimeout(() => requests.delete(id), SEARCH_TIMEOUT_MS);
    requests.set(id, (value) => {
      clearTimeout(timeout);
      if (alive && Array.isArray(value)) onResults({ addon: frame.addon, items: cleanItems(value) });
    });
    post(frame, { request: id, method: "search", args: [query] });
  }
  return () => {
    alive = false;
  };
}

/** The running addon that owns this query by its search prefix, if any. */
export function prefixOwner(query: string): AddonInfo | null {
  const q = query.trimStart();
  for (const frame of frames.values()) {
    const prefix = frame.addon.searchPrefix;
    if (prefix && q.startsWith(prefix)) return frame.addon;
  }
  return null;
}

/** Addon results for what's typed in search; stale ones are never shown. */
export function useAddonSearch(query: string): AddonResults[] {
  const [found, setFound] = useState<{ query: string; results: AddonResults[] }>({ query: "", results: [] });
  const q = query.trim();
  useEffect(() => {
    if (!q || !frames.size) return;
    let cancel = () => {};
    const t = setTimeout(() => {
      cancel = searchAddons(q, (r) =>
        setFound((f) => {
          const others = f.query === q ? f.results.filter((x) => x.addon.id !== r.addon.id) : [];
          // In folder order, so results don't swap places as answers come in.
          const results = [...others, r].sort((a, b) => a.addon.folder.localeCompare(b.addon.folder));
          return { query: q, results };
        }),
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      cancel();
    };
  }, [q]);
  return found.query === q ? found.results : [];
}

function cleanItems(raw: unknown[]): SearchItem[] {
  return raw
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object" && "title" in i)
    .slice(0, SEARCH_ITEMS)
    .map((i, n) => ({
      id: text(i.id ?? n, 100),
      title: text(i.title),
      hint: i.hint == null ? undefined : text(i.hint),
      icon: typeof i.icon === "string" ? i.icon : undefined,
      copy: typeof i.copy === "string" ? i.copy.slice(0, 100_000) : undefined,
      open: typeof i.open === "string" ? i.open : undefined,
      terminal: typeof i.terminal === "string" && i.terminal.trim() && !/[\r\n]/.test(i.terminal) ? i.terminal.slice(0, 8000) : undefined,
      shell: typeof i.shell === "string" ? i.shell : undefined,
    }));
}

/** Enter on an addon's result: copy, open, or tell the addon. */
export function selectAddonResult(addon: AddonInfo, item: SearchItem) {
  const frame = frames.get(addon.id);
  if (!frame) return;
  if (item.terminal && can(frame, "terminal")) {
    // The command the user picked runs in plain sight, in its own window.
    launcher.close(false);
    invoke("addons_terminal", { id: addon.id, command: item.terminal, shell: item.shell ?? null }).catch((err) =>
      noticeSink?.({ addon, title: "Не удалось запустить", detail: String(err) }),
    );
  } else if (item.copy != null && can(frame, "clipboard")) {
    launcher.copy(item.copy);
  } else if (item.open && /^https?:\/\//i.test(item.open) && can(frame, "links")) {
    launcher.openUrl(item.open);
  } else {
    emit(frame, "select", { id: item.id });
    launcher.close(true);
  }
}

function onMessage(e: MessageEvent) {
  const m = e.data as Message;
  if (!m || m.lumen !== 1) return;
  const frame = [...frames.values()].find((f) => f.el.contentWindow === e.source);
  if (!frame) return;
  if (typeof m.response === "number") {
    const resolve = requests.get(m.response);
    requests.delete(m.response);
    resolve?.(m.ok ? m.value : []);
    return;
  }
  if (typeof m.call !== "number" || typeof m.method !== "string") return;
  const call = m.call;
  handle(frame, m.method, Array.isArray(m.args) ? m.args : []).then(
    (value) => post(frame, { reply: call, ok: true, value: value ?? null }),
    (err) => post(frame, { reply: call, ok: false, error: String(err?.message ?? err) }),
  );
}

async function handle(frame: Frame, method: string, args: unknown[]): Promise<unknown> {
  const { addon } = frame;
  switch (method) {
    case "ready":
      frame.ready = true;
      return { id: addon.id, version: addon.version, settings: JSON.parse(frame.config) };
    case "notify": {
      need(frame, "notify");
      const now = Date.now();
      if (now - frame.lastNotice < NOTICE_GAP_MS) throw new Error("too many notices");
      frame.lastNotice = now;
      const n = (args[0] ?? {}) as Record<string, unknown>;
      noticeSink?.({ addon, title: text(n.title, 60), detail: text(n.detail, 120) });
      return;
    }
    case "activity": {
      need(frame, "notify");
      const a = args[0] as Record<string, unknown> | null;
      if (!a || typeof a !== "object") activities.delete(addon.id);
      else {
        const progress = typeof a.progress === "number" ? Math.min(1, Math.max(0, a.progress)) : null;
        activities.set(addon.id, {
          addon,
          at: activities.get(addon.id)?.at ?? Date.now(),
          title: text(a.title, 60),
          detail: a.detail == null ? undefined : text(a.detail, 60),
          progress,
          icon: typeof a.icon === "string" ? a.icon : undefined,
        });
      }
      changed();
      return;
    }
    case "render":
      if (!addon.tab) throw new Error('the manifest has no "tab"');
      views.set(addon.id, args[0]);
      changed();
      return;
    case "copy":
      need(frame, "clipboard");
      return invoke("addons_copy", { text: text(args[0], 100_000) });
    case "open": {
      need(frame, "links");
      const url = text(args[0], 4000);
      if (!/^https?:\/\//i.test(url)) throw new Error("only http(s) links");
      return invoke("launcher_open_url", { url });
    }
    case "fetch":
      need(frame, "network");
      return invoke("addons_fetch", { id: addon.id, request: args[0] });
    case "storage.get":
      return (await store(addon.id))[text(args[0])] ?? null;
    case "storage.set": {
      const key = text(args[0]);
      const data = { ...(await store(addon.id)) };
      if (args[1] == null) delete data[key];
      else data[key] = args[1];
      stores.set(addon.id, Promise.resolve(data));
      const write = (writes.get(addon.id) ?? Promise.resolve())
        .catch(() => {})
        .then(() => invoke("addons_storage_set", { id: addon.id, data }));
      writes.set(addon.id, write);
      return write;
    }
    case "media":
      need(frame, "media");
      return media;
    case "foreground":
      need(frame, "foreground");
      return invoke("addons_front");
    case "hotkeys.pause":
      need(frame, "hotkeys");
      frame.pausing = args[0] === true;
      syncBackend();
      return;
    default:
      throw new Error(`unknown method ${method}`);
  }
}

function store(id: string) {
  let s = stores.get(id);
  if (!s) {
    s = invoke<Record<string, unknown>>("addons_storage_get", { id });
    stores.set(id, s);
  }
  return s;
}
