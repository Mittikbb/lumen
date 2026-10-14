import { ReactNode } from "react";
import { motion } from "motion/react";
import type { BluetoothEvent } from "./useDeviceEvents";

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden>
    {d}
  </svg>
);

// Each path has pathLength 1, so the stroke can be drawn in.
const ICONS: Record<BluetoothEvent["kind"], ReactNode> = {
  audio: icon(
    <path pathLength={1} d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />,
  ),
  keyboard: icon(
    <path pathLength={1} d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />,
  ),
  mouse: icon(<path pathLength={1} d="M12 3a6 6 0 0 1 6 6v6a6 6 0 0 1-12 0V9a6 6 0 0 1 6-6zM12 7v4" />),
  gamepad: icon(
    <path pathLength={1} d="M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.4 2l1.1-1.5h7l1.1 1.5A3 3 0 0 0 22 15l-.7-6.4a4 4 0 0 0-4-3.6z" />,
  ),
  phone: icon(<path pathLength={1} d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2" />),
  device: icon(<path pathLength={1} d="M7 7l10 10-5 5V2l5 5L7 17" />),
};

const tone = (level: number) => (level <= 20 ? "low" : level <= 50 ? "mid" : "high");

/**
 * A Bluetooth device coming or going, in the collapsed island: its icon draws
 * itself in while a ripple spreads from it, the name slides in, and a battery
 * fills up to the charge when the device reports one. Going, the icon is
 * crossed out.
 */
export function BluetoothView({ event, reduced }: { event: Omit<BluetoothEvent, "key">; reduced: boolean }) {
  const slide = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, x: -10, filter: "blur(4px)" },
          animate: { opacity: 1, x: 0, filter: "blur(0px)" },
          transition: { delay, duration: 0.35, ease: "easeOut" as const },
        };
  return (
    <motion.div key={`${event.name}-${event.connected}`} className={`bluetooth${event.connected ? "" : " gone"}${reduced ? " still" : ""}`}>
      <span className="bluetooth-icon">
        {event.connected && !reduced && (
          <>
            <i className="bluetooth-ripple" />
            <i className="bluetooth-ripple late" />
          </>
        )}
        {ICONS[event.kind] ?? ICONS.device}
        {!event.connected && (
          <svg className="bluetooth-cross" viewBox="0 0 24 24" aria-hidden>
            <path pathLength={1} d="M3 3l18 18" />
          </svg>
        )}
      </span>
      <motion.span className="bluetooth-name" {...slide(0.12)}>
        {event.name}
      </motion.span>
      <motion.span className="bluetooth-meta" {...slide(0.22)}>
        {event.connected ? (
          event.battery !== null ? (
            <span className={`battery ${tone(event.battery)}`}>
              <span className="battery-body">
                <motion.i
                  initial={reduced ? false : { width: "0%" }}
                  animate={{ width: `${event.battery}%` }}
                  transition={{ delay: 0.35, duration: 0.9, ease: "easeOut" }}
                />
              </span>
              {event.battery}%
            </span>
          ) : (
            "Подключено"
          )
        ) : (
          "Отключено"
        )}
      </motion.span>
    </motion.div>
  );
}
