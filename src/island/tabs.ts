import { isMac } from "./env";

/**
 * Island tabs, in the order they appear. "Звонок" only shows during a Discord
 * call; search is tied to its hotkey and can't be hidden.
 */
export const TABS = [
  { id: "call", label: "Звонок" },
  { id: "media", label: "Медиа" },
  { id: "weather", label: "Погода" },
  { id: "shelf", label: "Полка" },
  { id: "clipboard", label: "Буфер" },
  { id: "launcher", label: "Поиск" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

/** Tabs whose backend isn't there on macOS yet: Discord calls. */
const MAC_MISSING: TabId[] = ["call"];

/** The tabs this platform has, in order. */
export const PLATFORM_TABS = TABS.filter((t) => !(isMac && MAC_MISSING.includes(t.id)));
