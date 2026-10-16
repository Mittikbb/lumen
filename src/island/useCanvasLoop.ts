import { RefObject, useEffect, useRef } from "react";

/**
 * Sizes a canvas to its CSS box at the screen's pixel density and runs `draw`
 * every frame while mounted. `draw` gets the 2D context (in CSS px), the box
 * size, the seconds since the last frame and the time in seconds.
 * Only loops while `running`. `still`, asked before each frame with the time
 * in seconds, may answer true to keep the last picture instead of drawing the
 * same one again.
 */
export function useCanvasLoop(
  ref: RefObject<HTMLCanvasElement | null>,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, now: number) => void,
  running = true,
  still?: (now: number) => boolean,
) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const stillRef = useRef(still);
  stillRef.current = still;
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !running) return;
    let frame = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    // Resizing wipes the canvas, so the next frame is drawn either way.
    let wiped = true;
    const fit = () => {
      wiped = true;
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(canvas);
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!wiped && stillRef.current?.(now / 1000)) {
        frame = requestAnimationFrame(tick);
        return;
      }
      wiped = false;
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, w, h, dt, now / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      ctx.clearRect(0, 0, w, h);
    };
  }, [ref, running]);
}
