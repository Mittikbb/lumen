import { ReactNode, useEffect, useState } from "react";
import type { NightPrefs } from "../settings/useSettings";

/**
 * The clock's two colours through the day, by hour: indigo at night, rose and
 * amber at dawn, sky and sun by day, orange at sunset, violet at dusk.
 */
const SKY: [number, [number, number, number], [number, number, number]][] = [
  [0, [104, 118, 255], [178, 110, 255]],
  [4.5, [128, 110, 255], [235, 120, 200]],
  [7, [255, 170, 110], [255, 108, 140]],
  [10, [130, 214, 255], [255, 236, 170]],
  [14, [150, 228, 255], [255, 222, 130]],
  [18, [255, 176, 92], [255, 94, 122]],
  [20.5, [255, 122, 158], [150, 110, 255]],
  [22.5, [96, 122, 255], [165, 110, 255]],
  [24, [104, 118, 255], [178, 110, 255]],
];

const rgb = ([r, g, b]: number[]) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

/** The two colours for a moment of the day, blended between the nearest hours above. */
export function skyColors(date: Date) {
  const hour = date.getHours() + date.getMinutes() / 60;
  const i = SKY.findIndex(([h]) => h > hour) - 1;
  const [h0, a0, b0] = SKY[Math.max(0, i)];
  const [h1, a1, b1] = SKY[Math.max(1, i + 1)];
  const k = (hour - h0) / (h1 - h0);
  const mix = (x: number[], y: number[]) => x.map((v, n) => v + (y[n] - v) * k);
  return { a: rgb(mix(a0, a1)), b: rgb(mix(b0, b1)) };
}

/** Whether the night screen is on right now (checked every half minute). */
export function useNight({ mode, from, to }: NightPrefs) {
  const check = () => {
    if (mode !== "schedule") return mode === "always";
    const hour = new Date().getHours();
    return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
  };
  const [on, setOn] = useState(check);
  useEffect(() => {
    setOn(check());
    const id = setInterval(() => setOn(check()), 30_000);
    return () => clearInterval(id);
  }, [mode, from, to]);
  return on;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The night screen in the collapsed island: the time large, the weekday and
 * date beside it, in colours that drift with the time of day.
 */
export function NightView({ clock24, weather }: { clock24: boolean; weather?: ReactNode }) {
  const now = useNow();
  const { a, b } = skyColors(now);
  const time = now.toLocaleTimeString(clock24 ? "ru-RU" : "en-US", {
    hour: clock24 ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: !clock24,
  });
  const weekday = now.toLocaleDateString("ru-RU", { weekday: "long" });
  const day = now.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return (
    <div className="night" style={{ "--night-a": a, "--night-b": b } as React.CSSProperties}>
      <span className="night-time">{time}</span>
      <span className="night-date">
        <span className="night-weekday">{weekday}</span>
        <span>{day}</span>
      </span>
      {weather && <span className="night-weather">{weather}</span>}
    </div>
  );
}
