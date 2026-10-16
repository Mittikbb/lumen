import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./env";

/** Cursor position in window CSS pixels, streamed by the Rust tracker. */
export interface Cursor {
  x: number;
  y: number;
  inside: boolean;
}

/**
 * Calls `onCursor` with every cursor update (~60 a second while the pointer
 * is near the island), outside React state, so following the pointer
 * doesn't re-render anything by itself.
 */
export function useCursorListener(onCursor: (cursor: Cursor) => void) {
  const handler = useRef(onCursor);
  handler.current = onCursor;

  useEffect(() => {
    const call = (cursor: Cursor) => handler.current(cursor);
    if (!isTauri) return browserCursor(call);
    const unlisten = listen<Cursor>("lumen://cursor", (e) => call(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);
}

/** Browser preview: derive the same events from mousemove. */
function browserCursor(set: (c: Cursor) => void) {
  const onMove = (e: MouseEvent) => {
    const r = document.querySelector(".island")?.getBoundingClientRect();
    const inside =
      !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    set({ x: e.clientX, y: e.clientY, inside });
  };
  window.addEventListener("mousemove", onMove);
  return () => window.removeEventListener("mousemove", onMove);
}
