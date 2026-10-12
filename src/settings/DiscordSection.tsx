import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "../island/env";
import { useDiscord } from "../discord/useDiscord";
import { Heading, Row, Segmented, Slider, TextField, Toggle } from "./controls";
import { CallPrefs, CallStyle, DiscordPrefs, DropPull, Settings, updateSettings } from "./useSettings";

const PORTAL_URL = "https://discord.com/developers/applications";

const CALL_STYLES: { id: CallStyle; label: string }[] = [
  { id: "classic", label: "Аватары и имя" },
  { id: "right", label: "Имя говорящего справа" },
  { id: "drop", label: "Капля слева от острова" },
];

const PULLS: { value: DropPull; label: string }[] = [
  { value: "soft", label: "Мягкий" },
  { value: "normal", label: "Обычный" },
  { value: "tight", label: "Тугой" },
];

const TINTS: { value: CallPrefs["tint"]; label: string }[] = [
  { value: "island", label: "Как у острова" },
  { value: "discord", label: "Discord" },
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
  const call = settings.call;
  const setCall = (patch: Partial<CallPrefs>) => updateSettings({ call: patch });
  const notify = (patch: Partial<CallPrefs["notify"]>) => updateSettings({ call: { notify: patch } });
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
              value={call.style}
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

      {prefs.voice && call.style === "drop" && (
        <>
          <Heading>Капля</Heading>
          <div className="st-card">
            <Row title="Вход и выход из канала" hint="Капля выскакивает и показывает, кто это">
              <Toggle on={call.notify.joins} onChange={(joins) => notify({ joins })} />
            </Row>
            <Row title="Чужой микрофон">
              <Toggle on={call.notify.mic} onChange={(mic) => notify({ mic })} />
            </Row>
            <Row title="Чужой звук">
              <Toggle on={call.notify.sound} onChange={(sound) => notify({ sound })} />
            </Row>
            <Row title="Мои микрофон и звук" hint="Например, когда выключаешь их хоткеем в игре">
              <Toggle on={call.notify.self} onChange={(self) => notify({ self })} />
            </Row>
            <Row title="Сколько показывать">
              <Slider
                value={call.showMs / 1000}
                min={1.5}
                max={5}
                step={0.5}
                format={(s) => `${String(s).replace(".", ",")} с`}
                onChange={(s) => setCall({ showMs: Math.round(s * 1000) })}
              />
            </Row>
            <Row title="Отрыв" hint="Как далеко тянется перемычка, прежде чем лопнуть">
              <Segmented value={call.pull} options={PULLS} onChange={(pull) => setCall({ pull })} />
            </Row>
            <Row title="Выходить навстречу курсору" hint="С какого расстояния капля выглядывает">
              <Slider value={call.reach} min={60} max={200} step={10} format={(v) => `${v} px`} onChange={(reach) => setCall({ reach })} />
            </Row>
            <Row title="Цвет свечения">
              <Segmented value={call.tint} options={TINTS} onChange={(tint) => setCall({ tint })} />
            </Row>
          </div>
        </>
      )}

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
