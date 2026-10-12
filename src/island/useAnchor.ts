import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./env";

/** Where a dragged island sits inside the window: centre `x`, top `y` (CSS px). */
export interface Anchor {
  x: number;
  y: number;
}

/** Null while the island keeps its usual place, centred at the top. */
export function useAnchor(): Anchor | null {
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    invoke<Anchor | null>("overlay_anchor").then(setAnchor);
    const unlisten = listen<Anchor | null>("lumen://anchor", (e) => setAnchor(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  return anchor;
}
