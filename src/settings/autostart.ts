import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";

/** How Lumen starts with Windows; `admin`: elevated, via Task Scheduler. */
export interface Autostart {
  on: boolean;
  admin: boolean;
}

/** Autostart state, live with the tray toggle; null when it can't be changed. */
export function useAutostart(): Autostart | null {
  const [state, setState] = useState<Autostart | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    invoke<Autostart | null>("settings_autostart").then(setState);
    const unlisten = listen<Autostart>("lumen://autostart", (e) => setState(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);
  return state;
}
