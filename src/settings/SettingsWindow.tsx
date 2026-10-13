import { ReactNode, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../island/env";
import { useApps } from "../launcher/useLauncher";
import { TABS, TabId } from "../island/tabs";
import { useLook } from "./look";
import { Heading, Row, Toggle } from "./controls";
import { IslandSection } from "./IslandSection";
import { LookSection } from "./LookSection";
import { ModulesSection } from "./ModulesSection";
import { DiscordSection } from "./DiscordSection";
import { AdvancedSection } from "./AdvancedSection";
import { AboutSection } from "./AboutSection";
import {
  DEFAULT_SETTINGS,
  formatShortcut,
  heldModifiers,
  Hotkeys,
  Settings,
  shortcutFromEvent,
  shortcutParts,
  updateSettings,
  useSettings,
} from "./useSettings";
import "./settings.css";

const SECTIONS = [
  { id: "general", label: "Общие" },
  { id: "island", label: "Остров" },
  { id: "look", label: "Внешний вид" },
  { id: "keys", label: "Клавиши" },
  { id: "modules", label: "Модули" },
  { id: "discord", label: "Discord" },
  { id: "advanced", label: "Расширенные" },
  { id: "about", label: "О Lumen" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const SECTION_ICONS: Record<SectionId, ReactNode> = {
  general: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6" />,
  island: <path d="M8 9h8a3 3 0 0 1 0 6H8a3 3 0 0 1 0-6zM4 4h16M4 20h16" />,
  modules: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  discord: <path d="M8 7.5a14 14 0 0 1 8 0M7 17c3 1.4 7 1.4 10 0M5.5 7.5C3.8 10.6 3.3 13.5 3.8 16.6 5.3 17.8 6.8 18.5 8.3 19l1-2M18.5 7.5c1.7 3.1 2.2 6 1.7 9.1-1.5 1.2-3 1.9-4.5 2.4l-1-2M9.5 12.5h.01M14.5 12.5h.01" />,
  keys: <path d="M4 7h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17 10.5h.01M8 14h8" />,
  look: <path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />,
  advanced: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  about: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01" />,
};

/** `optional`: off until a key is set, and can be switched off again. */
type HotkeyRowSpec = { id: keyof Hotkeys; title: string; hint: string; optional?: boolean };

const HOTKEY_GROUPS: { title: string; rows: HotkeyRowSpec[] }[] = [
  {
    title: "Основные",
    rows: [
      { id: "launcher", title: "Поиск", hint: "Программы, калькулятор, вопрос ИИ" },
      { id: "screenshot", title: "Скриншот области", hint: "Снимок сразу попадает в буфер" },
      { id: "text", title: "Текст с экрана", hint: "Распознаёт текст и копирует его" },
    ],
  },
  {
    title: "Discord",
    rows: [{ id: "mic", title: "Микрофон", hint: "Выключить или включить микрофон в звонке", optional: true }],
  },
  {
    title: "Музыка",
    rows: [
      { id: "play", title: "Пауза / играть", hint: "Трек, который сейчас на острове", optional: true },
      { id: "next", title: "Следующий трек", hint: "", optional: true },
      { id: "previous", title: "Предыдущий трек", hint: "", optional: true },
    ],
  },
];

const HOTKEY_ROWS = HOTKEY_GROUPS.flatMap((g) => g.rows);

/** Backend names for actions whose key another app holds. */
type Action = keyof Hotkeys;

/** The settings window: sections on the left, changes apply instantly. */
export function SettingsWindow() {
  const settings = useSettings();
  const [section, setSection] = useState<SectionId>("general");
  // "Расширенные" stays out of the list until unlocked in О Lumen.
  const unlocked = !!settings?.advanced.unlocked;
  const sections = SECTIONS.filter((s) => s.id !== "advanced" || unlocked);
  useEffect(() => {
    if (section === "advanced" && !unlocked) setSection("about");
  }, [section, unlocked]);
  useLook(settings?.look);

  useEffect(() => {
    document.documentElement.classList.add("settings-root");
  }, []);

  return (
    <div className="settings">
      <nav className="st-nav" data-tauri-drag-region>
        <div className="st-brand" data-tauri-drag-region>
          <span className="orb" />
          Lumen
        </div>
        {sections.map((s) => (
          <button
            key={s.id}
            className="st-nav-item"
            aria-current={section === s.id ? "page" : undefined}
            onClick={() => setSection(s.id)}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              {SECTION_ICONS[s.id]}
            </svg>
            {s.label}
          </button>
        ))}
      </nav>

      <main className="st-main">
        <header className="st-titlebar" data-tauri-drag-region>
          <h1 data-tauri-drag-region>{SECTIONS.find((s) => s.id === section)!.label}</h1>
          <WindowButtons />
        </header>
        <div className="st-content" key={section}>
          {!settings ? null : section === "general" ? (
            <GeneralSection settings={settings} />
          ) : section === "island" ? (
            <IslandSection settings={settings} />
          ) : section === "look" ? (
            <LookSection settings={settings} />
          ) : section === "keys" ? (
            <KeysSection hotkeys={settings.hotkeys} />
          ) : section === "modules" ? (
            <ModulesSection settings={settings} />
          ) : section === "discord" ? (
            <DiscordSection settings={settings} />
          ) : section === "advanced" ? (
            <AdvancedSection settings={settings} />
          ) : (
            <AboutSection settings={settings} />
          )}
        </div>
      </main>
    </div>
  );
}

function WindowButtons() {
  if (!isTauri) return null;
  const win = getCurrentWindow();
  return (
    <div className="st-window-buttons">
      <button aria-label="Свернуть" onClick={() => win.minimize()}>
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M6 12h12" />
        </svg>
      </button>
      <button className="st-close" aria-label="Закрыть" onClick={() => win.close()}>
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      </button>
    </div>
  );
}

/* Общие */

function GeneralSection({ settings }: { settings: Settings }) {
  const autostart = useAutostart();
  const { apps, aiApps } = useApps();
  const auto = aiApps[0];
  const chosen = settings.aiApp;
  const missing = chosen && !apps.some((a) => a.id === chosen);
  const others = apps.filter((a) => !aiApps.some((ai) => ai.id === a.id));

  return (
    <>
      <Heading>Запуск</Heading>
      <div className="st-card">
        <Row
          title="Запускать вместе с Windows"
          hint={autostart === null ? "Работает только в установленной версии" : "Остров появится сразу после входа"}
        >
          <Toggle
            on={!!autostart}
            disabled={autostart === null}
            onChange={(on) => invoke<boolean | null>("settings_set_autostart", { on })}
          />
        </Row>
      </div>

      <Heading>Приложения</Heading>
      <div className="st-card">
        <Row title="ИИ-приложение" hint="Открывается из поиска; вопрос копируется — вставь его через Ctrl+V">
          <select
            className="st-select"
            value={chosen ?? ""}
            onChange={(e) => updateSettings({ aiApp: e.target.value || null })}
          >
            <option value="">{auto ? `Автоматически · ${auto.name}` : "Автоматически"}</option>
            {missing && <option value={chosen ?? ""}>Не найдено</option>}
            {aiApps.length > 0 && (
              <optgroup label="ИИ-приложения">
                {aiApps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Все приложения">
                {others.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Row>
        <BrowserRow chosen={settings.browser} />
      </div>

      <Heading>Вкладки острова</Heading>
      <div className="st-card">
        {TABS.map((tab) => {
          const always = tab.id === "launcher";
          const on = always || !settings.hiddenTabs.includes(tab.id);
          return (
            <Row
              key={tab.id}
              title={tab.label}
              hint={always ? `Всегда включён: открывается по ${formatShortcut(settings.hotkeys.launcher)}` : TAB_HINTS[tab.id]}
            >
              <Toggle
                on={on}
                disabled={always}
                onChange={(show) =>
                  updateSettings({
                    hiddenTabs: show
                      ? settings.hiddenTabs.filter((id) => id !== tab.id)
                      : [...settings.hiddenTabs, tab.id],
                  })
                }
              />
            </Row>
          );
        })}
      </div>
    </>
  );
}

const TAB_HINTS: Partial<Record<TabId, string>> = {
  media: "Трек, обложка и управление музыкой",
  weather: "Прогноз и температура в свёрнутом острове",
  shelf: "Файлы, перетащенные на остров",
  clipboard: "История копирования",
};

interface Browser {
  id: string;
  name: string;
}

function BrowserRow({ chosen }: { chosen: string | null }) {
  const [browsers, setBrowsers] = useState<{ all: Browser[]; auto: Browser | null }>({ all: [], auto: null });
  useEffect(() => {
    if (isTauri) invoke<{ all: Browser[]; auto: Browser | null }>("browser_list").then(setBrowsers);
  }, []);
  const missing = chosen && chosen !== "system" && !browsers.all.some((b) => b.id === chosen);

  return (
    <Row title="Браузер" hint="Для поиска в интернете и ссылок из лаунчера">
      <select
        className="st-select"
        value={chosen ?? ""}
        onChange={(e) => updateSettings({ browser: e.target.value || null })}
      >
        <option value="">
          {browsers.auto ? `Автоматически · ${browsers.auto.name}` : "Автоматически"}
        </option>
        <option value="system">Браузер Windows по умолчанию</option>
        {missing && <option value={chosen ?? ""}>Не найден</option>}
        {browsers.all.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </Row>
  );
}

/** Autostart state, live with the tray toggle; null when it can't be changed. */
function useAutostart(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    invoke<boolean | null>("settings_autostart").then(setOn);
    const unlisten = listen<boolean>("lumen://autostart", (e) => setOn(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);
  return on;
}

/* Клавиши */

function KeysSection({ hotkeys }: { hotkeys: Hotkeys }) {
  const busy = useBusyHotkeys();
  const isDefault = HOTKEY_ROWS.every((r) => hotkeys[r.id] === DEFAULT_SETTINGS.hotkeys[r.id]);

  return (
    <>
      {HOTKEY_GROUPS.map((group) => (
        <div key={group.title}>
          <Heading>{group.title}</Heading>
          <div className="st-card">
            {group.rows.map((row) => (
              <HotkeyRow key={row.id} row={row} hotkeys={hotkeys} busy={busy.includes(row.id)} />
            ))}
          </div>
        </div>
      ))}
      <div className="st-footnote">
        Нажми на сочетание и набери новое. Esc — отмена. Действия без сочетания выключены.{" "}
        {!isDefault && (
          <button className="st-link" onClick={() => updateSettings({ hotkeys: DEFAULT_SETTINGS.hotkeys })}>
            Вернуть стандартные
          </button>
        )}
        <div className="st-footnote-note">
          Не советуем ставить Alt+F3: в некоторых программах это сочетание уже занято. P.S. Lackyhy
        </div>
      </div>
    </>
  );
}

function HotkeyRow({ row, hotkeys, busy }: { row: HotkeyRowSpec; hotkeys: Hotkeys; busy: boolean }) {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  // While recording, Lumen lets go of its own shortcuts so they can be pressed here.
  useEffect(() => {
    if (!recording || !isTauri) return;
    invoke("hotkeys_suspend", { suspended: true });
    return () => {
      invoke("hotkeys_suspend", { suspended: false });
    };
  }, [recording]);

  const stop = () => {
    setRecording(false);
    setHeld([]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      stop();
      button.current?.blur();
      return;
    }
    setHeld(heldModifiers(e));
    const shortcut = shortcutFromEvent(e);
    if (!shortcut) return;
    if (!shortcut.includes("+")) {
      setError("Добавь Ctrl, Alt, Shift или Win");
      return;
    }
    const taken = HOTKEY_ROWS.find((r) => r.id !== row.id && hotkeys[r.id] === shortcut);
    if (taken) {
      setError(`Уже занято: ${taken.title.toLowerCase()}`);
      return;
    }
    stop();
    button.current?.blur();
    updateSettings({ hotkeys: { [row.id]: shortcut } }).then(
      () => setError(null),
      (err) => setError(String(err)),
    );
  };

  const parts = recording ? held : shortcutParts(hotkeys[row.id]);
  const clear = () => {
    setError(null);
    updateSettings({ hotkeys: { [row.id]: "" } });
  };

  return (
    <Row
      title={row.title}
      hint={
        error ? (
          <span className="st-error">{error}</span>
        ) : busy ? (
          <span className="st-warn">Занято другим приложением — Lumen подхватит, когда освободится</span>
        ) : (
          row.hint
        )
      }
    >
      <button
        ref={button}
        className={`st-hotkey${recording ? " recording" : ""}`}
        onClick={() => {
          setError(null);
          setRecording(true);
        }}
        onBlur={stop}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => recording && setHeld(heldModifiers(e))}
      >
        {parts.map((p) => (
          <kbd key={p}>{p}</kbd>
        ))}
        {recording && <span className="st-hotkey-prompt">{held.length ? "…" : "Нажми сочетание"}</span>}
        {!recording && !parts.length && <span className="st-hotkey-empty">Не задано</span>}
      </button>
      {row.optional && hotkeys[row.id] && !recording && (
        <button className="st-hotkey-clear" title="Выключить" aria-label="Выключить сочетание" onClick={clear}>
          ×
        </button>
      )}
    </Row>
  );
}

/** Actions whose shortcut another app holds, refreshed as registrations change. */
function useBusyHotkeys(): Action[] {
  const [busy, setBusy] = useState<Action[]>([]);
  useEffect(() => {
    if (!isTauri) return;
    const load = () => invoke<Action[]>("hotkeys_busy").then(setBusy);
    load();
    const unlisten = listen("lumen://hotkeys", load);
    return () => {
      unlisten.then((off) => off());
    };
  }, []);
  return busy;
}

