import { RefObject, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./env";

/** Pointer travel (px) after which a Ctrl + press counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;

/**
 * Ctrl + drag moves the island anywhere on any monitor. The window follows
 * the pointer; on release the backend remembers the spot and docks there.
 * The window never has keyboard focus, so Ctrl is read off pointer events.
 */
export function useIslandDrag(island: RefObject<HTMLElement | null>) {
  const [dragging, setDragging] = useState(false);
  const [ctrl, setCtrl] = useState(false);
  const drag = useRef<{ startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  // One move request at a time, carrying whatever the pointer added meanwhile.
  const pending = useRef({ dx: 0, dy: 0 });
  const sending = useRef<Promise<unknown> | null>(null);
  const flush = () => {
    if (sending.current) return;
    const { dx, dy } = pending.current;
    if (!dx && !dy) return;
    pending.current = { dx: 0, dy: 0 };
    sending.current = invoke("overlay_drag_by", { dx, dy })
      .catch(() => {})
      .finally(() => {
        sending.current = null;
        flush();
      });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.ctrlKey || e.button !== 0 || !isTauri) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { startX: e.screenX, startY: e.screenY, lastX: e.screenX, lastY: e.screenY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    invoke("overlay_drag_start");
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      if (e.ctrlKey !== ctrl) setCtrl(e.ctrlKey);
      return;
    }
    e.preventDefault();
    pending.current.dx += e.screenX - d.lastX;
    pending.current.dy += e.screenY - d.lastY;
    d.lastX = e.screenX;
    d.lastY = e.screenY;
    if (Math.hypot(e.screenX - d.startX, e.screenY - d.startY) > DRAG_THRESHOLD) d.moved = true;
    flush();
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    if (d.moved) {
      // Swallow the click that follows the release.
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 150);
    }
    // Let the last moves land before reading where the island ended up.
    while (sending.current) await sending.current;
    // Layout box, without the lean and bump transforms.
    const el = island.current;
    if (el) await invoke("overlay_drag_end", { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop }).catch(() => {});
    setDragging(false);
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (e.ctrlKey || justDragged.current) {
      e.preventDefault();
      e.stopPropagation();
      justDragged.current = false;
    }
  };

  return { dragging, ctrl, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture } };
}
