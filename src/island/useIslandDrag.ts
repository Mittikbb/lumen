import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./env";

export function useIslandDrag() {
  const [dragging, setDragging] = useState(false);
  const [ctrlDown, setCtrlDown] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const justDraggedRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control") setCtrlDown(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") setCtrlDown(false);
    };
    const handleBlur = () => setCtrlDown(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const onPointerDown = async (e: React.PointerEvent) => {
    if (!e.ctrlKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    dragRef.current = {
      startX: e.screenX,
      startY: e.screenY,
      lastX: e.screenX,
      lastY: e.screenY,
      moved: false,
    };
    setDragging(true);

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    if (isTauri) {
      await invoke("overlay_start_drag");
    }
  };

  const onPointerMove = async (e: React.PointerEvent) => {
    if (!dragRef.current) {
      if (e.ctrlKey !== ctrlDown) setCtrlDown(e.ctrlKey);
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const dx = e.screenX - dragRef.current.lastX;
    const dy = e.screenY - dragRef.current.lastY;
    dragRef.current.lastX = e.screenX;
    dragRef.current.lastY = e.screenY;

    if (Math.hypot(e.screenX - dragRef.current.startX, e.screenY - dragRef.current.startY) > 3) {
      dragRef.current.moved = true;
    }

    if (isTauri && (dx !== 0 || dy !== 0)) {
      await invoke("overlay_drag_by", { dx, dy });
    }
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    if (dragRef.current.moved) {
      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 150);
    }

    dragRef.current = null;
    setDragging(false);

    if (isTauri) {
      await invoke("overlay_end_drag");
    }
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (e.ctrlKey || justDraggedRef.current || dragging) {
      e.preventDefault();
      e.stopPropagation();
      justDraggedRef.current = false;
    }
  };

  return {
    dragging,
    ctrlDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onClickCapture,
  };
}
