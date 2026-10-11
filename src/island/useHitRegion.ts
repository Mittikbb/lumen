import { RefObject, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./env";

/**
 * Keeps the Rust side informed about where the island is, so the window only
 * catches the mouse over the island and lets clicks through everywhere else.
 */
export function useHitRegion(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!isTauri) return;
    let frame = 0;
    let last = "";

    const tick = () => {
      const el = ref.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const rect = {
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
        const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
        if (key !== last) {
          last = key;
          invoke("set_hit_region", { rect });
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ref]);
}
