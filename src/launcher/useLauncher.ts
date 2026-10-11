import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";

export interface App {
  name: string;
  /** Start menu AppID. */
  id: string;
}

export const launcher = {
  open: () => isTauri && invoke("launcher_open"),
  close: (restoreFocus: boolean) => isTauri && invoke("launcher_close", { restoreFocus }),
  run: (id: string) => isTauri && invoke("launcher_run", { id }),
  openUrl: (url: string) => isTauri && invoke("launcher_open_url", { url }),
  copy: (text: string) => isTauri && invoke("launcher_copy", { text }),
  askAi: (id: string, question: string) => isTauri && invoke("launcher_ask_ai", { id, question }),
};

/** Whether the launcher is open (Alt+Space or the search tab). */
export function useLauncherOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<boolean>("lumen://launcher", (e) => setOpen(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  return open;
}

/**
 * Installed apps, the known AI apps among them and the one to open, refreshed
 * when the backend reloads the list or the AI app is changed in settings.
 */
export function useApps(): { apps: App[]; ai: App | null; aiApps: App[] } {
  const [apps, setApps] = useState<App[]>([]);
  const [ai, setAi] = useState<App | null>(null);
  const [aiApps, setAiApps] = useState<App[]>([]);

  useEffect(() => {
    if (!isTauri) return;
    const load = () => {
      invoke<App[]>("launcher_apps").then(setApps);
      invoke<App | null>("launcher_ai_app").then(setAi);
      invoke<App[]>("launcher_ai_apps").then(setAiApps);
    };
    load();
    const unlisten = [listen("lumen://apps", load), listen("lumen://settings", load)];
    return () => {
      unlisten.forEach((u) => u.then((off) => off()));
    };
  }, []);

  return { apps, ai, aiApps };
}

/** Icons already fetched this session (null = the app has none). */
const iconCache = new Map<string, string | null>();

/** The app's icon as a data URL, or null while loading / when there is none. */
export function useAppIcon(id: string): string | null {
  const [icon, setIcon] = useState(() => iconCache.get(id) ?? null);

  useEffect(() => {
    if (!isTauri) return;
    if (iconCache.has(id)) {
      setIcon(iconCache.get(id)!);
      return;
    }
    let alive = true;
    invoke<string | null>("launcher_icon", { id }).then((url) => {
      iconCache.set(id, url);
      if (alive) setIcon(url);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  return icon;
}
