import { motion } from "motion/react";
import { Drop, DropLayer, DropMotion, Lean, textWidth } from "../island/Drop";
import type { KeyboardEvent } from "./useDeviceEvents";

const LOCK = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const FONT = "700 12px";

/** What the drop says: the layout, or Caps Lock's state. */
const caption = (e: Pick<KeyboardEvent, "kind" | "layout" | "caps">) =>
  e.kind === "layout" ? e.layout : e.caps ? "CAPS" : "abc";

/** The drop's width: round when the text fits (RU, EN, abc), a pill for CAPS. */
export function keyboardWidth(size: number, e: Pick<KeyboardEvent, "kind" | "layout" | "caps"> | null) {
  if (!e) return size;
  const text = textWidth(caption(e), FONT) + (e.kind === "caps" && e.caps ? 18 : 0);
  return text + 14 <= size ? size : text + 24;
}

/**
 * The keyboard layout (RU, EN…) or Caps Lock (CAPS / abc) as a drop that
 * flows out of the island's bottom edge for a moment (see Drop).
 */
export function KeyboardDrop({ event, motion: m, lean, layer }: {
  event: Pick<KeyboardEvent, "kind" | "layout" | "caps">;
  motion: DropMotion;
  lean: Lean;
  layer: DropLayer;
}) {
  const caps = event.kind === "caps";
  // Text wider than the round drop shows as the pill opens, not before.
  const pill = keyboardWidth(m.size, event) > m.size;
  return (
    <Drop motion={m} lean={lean} layer={layer} className={`keyboard-drop${caps ? (event.caps ? " caps-on" : " caps-off") : ""}`}>
      <motion.span className="keyboard-face" style={{ opacity: pill ? m.label : 1 }}>
        {caps && event.caps && LOCK}
        {caption(event)}
      </motion.span>
    </Drop>
  );
}
