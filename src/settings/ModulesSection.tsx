import { useState } from "react";
import { isMac } from "../island/env";
import { ENGINES } from "../launcher/engines";
import { playerName } from "../media/useMedia";
import { playChime } from "../timer/timer";
import { WeatherSettings } from "./WeatherSettings";
import { Heading, Row, Slider, TextField, Toggle } from "./controls";
import { PlayerPrefs, SearchEngine, Settings, TimerPrefs, updateSettings } from "./useSettings";

const KEEP_DAYS = [
  { value: 0, label: "Всегда" },
  { value: 1, label: "1 день" },
  { value: 7, label: "Неделю" },
  { value: 30, label: "Месяц" },
];

/** Модули: clipboard history, shelf, search, weather, media, players and the timer. */
export function ModulesSection({ settings }: { settings: Settings }) {
  const { clipboard, shelf, search, timer } = settings;
  const setTimer = (patch: Partial<TimerPrefs>) => updateSettings({ timer: patch });

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
        <Row title="Сколько программ показывать" hint="Найденных по названию, в одном поиске">
          <Slider
            value={search.apps}
            min={3}
            max={10}
            format={(v) => `${v}`}
            onChange={(apps) => updateSettings({ search: { apps } })}
          />
        </Row>
      </div>

      <Heading>Погода</Heading>
      <WeatherSettings settings={settings} />

      {/* No per-player volume on macOS yet. */}
      {!isMac && (
        <>
          <Heading>Медиа</Heading>
          <div className="st-card">
            <Row title="Ползунок громкости" hint="Регулировка громкости трека прямо в плеере">
              <Toggle
                on={settings.media?.volumeSlider ?? true}
                onChange={(volumeSlider) => updateSettings({ media: { volumeSlider } })}
              />
            </Row>
          </div>
        </>
      )}

      <Heading>Плееры</Heading>
      <Players players={settings.players} />

      <Heading>Загрузки</Heading>
      <div className="st-card">
        <Row
          title="Показывать загрузки"
          hint="Пока браузер качает файл в «Загрузки», остров показывает имя, размер и скорость; готовый файл — по клику в папке"
        >
          <Toggle
            on={settings.downloads.enabled}
            onChange={(enabled) => updateSettings({ downloads: { enabled } })}
          />
        </Row>
      </div>

      <Heading>Таймер</Heading>
      <div className="st-card">
        <Row title="Звук по окончании" hint="«таймер 10м» в поиске — капля справа от острова">
          <Toggle on={timer.sound} onChange={(sound) => setTimer({ sound })} />
        </Row>
        {timer.sound && (
          <Row title="Громкость звука">
            <span className="st-player">
              <Slider
                value={Math.round(timer.volume * 100)}
                min={10}
                max={100}
                step={10}
                format={(v) => `${v}%`}
                onChange={(v) => setTimer({ volume: v / 100 })}
              />
              <button className="st-button quiet" onClick={() => playChime(timer.volume)}>
                Послушать
              </button>
            </span>
          </Row>
        )}
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
