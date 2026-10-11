import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./env";

/** Cursor position in window CSS pixels, streamed by the Rust tracker. */
export interface Cursor {
  x: number;
  y: number;
  inside: boolean;
}

export function useCursor(): Cursor | null {
  const [cursor, setCursor] = useState<Cursor | null>(null);

  useEffect(() => {
    if (!isTauri) return browserCursor(setCursor);
    const unlisten = listen<Cursor>("lumen://cursor", (e) => setCursor(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  return cursor;
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
