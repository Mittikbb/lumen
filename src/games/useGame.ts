import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";

/** The PC's load while a game starts (games.rs); `null` where it can't be read. */
export interface GameStats {
  fps: number | null;
  cpu: number;
  gpu: number | null;
  ram: number;
}

export interface GameShown {
  name: string;
  /** Until the first second has been measured. */
  stats: GameStats | null;
}

/** A game that just took the screen, while the island shows it. */
export function useGame(): GameShown | null {
  const [game, setGame] = useState<GameShown | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    const offs = [
      listen<{ name: string } | null>("lumen://game", (e) => setGame(e.payload && { name: e.payload.name, stats: null })),
      listen<GameStats>("lumen://game-stats", (e) => setGame((g) => g && { ...g, stats: e.payload })),
    ];
    return () => {
      offs.forEach((off) => off.then((f) => f()));
    };
  }, []);
  return game;
}
