import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { calculate, formatNumber, plainNumber } from "./calc";
import { convert } from "./units";
import { fuzzyScore } from "./fuzzy";
import { App, launcher, useApps } from "./useLauncher";

const MAX_APPS = 5;
const URL_LIKE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

interface Result {
  key: string;
  icon: ReactNode;
  title: ReactNode;
  hint: string;
  run: () => void;
}

const icon = (d: ReactNode) => <svg viewBox="0 0 24 24">{d}</svg>;
const ICONS = {
  calc: icon(<path d="M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 8h6M9 13h.01M12 13h.01M15 13h.01M9 16h.01M12 16h.01M15 16h.01" />),
  convert: icon(<path d="M7 7h11l-3-3M17 17H6l3 3" />),
  ai: icon(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />),
  web: icon(<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />),
  link: icon(<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />),
};

function AppIcon({ name }: { name: string }) {
  // Stable colour per app until real icons are extracted.
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="app-letter" style={{ background: `hsl(${hue} 45% 32%)` }}>
      {name.trim()[0]?.toUpperCase()}
    </span>
  );
}

function buildResults(query: string, apps: App[], ai: App | null): Result[] {
  const q = query.trim();
  const out: Result[] = [];

  if (!q) {
    if (ai) {
      out.push({ key: "ai", icon: ICONS.ai, title: `Открыть ${ai.name}`, hint: "ИИ", run: () => launcher.run(ai.id) });
    }
    return out;
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

  apps
    .map((app) => ({ app, score: fuzzyScore(app.name, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_APPS)
    .forEach(({ app }) =>
      out.push({
        key: `app:${app.id}`,
        icon: <AppIcon name={app.name} />,
        title: app.name,
        hint: "Приложение",
        run: () => launcher.run(app.id),
      }),
    );

  if (URL_LIKE.test(q)) {
    const url = /^https?:\/\//i.test(q) ? q : `https://${q}`;
    out.push({ key: "url", icon: ICONS.link, title: `Открыть ${q}`, hint: "Сайт", run: () => launcher.openUrl(url) });
  }

  if (ai) {
    out.push({
      key: "ai",
      icon: ICONS.ai,
      title: <>Спросить {ai.name}: «{q}»</>,
      hint: "Запрос скопируется — вставь его через Ctrl+V",
      run: () => launcher.askAi(ai.id, q),
    });
  }

  out.push({
    key: "web",
    icon: ICONS.web,
    title: <>Найти в Chrome: «{q}»</>,
    hint: "Поиск Google",
    run: () => launcher.openUrl(`https://www.google.com/search?q=${encodeURIComponent(q)}`),
  });

  return out;
}

export function LauncherPanel({ open }: { open: boolean }) {
  const { apps, ai } = useApps();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => buildResults(query, apps, ai), [query, apps, ai]);

  // Fresh, focused search box every time the launcher opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      results[selected]?.run();
    } else if (e.key === "Escape") {
      launcher.close(true);
    }
  };

  return (
    <div className="panel launcher">
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
        <kbd>Alt+Space</kbd>
      </label>

      <ul className="results" ref={list}>
        {results.map((r, i) => (
          <li
            key={r.key}
            className={`result${i === selected ? " selected" : ""}`}
            onMouseMove={() => setSelected(i)}
            onClick={r.run}
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
  );
}
