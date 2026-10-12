import { ReactNode, Ref, useEffect, useRef } from "react";
import { MotionValue, animate, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { HEADPHONES, HEADPHONES_OFF, MIC, MIC_OFF, icon } from "./CallPanel";
import type { DropPull } from "../settings/useSettings";
import type { CallEvent, CallEventKind } from "./useCallEvents";
import { discordVoice, type Voice } from "./useDiscord";

/** Gap between the popped-out drop and the island. */
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
/** How far the island's left content gets nudged while the drop squeezes out. */
const PUSH = 7;
/** Longest name an announcement shows before trailing off. */
const NAME_MAX = 110;

/** `notify`: popped out and widened into a pill that tells what happened. */
export type DropState = "rest" | "out" | "notify" | "merged";

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
/** Width of a name as the announcement draws it (12px, medium), capped. */
function nameWidth(name: string) {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return NAME_MAX;
  measurer.font = `500 12px ${getComputedStyle(document.body).fontFamily}`;
  return Math.min(NAME_MAX, Math.ceil(measurer.measureText(name).width));
}

/** The drop's width while announcing: avatar, name, the event's mark. */
export function notifyWidth(size: number, event: CallEvent | null) {
  return event ? size + nameWidth(event.member.name) + 36 : size;
}

/**
 * The drop's motion, shared by all of its layers. At rest it hides inside the
 * island's left end. Popping out, it squeezes through that edge (nudging the
 * cover aside), drags a neck that thins as it stretches, tears off (see PULLS)
 * and springs back to its spot; coming back the neck reforms and it melts in.
 * Announcing, it then widens to the left into a pill. It's tracked by its
 * right edge, the side facing the island, so widening never moves the neck.
 */
export function useDropMotion(
  state: DropState,
  islandLeft: number,
  size: number,
  width: number,
  pull: DropPull,
  reduced: boolean,
) {
  const { breakAt, seconds } = PULLS[pull] ?? PULLS.normal;
  const restRight = islandLeft + size * 1.15;
  const outRight = islandLeft - GAP;
  const right = useMotionValue(restRight);
  const w = useMotionValue(size);
  const scale = useMotionValue(0.8);
  const opacity = useMotionValue(1);
  const face = useMotionValue(0);
  const label = useMotionValue(0);
  const neck = useMotionValue(0);
  const attached = useRef(true);
  const left = useRef(islandLeft);
  left.current = islandLeft;

  // The neck and the face follow where the drop is.
  useEffect(
    () =>
      right.on("change", (r) => {
        const gap = left.current - r;
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
    [right, neck, face, size, breakAt, reduced],
  );
  // The announcement's text shows as the pill opens.
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
              animate(right, [right.get(), islandLeft - breakAt - 2, outRight], {
                duration: seconds,
                times: [0, 0.68, 1],
                ease: ["easeOut", "backOut"],
              })
            : animate(right, outRight, reduced ? instant : settle),
          // An announcement opens once the drop is out.
          animate(w, state === "notify" ? width : size, reduced ? instant : { ...settle, delay: state === "notify" ? 0.45 : 0 }),
          animate(scale, 1, reduced ? instant : settle),
          animate(opacity, 1, instant),
        ]
      : [
          animate(right, state === "merged" ? islandLeft + size * 1.5 : restRight, reduced ? instant : settle),
          animate(w, size, reduced ? instant : settle),
          animate(scale, state === "merged" ? 0.4 : 0.8, reduced ? instant : settle),
          animate(opacity, state === "merged" ? 0 : 1, reduced ? instant : { duration: 0.25 }),
        ];
    return () => running.forEach((a) => a.stop());
  }, [state, islandLeft, size, width, breakAt, seconds, reduced, right, w, scale, opacity, outRight, restRight]);

  const x = useTransform(() => right.get() - w.get());
  // The cover nudged aside while the drop squeezes out, gliding back after.
  const push = useSpring(useTransform(neck, [0, size * NECK], [0, PUSH]), { stiffness: 400, damping: 30 });

  return { x, right, w, scale, opacity, face, label, neck, push, size };
}

export type DropMotion = ReturnType<typeof useDropMotion>;

type Lean = { x: MotionValue<number>; y: MotionValue<number> };

const JOINED = icon(
  <>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <path d="M10 17l5-5-5-5M15 12H3" />
  </>,
);
const LEFT = icon(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </>,
);
const MARKS: Record<CallEventKind, { mark: ReactNode; tone: string; text: string }> = {
  join: { mark: JOINED, tone: "good", text: "вход в канал" },
  leave: { mark: LEFT, tone: "quiet", text: "выход из канала" },
  mute: { mark: MIC_OFF, tone: "bad", text: "микрофон выключен" },
  unmute: { mark: MIC, tone: "good", text: "микрофон включён" },
  deaf: { mark: HEADPHONES_OFF, tone: "bad", text: "звук выключен" },
  undeaf: { mark: HEADPHONES, tone: "good", text: "звук включён" },
};

/** A second click within this long makes it a double click. */
const DOUBLE_MS = 260;

/**
 * Click: mic on/off; double click: sound on/off. A single click waits out the
 * double-click window, so a double click doesn't flip the mic on the way.
 */
function useDropClicks(onPoke: () => void) {
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pending.current), []);
  return {
    onClick: () => {
      onPoke();
      clearTimeout(pending.current);
      pending.current = setTimeout(() => discordVoice("mute"), DOUBLE_MS);
    },
    onDoubleClick: () => {
      clearTimeout(pending.current);
      discordVoice("deaf");
    },
  };
}

/**
 * "Капля": a Discord call as a round drop that flows out of the island's left
 * end, like the second activity on an iPhone. It is drawn in layers (see
 * Island.tsx): `halo` glows, `fill` is the plain twin melted with the island
 * in the liquid layer, `face` shows who talks or what just happened. `solid`
 * is all in one, for reduced motion, where there is no liquid layer.
 *
 * The face takes clicks while `live` (popped out): see useDropClicks.
 * `hitRef` gets the face, for the window's hit region.
 */
export function CallDrop({ voice, event, motion: m, top, lean, layer, tint, live, hitRef, onPoke }: {
  voice: Voice;
  /** What the drop is announcing, if anything. */
  event: CallEvent | null;
  motion: DropMotion;
  top: number;
  /** The island's lean toward the pointer; the drop sways along, keeping its gap. */
  lean: Lean;
  layer: "halo" | "fill" | "face" | "solid";
  /** "discord" tints the drop's glow Discord blurple. */
  tint: "island" | "discord";
  live?: boolean;
  hitRef?: Ref<HTMLDivElement>;
  /** Every click, so the island can hold off opening. */
  onPoke?: () => void;
}) {
  const speaker = voice.members.find((member) => member.speaking);
  const who = event?.member ?? speaker;
  const mark = event && MARKS[event.kind];
  const showsFace = layer === "face" || layer === "solid";
  const clicks = useDropClicks(onPoke ?? (() => {}));
  const takesClicks = showsFace && live;
  // Your own mic or sound being off, unless the drop is saying just that.
  const off = voice.deaf ? "deaf" : voice.mute ? "mute" : null;
  return (
    <motion.div className="call-drop-lean" style={{ x: lean.x, y: lean.y }} exit={{ opacity: 0 }}>
      <motion.div
        // Always attached: motion only takes a ref when it mounts.
        ref={showsFace ? hitRef : undefined}
        {...(takesClicks ? clicks : {})}
        title={takesClicks ? "Клик — микрофон, двойной клик — звук" : undefined}
        className={`call-drop ${layer}${tint === "discord" ? " discord" : ""}${speaker && !event ? " speaking" : ""}${takesClicks ? " live" : ""}`}
        style={{
          top,
          width: m.w,
          height: m.size,
          originX: 1,
          x: m.x,
          scale: m.scale,
          opacity: layer === "face" ? m.face : m.opacity,
        }}
        aria-hidden
      >
        {showsFace && (
          <>
            <motion.span
              className="drop-avatar"
              style={{ width: m.size, height: m.size }}
              whileTap={takesClicks ? { scale: 0.86 } : undefined}
            >
              {who ? <img src={who.avatar} alt="" draggable={false} /> : HEADPHONES}
              {off && !event && <i className={`drop-off ${off}`}>{off === "deaf" ? HEADPHONES_OFF : MIC_OFF}</i>}
            </motion.span>
            {event && mark && (
              <motion.span className="drop-note" style={{ opacity: m.label }} title={`${event.member.name}: ${mark.text}`}>
                <span className="drop-name" style={{ maxWidth: NAME_MAX }}>
                  {event.self ? "Ты" : event.member.name}
                </span>
                <span className={`drop-mark ${mark.tone}`}>{mark.mark}</span>
              </motion.span>
            )}
          </>
        )}
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
  // From the centre of the drop's island-side end into the island's rounded end.
  const left = useTransform(m.right, (r) => r - m.size / 2);
  const width = useTransform(m.right, (r) => Math.max(0, at.current.islandLeft + m.size * 0.3 - (r - m.size / 2)));
  const y = useTransform(m.neck, (n) => at.current.top + (m.size - n) / 2);
  return (
    <motion.div className="call-drop-lean" style={{ x: lean.x, y: lean.y }} exit={{ opacity: 0 }}>
      <motion.div className="drop-neck" style={{ left, top: y, width, height: m.neck }} />
    </motion.div>
  );
}
