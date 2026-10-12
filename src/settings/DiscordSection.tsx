import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "../island/env";
import { useDiscord } from "../discord/useDiscord";
import { Heading, Row, TextField, Toggle } from "./controls";
import { CallStyle, DiscordPrefs, Settings, updateSettings } from "./useSettings";

const PORTAL_URL = "https://discord.com/developers/applications";

const CALL_STYLES: { id: CallStyle; label: string }[] = [
  { id: "classic", label: "Аватары и имя" },
  { id: "right", label: "Имя говорящего справа" },
  { id: "drop", label: "Капля слева от острова" },
];

const STATES: Record<string, { label: string; tone: "ok" | "wait" | "bad" | "off" }> = {
  off: { label: "Выключено", tone: "off" },
  connecting: { label: "Подключаюсь…", tone: "wait" },
  waiting: { label: "Жду, пока запустится Discord", tone: "wait" },
  authorize: { label: "Подтверди доступ в окне Discord", tone: "wait" },
  ready: { label: "Подключено", tone: "ok" },
  error: { label: "Ошибка", tone: "bad" },
};

/** Discord: the user's app credentials, what to show, connection state. */
export function DiscordSection({ settings }: { settings: Settings }) {
  const prefs = settings.discord;
  const status = useDiscord();
  const set = (patch: Partial<DiscordPrefs>) => updateSettings({ discord: patch });
  const state = STATES[status.state] ?? STATES.error;
  const missingId = !prefs.clientId;

  return (
    <>
      <div className="st-card">
        <Row
          title="Подключение к Discord"
          hint={
            <span className={`st-status ${state.tone}`}>
              <i />
              {state.label}
              {status.state === "ready" && status.user ? ` как ${status.user}` : ""}
              {status.message && status.state !== "authorize" ? ` · ${status.message}` : ""}
            </span>
          }
        >
          <Toggle on={prefs.enabled} disabled={missingId && !prefs.enabled} onChange={(enabled) => set({ enabled })} />
        </Row>
      </div>

      <Heading>Что показывать</Heading>
      <div className="st-card">
        <Row title="Звонок на острове" hint="Кто в голосовом канале, кто говорит, микрофон и звук">
          <Toggle on={prefs.voice} onChange={(voice) => set({ voice })} />
        </Row>
        {prefs.voice && (
          <Row title="Как показывать звонок" hint="В свёрнутом острове">
            <select
              className="st-select"
              value={settings.call.style}
              onChange={(e) => updateSettings({ call: { style: e.target.value as CallStyle } })}
            >
              {CALL_STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row title="Статус «Слушает»" hint="Трек из любого плеера в профиле Discord. Spotify Discord показывает сам">
          <Toggle on={prefs.presence} onChange={(presence) => set({ presence })} />
        </Row>
      </div>

      <Heading>Приложение Discord</Heading>
      <div className="st-card">
        <Row title="Application ID" hint="General Information → Application ID">
          <TextField value={prefs.clientId} placeholder="1234567890" onCommit={(clientId) => set({ clientId })} />
        </Row>
        <Row title="Client Secret" hint="OAuth2 → Reset Secret. Нужен только для звонков">
          <TextField value={prefs.clientSecret} secret onCommit={(clientSecret) => set({ clientSecret })} />
        </Row>
      </div>
      <div className="st-footnote">
        Discord пускает к звонкам только через собственное приложение. Создай его на{" "}
        <button className="st-link" onClick={() => (isTauri ? openUrl(PORTAL_URL) : window.open(PORTAL_URL))}>
          Discord Developer Portal
        </button>
        , в OAuth2 → Redirects добавь <code>http://127.0.0.1</code>. Секрет хранится только на этом компьютере.
        {prefs.enabled && (
          <>
            {" "}
            <button className="st-link" onClick={() => isTauri && invoke("discord_forget")}>
              Запросить доступ заново
            </button>
          </>
        )}
      </div>
    </>
  );
}
