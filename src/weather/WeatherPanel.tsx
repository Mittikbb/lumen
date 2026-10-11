import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../island/env";
import { condition } from "./conditions";
import { City, Day, Forecast, useCitySearch } from "./useWeather";
import { WeatherIcon } from "./WeatherIcon";

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

// Typing needs the normally non-activating window to take keyboard focus.
const takeFocus = () => isTauri && invoke("overlay_take_focus");
const releaseFocus = (restoreFocus: boolean) => isTauri && invoke("overlay_release_focus", { restoreFocus });

interface Props {
  city: City | null;
  forecast: Forecast | null;
  error: boolean;
  onCity: (city: City) => void;
}

export function WeatherPanel({ city, forecast, error, onCity }: Props) {
  const [picking, setPicking] = useState(false);

  if (!city || picking) {
    return (
      <CityPicker
        onPick={(c) => {
          onCity(c);
          setPicking(false);
        }}
        onCancel={city ? () => setPicking(false) : undefined}
      />
    );
  }

  if (!forecast) {
    return <div className="panel empty">{error ? "Не удалось загрузить погоду" : "Загружаю погоду…"}</div>;
  }

  const { text, sky } = condition(forecast.code);
  const weekMin = Math.min(...forecast.days.map((d) => d.min));
  const weekMax = Math.max(...forecast.days.map((d) => d.max));

  return (
    <div className="panel weather">
      <div className="wx-now">
        <button className="wx-city" onClick={() => setPicking(true)} title="Сменить город">
          {city.name}
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
          </svg>
        </button>
        <div className="wx-temp">
          <WeatherIcon sky={sky} day={forecast.day} />
          <span>{forecast.temp}°</span>
        </div>
        <div className="wx-text">{text}</div>
        <div className="wx-feels">Ощущается как {forecast.feelsLike}°</div>
      </div>

      <ul className="wx-days">
        {forecast.days.map((day, i) => (
          <DayRow key={day.date} day={day} today={i === 0} weekMin={weekMin} weekMax={weekMax} />
        ))}
      </ul>
    </div>
  );
}

function DayRow({ day, today, weekMin, weekMax }: { day: Day; today: boolean; weekMin: number; weekMax: number }) {
  const span = Math.max(1, weekMax - weekMin);
  const left = ((day.min - weekMin) / span) * 100;
  const width = Math.max(6, ((day.max - day.min) / span) * 100);
  const label = today ? "Сегодня" : WEEKDAYS[new Date(`${day.date}T12:00`).getDay()];

  return (
    <li className="wx-day">
      <span className="wx-day-name">{label}</span>
      <WeatherIcon sky={condition(day.code).sky} />
      <span className="wx-chance">{day.rainChance >= 30 ? `${day.rainChance}%` : ""}</span>
      <span className="wx-min">{day.min}°</span>
      <span className="wx-range">
        <i style={{ left: `${left}%`, width: `${width}%` }} />
      </span>
      <span className="wx-max">{day.max}°</span>
    </li>
  );
}

function CityPicker({ onPick, onCancel }: { onPick: (city: City) => void; onCancel?: () => void }) {
  const [query, setQuery] = useState("");
  const results = useCitySearch(query);
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // Ask for keyboard focus as soon as the picker shows; give it back on unmount.
  useEffect(() => {
    takeFocus();
    requestAnimationFrame(() => input.current?.focus());
    return () => {
      releaseFocus(false);
    };
  }, []);

  useEffect(() => setSelected(0), [results]);

  const pick = (city: City) => {
    releaseFocus(true);
    onPick(city);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      pick(results[selected]);
    } else if (e.key === "Escape") {
      releaseFocus(true);
      onCancel?.();
    }
  };

  return (
    <div className="panel launcher">
      <label className="search-box">
        <svg viewBox="0 0 24 24">
          <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
        </svg>
        <input
          ref={input}
          value={query}
          placeholder="Твой город, например Казань"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onMouseDown={() => takeFocus()}
        />
        {onCancel && <kbd>Esc</kbd>}
      </label>

      <ul className="results">
        {results.map((c, i) => (
          <li
            key={`${c.latitude},${c.longitude}`}
            className={`result${i === selected ? " selected" : ""}`}
            onMouseMove={() => setSelected(i)}
            onClick={() => pick(c)}
          >
            <span className="result-main">
              <span className="result-title">{c.name}</span>
              <span className="result-hint">{c.area}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
