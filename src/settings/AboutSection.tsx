import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "../island/env";
import { Heading, Row, Toggle } from "./controls";
import { Settings, updateSettings } from "./useSettings";

const REPO_URL = "https://github.com/Mittikbb/lumen";

interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  url: string;
  download: string | null;
  notes: string;
}

const open = (url: string) => (isTauri ? openUrl(url) : window.open(url, "_blank"));

/** О Lumen: version, update check and links. */
export function AboutSection({ settings }: { settings: Settings }) {
  const [version, setVersion] = useState<string | null>(null);
  const { info, checking, error, check } = useUpdate();
  useEffect(() => {
    if (isTauri) getVersion().then(setVersion);
  }, []);

  const status = checking
    ? "Проверяю…"
    : error
      ? error
      : !info
        ? "Ещё не проверялось"
        : info.available
          ? `У тебя ${info.current} — скачай установщик и запусти его`
          : "Установлена последняя версия";

  return (
    <>
      <div className="st-about">
        <div className="island st-about-logo">
          <span className="orb" />
        </div>
        <div className="st-about-name">Lumen</div>
        <div className="st-row-hint">{version ? `Версия ${version}` : "Версия для разработки"}</div>
        <p className="st-about-text">Живой остров в верхней части рабочего стола Windows.</p>
      </div>

      <Heading>Обновления</Heading>
      <div className="st-card">
        <Row
          title={info?.available ? `Вышел Lumen ${info.latest}` : "Обновления"}
          hint={<span className={info?.available ? "st-accent" : error ? "st-error" : undefined}>{status}</span>}
        >
          <div className="st-buttons">
            {info?.available && (
              <>
                <button className="st-button quiet" onClick={() => open(info.url)}>
                  Что нового
                </button>
                <button className="st-button primary" onClick={() => open(info.download ?? info.url)}>
                  Скачать
                </button>
              </>
            )}
            {!info?.available && (
              <button className="st-button" disabled={checking} onClick={check}>
                Проверить
              </button>
            )}
          </div>
        </Row>
        <Row title="Проверять автоматически" hint="При запуске и раз в несколько часов; о новой версии скажет остров">
          <Toggle on={settings.updates.auto} onChange={(auto) => updateSettings({ updates: { auto } })} />
        </Row>
      </div>

      <div className="st-footnote">
        <button className="st-link" onClick={() => open(REPO_URL)}>
          Lumen на GitHub
        </button>
      </div>
    </>
  );
}

/** The latest known release, live from background checks, plus a manual check. */
function useUpdate() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    invoke<UpdateInfo | null>("update_last").then((last) => last && setInfo(last));
    const unlisten = listen<UpdateInfo>("lumen://update", (e) => setInfo(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  const check = () => {
    if (!isTauri) return;
    setChecking(true);
    setError(null);
    invoke<UpdateInfo>("update_check")
      .then(setInfo, (e) => setError(String(e)))
      .finally(() => setChecking(false));
  };

  return { info, checking, error, check };
}
