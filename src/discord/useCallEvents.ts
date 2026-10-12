import { useEffect, useRef, useState } from "react";
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

/** How long each event stays out, and shorter while more are waiting. */
const SHOW_MS = 2600;
const QUEUED_MS = 1600;
/** Events waiting beyond this are dropped, oldest first, so it never lags far behind. */
const QUEUE = 3;

/**
 * Who joined or left the channel and who switched their mic or sound,
 * one event at a time. Nothing is announced for the people already in a
 * channel when you join it.
 */
export function useCallEvents(voice: Voice | null, selfId: string | null, enabled: boolean): CallEvent | null {
  const [queue, setQueue] = useState<CallEvent[]>([]);
  const last = useRef<{ channel: string; members: Map<string, Member> } | null>(null);
  const key = useRef(0);

  useEffect(() => {
    const prev = last.current;
    last.current = voice && { channel: voice.channel, members: new Map(voice.members.map((m) => [m.id, m])) };
    if (!voice || !prev || prev.channel !== voice.channel || !enabled) {
      if (!voice || !enabled) setQueue([]);
      return;
    }
    const events: CallEvent[] = [];
    const add = (kind: CallEventKind, member: Member) =>
      events.push({ key: ++key.current, kind, member, self: member.id === selfId });
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
  }, [voice, selfId, enabled]);

  const current = queue[0] ?? null;
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), queue.length > 1 ? QUEUED_MS : SHOW_MS);
    return () => clearTimeout(t);
  }, [current, queue.length]);

  return current;
}
