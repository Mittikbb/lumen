export const GITHUB_REPO_URL = "https://github.com/lackyhy/Protocol-list";

export interface HttpCodeInfo {
  kind: "http";
  code: number;
  phrase: string;
  /** The Russian name, when lumen.json has one. */
  nameRu?: string;
  description: string;
  category: "1xx" | "2xx" | "3xx" | "4xx" | "5xx";
}

export interface ProtocolInfo {
  kind: "protocol";
  id: string;
  name: string;
  fullName: string;
  description: string;
  docUrl: string;
  /** Other names it's found by, lowercase: "tls" and "ssl" for TLS/SSL. */
  aliases?: string[];
}

export interface GithubHelpItem {
  kind: "github-help";
  title: string;
  url: string;
  hint: string;
}

export type NetworkSearchResult = HttpCodeInfo | ProtocolInfo | GithubHelpItem;


// Filled only from lumen.json in lackyhy/Protocol-list (see lookupData.ts):
// nothing is built in, so until it loads the lookup knows nothing.
let HTTP_CODES: HttpCodeInfo[] = [];
let NETWORK_PROTOCOLS: ProtocolInfo[] = [];

const CATEGORIES = ["1xx", "2xx", "3xx", "4xx", "5xx"] as const;
const text = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Takes the codes and protocols from lumen.json. Returns false (and changes
 * nothing) if the file doesn't look right.
 */
export function applyIndex(index: unknown): boolean {
  if (!index || typeof index !== "object") return false;
  const { http, protocols } = index as { http?: unknown; protocols?: unknown };
  if (!Array.isArray(http) || !Array.isArray(protocols)) return false;

  const codes = new Map<number, HttpCodeInfo>();
  for (const raw of http) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const code = typeof r.code === "number" ? r.code : NaN;
    const category = CATEGORIES.find((c) => c[0] === String(code)[0]);
    if (!Number.isInteger(code) || code < 100 || code > 599 || !category || !text(r.phrase)) continue;
    codes.set(code, {
      kind: "http",
      code,
      phrase: text(r.phrase, 80),
      nameRu: text(r.nameRu, 80) || undefined,
      description: text(r.description),
      category,
    });
  }

  const fresh: ProtocolInfo[] = [];
  for (const raw of protocols) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = text(r.id, 60).toLowerCase();
    const name = text(r.name, 60);
    const file = text(r.file, 200);
    if (!id || !name || !/^prot\/[^/]+\.md$/.test(file)) continue;
    const aliases = Array.isArray(r.aliases)
      ? r.aliases.map((a) => text(a, 60).toLowerCase()).filter(Boolean)
      : [id, name.toLowerCase()];
    fresh.push({
      kind: "protocol",
      id,
      name,
      fullName: text(r.fullName, 120),
      description: text(r.description),
      docUrl: `${GITHUB_REPO_URL}/blob/main/${file.split("/").map(encodeURIComponent).join("/")}`,
      aliases,
    });
  }

  HTTP_CODES = [...codes.values()].sort((a, b) => a.code - b.code);
  NETWORK_PROTOCOLS = fresh;
  return true;
}

/** How many codes and protocols the search knows now. */
export const lookupSize = () => ({ codes: HTTP_CODES.length, protocols: NETWORK_PROTOCOLS.length });

/** "Wi-Fi", "wi fi" and "wifi" are the same name. */
const compact = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}+]/gu, "");
const isAlias = (p: ProtocolInfo, name: string) =>
  [p.id, p.name, ...(p.aliases ?? [])].some((n) => n === name || compact(n) === compact(name));

const POPULAR_CODES = [200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 418, 429, 500, 502, 503];

/**
 * Searches HTTP status codes and network protocols from Protocol-list.
 * Handles "hHelp:" to open GitHub repository directly.
 */
export function searchHttpCodes(query: string): NetworkSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Exclude full URLs like "http://example.com"
  if (/^https?:\/\//i.test(trimmed)) {
    return [];
  }

  // Explicit GitHub Help commands: "hHelp:", "hhelp:", "hhelp", "h:help", "http:help"
  const helpMatch = /^(?:hhelp:?|(?:h|http):help)(?:\s*(.*))?$/i.exec(trimmed);
  if (helpMatch) {
    const sub = (helpMatch[1] ?? "").trim();
    if (sub) {
      const targetProt = NETWORK_PROTOCOLS.find(
        (p) => p.name.toLowerCase() === sub.toLowerCase() || isAlias(p, sub.toLowerCase()),
      );
      if (targetProt) {
        return [
          {
            kind: "github-help",
            title: `${targetProt.name} — документация на GitHub`,
            url: targetProt.docUrl,
            hint: targetProt.docUrl,
          },
        ];
      }
    }
    return [
      {
        kind: "github-help",
        title: "Справочник протоколов lackyhy/Protocol-list",
        url: GITHUB_REPO_URL,
        hint: GITHUB_REPO_URL,
      },
    ];
  }

  let term = "";
  let matchedPrefix = false;

  // Only with a colon: "http something" is an ordinary search.
  const prefixMatch = /^(?:h|http):(.*)$/i.exec(trimmed);
  const shortCodeMatch = /^h(\d{3})$/i.exec(trimmed);

  if (prefixMatch) {
    matchedPrefix = true;
    term = prefixMatch[1].trim();
  } else if (shortCodeMatch) {
    matchedPrefix = true;
    term = shortCodeMatch[1];
  }

  if (!matchedPrefix) {
    return [];
  }

  // If user simply typed "h:" or "http:"
  if (!term) {
    const popular: NetworkSearchResult[] = [
      {
        kind: "github-help",
        title: "Справочник lackyhy/Protocol-list на GitHub (напиши hHelp:)",
        url: GITHUB_REPO_URL,
        hint: "Напиши hHelp: для перехода в репозиторий",
      },
      ...HTTP_CODES.filter((c) => POPULAR_CODES.includes(c.code)),
    ];
    return popular.slice(0, 6);
  }

  const lower = term.toLowerCase();

  // If term is purely numeric: search HTTP status codes
  if (/^\d+$/.test(term)) {
    const num = parseInt(term, 10);
    const exact = HTTP_CODES.find((c) => c.code === num);
    if (exact) {
      return [exact];
    }
    // Prefix match (e.g. "40" matches 400..409)
    return HTTP_CODES.filter((c) => c.code.toString().startsWith(term)).slice(0, 6);
  }

  // Text search in HTTP codes and network protocols
  const httpMatches: { item: NetworkSearchResult; score: number }[] = [];

  for (const item of HTTP_CODES) {
    let score = 0;
    const phraseLower = item.phrase.toLowerCase();
    const nameLower = (item.nameRu ?? "").toLowerCase();
    const descLower = item.description.toLowerCase();

    if (phraseLower === lower || nameLower === lower) {
      score += 100;
    } else if (phraseLower.startsWith(lower) || nameLower.startsWith(lower)) {
      score += 60;
    } else if (phraseLower.includes(lower) || nameLower.includes(lower)) {
      score += 40;
    } else if (descLower.includes(lower)) {
      score += 15;
    }

    if (score > 0) {
      httpMatches.push({ item, score });
    }
  }

  const protocolMatches: { item: NetworkSearchResult; score: number }[] = [];

  for (const item of NETWORK_PROTOCOLS) {
    let score = 0;
    const nameLower = item.name.toLowerCase();
    const fullLower = item.fullName.toLowerCase();
    const descLower = item.description.toLowerCase();

    if (nameLower === lower || isAlias(item, lower)) {
      score += 120;
    } else if (nameLower.startsWith(lower)) {
      score += 80;
    } else if (fullLower.includes(lower) || nameLower.includes(lower)) {
      score += 50;
    } else if (descLower.includes(lower)) {
      score += 20;
    }

    if (score > 0) {
      protocolMatches.push({ item, score });
    }
  }

  const all = [...httpMatches, ...protocolMatches].sort((a, b) => b.score - a.score);
  return all.slice(0, 6).map((r) => r.item);
}

export function getDropletAccent(item: NetworkSearchResult): string {
  if (item.kind === "http") {
    switch (item.category) {
      case "1xx":
        return "#38bdf8";
      case "2xx":
        return "#4ade80";
      case "3xx":
        return "#facc15";
      case "4xx":
        return "#fb923c";
      case "5xx":
        return "#f87171";
    }
  }
  if (item.kind === "protocol") {
    return "#818cf8";
  }
  return "#c084fc";
}

export function getCategoryName(category: "1xx" | "2xx" | "3xx" | "4xx" | "5xx"): string {
  switch (category) {
    case "1xx":
      return "1xx Informational · Информационный";
    case "2xx":
      return "2xx Success · Успешно";
    case "3xx":
      return "3xx Redirection · Перенаправление";
    case "4xx":
      return "4xx Client Error · Ошибка клиента";
    case "5xx":
      return "5xx Server Error · Ошибка сервера";
  }
}

