import { RefObject, useEffect, useRef } from "react";
import { audioLevels } from "./useAudioLevels";
import { useCanvasLoop } from "../island/useCanvasLoop";

/** The glow's two colours as they are right now (they fade between album arts). */
function useGlowColors() {
  const colors = useRef({ a: "rgb(247, 178, 103)", b: "rgb(242, 92, 84)", at: 0 });
  return (now: number) => {
    const c = colors.current;
    if (now - c.at > 0.25) {
      const style = getComputedStyle(document.documentElement);
      c.a = style.getPropertyValue("--glow-a").trim() || c.a;
      c.b = style.getPropertyValue("--glow-b").trim() || c.b;
      c.at = now;
    }
    return c;
  };
}

/** Each band's wave: how many humps across the trace, how fast it runs, how tall it may get. */
const SCOPE_WAVES = [
  { k: 1.15, speed: 3.1, gain: 0.95 },
  { k: 2.6, speed: -5.3, gain: 0.6 },
  { k: 5.2, speed: 8.4, gain: 0.4 },
  { k: 7.4, speed: -11.2, gain: 0.18 },
];

/**
 * "Осциллограф": a glowing wave in place of the equaliser bars, its humps
 * driven by the four bands (bass the long ones, highs the ripples). Without
 * live audio it sways on its own while music plays and goes flat on pause.
 */
export function Scope({ playing, reactive }: { playing: boolean; reactive: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const amps = useRef([0, 0, 0, 0]);
  const glow = useGlowColors();
  /** Colours of the last frame drawn. */
  const drawn = useRef({ a: "", b: "" });

  // On pause the trace settles flat; from then on it stays as drawn until the
  // music or the glow's colours change, rather than being redrawn every frame.
  const still = (t: number) => {
    if (playing || reactive || amps.current.some((v) => v !== 0)) return false;
    const { a, b } = glow(t);
    return a === drawn.current.a && b === drawn.current.b;
  };

  useCanvasLoop(ref, (ctx, w, h, dt, t) => {
    const a = amps.current;
    for (let i = 0; i < 4; i++) {
      const target = reactive
        ? audioLevels.bands[i]
        : playing
          ? 0.35 + 0.25 * Math.sin(t * (1.3 + i * 0.7) + i * 1.9)
          : 0;
      // Quick to rise, slower to settle, like the bars.
      const rate = target > a[i] ? 18 : 6;
      a[i] += (target - a[i]) * Math.min(1, rate * dt);
      // Below a hundredth of a pixel: flat.
      if (target === 0 && Math.abs(a[i]) < 1e-3) a[i] = 0;
    }
    const lift = reactive ? 1 + 0.5 * audioLevels.beat : 1;
    const { a: ca, b: cb } = glow(t);
    drawn.current = { a: ca, b: cb };
    const mid = h / 2;
    const room = mid - 2;

    const trace = (shift: number) => {
      ctx.beginPath();
      const steps = Math.max(24, Math.round(w));
      for (let s = 0; s <= steps; s++) {
        const x = s / steps;
        // Pinned to the middle at both ends, so it reads as one contained trace.
        const env = Math.pow(Math.sin(Math.PI * x), 0.7);
        let v = 0;
        SCOPE_WAVES.forEach((wave, i) => {
          v += a[i] * wave.gain * Math.sin(2 * Math.PI * wave.k * x + t * wave.speed + shift * (i + 1));
        });
        const y = mid - Math.max(-1, Math.min(1, v * lift)) * room * env;
        if (s === 0) ctx.moveTo(x * w, y);
        else ctx.lineTo(x * w, y);
      }
    };

    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, ca);
    gradient.addColorStop(0.5, cb);
    gradient.addColorStop(1, ca);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = gradient;

    // A fainter echo a little out of phase gives it depth.
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    trace(1.7);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.7;
    ctx.shadowColor = cb;
    ctx.shadowBlur = 5;
    trace(0);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, true, still);

  return <canvas ref={ref} className="scope" aria-hidden />;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  /** The glow's first or second colour, or white-hot. */
  color: 0 | 1 | 2;
}

/** Shortest gap between two bursts, s. */
const SPARK_GAP = 0.11;
const MAX_SPARKS = 220;

/**
 * "Частицы": on each kick, sparks burst out of the island's outline and fly
 * off, fading as they slow down. Drawn on a canvas behind the island, so
 * they seem to come out from under its edge.
 */
export function BeatSparks({ island, active }: { island: RefObject<HTMLElement | null>; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sparks = useRef<Spark[]>([]);
  const last = useRef({ beat: 0, burst: 0 });
  const glow = useGlowColors();
  useEffect(() => {
    if (!active) sparks.current = [];
  }, [active]);

  useCanvasLoop(ref, (ctx, _w, _h, dt, t) => {
    const el = island.current;
    const canvas = ref.current;
    const list = sparks.current;
    if (el && canvas) {
      const beat = audioLevels.beat;
      const rising = beat - last.current.beat;
      last.current.beat = beat;
      if (beat > 0.25 && rising > 0.08 && t - last.current.burst > SPARK_GAP) {
        last.current.burst = t;
        const box = el.getBoundingClientRect();
        const origin = canvas.getBoundingClientRect();
        burst(list, box.left - origin.left, box.top - origin.top, box.width, box.height, beat);
      }
    }

    const drag = Math.exp(-2.6 * dt);
    const { a, b } = glow(t);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) {
        list.splice(i, 1);
        continue;
      }
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const fade = Math.pow(1 - p.age / p.life, 1.4);
      ctx.globalAlpha = fade;
      ctx.strokeStyle = p.color === 2 ? "#fff6ee" : p.color ? b : a;
      ctx.lineWidth = p.size;
      // A short tail along the way it flies.
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }, active);

  return <canvas ref={ref} className="beat-sparks" aria-hidden />;
}

/** Adds a burst of sparks spread around a capsule's outline, flying outward. */
function burst(list: Spark[], left: number, top: number, w: number, h: number, beat: number) {
  const r = h / 2;
  const straight = Math.max(0, w - 2 * r);
  const perimeter = 2 * straight + 2 * Math.PI * r;
  const count = Math.round(5 + 14 * beat);
  for (let n = 0; n < count && list.length < MAX_SPARKS; n++) {
    // A point on the outline and the outward direction there.
    let d = Math.random() * perimeter;
    let x: number, y: number, nx: number, ny: number;
    if (d < straight) {
      x = left + r + d;
      y = top + h;
      nx = 0;
      ny = 1;
    } else if ((d -= straight) < Math.PI * r) {
      const angle = Math.PI / 2 - d / r; // the right end, bottom to top
      nx = Math.cos(angle);
      ny = Math.sin(angle);
      x = left + w - r + nx * r;
      y = top + r + ny * r;
    } else if ((d -= Math.PI * r) < straight) {
      x = left + w - r - d;
      y = top;
      nx = 0;
      ny = -1;
    } else {
      d -= straight;
      const angle = -Math.PI / 2 - d / r; // the left end, top to bottom
      nx = Math.cos(angle);
      ny = Math.sin(angle);
      x = left + r + nx * r;
      y = top + r + ny * r;
    }
    const speed = 45 + (60 + 120 * beat) * Math.random();
    const side = (Math.random() - 0.5) * 40;
    list.push({
      x,
      y,
      vx: nx * speed - ny * side,
      vy: ny * speed + nx * side,
      age: 0,
      life: 0.45 + 0.6 * Math.random(),
      size: 0.8 + 1.6 * Math.random(),
      color: Math.random() < 0.25 ? 2 : Math.random() < 0.5 ? 0 : 1,
    });
  }
}
