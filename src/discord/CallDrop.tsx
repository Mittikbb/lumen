import { motion } from "motion/react";
import { HEADPHONES } from "./CallPanel";
import type { Voice } from "./useDiscord";

/** Gap between the popped-out drop and the island. */
const GAP = 8;
/** How much of the resting drop shows from behind the island's left edge, and its size then. */
const PEEK = 12;
const PEEK_SCALE = 0.82;
/** The pointer this close to the drop's centre makes it pop out. */
const NEAR = 120;

export type DropState = "peek" | "out" | "merged";

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
 * "Капля": a Discord call as a round drop beside the island, like the second
 * activity on an iPhone. It peeks from behind the island's left edge, pops
 * out when the pointer comes close and flows into the island on hover.
 */
export function CallDrop({ voice, state, top, islandLeft, size, reduced }: {
  voice: Voice;
  state: DropState;
  top: number;
  islandLeft: number;
  size: number;
  reduced: boolean;
}) {
  const speaker = voice.members.find((m) => m.speaking);
  const x =
    state === "out"
      ? islandLeft - GAP - size
      : state === "peek"
        ? // Scaled from its right edge, so shift by what the scale takes off.
          islandLeft - PEEK - (1 - PEEK_SCALE) * size
        : islandLeft + size / 2;
  return (
    <motion.div
      className={`call-drop${speaker ? " speaking" : ""}`}
      style={{ top, width: size, height: size, originX: 1 }}
      // A call started: the drop flows out of the island.
      initial={{ x: islandLeft, scale: 0, opacity: 0 }}
      animate={{
        x,
        scale: state === "out" ? 1 : state === "peek" ? PEEK_SCALE : 0.4,
        opacity: state === "merged" ? 0 : 1,
      }}
      // The call ended: the drop shrinks back into the island.
      exit={{ x: islandLeft, scale: 0, opacity: 0 }}
      // A soft, bouncy spring: the drop wobbles as it pops out.
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 460, damping: 17, mass: 0.8 }}
      aria-hidden
    >
      {speaker ? <img src={speaker.avatar} alt="" draggable={false} /> : HEADPHONES}
    </motion.div>
  );
}
