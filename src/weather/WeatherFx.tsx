import { useRef } from "react";
import { useCanvasLoop } from "../island/useCanvasLoop";
import type { Precipitation } from "./conditions";

interface Flake {
  /** 0..1 across and down the capsule, so a resize doesn't bunch them up. */
  x: number;
  y: number;
  /** Fall speed, px/s. */
  speed: number;
  size: number;
  alpha: number;
  phase: number;
}

/** Drops (or flakes) per 220 px of capsule, light to heavy. */
const DENSITY = { drizzle: [12, 26], rain: [12, 32], snow: [12, 28] };
/** Rain falls slanted: this much sideways per px down. */
const SLANT = 0.28;

const flake = (kind: Precipitation["kind"], top: boolean): Flake => ({
  x: Math.random() * 1.2 - 0.1,
  y: top ? -Math.random() * 0.3 : Math.random(),
  speed: kind === "snow" ? 7 + 9 * Math.random() : kind === "drizzle" ? 38 + 22 * Math.random() : 55 + 35 * Math.random(),
  size: kind === "snow" ? 0.7 + 0.9 * Math.random() : kind === "drizzle" ? 1.5 + 1.5 * Math.random() : 4 + 4 * Math.random(),
  alpha: kind === "snow" ? 0.45 + 0.4 * Math.random() : 0.24 + 0.26 * Math.random(),
  phase: Math.random() * Math.PI * 2,
});

/**
 * Light rain or snow falling inside the collapsed capsule, under its content,
 * while the weather outside does the same. Thunderstorms flash now and then.
 */
export function WeatherFx({ fx }: { fx: Precipitation }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const flakes = useRef<{ kind: string; list: Flake[] }>({ kind: "", list: [] });
  const flash = useRef({ next: 3 + Math.random() * 4, at: -10 });

  useCanvasLoop(ref, (ctx, w, h, dt, t) => {
    const [few, many] = DENSITY[fx.kind];
    const count = Math.round((w / 220) * (few + (many - few) * fx.amount));
    const store = flakes.current;
    if (store.kind !== fx.kind) store.list = [];
    store.kind = fx.kind;
    while (store.list.length < count) store.list.push(flake(fx.kind, false));
    store.list.length = Math.min(store.list.length, count);

    ctx.lineCap = "round";
    for (let i = 0; i < store.list.length; i++) {
      const p = store.list[i];
      p.y += (p.speed * dt) / h;
      if (p.y > 1.15) store.list[i] = flake(fx.kind, true);
      let x = p.x * w;
      const y = p.y * h;
      if (fx.kind === "snow") {
        x += Math.sin(t * 1.3 + p.phase) * 5;
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = "#f4f6ff";
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // The slant drifts the drop sideways as it falls.
        x += p.y * h * SLANT;
        ctx.globalAlpha = p.alpha;
        ctx.strokeStyle = "#cfe0ff";
        ctx.lineWidth = fx.kind === "drizzle" ? 1 : 1.1;
        ctx.beginPath();
        ctx.moveTo(x - p.size * SLANT, y - p.size);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }

    // Lightning: a double flicker every few seconds.
    if (fx.storm) {
      const f = flash.current;
      if (t > f.next) {
        f.at = t;
        f.next = t + 4 + Math.random() * 6;
      }
      const since = t - f.at;
      const glow = since < 0.12 ? 1 - since / 0.12 : since > 0.16 && since < 0.42 ? 0.7 * (1 - (since - 0.16) / 0.26) : 0;
      if (glow > 0) {
        ctx.globalAlpha = 0.16 * glow;
        ctx.fillStyle = "#dfe6ff";
        ctx.fillRect(0, 0, w, h);
      }
    }
    ctx.globalAlpha = 1;
  });

  return <canvas ref={ref} className="weather-fx" aria-hidden />;
}
