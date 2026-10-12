import { ReactNode, Ref, useEffect, useRef } from "react";
import { MotionValue, animate, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import type { DropPull } from "../settings/useSettings";

/** Gap between a popped-out drop and the island. */
const GAP = 14;
/**
 * The neck holds until the drop is this far from the island, then snaps and
 * the drop springs back to GAP: it takes a pull to tear it off. A tighter
 * setting stretches it further, over a longer pull.
 */
const PULLS: Record<DropPull, { breakAt: number; seconds: number }> = {
  soft: { breakAt: 18, seconds: 0.55 },
  normal: { breakAt: 30, seconds: 0.7 },
  tight: { breakAt: 46, seconds: 0.85 },
};
/** Neck at its thickest, as a share of the drop. */
const NECK = 0.56;
/** How far the island's content gets nudged while a drop squeezes out. */
const PUSH = 7;
/** A second click within this long makes it a double click. */
const DOUBLE_MS = 260;

/** `notify`: popped out and widened into a pill. */
export type DropState = "rest" | "out" | "notify" | "merged";
/** Which end of the island the drop flows out of. */
export type DropSide = "left" | "right";

/** -1 to the left of the island, +1 to the right. */
const sign = (side: DropSide) => (side === "left" ? -1 : 1);

/**
 * The drop's geometry for an island of `width` centred at `center`, top at
 * `top`: the island's end it flows out of, and the centre of the popped-out
 * drop.
 */
export function dropGeometry(center: number, top: number, width: number, size: number, side: DropSide) {
  const dir = sign(side);
  const edge = center + (dir * width) / 2;
  return { edge, cx: edge + dir * (GAP + size / 2), cy: top + size / 2 };
}

/**
 * Where the pointer is relative to the drop: within `reach` px of its centre
 * to pop it out, or on it.
 */
export function dropHover(
  cursor: { x: number; y: number } | null,
  geometry: { cx: number; cy: number },
  size: number,
  reach: number,
) {
  const distance = cursor ? Math.hypot(cursor.x - geometry.cx, cursor.y - geometry.cy) : Infinity;
  return { near: distance < reach, over: distance < size / 2 + 6 };
}

/**
 * Gooey filter for the liquid layer: blur, then cut the alpha back to a hard
 * edge, so shapes closer than ~1.5 × stdDeviation melt into one. sRGB keeps
 * the fill exactly the island's colour.
 */
export function LiquidFilter() {
  return (
    <svg className="liquid-defs" aria-hidden>
      <filter id="lumen-liquid" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="6" />
        <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" />
      </filter>
    </svg>
  );
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

let measurer: CanvasRenderingContext2D | null = null;
/** Width of `text` in the given CSS font, capped at `max`. */
export function textWidth(text: string, font: string, max = Infinity) {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return Math.min(max, text.length * 8);
  measurer.font = `${font} ${getComputedStyle(document.body).fontFamily}`;
  return Math.min(max, Math.ceil(measurer.measureText(text).width));
}

/**
 * A drop's motion, shared by all of its layers. At rest it hides inside the
 * island's end (`edge`). Popping out, it squeezes through that edge (nudging
 * the island's content aside), drags a neck that thins as it stretches, tears
 * off (see PULLS) and springs back to its spot; coming back the neck reforms
 * and it melts in. As a pill it then widens away from the island. It's
 * tracked by its inner edge, the side facing the island, so widening never
 * moves the neck.
 */
export function useDropMotion(
  state: DropState,
  edge: number,
  side: DropSide,
  size: number,
  width: number,
  pull: DropPull,
  reduced: boolean,
) {
  const { breakAt, seconds } = PULLS[pull] ?? PULLS.normal;
  const dir = sign(side);
  const restInner = edge - dir * size * 1.15;
  const outInner = edge + dir * GAP;
  const inner = useMotionValue(restInner);
  const w = useMotionValue(size);
  const scale = useMotionValue(0.8);
  const opacity = useMotionValue(1);
  const face = useMotionValue(0);
  const label = useMotionValue(0);
  const neck = useMotionValue(0);
  const attached = useRef(true);
  const at = useRef(edge);
  at.current = edge;

  // The neck and the face follow where the drop is.
  useEffect(
    () =>
      inner.on("change", (v) => {
        const gap = dir * (v - at.current);
        if (attached.current && gap > breakAt) {
          attached.current = false;
          animate(neck, 0, { duration: reduced ? 0 : 0.09, ease: "easeIn" }); // snap
        } else if (!attached.current && gap < 2) {
          attached.current = true;
        }
        if (attached.current) {
          // Grows as the drop squeezes through the edge, thins as it stretches.
          const through = clamp01((gap + size * 0.7) / (size * 0.7));
          const stretch = Math.sqrt(clamp01(1 - gap / breakAt));
          neck.set(size * NECK * Math.min(through, stretch));
        }
        face.set(clamp01((gap + size * 0.35) / (size * 0.45)));
      }),
    [inner, neck, face, size, dir, breakAt, reduced],
  );
  // A pill's text shows as it opens.
  useEffect(() => w.on("change", (v) => label.set(clamp01((v - size - 12) / 30))), [w, label, size]);

  useEffect(() => {
    const instant = { duration: 0 };
    const settle = { type: "spring", stiffness: 300, damping: 24 } as const;
    const popping = state === "out" || state === "notify";
    const running = popping
      ? [
          attached.current && !reduced
            ? // Pulled against the neck, slowing as it stretches, then torn
              // free and bouncing back to its spot.
              animate(inner, [inner.get(), edge + dir * (breakAt + 2), outInner], {
                duration: seconds,
                times: [0, 0.68, 1],
                ease: ["easeOut", "backOut"],
              })
            : animate(inner, outInner, reduced ? instant : settle),
          // A pill opens once the drop is out.
          animate(w, state === "notify" ? width : size, reduced ? instant : { ...settle, delay: state === "notify" ? 0.45 : 0 }),
          animate(scale, 1, reduced ? instant : settle),
          animate(opacity, 1, instant),
        ]
      : [
          animate(inner, state === "merged" ? edge - dir * size * 1.5 : restInner, reduced ? instant : settle),
          animate(w, size, reduced ? instant : settle),
          animate(scale, state === "merged" ? 0.4 : 0.8, reduced ? instant : settle),
          animate(opacity, state === "merged" ? 0 : 1, reduced ? instant : { duration: 0.25 }),
        ];
    return () => running.forEach((a) => a.stop());
  }, [state, edge, dir, size, width, breakAt, seconds, reduced, inner, w, scale, opacity, outInner, restInner]);

  // The element's left edge: a left drop grows leftwards from its inner edge.
  const x = useTransform(() => (dir < 0 ? inner.get() - w.get() : inner.get()));
  // The island's content nudged aside while the drop squeezes out, gliding back after.
  const push = useSpring(useTransform(neck, [0, size * NECK], [0, -dir * PUSH]), { stiffness: 400, damping: 30 });

  return { x, inner, w, scale, opacity, face, label, neck, push, size, dir };
}

export type DropMotion = ReturnType<typeof useDropMotion>;

export type Lean = { x: MotionValue<number>; y: MotionValue<number> };

/** halo: the glow; fill: the twin melted with the island; face: what it shows; solid: all in one. */
export type DropLayer = "halo" | "fill" | "face" | "solid";

/**
 * Click and double click on a drop. A single click waits out the
 * double-click window, so a double click doesn't do both. `onPoke` hears
 * every click at once.
 */
export function useDropClicks(onClick: () => void, onDoubleClick: () => void, onPoke?: () => void) {
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pending.current), []);
  return {
    onClick: () => {
      onPoke?.();
      clearTimeout(pending.current);
      pending.current = setTimeout(onClick, DOUBLE_MS);
    },
    onDoubleClick: () => {
      clearTimeout(pending.current);
      onDoubleClick();
    },
  };
}

/**
 * A drop beside the island, drawn in layers (see Island.tsx): `halo` glows,
 * `fill` is the plain twin melted with the island in the liquid layer, `face`
 * shows the content (`children`). `solid` is all in one, for reduced motion,
 * where there is no liquid layer.
 *
 * The face takes clicks while `live` (popped out); `hitRef` gets it, for the
 * window's hit region.
 */
export function Drop({ motion: m, top, lean, layer, className, live, hitRef, clicks, title, children }: {
  motion: DropMotion;
  top: number;
  /** The island's lean toward the pointer; the drop sways along, keeping its gap. */
  lean: Lean;
  layer: DropLayer;
  className?: string;
  live?: boolean;
  hitRef?: Ref<HTMLDivElement>;
  clicks?: ReturnType<typeof useDropClicks>;
  title?: string;
  children?: ReactNode;
}) {
  const showsFace = layer === "face" || layer === "solid";
  const takesClicks = showsFace && live;
  return (
    <motion.div className="drop-lean" style={{ x: lean.x, y: lean.y }} exit={{ opacity: 0 }}>
      <motion.div
        // Always attached: motion only takes a ref when it mounts.
        ref={showsFace ? hitRef : undefined}
        {...(takesClicks ? clicks : {})}
        title={takesClicks ? title : undefined}
        className={`drop-body ${layer}${className ? ` ${className}` : ""}${takesClicks ? " live" : ""}`}
        style={{
          top,
          width: m.w,
          height: m.size,
          originX: m.dir < 0 ? 1 : 0,
          x: m.x,
          scale: m.scale,
          opacity: layer === "face" ? m.face : m.opacity,
        }}
        aria-hidden
      >
        {showsFace && children}
      </motion.div>
    </motion.div>
  );
}

/** The neck between a drop and the island, in the liquid layer. */
export function DropNeck({ motion: m, top, edge, lean }: {
  motion: DropMotion;
  top: number;
  edge: number;
  lean: Lean;
}) {
  const at = useRef({ top, edge });
  at.current = { top, edge };
  // From the middle of the drop into the island's rounded end.
  const ends = (v: number) => {
    const inDrop = v + (m.dir * m.size) / 2;
    const inIsland = at.current.edge - m.dir * m.size * 0.3;
    return { inDrop, inIsland };
  };
  const left = useTransform(m.inner, (v) => {
    const { inDrop, inIsland } = ends(v);
    return Math.min(inDrop, inIsland);
  });
  const width = useTransform(m.inner, (v) => {
    const { inDrop, inIsland } = ends(v);
    return Math.max(0, m.dir * (inDrop - inIsland));
  });
  const y = useTransform(m.neck, (n) => at.current.top + (m.size - n) / 2);
  return (
    <motion.div className="drop-lean" style={{ x: lean.x, y: lean.y }} exit={{ opacity: 0 }}>
      <motion.div className="drop-neck" style={{ left, top: y, width, height: m.neck }} />
    </motion.div>
  );
}
