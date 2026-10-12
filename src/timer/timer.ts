import { useEffect, useState, useSyncExternalStore } from "react";

/** A countdown started from search ("таймер 10м"). */
export interface Timer {
  /** Its full length, ms. */
  total: number;
  /** When it runs out, while running. */
  endsAt: number | null;
  /** Time left while paused. */
  pausedLeft: number | null;
  /** When it ran out; it rings until dismissed. */
  doneAt: number | null;
}

const KEY = "lumen.timer";
/** A finished timer stops asking for attention after this long. */
const DONE_MS = 60_000;
const MAX_MS = 24 * 3600_000;

let current: Timer | null = load();
const listeners = new Set<() => void>();
let wake: ReturnType<typeof setTimeout> | undefined;

function load(): Timer | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Timer | null;
    // Ran out while Lumen was closed: long enough ago, it's over.
    const end = saved?.endsAt ?? saved?.doneAt;
    if (saved && end && Date.now() - end > DONE_MS) return null;
    return saved;
  } catch {
    return null;
  }
}

function set(next: Timer | null) {
  current = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Not saved: it just won't outlive a restart.
  }
  schedule();
  listeners.forEach((l) => l());
}

/** Wakes up when the timer runs out, and when a finished one should go quiet. */
function schedule() {
  clearTimeout(wake);
  const t = current;
  if (!t) return;
  if (t.endsAt) {
    wake = setTimeout(() => {
      set({ ...t, endsAt: null, doneAt: Date.now() });
      chime();
    }, Math.max(0, t.endsAt - Date.now()));
  } else if (t.doneAt) {
    wake = setTimeout(() => set(null), Math.max(0, t.doneAt + DONE_MS - Date.now()));
  }
}
schedule();

export const timer = {
  start(ms: number) {
    prime();
    set({ total: ms, endsAt: Date.now() + ms, pausedLeft: null, doneAt: null });
  },
  /** Pauses a running timer, resumes a paused one, silences a finished one. */
  toggle() {
    const t = current;
    if (!t) return;
    if (t.doneAt) set(null);
    else if (t.endsAt) set({ ...t, endsAt: null, pausedLeft: Math.max(0, t.endsAt - Date.now()) });
    else if (t.pausedLeft !== null) set({ ...t, endsAt: Date.now() + t.pausedLeft, pausedLeft: null });
  },
  stop() {
    set(null);
  },
  get: () => current,
};

/** The timer and the time left on it, ticking while it runs. */
export function useTimer(): { timer: Timer | null; left: number } {
  const t = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const [, tick] = useState(0);
  useEffect(() => {
    if (!t?.endsAt) return;
    // Lands each tick just after the displayed second changes.
    let id: ReturnType<typeof setTimeout>;
    const next = () => {
      tick((n) => n + 1);
      id = setTimeout(next, ((t.endsAt! - Date.now()) % 1000) + 20);
    };
    id = setTimeout(next, ((t.endsAt - Date.now()) % 1000) + 20);
    return () => clearTimeout(id);
  }, [t]);
  const left = !t || t.doneAt ? 0 : t.endsAt ? Math.max(0, t.endsAt - Date.now()) : (t.pausedLeft ?? 0);
  return { timer: t, left };
}

/** "9:05", "1:02:00": time left, rounded up to the second. */
export function formatLeft(ms: number) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "10 мин", "1 ч 30 мин", "45 с": a length in words. */
export function formatSpan(ms: number) {
  const s = Math.round(ms / 1000);
  const parts = [
    [Math.floor(s / 3600), "ч"],
    [Math.floor((s % 3600) / 60), "мин"],
    [s % 60, "с"],
  ] as const;
  return parts
    .filter(([n]) => n)
    .map(([n, unit]) => `${n} ${unit}`)
    .join(" ");
}

// Not \b: it only knows Latin letters.
const COMMAND = /^(таймер|timer)(?![a-zа-яё])\s*/i;
const UNIT = /\s*(\d+(?:[.,]\d+)?)\s*([a-zа-яё]*)/iy;

/** Whether the query asks for the timer at all ("таймер", "timer ..."). */
export const isTimerQuery = (q: string) => COMMAND.test(q.trim());

/**
 * The length a search like "таймер 10м", "таймер 1ч 30м", "timer 90s",
 * "таймер 1:30" or "таймер 5" (minutes) asks for, in ms; null if it isn't one.
 */
export function parseTimer(query: string): number | null {
  const q = query.trim();
  if (!COMMAND.test(q)) return null;
  const rest = q.replace(COMMAND, "").trim().toLowerCase();
  if (!rest) return null;

  let ms = 0;
  const clock = rest.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) {
    const [a, b, c] = clock.slice(1).map((v) => (v ? Number(v) : null));
    // m:ss, or h:mm:ss with a third part.
    ms = c === null ? (a! * 60 + b!) * 1000 : (a! * 3600 + b! * 60 + c) * 1000;
  } else {
    UNIT.lastIndex = 0;
    let parts = 0;
    while (UNIT.lastIndex < rest.length) {
      const m = UNIT.exec(rest);
      if (!m) return null;
      const n = Number(m[1].replace(",", "."));
      const unit = m[2];
      const scale = !unit
        ? 60_000
        : /^(ч|h)/.test(unit)
          ? 3600_000
          : /^(м|m)/.test(unit) && unit !== "ms"
            ? 60_000
            : /^(с|s)/.test(unit)
              ? 1000
              : null;
      if (scale === null) return null;
      ms += n * scale;
      parts++;
    }
    if (!parts) return null;
  }
  ms = Math.round(ms / 1000) * 1000;
  return ms >= 1000 && ms <= MAX_MS ? ms : null;
}

let audio: AudioContext | null = null;

/** Wakes the audio up while the user is starting the timer (autoplay rules). */
function prime() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    audio = null;
  }
}

/** Three soft rising notes. */
function chime() {
  prime();
  if (!audio) return;
  const now = audio.currentTime;
  [660, 880, 990].forEach((freq, i) => {
    const at = now + i * 0.18;
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.18, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
    osc.connect(gain).connect(audio!.destination);
    osc.start(at);
    osc.stop(at + 0.55);
  });
}
