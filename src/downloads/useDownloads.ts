import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";

/** A file a browser is downloading into the Downloads folder. */
export interface Download {
  id: string;
  /** Its name once the browser has chosen it. */
  name: string | null;
  bytes: number;
  /** Bytes per second. */
  speed: number;
}

/** A download that just finished. */
export interface Finished {
  name: string;
  path: string;
  bytes: number;
}

/** How long the island says a download is in. */
const DONE_MS = 4500;

/**
 * Downloads in progress and the one that just finished, from the backend's
 * watch on the Downloads folder (which only runs while switched on).
 */
export function useDownloads(): { active: Download[]; done: Finished | null } {
  const [active, setActive] = useState<Download[]>([]);
  const [done, setDone] = useState<Finished | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    const unlisten = [
      listen<Download[]>("lumen://downloads", (e) => setActive(e.payload)),
      listen<Finished>("lumen://download-done", (e) => setDone(e.payload)),
    ];
    return () => {
      unlisten.forEach((u) => u.then((off) => off()));
    };
  }, []);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), DONE_MS);
    return () => clearTimeout(t);
  }, [done]);

  return { active, done };
}

export const revealDownload = (path: string) => isTauri && invoke("downloads_reveal", { path });

/** "820 КБ", "12,4 МБ", "1,2 ГБ". */
export function formatBytes(bytes: number) {
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value < 10 && unit > 0 ? 1 : 0;
  return `${value.toFixed(digits).replace(".", ",")} ${units[unit]}`;
}
