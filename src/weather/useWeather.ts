import { useEffect, useRef, useState } from "react";
import { updateSettings, WeatherPrefs } from "../settings/useSettings";
import { isWet } from "./conditions";

/** Weather from Open-Meteo: free, no API key, CORS-enabled. */
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";


/** Where the city lived before the settings window; moved into the settings once. */
const LEGACY_CITY_KEY = "lumen.weather.city";
const ALERTED_KEY = "lumen.weather.alerted";

export interface City {
  name: string;
  /** Region and country, for telling same-named places apart. */
  area: string;
  latitude: number;
  longitude: number;
}

export interface Day {
  date: string;
  code: number;
  min: number;
  max: number;
  rainChance: number;
}

export interface Forecast {
  temp: number;
  feelsLike: number;
  code: number;
  day: boolean;
  days: Day[];
  /** Next 24 hours, starting with the current hour. */
  hours: { time: string; temp: number; code: number; rainChance: number }[];
}

export interface RainAlert {
  /** "Через час дождь", "Скоро снег"... */
  title: string;
  /** "с 19:00 · 8°" */
  detail: string;
}

/** Marks the move as done; the old key stays, so older versions keep their city. */
const MIGRATED_KEY = "lumen.weather.migrated";

function takeLegacyCity(): City | null {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return null;
    localStorage.setItem(MIGRATED_KEY, "1");
    return JSON.parse(localStorage.getItem(LEGACY_CITY_KEY) ?? "null");
  } catch {
    return null;
  }
}

export const setCity = (city: City | null) => updateSettings({ city });

async function searchCities(query: string): Promise<City[]> {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=5&language=ru&format=json`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((r: any) => ({
    name: r.name,
    area: [r.admin1, r.country].filter(Boolean).join(", "),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

const SEARCH_DEBOUNCE_MS = 300;

/** Cities matching the query, looked up a beat after typing stops. */
export function useCitySearch(query: string): City[] {
  const [results, setResults] = useState<City[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      searchCities(q)
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults([]));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  return results;
}

async function fetchForecast(city: City, units: WeatherPrefs["units"]): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    current: "temperature_2m,apparent_temperature,weather_code,is_day",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "7",
    temperature_unit: units === "f" ? "fahrenheit" : "celsius",
  });
  const res = await fetch(`${FORECAST_URL}?${params}`);
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const d = await res.json();

  // Hourly times are local to the city; find the current hour by its prefix.
  const nowHour = d.current.time.slice(0, 13);
  const start = Math.max(0, d.hourly.time.findIndex((t: string) => t.startsWith(nowHour)));

  return {
    temp: Math.round(d.current.temperature_2m),
    feelsLike: Math.round(d.current.apparent_temperature),
    code: d.current.weather_code,
    day: d.current.is_day === 1,
    days: d.daily.time.map((date: string, i: number) => ({
      date,
      code: d.daily.weather_code[i],
      min: Math.round(d.daily.temperature_2m_min[i]),
      max: Math.round(d.daily.temperature_2m_max[i]),
      rainChance: d.daily.precipitation_probability_max[i] ?? 0,
    })),
    hours: d.hourly.time.slice(start, start + 24).map((time: string, i: number) => ({
      time,
      temp: Math.round(d.hourly.temperature_2m[start + i]),
      code: d.hourly.weather_code[start + i],
      rainChance: d.hourly.precipitation_probability[start + i] ?? 0,
    })),
  };
}

/** A heads-up when it's dry now but rain or snow is likely within the hour. */
export function rainAlert(f: Forecast, minChance: number): { key: string; alert: RainAlert } | null {
  if (isWet(f.code)) return null;
  const next = f.hours[1];
  if (!next || next.rainChance < minChance || !isWet(next.code)) return null;
  const snow = [71, 73, 75, 77, 85, 86].includes(next.code);
  return {
    key: next.time,
    alert: {
      title: snow ? "Через час снег" : "Через час дождь",
      detail: `с ${next.time.slice(11, 16)} · ${next.temp}°`,
    },
  };
}

/**
 * Current weather and forecast for the city from the settings (`undefined`
 * while they load), refreshed every 15 min. `onAlert` fires once per upcoming
 * rain spell.
 */
export function useWeather(
  city: City | null | undefined,
  prefs: WeatherPrefs,
  onAlert: (alert: RainAlert) => void,
) {
  const { units, rainChance, refreshMinutes } = prefs;
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState(false);
  const alertRef = useRef(onAlert);
  alertRef.current = onAlert;

  useEffect(() => {
    if (city !== null) return;
    const legacy = takeLegacyCity();
    if (legacy) setCity(legacy);
  }, [city]);

  // Settings arrive as fresh objects on every change; only a new place matters.
  const place = city ? `${city.latitude},${city.longitude}` : "";
  const cityRef = useRef(city);
  cityRef.current = city;

  useEffect(() => {
    setForecast(null);
    setError(false);
    const city = cityRef.current;
    if (!city) return;
    let alive = true;

    const load = async () => {
      try {
        const f = await fetchForecast(city, units);
        if (!alive) return;
        setForecast(f);
        setError(false);

        const rain = rainAlert(f, rainChance);
        if (rain && localStorage.getItem(ALERTED_KEY) !== rain.key) {
          localStorage.setItem(ALERTED_KEY, rain.key);
          alertRef.current(rain.alert);
        }
      } catch {
        if (alive) setError(true);
      }
    };

    load();
    const timer = setInterval(load, refreshMinutes * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [place, units, rainChance, refreshMinutes]);

  return { forecast, error };
}
