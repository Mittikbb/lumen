import { useEffect, useRef } from "react";
import { MotionValue, animate, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { HEADPHONES } from "./CallPanel";
import type { Voice } from "./useDiscord";

/** Gap between the popped-out drop and the island. */
const GAP = 14;
/**
 * The neck holds until the drop is this far from the island, then snaps and
 * the drop springs back to GAP: it takes a little pull to tear it off.
 */
const BREAK = 30;
/** Neck at its thickest, as a share of the drop. */
const NECK = 0.56;
/** How far the island's left content gets nudged while the drop squeezes out. */
const PUSH = 7;
/** The pointer this close to the drop's centre makes it pop out. */
const NEAR = 120;

export type DropState = "rest" | "out" | "merged";

/** The drop's geometry for an island of `width` centred at `center`, top at `top`. */
export function dropGeometry(center: number, top: number, width: number, size: number) {
  const islandLeft = center - width / 2;
  return {
    islandLeft,
    // Centre of the popped-out drop.
    cx: islandLeft - GAP - size / 2,
    cy: top + size / 2,
  };
}

/** Where the pointer is relative to the drop: near enough to pop it out, or on it. */
export function dropHover(
  cursor: { x: number; y: number } | null,
  geometry: { cx: number; cy: number },
  size: number,
) {
  const distance = cursor ? Math.hypot(cursor.x - geometry.cx, cursor.y - geometry.cy) : Infinity;
  return { near: distance < NEAR, over: distance < size / 2 + 6 };
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

/**
 * The drop's motion, shared by all of its layers. At rest it hides inside the
 * island's left end. Popping out, it squeezes through that edge (nudging the
 * cover aside), drags a neck that thins as it stretches, tears off at BREAK
 * and springs back to its spot; coming back the neck reforms and it melts in.
 */
export function useDropMotion(state: DropState, islandLeft: number, size: number, reduced: boolean) {
  const restX = islandLeft + size * 0.15;
  const outX = islandLeft - GAP - size;
  const x = useMotionValue(restX);
  const scale = useMotionValue(0.8);
  const opacity = useMotionValue(1);
  const face = useMotionValue(0);
  const neck = useMotionValue(0);
  const attached = useRef(true);
  const left = useRef(islandLeft);
  left.current = islandLeft;

  // The neck and the face follow where the drop is.
  useEffect(
    () =>
      x.on("change", (v) => {
        // Gap between the drop's right edge (its scale origin) and the island.
        const gap = left.current - (v + size);
        if (attached.current && gap > BREAK) {
          attached.current = false;
          animate(neck, 0, { duration: reduced ? 0 : 0.09, ease: "easeIn" }); // snap
        } else if (!attached.current && gap < 2) {
          attached.current = true;
        }
        if (attached.current) {
          // Grows as the drop squeezes through the edge, thins as it stretches.
          const through = clamp01((gap + size * 0.7) / (size * 0.7));
          const stretch = Math.sqrt(clamp01(1 - gap / BREAK));
          neck.set(size * NECK * Math.min(through, stretch));
        }
        face.set(clamp01((gap + size * 0.35) / (size * 0.45)));
      }),
    [x, neck, face, size, reduced],
  );

  useEffect(() => {
    const instant = { duration: 0 };
    const settle = { type: "spring", stiffness: 300, damping: 24 } as const;
    const running =
      state === "out"
        ? [
            attached.current && !reduced
              ? // Pulled against the neck, slowing as it stretches, then torn
                // free and bouncing back to its spot.
                animate(x, [x.get(), islandLeft - BREAK - 2 - size, outX], {
                  duration: 0.7,
                  times: [0, 0.68, 1],
                  ease: ["easeOut", "backOut"],
                })
              : animate(x, outX, reduced ? instant : settle),
            animate(scale, 1, reduced ? instant : settle),
            animate(opacity, 1, instant),
          ]
        : [
            animate(x, state === "merged" ? islandLeft + size / 2 : restX, reduced ? instant : settle),
            animate(scale, state === "merged" ? 0.4 : 0.8, reduced ? instant : settle),
            animate(opacity, state === "merged" ? 0 : 1, reduced ? instant : { duration: 0.25 }),
          ];
    return () => running.forEach((a) => a.stop());
  }, [state, islandLeft, size, reduced, x, scale, opacity, outX, restX]);

  // The cover nudged aside while the drop squeezes out, gliding back after.
  const push = useSpring(useTransform(neck, [0, size * NECK], [0, PUSH]), { stiffness: 400, damping: 30 });

  return { x, scale, opacity, face, neck, push, size };
}

export type DropMotion = ReturnType<typeof useDropMotion>;

type Lean = { x: MotionValue<number>; y: MotionValue<number> };

/**
 * "Капля": a Discord call as a round drop that flows out of the island's left
 * end, like the second activity on an iPhone. It is drawn in layers (see
 * Island.tsx): `halo` glows, `fill` is the plain twin melted with the island
 * in the liquid layer, `face` shows who talks. `solid` is all in one, for
 * reduced motion, where there is no liquid layer.
 */
export function CallDrop({ voice, motion: m, top, lean, layer }: {
  voice: Voice;
  motion: DropMotion;
  top: number;
  /** The island's lean toward the pointer; the drop sways along, keeping its gap. */
  lean: Lean;
  layer: "halo" | "fill" | "face" | "solid";
}) {
  const speaker = voice.members.find((member) => member.speaking);
  const showsFace = layer === "face" || layer === "solid";
  return (
    <motion.div className="call-drop-lean" style={{ x: lean.x, y: lean.y }} exit={{ opacity: 0 }}>
      <motion.div
        className={`call-drop ${layer}${speaker ? " speaking" : ""}`}
        style={{
          top,
          width: m.size,
          height: m.size,
          originX: 1,
          x: m.x,
          scale: m.scale,
          opacity: layer === "face" ? m.face : m.opacity,
        }}
        aria-hidden
      >
        {showsFace && (speaker ? <img src={speaker.avatar} alt="" draggable={false} /> : HEADPHONES)}
      </motion.div>
    </motion.div>
  );
}

/** The neck between the drop and the island, in the liquid layer. */
export function DropNeck({ motion: m, top, islandLeft, lean }: {
  motion: DropMotion;
  top: number;
  islandLeft: number;
  lean: Lean;
}) {
  const at = useRef({ top, islandLeft });
  at.current = { top, islandLeft };
  // From the drop's centre into the island's rounded end.
  const left = useTransform(m.x, (x) => x + m.size / 2);
  const width = useTransform(m.x, (x) => Math.max(0, at.current.islandLeft + m.size * 0.3 - x - m.size / 2));
  const y = useTransform(m.neck, (n) => at.current.top + (m.size - n) / 2);
  return (
    <motion.div className="call-drop-lean" style={{ x: lean.x, y: lean.y }} exit={{ opacity: 0 }}>
      <motion.div className="drop-neck" style={{ left, top: y, width, height: m.neck }} />
    </motion.div>
  );
}
