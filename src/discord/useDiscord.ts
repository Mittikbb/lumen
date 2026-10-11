import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";

export interface Member {
  id: string;
  name: string;
  avatar: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
}

export interface Voice {
  channel: string;
  members: Member[];
  /** Your own microphone and sound in Discord. */
  mute: boolean;
  deaf: boolean;
}

export interface DiscordStatus {
  /** "off", "connecting", "waiting", "authorize", "ready" or "error". */
  state: string;
  message: string | null;
  user: string | null;
  voice: Voice | null;
}

const OFF: DiscordStatus = { state: "off", message: null, user: null, voice: null };

/** Connection state and the voice channel you're in, live from the backend. */
export function useDiscord(): DiscordStatus {
  const [status, setStatus] = useState(OFF);

  useEffect(() => {
    if (!isTauri) return;
    invoke<DiscordStatus>("discord_status").then(setStatus);
    const unlisten = listen<DiscordStatus>("lumen://discord", (e) => setStatus(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  return status;
}

export const discordVoice = (action: "mute" | "deaf" | "leave") =>
  isTauri && invoke("discord_voice", { action });
