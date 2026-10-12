import { RefObject, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./env";

/**
 * Keeps the Rust side informed about where the island is, so the window only
 * catches the mouse over the island and lets clicks through everywhere else.
 * `extra` are other clickable bits beside it (the drops); the island
 * itself always comes first.
 */
export function useHitRegion(ref: RefObject<HTMLElement | null>, extra: RefObject<HTMLElement | null>[] = []) {
  const others = useRef(extra);
  others.current = extra;
  useEffect(() => {
    if (!isTauri) return;
    let frame = 0;
    let last = "";

    const tick = () => {
      const el = ref.current;
      if (el) {
        const rects = [el, ...others.current.map((r) => r.current)]
          .filter((e): e is HTMLElement => !!e)
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
          });
        const key = rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join(";");
        if (key !== last) {
          last = key;
          invoke("set_hit_region", { rects });
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ref]);
}
