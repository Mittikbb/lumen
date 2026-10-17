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

/** A built-in tab, or an addon's as "addon:<id>". */
export type TabId = (typeof TABS)[number]["id"] | `addon:${string}`;

export const addonTabId = (id: string): TabId => `addon:${id}`;
