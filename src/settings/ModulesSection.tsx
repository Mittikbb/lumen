import { useState } from "react";
import { ENGINES } from "../launcher/engines";
import { playerName } from "../media/useMedia";
import { Heading, Row, Slider, TextField, Toggle } from "./controls";
import { PlayerPrefs, SearchEngine, Settings, updateSettings } from "./useSettings";

const KEEP_DAYS = [
  { value: 0, label: "Всегда" },
  { value: 1, label: "1 день" },
  { value: 7, label: "Неделю" },
  { value: 30, label: "Месяц" },
];

/** Модули: clipboard history, shelf, web search and media. */
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

      <Heading>Медиа</Heading>
      <div className="st-card">
        <Row title="Ползунок громкости" hint="Регулировка громкости трека прямо в плеере">
          <Toggle
            on={settings.media?.volumeSlider ?? true}
            onChange={(volumeSlider) => updateSettings({ media: { volumeSlider } })}
          />
        </Row>
      </div>

      <Heading>Плееры</Heading>
      <Players players={settings.players} />
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

/**
 * Every player that has played something: a name of your own (empty keeps
 * the built-in one) and whether the island shows it at all.
 */
function Players({ players }: { players: PlayerPrefs }) {
  if (!players.known.length) {
    return (
      <div className="st-card">
        <Row title="Пока пусто" hint="Плееры появятся здесь, как только в них что-нибудь заиграет">
          <span />
        </Row>
      </div>
    );
  }
  const show = (id: string, on: boolean) =>
    updateSettings({ players: { hidden: on ? players.hidden.filter((h) => h !== id) : [...players.hidden, id] } });

  return (
    <>
      <div className="st-card">
        {players.known.map((id) => {
          const builtIn = playerName(id);
          return (
            <Row key={id} title={builtIn} hint={id !== builtIn ? id : undefined}>
              <span className="st-player">
                <TextField
                  value={players.names[id] ?? ""}
                  placeholder="Своё название"
                  onCommit={(name) => updateSettings({ players: { names: { [id]: name } } })}
                />
                <Toggle on={!players.hidden.includes(id)} onChange={(on) => show(id, on)} />
              </span>
            </Row>
          );
        })}
      </div>
      <div className="st-footnote">
        Выключенный плеер остров не показывает — вместо него покажет другой, если что-то играет. Его трек не попадёт
        и в статус Discord.
      </div>
    </>
  );
}
