/** Icon shapes used for weather conditions. */
export type Sky = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

interface Condition {
  text: string;
  sky: Sky;
}

/** WMO weather interpretation codes, as returned by Open-Meteo. */
const CODES: Record<number, Condition> = {
  0: { text: "Ясно", sky: "clear" },
  1: { text: "Почти ясно", sky: "partly" },
  2: { text: "Переменная облачность", sky: "partly" },
  3: { text: "Пасмурно", sky: "cloudy" },
  45: { text: "Туман", sky: "fog" },
  48: { text: "Изморозь", sky: "fog" },
  51: { text: "Слабая морось", sky: "drizzle" },
  53: { text: "Морось", sky: "drizzle" },
  55: { text: "Сильная морось", sky: "drizzle" },
  56: { text: "Ледяная морось", sky: "drizzle" },
  57: { text: "Ледяная морось", sky: "drizzle" },
  61: { text: "Небольшой дождь", sky: "rain" },
  63: { text: "Дождь", sky: "rain" },
  65: { text: "Ливень", sky: "rain" },
  66: { text: "Ледяной дождь", sky: "rain" },
  67: { text: "Ледяной дождь", sky: "rain" },
  71: { text: "Небольшой снег", sky: "snow" },
  73: { text: "Снег", sky: "snow" },
  75: { text: "Снегопад", sky: "snow" },
  77: { text: "Снежная крупа", sky: "snow" },
  80: { text: "Кратковременный дождь", sky: "rain" },
  81: { text: "Ливень", sky: "rain" },
  82: { text: "Сильный ливень", sky: "rain" },
  85: { text: "Снег", sky: "snow" },
  86: { text: "Сильный снег", sky: "snow" },
  95: { text: "Гроза", sky: "storm" },
  96: { text: "Гроза с градом", sky: "storm" },
  99: { text: "Гроза с градом", sky: "storm" },
};

export function condition(code: number): Condition {
  return CODES[code] ?? { text: "—", sky: "cloudy" };
}

export function isWet(code: number) {
  const { sky } = condition(code);
  return sky === "drizzle" || sky === "rain" || sky === "snow" || sky === "storm";
}

/** What falls from the sky and how much (0..1), for the rain or snow inside the capsule. */
export interface Precipitation {
  kind: "drizzle" | "rain" | "snow";
  amount: number;
  /** Lightning now and then. */
  storm: boolean;
}

const PRECIPITATION: Record<number, Precipitation> = {
  51: { kind: "drizzle", amount: 0.35, storm: false },
  53: { kind: "drizzle", amount: 0.6, storm: false },
  55: { kind: "drizzle", amount: 0.9, storm: false },
  56: { kind: "drizzle", amount: 0.5, storm: false },
  57: { kind: "drizzle", amount: 0.8, storm: false },
  61: { kind: "rain", amount: 0.35, storm: false },
  63: { kind: "rain", amount: 0.6, storm: false },
  65: { kind: "rain", amount: 1, storm: false },
  66: { kind: "rain", amount: 0.45, storm: false },
  67: { kind: "rain", amount: 0.8, storm: false },
  71: { kind: "snow", amount: 0.35, storm: false },
  73: { kind: "snow", amount: 0.6, storm: false },
  75: { kind: "snow", amount: 1, storm: false },
  77: { kind: "snow", amount: 0.45, storm: false },
  80: { kind: "rain", amount: 0.45, storm: false },
  81: { kind: "rain", amount: 0.75, storm: false },
  82: { kind: "rain", amount: 1, storm: false },
  85: { kind: "snow", amount: 0.5, storm: false },
  86: { kind: "snow", amount: 0.9, storm: false },
  95: { kind: "rain", amount: 0.8, storm: true },
  96: { kind: "rain", amount: 0.9, storm: true },
  99: { kind: "rain", amount: 1, storm: true },
};

export const precipitation = (code: number): Precipitation | null => PRECIPITATION[code] ?? null;
