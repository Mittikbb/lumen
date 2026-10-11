import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Mode = "shot" | "text";

const HINTS: Record<Mode, string> = {
  shot: "Выдели область — снимок сразу в буфере",
  text: "Выдели текст — распознаю и скопирую",
};

/** Smaller drags are treated as a click and cancel the capture. */
const MIN_SIZE = 4;

interface Point {
  x: number;
  y: number;
}

/**
 * Full-screen selection layer: the screen dims, the dragged-out area stays
 * clear with its size shown next to it. Release to capture, right-click or
 * Esc to cancel.
 */
export function CaptureOverlay() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("capture-root");
    // The mode may have been set before this window finished loading.
    invoke<Mode | null>("capture_mode").then(setMode);
    const unlisten = listen<Mode>("lumen://capture", (e) => {
      setMode(e.payload);
      setStart(null);
      setEnd(null);
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  const rect =
    start && end
      ? {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          w: Math.abs(end.x - start.x),
          h: Math.abs(end.y - start.y),
        }
      : null;

  const reset = () => {
    setStart(null);
    setEnd(null);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) {
      reset();
      invoke("capture_cancel");
      return;
    }
    if (e.button !== 0) return;
    setStart({ x: e.clientX, y: e.clientY });
    setEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (start) setEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseUp = () => {
    if (!rect) return;
    reset();
    if (rect.w < MIN_SIZE || rect.h < MIN_SIZE) {
      invoke("capture_cancel");
    } else {
      invoke("capture_finish", { selection: rect });
    }
  };

  return (
    <div
      className={`capture${rect ? " selecting" : ""}`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {!rect && mode && (
        <div className="capture-hint">
          {HINTS[mode]}
          <kbd>Esc</kbd>
        </div>
      )}
      {rect && (
        <>
          <div className="capture-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
          <div
            className="capture-size"
            style={{ left: rect.x, top: rect.y > 28 ? rect.y - 26 : rect.y + rect.h + 6 }}
          >
            {Math.round(rect.w * devicePixelRatio)} × {Math.round(rect.h * devicePixelRatio)}
          </div>
        </>
      )}
    </div>
  );
}
