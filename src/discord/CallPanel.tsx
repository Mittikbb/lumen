import { discordVoice, Member, Voice } from "./useDiscord";

const MIC = <path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v3" />;
const MIC_OFF = <path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 5.2 2M15 10V7a3 3 0 0 0-5.6-1.5M6 11a6 6 0 0 0 9.5 4.9M18 11a6 6 0 0 1-.4 2M12 17v3M4 4l16 16" />;
const HEADPHONES = <path d="M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z" />;
const HEADPHONES_OFF = <path d="M4 15v-3a8 8 0 0 1 13.7-5.7M20 12v3M4 15a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2zM4 4l16 16" />;
const LEAVE = <path d="M4 15.5c4.5-4.6 11.5-4.6 16 0l-2.2 2.2-3-1.4v-2.2a9.5 9.5 0 0 0-5.6 0v2.2l-3 1.4z" />;

function Avatar({ member, size }: { member: Member; size?: "small" }) {
  return (
    <span
      className={`call-avatar${member.speaking ? " speaking" : ""}${size ? ` ${size}` : ""}`}
      title={member.name}
    >
      <img src={member.avatar} alt="" draggable={false} />
      {(member.muted || member.deafened) && <i className="call-muted" />}
    </span>
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
        <button
          className={`call-button${voice.mute ? " off" : ""}`}
          title={voice.mute ? "Включить микрофон" : "Выключить микрофон"}
          onClick={() => discordVoice("mute")}
        >
          <svg viewBox="0 0 24 24" aria-hidden>{voice.mute ? MIC_OFF : MIC}</svg>
        </button>
        <button
          className={`call-button${voice.deaf ? " off" : ""}`}
          title={voice.deaf ? "Включить звук" : "Выключить звук"}
          onClick={() => discordVoice("deaf")}
        >
          <svg viewBox="0 0 24 24" aria-hidden>{voice.deaf ? HEADPHONES_OFF : HEADPHONES}</svg>
        </button>
        <button className="call-button leave" title="Отключиться" onClick={() => discordVoice("leave")}>
          <svg viewBox="0 0 24 24" aria-hidden>{LEAVE}</svg>
        </button>
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
      {voice.mute && (
        <svg className="mini-call-muted" viewBox="0 0 24 24" aria-hidden>
          {MIC_OFF}
        </svg>
      )}
    </div>
  );
}
