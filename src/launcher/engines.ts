import type { SearchEngine } from "../settings/useSettings";

/** Web search engines for the launcher's "find on the web" result. */
export const ENGINES: Record<SearchEngine, { name: string; url: (q: string) => string }> = {
  google: { name: "Google", url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  yandex: { name: "Яндекс", url: (q) => `https://yandex.ru/search/?text=${encodeURIComponent(q)}` },
  duckduckgo: { name: "DuckDuckGo", url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  bing: { name: "Bing", url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
};
