import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "../island/env";
import { Heading, Row, Toggle } from "./controls";
import { Settings, updateSettings } from "./useSettings";

const REPO_URL = "https://github.com/Mittikbb/lumen";

const AUTHORS = [
  { name: "Mittikbb", login: "Mittikbb", role: "Автор" },
  { name: "Lcky", login: "lackyhy", role: "Соавтор: громкость плеера, перетаскивание острова, ник справа, «Перелив», анимация появления" },
];

interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  url: string;
  notes: string;
}

const open = (url: string) => (isTauri ? openUrl(url) : window.open(url, "_blank"));

/** О Lumen: version, update check and links. */
export function AboutSection({ settings }: { settings: Settings }) {
  const [version, setVersion] = useState<string | null>(null);
  const { info, checking, error, check, install, installing } = useUpdate();
  useEffect(() => {
    if (isTauri) getVersion().then(setVersion);
  }, []);

  const status = installing
    ? installing.total
      ? `Скачиваю… ${Math.round((installing.downloaded / installing.total) * 100)}%`
      : "Скачиваю…"
    : checking
      ? "Проверяю…"
      : error
        ? error
        : !info
          ? "Ещё не проверялось"
          : info.available
            ? `У тебя ${info.current}. Обновится и перезапустится само, настройки сохранятся`
            : "Установлена последняя версия";

  return (
    <>
      <div className="st-about">
        <SecretLogo unlocked={settings.advanced.unlocked} />
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
                <button className="st-button primary" disabled={!!installing} onClick={install}>
                  Обновить
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
        {settings.updates.auto && (
          <Row title="Ставить обновления сами" hint="Сразу после запуска Lumen, пока ты ещё ничего не делаешь">
            <Toggle on={settings.updates.install} onChange={(install) => updateSettings({ updates: { install } })} />
          </Row>
        )}
      </div>

      <Heading>Авторы</Heading>
      <div className="st-card">
        {AUTHORS.map((a) => (
          <Row key={a.login} title={a.name} hint={a.role}>
            <button className="st-button quiet" onClick={() => open(`https://github.com/${a.login}`)}>
              GitHub
            </button>
          </Row>
        ))}
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

  // Download progress while updating; the installer then closes Lumen and
  // starts the new version, so success never comes back here.
  const [installing, setInstalling] = useState<{ downloaded: number; total: number | null } | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<{ downloaded: number; total: number | null }>("lumen://update-progress", (e) =>
      setInstalling(e.payload),
    );
    return () => {
      unlisten.then((off) => off());
    };
  }, []);
  const install = () => {
    if (!isTauri) return;
    setError(null);
    setInstalling({ downloaded: 0, total: null });
    invoke("update_install").catch((e) => {
      setInstalling(null);
      setError(String(e));
    });
  };

  return { info, checking, error, check, install, installing };
}

/** Taps on the logo it takes to open the hidden Расширенные section. */
const TAPS = 10;
/** A pause longer than this starts the count over. */
const TAP_GAP_MS = 1500;

/**
 * The logo, which opens the hidden Расширенные section after TAPS quick taps,
 * counting down from halfway, like developer options on a phone.
 */
function SecretLogo({ unlocked }: { unlocked: boolean }) {
  const [taps, setTaps] = useState(0);
  const last = useRef(0);
  const [said, setSaid] = useState<string | null>(null);

  const tap = () => {
    const now = Date.now();
    const count = now - last.current > TAP_GAP_MS ? 1 : taps + 1;
    last.current = now;
    setTaps(count);
    if (unlocked) {
      if (count >= 3) setSaid("Раздел «Расширенные» уже открыт");
      return;
    }
    if (count >= TAPS) {
      setTaps(0);
      setSaid("Открыт раздел «Расширенные»");
      updateSettings({ advanced: { unlocked: true } });
    } else if (count >= TAPS / 2) {
      setSaid(`Ещё ${TAPS - count}…`);
    }
  };

  useEffect(() => {
    if (!said) return;
    const t = setTimeout(() => setSaid(null), 2000);
    return () => clearTimeout(t);
  }, [said, taps]);

  return (
    <>
      <button type="button" className="island st-about-logo" onClick={tap} aria-label="Lumen">
        <span className="orb" />
      </button>
      {said && <div className="st-about-secret">{said}</div>}
    </>
  );
}
