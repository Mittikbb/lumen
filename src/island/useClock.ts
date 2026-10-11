import { useEffect, useState } from "react";

export interface ClockOptions {
  clock24: boolean;
  seconds: boolean;
  /** Prefix the weekday and date, e.g. "пт, 11 окт". */
  date: boolean;
}

const format = ({ clock24, seconds, date }: ClockOptions) => {
  const now = new Date();
  const time = now.toLocaleTimeString(clock24 ? "ru-RU" : "en-US", {
    hour: clock24 ? "2-digit" : "numeric",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hour12: !clock24,
  });
  if (!date) return time;
  const day = now.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
  return `${day.replace(".", "")} ${time}`;
};

export function useClock(options: ClockOptions = { clock24: true, seconds: false, date: false }) {
  const { clock24, seconds, date } = options;
  const [time, setTime] = useState(() => format(options));

  useEffect(() => {
    const opts = { clock24, seconds, date };
    setTime(format(opts));
    const id = setInterval(() => setTime(format(opts)), 1000);
    return () => clearInterval(id);
  }, [clock24, seconds, date]);

  return time;
}
