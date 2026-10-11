/**
 * Unit conversion for queries like "5 км в милях", "10 kg in lb", "100 f to c".
 * Units are matched by alias, or by a Russian stem so inflected forms work
 * ("милях", "килограммов").
 */

interface Unit {
  /** Display label in results. */
  label: string;
  dimension: string;
  /** Multiplier to the dimension's base unit (ignored for temperature). */
  factor: number;
  aliases: string[];
  /** Word stems that may be followed by any ending. */
  stems?: string[];
}

const U = (
  label: string,
  dimension: string,
  factor: number,
  aliases: string[],
  stems: string[] = [],
): Unit => ({ label, dimension, factor, aliases, stems });

const UNITS: Unit[] = [
  // length, base: metre
  U("мм", "length", 0.001, ["mm", "мм"], ["миллиметр"]),
  U("см", "length", 0.01, ["cm", "см"], ["сантиметр"]),
  U("м", "length", 1, ["m", "м"], ["метр"]),
  U("км", "length", 1000, ["km", "км"], ["километр"]),
  U("дюйм", "length", 0.0254, ["in", "inch", "inches", '"'], ["дюйм"]),
  U("фут", "length", 0.3048, ["ft", "foot", "feet"], ["фут"]),
  U("ярд", "length", 0.9144, ["yd", "yard", "yards"], ["ярд"]),
  U("миль", "length", 1609.344, ["mi", "mile", "miles"], ["мил"]),
  // mass, base: kilogram
  U("г", "mass", 0.001, ["g", "г", "гр"], ["грамм"]),
  U("кг", "mass", 1, ["kg", "кг"], ["килограмм"]),
  U("т", "mass", 1000, ["t", "т"], ["тонн"]),
  U("унций", "mass", 0.028349523125, ["oz", "ounce", "ounces"], ["унци"]),
  U("фунтов", "mass", 0.45359237, ["lb", "lbs", "pound", "pounds"], ["фунт"]),
  // temperature
  U("°C", "temp", 1, ["c", "°c", "с", "°с", "celsius"], ["цельси"]),
  U("°F", "temp", 1, ["f", "°f", "fahrenheit"], ["фаренгейт"]),
  U("K", "temp", 1, ["k", "kelvin"], ["кельвин"]),
  // data, base: byte
  U("Б", "data", 1, ["b", "byte", "bytes", "б"], ["байт"]),
  U("КБ", "data", 1024, ["kb", "кб"], ["килобайт"]),
  U("МБ", "data", 1024 ** 2, ["mb", "мб"], ["мегабайт"]),
  U("ГБ", "data", 1024 ** 3, ["gb", "гб"], ["гигабайт"]),
  U("ТБ", "data", 1024 ** 4, ["tb", "тб"], ["терабайт"]),
  // time, base: second
  U("с", "time", 1, ["s", "sec", "сек"], ["секунд"]),
  U("мин", "time", 60, ["min", "мин"], ["минут"]),
  U("ч", "time", 3600, ["h", "hr", "hour", "hours", "ч"], ["час"]),
  U("дн", "time", 86400, ["d", "day", "days", "дн"], ["день", "дня", "дне", "сут"]),
  U("нед", "time", 604800, ["w", "week", "weeks", "нед"], ["недел"]),
  // volume, base: litre
  U("мл", "volume", 0.001, ["ml", "мл"], ["миллилитр"]),
  U("л", "volume", 1, ["l", "л"], ["литр"]),
  U("галлонов", "volume", 3.785411784, ["gal", "gallon", "gallons"], ["галлон"]),
  // speed, base: m/s
  U("м/с", "speed", 1, ["m/s", "м/с", "мс"]),
  U("км/ч", "speed", 1 / 3.6, ["km/h", "kmh", "км/ч", "кмч"]),
  U("mph", "speed", 0.44704, ["mph"]),
];

function findUnit(token: string): Unit | null {
  const t = token.toLowerCase().replace(/\.$/, "");
  const exact = UNITS.find((u) => u.aliases.includes(t));
  if (exact) return exact;
  // Longest matching stem wins ("миллиметр" before "метр").
  let best: Unit | null = null;
  let bestLen = 0;
  for (const u of UNITS) {
    for (const s of u.stems ?? []) {
      if (t.startsWith(s) && s.length > bestLen) {
        best = u;
        bestLen = s.length;
      }
    }
  }
  return best;
}

function toCelsius(v: number, unit: string) {
  return unit === "°F" ? ((v - 32) * 5) / 9 : unit === "K" ? v - 273.15 : v;
}

function fromCelsius(c: number, unit: string) {
  return unit === "°F" ? (c * 9) / 5 + 32 : unit === "K" ? c + 273.15 : c;
}

export interface Conversion {
  value: number;
  unit: string;
}

const QUERY = /^\s*(-?\d+(?:[.,]\d+)?)\s*([^\s\d]+(?:\/[^\s\d]+)?)\s+(?:в|во|to|in|->|=)\s+(\S+)\s*$/i;

export function convert(query: string): Conversion | null {
  const m = QUERY.exec(query);
  if (!m) return null;
  const amount = parseFloat(m[1].replace(",", "."));
  const from = findUnit(m[2]);
  const to = findUnit(m[3]);
  if (!from || !to || from.dimension !== to.dimension || from === to) return null;

  const value =
    from.dimension === "temp"
      ? fromCelsius(toCelsius(amount, from.label), to.label)
      : (amount * from.factor) / to.factor;
  return { value, unit: to.label };
}
