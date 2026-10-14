import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";

/** A keyboard layout or Caps Lock switch, for the drop below the island. */
export interface KeyboardEvent {
  kind: "layout" | "caps";
  /** "RU", "EN"... */
  layout: string;
  caps: boolean;
  key: number;
}

/** A Bluetooth device that connected or disconnected. */
export interface BluetoothEvent {
  connected: boolean;
  name: string;
  kind: "audio" | "keyboard" | "mouse" | "gamepad" | "phone" | "device";
  /** Percent, when the device reports it. */
  battery: number | null;
  key: number;
}

const KEYBOARD_MS = 1400;
const BLUETOOTH_MS = 3800;

/** The latest event on `channel`, for `ms` after it came (each one restarts it). */
function useRecent<T>(channel: string, ms: number, accept: (payload: T) => boolean): (T & { key: number }) | null {
  const [event, setEvent] = useState<(T & { key: number }) | null>(null);
  // The filter follows the settings as they change; listening once is enough.
  const filter = useRef(accept);
  filter.current = accept;
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<T>(channel, (e) => {
      if (filter.current(e.payload)) setEvent({ ...e.payload, key: Date.now() });
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, [channel]);
  useEffect(() => {
    if (!event) return;
    const t = setTimeout(() => setEvent(null), ms);
    return () => clearTimeout(t);
  }, [event, ms]);
  return event;
}

export const useKeyboardEvents = (accept: (e: Omit<KeyboardEvent, "key">) => boolean) =>
  useRecent<Omit<KeyboardEvent, "key">>("lumen://keyboard", KEYBOARD_MS, accept);

export const useBluetoothEvents = (accept: (e: Omit<BluetoothEvent, "key">) => boolean) =>
  useRecent<Omit<BluetoothEvent, "key">>("lumen://bluetooth", BLUETOOTH_MS, accept);
