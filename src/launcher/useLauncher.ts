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

/** Installed apps and the preferred AI app, refreshed when the backend reloads them. */
export function useApps(): { apps: App[]; ai: App | null } {
  const [apps, setApps] = useState<App[]>([]);
  const [ai, setAi] = useState<App | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    const load = () => {
      invoke<App[]>("launcher_apps").then(setApps);
      invoke<App | null>("launcher_ai_app").then(setAi);
    };
    load();
    const unlisten = listen("lumen://apps", load);
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  return { apps, ai };
}
