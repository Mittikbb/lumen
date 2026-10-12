import { useEffect, useRef, useState } from "react";
import type { CallPrefs } from "../settings/useSettings";
import type { Member, Voice } from "./useDiscord";

export type CallEventKind = "join" | "leave" | "mute" | "unmute" | "deaf" | "undeaf";

export interface CallEvent {
  /** Tells repeated events apart. */
  key: number;
  kind: CallEventKind;
  member: Member;
  /** It's you: your own mic or sound. */
  self: boolean;
}

/** While more events are waiting, each is shown at most this long. */
const QUEUED_MS = 1600;
/** Events waiting beyond this are dropped, oldest first, so it never lags far behind. */
const QUEUE = 3;

/** Whether an event is one the settings ask for. */
function wanted(kind: CallEventKind, self: boolean, notify: CallPrefs["notify"]) {
  if (self) return notify.self;
  if (kind === "join" || kind === "leave") return notify.joins;
  if (kind === "mute" || kind === "unmute") return notify.mic;
  return notify.sound;
}

/**
 * Who joined or left the channel and who switched their mic or sound, one
 * event at a time, as far as the drop settings ask. Nothing is announced for
 * the people already in a channel when you join it. `prefs` null: off.
 */
export function useCallEvents(
  voice: Voice | null,
  selfId: string | null,
  prefs: Pick<CallPrefs, "notify" | "showMs"> | null,
): CallEvent | null {
  const [queue, setQueue] = useState<CallEvent[]>([]);
  const last = useRef<{ channel: string; members: Map<string, Member> } | null>(null);
  const key = useRef(0);
  const notify = prefs?.notify ?? null;

  useEffect(() => {
    const prev = last.current;
    last.current = voice && { channel: voice.channel, members: new Map(voice.members.map((m) => [m.id, m])) };
    if (!voice || !prev || prev.channel !== voice.channel || !notify) {
      if (!voice || !notify) setQueue([]);
      return;
    }
    const events: CallEvent[] = [];
    const add = (kind: CallEventKind, member: Member) => {
      const self = member.id === selfId;
      if (wanted(kind, self, notify)) events.push({ key: ++key.current, kind, member, self });
    };
    for (const m of voice.members) {
      const before = prev.members.get(m.id);
      if (!before) add("join", m);
      // Deafening mutes too, so it's reported once, as the sound.
      else if (before.deafened !== m.deafened) add(m.deafened ? "deaf" : "undeaf", m);
      else if (before.muted !== m.muted) add(m.muted ? "mute" : "unmute", m);
    }
    for (const [id, m] of prev.members) {
      if (!last.current?.members.has(id)) add("leave", m);
    }
    if (events.length) setQueue((q) => [...q, ...events].slice(-QUEUE));
  }, [voice, selfId, notify]);

  const current = queue[0] ?? null;
  const showMs = prefs?.showMs ?? 0;
  useEffect(() => {
    if (!current) return;
    const ms = queue.length > 1 ? Math.min(showMs, QUEUED_MS) : showMs;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), ms);
    return () => clearTimeout(t);
  }, [current, queue.length, showMs]);

  return current;
}
