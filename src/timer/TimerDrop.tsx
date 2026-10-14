import { Ref } from "react";
import { motion } from "motion/react";
import { Drop, DropLayer, DropMotion, Lean, textWidth, useDropClicks } from "../island/Drop";
import { Timer, formatLeft, formatSpan, timer as timers } from "./timer";

const BELL = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />
  </svg>
);
const PAUSED = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M10 15V9M14 15V9" />
  </svg>
);

const TEXT_FONT = "600 13px";

/** What the pill says: the time left, or that it's up. */
const caption = (t: Timer, left: number) => (t.doneAt ? "Время!" : formatLeft(left));

/** The timer drop's width: the ring, then the caption. */
export function timerWidth(size: number, t: Timer | null, left: number) {
  // Every digit measured as a 0, so the pill doesn't twitch each second.
  return t ? size + textWidth(caption(t, left).replace(/\d/g, "0"), TEXT_FONT) + 14 : size;
}

/**
 * The timer as a drop out of the island's right end (see Drop): a ring that
 * empties as time runs out and the time left. Click pauses or resumes it,
 * double click cancels it; when it's up it rings and pulses until clicked.
 */
export function TimerDrop({ timer: t, left, motion: m, lean, layer, live, hitRef }: {
  timer: Timer;
  left: number;
  motion: DropMotion;
  lean: Lean;
  layer: DropLayer;
  live?: boolean;
  hitRef?: Ref<HTMLDivElement>;
}) {
  const clicks = useDropClicks(timers.toggle, timers.stop);
  const done = !!t.doneAt;
  const paused = !done && !t.endsAt;
  // A ring 72 % of the drop, like an avatar; it empties clockwise.
  const r = 11;
  const share = done ? 0 : left / t.total;
  return (
    <Drop
      motion={m}
      lean={lean}
      layer={layer}
      className={`timer-drop${done ? " done" : ""}${paused ? " paused" : ""}`}
      live={live}
      hitRef={hitRef}
      clicks={clicks}
      title={done ? "Клик — выключить" : `Таймер на ${formatSpan(t.total)} · клик — пауза, двойной клик — отменить`}
    >
      <motion.span className="timer-ring" style={{ width: m.size, height: m.size }} whileTap={live ? { scale: 0.86 } : undefined}>
        <svg viewBox="0 0 28 28" aria-hidden>
          <circle className="track" cx="14" cy="14" r={r} />
          <circle
            className="left"
            cx="14"
            cy="14"
            r={r}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - share}
            transform="rotate(-90 14 14)"
          />
        </svg>
        {done ? BELL : paused ? PAUSED : null}
      </motion.span>
      <motion.span className="timer-time" style={{ opacity: m.label }}>
        {caption(t, left)}
      </motion.span>
    </Drop>
  );
}
