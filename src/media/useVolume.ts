import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../island/env";

export interface VolumeState {
  volume: number;
  muted: boolean;
}

/** Picks up changes made in the Windows mixer or in the player itself. */
const POLL_MS = 2000;
/** Polls skip this long after the user moved the slider, so it doesn't jump back. */
const SETTLE_MS = 1000;

/**
 * Volume of the player `app` (its SMTC app id). Null while the player has no
 * audio session of its own; then there's nothing to show.
 */
export function useVolume(app: string | null) {
  const [state, setState] = useState<VolumeState | null>(null);
  const touched = useRef(0);

  useEffect(() => {
    setState(null);
    if (!isTauri || !app) return;
    let alive = true;
    const poll = () => {
      if (Date.now() - touched.current < SETTLE_MS) return;
      invoke<VolumeState>("media_get_volume", { app })
        .then((s) => alive && setState(s))
        .catch(() => alive && setState(null));
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [app]);

  // One request at a time while dragging, then the latest level: parallel
  // requests could land out of order and leave an older level behind.
  const sending = useRef(false);
  const queued = useRef<number | null>(null);

  const setVolume = useCallback(
    (level: number) => {
      if (!app) return;
      const volume = Math.max(0, Math.min(1, level));
      touched.current = Date.now();
      // Optimistic, so dragging feels instant.
      setState((s) => s && { ...s, volume });
      queued.current = volume;
      if (sending.current) return;
      sending.current = true;
      const send = () => {
        const next = queued.current;
        queued.current = null;
        if (next === null) {
          sending.current = false;
          return;
        }
        invoke("media_set_volume", { app, level: next })
          .catch(() => setState(null))
          .finally(send);
      };
      send();
    },
    [app],
  );

  const toggleMute = useCallback(() => {
    if (!app) return;
    touched.current = Date.now();
    setState((s) => s && { ...s, muted: !s.muted });
    invoke<VolumeState>("media_toggle_mute", { app })
      .then(setState)
      .catch(() => setState(null));
  }, [app]);

  return { state, setVolume, toggleMute };
}
