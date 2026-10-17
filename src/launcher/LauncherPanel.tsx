import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { calculate, formatNumber, plainNumber } from "./calc";
import { convert } from "./units";
import {
  searchHttpCodes,
  getDropletAccent,
  getCategoryName,
  NetworkSearchResult,
} from "./httpCodes";
import { fuzzyScore } from "./fuzzy";
import { App, launcher, useAppIcon, useApps } from "./useLauncher";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../island/env";
import { formatShortcut, Hotkeys, openSettings, SearchEngine, CodeBorderColor } from "../settings/useSettings";
import { ENGINES } from "./engines";
import { formatSpan, isTimerQuery, parseTimer, timer } from "../timer/timer";
import { AddonResults, prefixOwner, selectAddonResult, useAddonSearch } from "../addons/host";
import { AddonIcon } from "../addons/AddonPanel";
import { ensureFresh, useLookupData } from "./lookupData";

const URL_LIKE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

interface Result {
  key: string;
  icon: ReactNode;
  title: ReactNode;
  hint: string;
  data?: NetworkSearchResult;
  run: () => void;
}

const icon = (d: ReactNode) => <svg viewBox="0 0 24 24">{d}</svg>;
const ICONS = {
  calc: icon(<path d="M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 8h6M9 13h.01M12 13h.01M15 13h.01M9 16h.01M12 16h.01M15 16h.01" />),
  convert: icon(<path d="M7 7h11l-3-3M17 17H6l3 3" />),
  http: icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a14 14 0 0 0 0 18M12 3a14 14 0 0 1 0 18M3.6 9h16.8M3.6 15h16.8" />
    </>
  ),
  web: icon(<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />),
  shot: icon(<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />),
  scan: icon(<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8M8 12h8M8 15h5" />),
  settings: icon(<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4L10.7 6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z" />),
  timer: icon(<path d="M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />),
  link: icon(<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />),
};

function AppIcon({ app }: { app: App }) {
  const icon = useAppIcon(app.id);
  if (icon) return <img className="app-icon" src={icon} alt="" draggable={false} />;

  // Letter avatar while the icon loads, or for apps without one.
  const { name } = app;
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="app-letter" style={{ background: `hsl(${hue} 45% 32%)` }}>
      {name.trim()[0]?.toUpperCase()}
    </span>
  );
}

function buildResults(
  query: string,
  apps: App[],
  ai: App | null,
  hotkeys: Hotkeys,
  engine: SearchEngine,
  maxApps: number,
  lookup: boolean,
  addons: AddonResults[],
): Result[] {
  const q = query.trim();
  const out: Result[] = [];

  if (!q) {
    if (ai) {
      out.push({ key: "ai", icon: <AppIcon app={ai} />, title: `Открыть ${ai.name}`, hint: "ИИ", run: () => launcher.run(ai.id) });
    }
    return out;
  }

  // An addon owns queries with its prefix ("-ipconfig"): only its answers,
  // so Enter can't fall through to a web search while it's still thinking.
  const owner = prefixOwner(q);
  if (owner) return addonRows(addons.filter((r) => r.addon.id === owner.id));

  // Screen capture by keyword: "скрин", "screenshot", "текст", "ocr"...
  const lower = q.toLowerCase();
  const startCapture = (mode: "shot" | "text") => {
    launcher.close(true);
    if (isTauri) invoke("capture_start", { mode });
  };
  if (/^(скрин|снимок|screen|shot)/.test(lower)) {
    out.push({ key: "shot", icon: ICONS.shot, title: "Скриншот области", hint: formatShortcut(hotkeys.screenshot), run: () => startCapture("shot") });
  }
  if (/^(текст с|распозн|ocr|скан)/.test(lower)) {
    out.push({ key: "ocr", icon: ICONS.scan, title: "Текст с экрана", hint: formatShortcut(hotkeys.text), run: () => startCapture("text") });
  }

  if (/^(настр|settings|lumen)/.test(lower)) {
    const run = () => {
      launcher.close(false);
      openSettings();
    };
    out.push({ key: "settings", icon: ICONS.settings, title: "Настройки Lumen", hint: "Lumen", run });
  }

  // "таймер 10м": a countdown in a drop on the island's right.
  const span = parseTimer(q);
  if (span) {
    const run = () => {
      timer.start(span);
      launcher.close(true);
    };
    out.push({ key: "timer", icon: ICONS.timer, title: `Таймер на ${formatSpan(span)}`, hint: "Enter — запустить", run });
  } else if (isTimerQuery(q)) {
    const running = timer.get();
    if (running && !running.doneAt) {
      const run = () => {
        timer.stop();
        launcher.close(true);
      };
      out.push({ key: "timer", icon: ICONS.timer, title: `Отменить таймер на ${formatSpan(running.total)}`, hint: "Таймер", run });
    } else {
      out.push({ key: "timer", icon: ICONS.timer, title: "Таймер: допиши время", hint: "10м · 1ч 30м · 90с · 1:30", run: () => {} });
    }
  }

  const value = calculate(q);
  if (value !== null) {
    out.push({
      key: "calc",
      icon: ICONS.calc,
      title: <>= {formatNumber(value)}</>,
      hint: "Калькулятор · Enter — скопировать",
      run: () => launcher.copy(plainNumber(value)),
    });
  }

  const conversion = convert(q);
  if (conversion) {
    out.push({
      key: "convert",
      icon: ICONS.convert,
      title: `${formatNumber(conversion.value)} ${conversion.unit}`,
      hint: "Перевод величин · Enter — скопировать",
      run: () => launcher.copy(plainNumber(conversion.value)),
    });
  }

  // Codes and protocols only when switched on (Расширенные), and only with a
  // colon (h:404, http:dns) or as h404, so ordinary searches stay ordinary.
  const isHelpQuery = lookup && (/^hhelp:?/i.test(q) || /^(?:h|http):help/i.test(q));
  const isHttpQuery = lookup && (isHelpQuery || /^(?:h|http):/i.test(q) || /^h\d{3}$/i.test(q));
  const httpResults = isHttpQuery ? searchHttpCodes(q) : [];
  if (httpResults.length > 0) {
    for (const item of httpResults) {
      if (item.kind === "github-help") {
        out.push({
          key: `http:help:${item.url}`,
          icon: ICONS.link,
          data: item,
          title: (
            <span className="result-http-title">
              <span className="http-tag http-tag-help">GitHub</span>
              <span className="http-phrase">Protocol-list</span>
              <span className="http-sep">·</span>
              <span className="http-name-ru">{item.title}</span>
            </span>
          ),
          hint: `${item.hint} · Enter — открыть инфо`,
          run: () => launcher.openUrl(item.url),
        });
      } else if (item.kind === "protocol") {
        out.push({
          key: `prot:${item.id}`,
          icon: ICONS.http,
          data: item,
          title: (
            <span className="result-http-title">
              <span className="http-tag http-tag-prot">Протокол</span>
              <span className="http-phrase">{item.name}</span>
              <span className="http-sep">·</span>
              <span className="http-name-ru">{item.fullName}</span>
            </span>
          ),
          hint: `${item.description} · Enter — открыть инфо`,
          run: () => launcher.copy(`${item.name} (${item.fullName}): ${item.description}`),
        });
      } else {
        out.push({
          key: `http:${item.code}`,
          icon: ICONS.http,
          data: item,
          title: (
            <span className="result-http-title">
              <span className={`http-tag http-tag-${item.category}`}>{item.code}</span>
              <span className="http-phrase">{item.phrase}</span>
              <span className="http-sep">·</span>
              <span className="http-name-ru">{item.nameRu}</span>
            </span>
          ),
          hint: `${item.description} · Enter — открыть инфо`,
          run: () => launcher.copy(`HTTP ${item.code} ${item.phrase} (${item.nameRu}): ${item.description}`),
        });
      }
    }
  } else if (isHttpQuery && !/^https?:\/\//i.test(q)) {
    out.push({
      key: "http:not-found",
      icon: ICONS.http,
      title: "Код или протокол не найден",
      hint: "Попробуй h:200, h:404, h:dns, h:tcp, h:wireguard или напиши hHelp:",
      run: () => {},
    });
  }

  if (!isHttpQuery) {
    apps
      .map((app) => ({ app, score: fuzzyScore(app.name, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxApps)
      .forEach(({ app }) =>
        out.push({
          key: `app:${app.id}`,
          icon: <AppIcon app={app} />,
          title: app.name,
          hint: "Приложение",
          run: () => launcher.run(app.id),
        }),
      );
  }

  // Answers from addons, after the apps: they arrive a moment later, so the
  // first results don't move under the cursor.
  if (!isHttpQuery) out.push(...addonRows(addons));

  if (URL_LIKE.test(q)) {
    const url = /^https?:\/\//i.test(q) ? q : `https://${q}`;
    out.push({ key: "url", icon: ICONS.link, title: `Открыть ${q}`, hint: "Сайт", run: () => launcher.openUrl(url) });
  }

  if (ai) {
    out.push({
      key: "ai",
      icon: <AppIcon app={ai} />,
      title: <>Спросить {ai.name}: «{q}»</>,
      hint: "Запрос скопируется — вставь его через Ctrl+V",
      run: () => launcher.askAi(ai.id, q),
    });
  }

  out.push({
    key: "web",
    icon: ICONS.web,
    title: <>Найти в интернете: «{q}»</>,
    hint: `Поиск ${(ENGINES[engine] ?? ENGINES.google).name}`,
    run: () => launcher.openUrl((ENGINES[engine] ?? ENGINES.google).url(q)),
  });

  return out;
}

function addonRows(addons: AddonResults[]): Result[] {
  return addons.flatMap(({ addon, items }) =>
    items.map((item) => ({
      key: `addon:${addon.id}:${item.id}`,
      icon: <AddonIcon addon={addon} icon={item.icon} />,
      title: item.title,
      hint: item.hint ? `${item.hint} · ${addon.name}` : addon.name,
      run: () => selectAddonResult(addon, item),
    })),
  );
}

function DropletCard({
  item,
  onClose,
  copied,
  onCopy,
  codeBorderColor = "code",
  dropletGlassBlur = true,
}: {
  item: NetworkSearchResult;
  onClose: () => void;
  copied: boolean;
  onCopy: () => void;
  codeBorderColor?: CodeBorderColor;
  dropletGlassBlur?: boolean;
}) {
  const codeAccent = getDropletAccent(item);
  const borderAccent = codeBorderColor === "theme" ? "var(--glow-a)" : codeAccent;

  return (
    <motion.div
      key="droplet-card"
      className={`droplet-card${codeBorderColor === "theme" ? " theme-border" : ""}${!dropletGlassBlur ? " no-blur" : ""}`}
      style={{
        "--droplet-accent": codeAccent,
        "--droplet-border": borderAccent,
        transformOrigin: "0% 50%",
      } as React.CSSProperties}
      initial={{ opacity: 0, x: -24, scaleX: 0.74, scaleY: 0.9, filter: "blur(6px)" }}
      animate={{ opacity: 1, x: 0, scaleX: 1, scaleY: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, x: -18, scaleX: 0.78, scaleY: 0.92, filter: "blur(4px)" }}
      transition={{ type: "spring", stiffness: 340, damping: 22, mass: 0.7 }}
    >
      <div className="droplet-header">
        <div className="droplet-badge-group">
          {item.kind === "http" ? (
            <>
              <span className={`droplet-badge http-tag-${item.category}`}>{item.code}</span>
              <span className="droplet-phrase">{item.phrase}</span>
            </>
          ) : item.kind === "protocol" ? (
            <>
              <span className="droplet-badge http-tag-prot">Протокол</span>
              <span className="droplet-phrase">{item.name}</span>
            </>
          ) : (
            <>
              <span className="droplet-badge http-tag-help">GitHub</span>
              <span className="droplet-phrase">Protocol-list</span>
            </>
          )}
        </div>
        <button className="droplet-close" onClick={onClose} aria-label="Закрыть" title="Закрыть (Esc)">
          <svg viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="droplet-sub">
        {item.kind === "http" ? (
          <>
            <span className="droplet-category-label">{getCategoryName(item.category)}</span>
            <span className="droplet-name-ru">{item.nameRu}</span>
          </>
        ) : item.kind === "protocol" ? (
          <>
            <span className="droplet-category-label">Сетевой протокол</span>
            <span className="droplet-name-ru">{item.fullName}</span>
          </>
        ) : (
          <>
            <span className="droplet-category-label">Репозиторий</span>
            <span className="droplet-name-ru">Справочник протоколов lackyhy</span>
          </>
        )}
      </div>

      <div className="droplet-desc">
        {item.kind === "http"
          ? item.description
          : item.kind === "protocol"
            ? item.description
            : "Полный справочник сетевых протоколов и HTTP кодов на GitHub."}
      </div>

      <div className="droplet-actions">
        <div className="droplet-btn-row">
          <button className={`droplet-btn primary${copied ? " copied" : ""}`} onClick={onCopy}>
            {copied ? (
              <>
                <svg viewBox="0 0 24 24">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Скопировано!
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24">
                  <rect x="9" y="9" width="11" height="11" rx="2.5" />
                  <path d="M5 15V6a2 2 0 0 1 2-2h8" />
                </svg>
                Скопировать
              </>
            )}
          </button>
          <button
            className="droplet-btn"
            onClick={() =>
              launcher.openUrl(
                item.kind === "http"
                  ? "https://github.com/lackyhy/Protocol-list/blob/main/prot/HTTP.md"
                  : item.kind === "protocol"
                    ? item.docUrl
                    : item.url,
              )
            }
          >
            <svg viewBox="0 0 24 24">
              <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
            </svg>
            GitHub
          </button>
        </div>
        <div className="droplet-kbd-hint">
          <kbd>Enter</kbd> скопировать · <kbd>Esc</kbd> закрыть
        </div>
      </div>
    </motion.div>
  );
}

export function LauncherPanel({
  open,
  hotkeys,
  engine,
  maxApps = 5,
  lookup = false,
  detailItem,
  onDetailChange,
  codeBorderColor = "code",
  dropletGlassBlur = true,
}: {
  open: boolean;
  hotkeys: Hotkeys;
  engine: SearchEngine;
  /** How many programs a search lists at most. */
  maxApps?: number;
  /** HTTP codes and network protocols in search. */
  lookup?: boolean;
  detailItem?: NetworkSearchResult | null;
  onDetailChange?: (item: NetworkSearchResult | null) => void;
  codeBorderColor?: CodeBorderColor;
  dropletGlassBlur?: boolean;
}) {
  const { apps, ai } = useApps();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);
  const [internalDetail, setInternalDetail] = useState<NetworkSearchResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const currentDetail = detailItem !== undefined ? detailItem : internalDetail;
  const setDetail = (item: NetworkSearchResult | null) => {
    setInternalDetail(item);
    onDetailChange?.(item);
  };

  const addonResults = useAddonSearch(query);
  // Codes and protocols from Protocol-list on GitHub, over the built-in ones.
  const lookupData = useLookupData(lookup);
  const results = useMemo(
    () => buildResults(query, apps, ai, hotkeys, engine, maxApps, lookup, addonResults),
    // lookupData: a new copy of the list changes what the same query finds.
    [query, apps, ai, hotkeys, engine, maxApps, lookup, addonResults, lookupData],
  );

  // Fresh, focused search box every time the launcher opens.
  useEffect(() => {
    if (open && lookup) ensureFresh();
  }, [open, lookup]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setDetail(null);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSelected(0);
    setDetail(null);
  }, [query]);

  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const handleCopyCurrent = () => {
    if (!currentDetail) return;
    if (currentDetail.kind === "http") {
      launcher.copy(
        `HTTP ${currentDetail.code} ${currentDetail.phrase} (${currentDetail.nameRu}): ${currentDetail.description}`,
      );
    } else if (currentDetail.kind === "protocol") {
      launcher.copy(`${currentDetail.name} (${currentDetail.fullName}): ${currentDetail.description}`);
    } else {
      launcher.copy(currentDetail.url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = Math.min(selected + 1, results.length - 1);
      setSelected(nextIdx);
      if (currentDetail) {
        setDetail(results[nextIdx]?.data ?? null);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIdx = Math.max(selected - 1, 0);
      setSelected(prevIdx);
      if (currentDetail) {
        setDetail(results[prevIdx]?.data ?? null);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = results[selected];
      if (!current) return;
      if (current.data) {
        if (currentDetail && currentDetail === current.data) {
          handleCopyCurrent();
        } else {
          setDetail(current.data);
        }
      } else {
        current.run();
      }
    } else if (e.key === "Escape") {
      if (currentDetail) {
        e.preventDefault();
        setDetail(null);
      } else {
        launcher.close(true);
      }
    }
  };

  return (
    <div className={`panel launcher${currentDetail ? " has-detail" : ""}`}>
      <div className="launcher-main">
        <label className="search-box">
          <svg viewBox="0 0 24 24">
            <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />
          </svg>
          <input
            ref={input}
            value={query}
            placeholder="Приложение, пример или вопрос"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            // Clicking the box opens the launcher so the window accepts typing.
            onMouseDown={() => !open && launcher.open()}
          />
          <kbd>{formatShortcut(hotkeys.launcher)}</kbd>
        </label>

        <ul className="results" ref={list}>
          {results.map((r, i) => (
            <li
              key={r.key}
              className={`result${i === selected ? " selected" : ""}`}
              onMouseMove={() => setSelected(i)}
              onClick={() => {
                if (r.data) {
                  setDetail(r.data);
                } else {
                  r.run();
                }
              }}
            >
              <span className="result-icon">{r.icon}</span>
              <span className="result-main">
                <span className="result-title">{r.title}</span>
                <span className="result-hint">{r.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <AnimatePresence>
        {currentDetail && (
          <DropletCard
            item={currentDetail}
            copied={copied}
            onCopy={handleCopyCurrent}
            onClose={() => setDetail(null)}
            codeBorderColor={codeBorderColor}
            dropletGlassBlur={dropletGlassBlur}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
