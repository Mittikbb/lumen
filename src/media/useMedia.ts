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

export function useMedia(): NowPlaying | null {
  const [media, setMedia] = useState<NowPlaying | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    invoke<NowPlaying | null>("media_state").then(setMedia);
    const unlisten = listen<NowPlaying | null>("lumen://media", (e) => setMedia(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  return media;
}

/** Friendly player name from an SMTC app id ("Spotify.exe", "308046B0AF4A39CB", ...). */
export function playerName(app: string) {
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
  return app.replace(/\.exe$/i, "").split("!")[0];
}

export function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
