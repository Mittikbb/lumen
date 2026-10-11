import { useState } from "react";
import { ENGINES } from "../launcher/engines";
import { Heading, Row, Slider } from "./controls";
import { SearchEngine, Settings, updateSettings } from "./useSettings";

const KEEP_DAYS = [
  { value: 0, label: "Всегда" },
  { value: 1, label: "1 день" },
  { value: 7, label: "Неделю" },
  { value: 30, label: "Месяц" },
];

/** Модули: clipboard history, shelf and web search. */
export function ModulesSection({ settings }: { settings: Settings }) {
  const { clipboard, shelf, search } = settings;

  return (
    <>
      <Heading>Буфер обмена</Heading>
      <div className="st-card">
        <Row title="Размер истории" hint="Закреплённые записи не считаются">
          <Slider
            value={clipboard.limit}
            min={10}
            max={200}
            step={10}
            format={(v) => `${v}`}
            onChange={(limit) => updateSettings({ clipboard: { limit } })}
          />
        </Row>
        <Row title="Хранить записи" hint="Закреплённые остаются всегда">
          <select
            className="st-select"
            value={clipboard.keepDays}
            onChange={(e) => updateSettings({ clipboard: { keepDays: Number(e.target.value) } })}
          >
            {KEEP_DAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Row>
        <IgnoreList apps={clipboard.ignore} />
      </div>

      <Heading>Полка</Heading>
      <div className="st-card">
        <Row title="Сколько файлов держать" hint="Старые уходят с полки, сами файлы не трогаются">
          <Slider
            value={shelf.limit}
            min={10}
            max={100}
            step={5}
            format={(v) => `${v}`}
            onChange={(limit) => updateSettings({ shelf: { limit } })}
          />
        </Row>
      </div>

      <Heading>Поиск</Heading>
      <div className="st-card">
        <Row title="Поисковик" hint="Для запросов «Найти в интернете»">
          <select
            className="st-select"
            value={search.engine}
            onChange={(e) => updateSettings({ search: { engine: e.target.value as SearchEngine } })}
          >
            {(Object.keys(ENGINES) as SearchEngine[]).map((id) => (
              <option key={id} value={id}>
                {ENGINES[id].name}
              </option>
            ))}
          </select>
        </Row>
      </div>
    </>
  );
}

/** Apps whose copies the history skips, as removable chips plus an input. */
function IgnoreList({ apps }: { apps: string[] }) {
  const [draft, setDraft] = useState("");
  const save = (ignore: string[]) => updateSettings({ clipboard: { ignore } });
  const add = () => {
    const name = draft.trim().replace(/\.exe$/i, "");
    if (name && !apps.some((a) => a.toLowerCase() === name.toLowerCase())) save([...apps, name]);
    setDraft("");
  };

  return (
    <div className="st-row st-row-wrap">
      <div className="st-row-text">
        <div className="st-row-title">Не запоминать из приложений</div>
        <div className="st-row-hint">Имя программы, например keepass или telegram</div>
      </div>
      <div className="st-chips">
        {apps.map((app) => (
          <span key={app} className="st-chip">
            {app}
            <button aria-label={`Убрать ${app}`} onClick={() => save(apps.filter((a) => a !== app))}>
              ×
            </button>
          </span>
        ))}
        <input
          className="st-chip-input"
          value={draft}
          placeholder="Добавить…"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          onBlur={add}
        />
      </div>
    </div>
  );
}
