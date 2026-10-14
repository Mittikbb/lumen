import { ReactNode, Ref } from "react";
import { motion } from "motion/react";
import { HEADPHONES, HEADPHONES_OFF, MIC, MIC_OFF, icon } from "./CallPanel";
import { Drop, DropLayer, DropMotion, Lean, textWidth, useDropClicks } from "../island/Drop";
import type { CallEvent, CallEventKind } from "./useCallEvents";
import { discordVoice, type Voice } from "./useDiscord";

/** Longest name an announcement shows before trailing off. */
const NAME_MAX = 110;

/** The drop's width while announcing: avatar, name, the event's mark. */
export function notifyWidth(size: number, event: CallEvent | null) {
  return event ? size + textWidth(event.member.name, "500 12px", NAME_MAX) + 36 : size;
}

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

/**
 * "Капля": a Discord call as a round drop that flows out of the island's left
 * end, like the second activity on an iPhone (see Drop). It shows who talks or
 * what just happened. Popped out, a click turns your mic on or off and a
 * double click your sound.
 */
export function CallDrop({ voice, event, motion: m, lean, layer, tint, live, hitRef, onPoke }: {
  voice: Voice;
  /** What the drop is announcing, if anything. */
  event: CallEvent | null;
  motion: DropMotion;
  lean: Lean;
  layer: DropLayer;
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
  const clicks = useDropClicks(() => discordVoice("mute"), () => discordVoice("deaf"), onPoke);
  // Your own mic or sound being off, unless the drop is saying just that.
  const off = voice.deaf ? "deaf" : voice.mute ? "mute" : null;
  return (
    <Drop
      motion={m}
      lean={lean}
      layer={layer}
      className={`call-drop${tint === "discord" ? " discord" : ""}${speaker && !event ? " speaking" : ""}`}
      live={live}
      hitRef={hitRef}
      clicks={clicks}
      title="Клик — микрофон, двойной клик — звук"
    >
      <motion.span
        className="drop-avatar"
        style={{ width: m.size, height: m.size }}
        whileTap={live ? { scale: 0.86 } : undefined}
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
    </Drop>
  );
}
