import { ReactNode } from "react";
import { discordVoice, Member, Voice } from "./useDiscord";

// Icons in the Lucide style (24px grid, 2px rounded strokes).
const icon = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden>
    {children}
  </svg>
);
const MIC = icon(
  <>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
  </>,
);
const MIC_OFF = icon(
  <>
    <path d="M2 2l20 20M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 5.1 2.1" />
    <path d="M18.9 13.2A7 7 0 0 0 19 12v-2M5 10v2a7 7 0 0 0 12 5M12 19v3" />
  </>,
);
const HEADPHONES = icon(
  <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />,
);
const HEADPHONES_OFF = icon(
  <path d="M2 2l20 20M21 14h-1.3M9.1 3.5A9 9 0 0 1 21 12v3.3M20.4 20.4A2 2 0 0 1 19 21h-1a2 2 0 0 1-2-2v-3M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.6-6.4" />,
);
// A handset tipped over, like Discord's "leave call".
const HANG_UP = icon(
  <path
    transform="rotate(135 12 12)"
    d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"
  />,
);

function Avatar({ member, size }: { member: Member; size?: "small" }) {
  const status = member.deafened ? "deaf" : member.muted ? "muted" : null;
  return (
    <span className={`call-avatar${member.speaking ? " speaking" : ""}${size ? ` ${size}` : ""}`} title={member.name}>
      <img src={member.avatar} alt="" draggable={false} />
      {status && <i className={`call-badge ${status}`}>{status === "deaf" ? HEADPHONES_OFF : MIC_OFF}</i>}
    </span>
  );
}

function ControlButton({ label, active, danger, onClick, children }: {
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`call-button${active ? " off" : ""}${danger ? " leave" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Expanded island: the voice channel with everyone in it and your controls. */
export function CallPanel({ voice }: { voice: Voice }) {
  return (
    <div className="panel call">
      <div className="call-head">
        <span className="call-dot" />
        <span className="call-channel">{voice.channel}</span>
        <span className="call-count">{voice.members.length}</span>
      </div>
      <ul className="call-members">
        {voice.members.map((m) => (
          <li key={m.id}>
            <Avatar member={m} />
            <span className="call-name">{m.name}</span>
          </li>
        ))}
      </ul>
      <div className="call-controls">
        <ControlButton
          label={voice.mute ? "Включить микрофон" : "Выключить микрофон"}
          active={voice.mute}
          onClick={() => discordVoice("mute")}
        >
          {voice.mute ? MIC_OFF : MIC}
        </ControlButton>
        <ControlButton
          label={voice.deaf ? "Включить звук" : "Выключить звук"}
          active={voice.deaf}
          onClick={() => discordVoice("deaf")}
        >
          {voice.deaf ? HEADPHONES_OFF : HEADPHONES}
        </ControlButton>
        <ControlButton label="Отключиться" danger onClick={() => discordVoice("leave")}>
          {HANG_UP}
        </ControlButton>
      </div>
    </div>
  );
}

/** Collapsed island during a call: a stack of avatars, who's talking glows. */
export function MiniCall({ voice }: { voice: Voice }) {
  const speaking = voice.members.filter((m) => m.speaking);
  const shown = [...speaking, ...voice.members.filter((m) => !m.speaking)].slice(0, 4);
  return (
    <div className="mini-call">
      <span className="mini-avatars">
        {shown.map((m) => (
          <Avatar key={m.id} member={m} size="small" />
        ))}
      </span>
      <span className="mini-title">{speaking[0]?.name ?? voice.channel}</span>
      {(voice.mute || voice.deaf) && <span className="mini-call-muted">{voice.deaf ? HEADPHONES_OFF : MIC_OFF}</span>}
    </div>
  );
}
