import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isMac, isTauri } from "../island/env";
import { LookupCache, refreshLookup } from "../launcher/lookupData";
import { Heading, Row, Segmented, Toggle } from "./controls";
import { CodeBorderColor, Settings, updateSettings } from "./useSettings";
import { GITHUB_REPO_URL } from "../launcher/httpCodes";
import { useAutostart } from "./autostart";

const BORDER_COLOR_OPTIONS: { value: CodeBorderColor; label: string }[] = [
  { value: "code", label: "Цвет кода" },
  { value: "theme", label: "Тема программы" },
];

/**
 * Расширенные: hidden until 10 taps on the logo in О Lumen. The HTTP codes and
 * network protocols lookup (off by default), its card's look, Protocol-list,
 * and starting with Windows as administrator.
 */
export function AdvancedSection({ settings }: { settings: Settings }) {
  const advanced = settings.advanced;
  const autostart = useAutostart();
  // Waiting on the UAC prompt.
  const [elevating, setElevating] = useState(false);

  const setAdvanced = (patch: Partial<typeof advanced>) =>
    updateSettings({ advanced: patch });

  const setAdmin = (admin: boolean) => {
    setElevating(true);
    invoke("settings_set_autostart_admin", { admin }).finally(() => setElevating(false));
  };

  return (
    <>
      {/* macOS has no such thing. */}
      {!isMac && (
        <>
          <Heading>Запуск</Heading>
          <div className="st-card">
            <Row
              title="Автозапуск от имени администратора"
              hint={
                autostart === null
                  ? "Работает только в установленной версии"
                  : !autostart.on
                    ? "Сначала включи «Запускать вместе с Windows» в «Общих»"
                    : "Через Планировщик заданий, Windows один раз спросит разрешение. Программы, открытые из поиска Lumen, тоже запустятся от администратора, а файлы из Проводника на остров перетаскиваться не будут"
              }
            >
              <Toggle
                on={!!autostart?.admin}
                disabled={!autostart?.on || elevating}
                onChange={setAdmin}
              />
            </Row>
          </div>
        </>
      )}

      <Heading>Справочник кодов и протоколов</Heading>
      <div className="st-card">
        <Row title="Справочник в поиске" hint="h:404, h:dns, h:wireguard или hHelp: — Enter открывает карточку">
          <Toggle on={advanced.lookup} onChange={(lookup) => setAdvanced({ lookup })} />
        </Row>
      </div>

      {advanced.lookup && (
        <>
          <Heading>Карточка</Heading>
          <div className="st-card">
            <Row
              title="Цвет краёв инфо-окна"
              hint="Цвет рамки и свечения выезжающего окна информации при нажатии Enter"
            >
              <Segmented
                value={advanced.codeBorderColor}
                options={BORDER_COLOR_OPTIONS}
                onChange={(codeBorderColor) => setAdvanced({ codeBorderColor })}
              />
            </Row>

            <div
              className="st-droplet-preview"
              style={
                {
                  "--preview-accent":
                    advanced.codeBorderColor === "theme" ? "var(--glow-a)" : "#4ade80",
                } as React.CSSProperties
              }
            >
              <div className="st-preview-badge">200 OK</div>
              <div className="st-preview-info">
                <span className="st-preview-title">Пример: HTTP 200 OK</span>
                <span className="st-preview-sub">
                  {advanced.codeBorderColor === "theme"
                    ? "Края и свечение окрашены в цвет темы Lumen"
                    : "Края и свечение окрашены по категории кода (зелёный для 2xx)"}
                </span>
              </div>
            </div>

            <Row
              title="Размытие стекла"
              hint="Эффект матового стекла под выезжающей каплей информации"
            >
              <Toggle
                on={advanced.dropletGlassBlur}
                onChange={(dropletGlassBlur) => setAdvanced({ dropletGlassBlur })}
              />
            </Row>
          </div>
        </>
      )}

      <Heading>Справочник Protocol-list</Heading>
      <div className="st-card">
        <Row
          title="Репозиторий на GitHub"
          hint="База сетевых протоколов и HTTP кодов от lackyhy"
        >
          <button
            type="button"
            className="st-btn-link"
            onClick={() => openUrl(GITHUB_REPO_URL)}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
            </svg>
            Открыть репозиторий
          </button>
        </Row>

        <LookupStatus />

        <Row
          title="Быстрый переход по hHelp:"
          hint="Напиши hHelp: в поиске Lumen для мгновенного перехода в репозиторий"
        >
          <kbd className="st-key">hHelp:</kbd>
        </Row>
      </div>
      <div className="st-footnote">
        Раздел открывается десятью нажатиями на логотип в «О Lumen».{" "}
        <button className="st-link" onClick={() => setAdvanced({ unlocked: false })}>
          Спрятать раздел
        </button>
      </div>
    </>
  );
}

/** When the list was last downloaded from the repository (it's kept in memory only), and a button to do it now. */
function LookupStatus() {
  const [cache, setCache] = useState<LookupCache | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    invoke<LookupCache | null>("lookup_cached").then(setCache);
    const unlisten = listen<LookupCache>("lumen://lookup", (e) => setCache(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  const refresh = () => {
    setBusy(true);
    setError(null);
    refreshLookup()
      .then(setCache, (err) => setError(String(err)))
      .finally(() => setBusy(false));
  };

  const index = (cache?.index ?? {}) as { http?: unknown[]; protocols?: unknown[] };
  const when = cache && new Date(cache.fetchedAt).toLocaleString("ru", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  return (
    <Row
      title="Данные из репозитория"
      hint={
        error ? (
          <span className="st-error">Не удалось скачать: {error}</span>
        ) : cache ? (
          `Загружено с GitHub ${when} · ${index.http?.length ?? 0} кодов, ${index.protocols?.length ?? 0} протоколов. Не сохраняется на диск, Lumen проверяет раз в час`
        ) : (
          "Ещё не загружены — h: заработает, как только Lumen скачает их с GitHub"
        )
      }
    >
      <button className="st-button" disabled={busy || !isTauri} onClick={refresh}>
        {busy ? "Обновляю…" : "Обновить"}
      </button>
    </Row>
  );
}
