import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "../island/env";
import { City, setCity, useCitySearch } from "../weather/useWeather";
import { Row, Segmented, Slider } from "./controls";
import { Settings, updateSettings } from "./useSettings";

const REFRESH = [10, 15, 30, 60];

/** Погода (in Модули): the city, units, the rain warning and how often to refresh. */
export function WeatherSettings({ settings }: { settings: Settings }) {
  const { city, weather } = settings;
  const [picking, setPicking] = useState(!city);
  const [query, setQuery] = useState("");
  const results = useCitySearch(query);

  const pick = (c: City | null) => {
    setCity(c);
    setQuery("");
    setPicking(!c);
  };

  return (
    <>
      {city && !picking ? (
        <div className="st-card">
          <Row title={city.name} hint={city.area}>
            <div className="st-buttons">
              <button className="st-button" onClick={() => setPicking(true)}>
                Сменить
              </button>
              <button className="st-button quiet" onClick={() => pick(null)}>
                Убрать
              </button>
            </div>
          </Row>
        </div>
      ) : (
        <div className="st-card st-city-search">
          <label className="st-input">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />
            </svg>
            <input
              autoFocus={!!city}
              value={query}
              placeholder="Город, например Казань"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results[0]) pick(results[0]);
                if (e.key === "Escape" && city) setPicking(false);
              }}
            />
          </label>
          {results.length > 0 && (
            <ul className="st-results">
              {results.map((c) => (
                <li key={`${c.latitude},${c.longitude}`}>
                  <button onClick={() => pick(c)}>
                    <span>{c.name}</span>
                    <span className="st-row-hint">{c.area}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="st-card">
        <Row title="Единицы">
          <Segmented
            value={weather.units}
            options={[
              { value: "c", label: "°C" },
              { value: "f", label: "°F" },
            ]}
            onChange={(units) => updateSettings({ weather: { units } })}
          />
        </Row>
        <Row title="Предупреждать о дожде" hint="Если вероятность в ближайший час не ниже">
          <Slider
            value={weather.rainChance}
            min={30}
            max={90}
            step={5}
            format={(v) => `${v}%`}
            onChange={(rainChance) => updateSettings({ weather: { rainChance } })}
          />
        </Row>
        <Row title="Обновлять">
          <select
            className="st-select"
            value={weather.refreshMinutes}
            onChange={(e) => updateSettings({ weather: { refreshMinutes: Number(e.target.value) } })}
          >
            {REFRESH.map((m) => (
              <option key={m} value={m}>
                {`раз в ${m} мин`}
              </option>
            ))}
          </select>
        </Row>
      </div>
      <div className="st-footnote">
        Прогноз от <button className="st-link" onClick={() => open("https://open-meteo.com")}>Open-Meteo</button>.
      </div>
    </>
  );
}

const open = (url: string) => (isTauri ? openUrl(url) : window.open(url, "_blank"));
