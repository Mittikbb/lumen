import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../island/env";

export interface VolumeState {
  volume: number;
  muted: boolean;
  isAppVolume: boolean;
  appName: string | null;
}

export function useVolume(app?: string) {
  const [volState, setVolState] = useState<VolumeState>({
    volume: 1,
    muted: false,
    isAppVolume: false,
    appName: null,
  });

  const fetchVolume = useCallback(async (forceMaster?: boolean) => {
    if (!isTauri) return;
    try {
      const res = await invoke<VolumeState>("media_get_volume", {
        app: app || null,
        forceMaster: forceMaster ?? null,
      });
      setVolState(res);
    } catch (e) {
      console.warn("media_get_volume failed:", e);
    }
  }, [app]);

  useEffect(() => {
    fetchVolume();
  }, [fetchVolume]);

  const setVolume = useCallback(
    async (level: number, forceMaster?: boolean) => {
      const clamped = Math.max(0, Math.min(1, level));
      // Optimistic update for zero-latency dragging
      setVolState((prev) => ({
        ...prev,
        volume: clamped,
        muted: clamped === 0 ? true : prev.muted,
      }));

      if (!isTauri) return;
      try {
        const res = await invoke<VolumeState>("media_set_volume", {
          level: clamped,
          app: app || null,
          forceMaster: forceMaster ?? null,
        });
        setVolState(res);
      } catch (e) {
        console.warn("media_set_volume failed:", e);
      }
    },
    [app]
  );

  const toggleMute = useCallback(
    async (forceMaster?: boolean) => {
      setVolState((prev) => ({ ...prev, muted: !prev.muted }));
      if (!isTauri) return;
      try {
        const res = await invoke<VolumeState>("media_toggle_mute", {
          app: app || null,
          forceMaster: forceMaster ?? null,
        });
        setVolState(res);
      } catch (e) {
        console.warn("media_toggle_mute failed:", e);
      }
    },
    [app]
  );

  return {
    volume: volState.volume,
    muted: volState.muted,
    isAppVolume: volState.isAppVolume,
    appName: volState.appName,
    setVolume,
    toggleMute,
    fetchVolume,
  };
}
