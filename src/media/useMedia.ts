import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";

export interface NowPlaying {
  title: string;
  artist: string;
  app: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  art: string | null;
}

/** Identifies a track; changes when the song changes. */
export const trackKey = (m: NowPlaying) => [m.title, m.artist].join(" — ");

export type MediaAction = "toggle" | "next" | "previous";

export function mediaControl(action: MediaAction) {
  if (isTauri) invoke("media_control", { action });
}

/** An update from the backend: `art` is left out while the cover stays the same. */
type MediaEvent = Omit<NowPlaying, "art"> & { art?: string | null };

export function useMedia(): NowPlaying | null {
  const [media, setMedia] = useState<NowPlaying | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    let changed = false;
    const unlisten = listen<MediaEvent | null>("lumen://media", ({ payload }) => {
      changed = true;
      setMedia((prev) =>
        payload && payload.art === undefined ? { ...payload, art: prev?.art ?? null } : (payload as NowPlaying | null),
      );
    });
    // Read once listening, so no change slips in between. Updates that came
    // in meanwhile are newer, but may have left out a cover they took as known.
    unlisten
      .then(() => invoke<NowPlaying | null>("media_state"))
      .then((state) => {
        if (!alive) return;
        setMedia((prev) => {
          if (!changed) return state;
          return prev && state && prev.art === null && trackKey(prev) === trackKey(state) ? { ...prev, art: state.art } : prev;
        });
      });
    return () => {
      alive = false;
      unlisten.then((off) => off());
    };
  }, []);

  return media;
}

/**
 * Friendly player name from an SMTC app id ("Spotify.exe", "308046B0AF4A39CB",
 * ...) or a macOS bundle id ("com.spotify.client"): the one you gave it in
 * the settings, or a built-in one.
 */
export function playerName(app: string, names?: Record<string, string>) {
  const own = names?.[app]?.trim();
  if (own) return own;
  const id = app.toLowerCase();
  if (id.includes("spotify")) return "Spotify";
  // AyuGram and Telega are Telegram forks; check them before Telegram itself.
  if (id.includes("ayugram")) return "AyuGram";
  if (id.includes("telega") && !id.includes("telegram")) return "Telega";
  if (id.includes("telegram")) return "Telegram";
  if (id.includes("yandex")) return "Яндекс Музыка";
  if (id.includes("chrome")) return "Chrome";
  if (id.includes("msedge")) return "Edge";
  if (id.includes("firefox") || id === "308046b0af4a39cb") return "Firefox";
  if (id.includes("zunemusic") || id.includes("media.player")) return "Медиаплеер";
  // macOS bundle ids: "com.apple.Music", "com.apple.Safari", "org.videolan.vlc"...
  if (id === "com.apple.music") return "Музыка";
  if (id === "com.apple.safari") return "Safari";
  if (id.includes("vlc")) return "VLC";
  if (!id.endsWith(".exe") && /^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/.test(id)) return app.split(".").pop()!;
  return app.replace(/\.exe$/i, "").split("!")[0];
}

export function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
