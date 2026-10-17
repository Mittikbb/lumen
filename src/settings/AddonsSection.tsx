import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "../island/env";
import { AddonIcon } from "../addons/AddonPanel";
import {
  addonConfig,
  granted,
  isActive,
  needsApproval,
  openAddonsFolder,
  required,
  settingFields,
  useAddonList,
} from "../addons/useAddons";
import type { AddonInfo, Permission, SettingField } from "../addons/types";
import { Heading, Row, Slider, TextField, Toggle } from "./controls";
import { Settings, updateSettings } from "./useSettings";

const DOCS_URL = "https://github.com/Mittikbb/lumen/blob/main/docs/addons.md";
const open = (url: string) => (isTauri ? openUrl(url) : window.open(url, "_blank"));

const PERMISSION_TEXT: Record<Permission, string> = {
  notify: "Показывать уведомления и строку активности на острове",
  clipboard: "Копировать текст в буфер обмена",
  links: "Открывать ссылки в браузере",
  media: "Видеть, какой трек играет",
  network: "Ходить в интернет",
};

/** Аддоны: what's in the addons folder, switched on with the user's consent. */
export function AddonsSection({ settings }: { settings: Settings }) {
  const list = useAddonList();

  return (
    <>
      <Heading>Папка аддонов</Heading>
      <div className="st-card st-addon-folder">
        <Row
          title="Свои аддоны"
          hint="Положи папку аддона в папку аддонов — Lumen подхватит его сам, без перезапуска"
        >
          <div className="st-buttons">
            <button className="st-button" onClick={() => openAddonsFolder()}>
              Открыть папку
            </button>
            <button className="st-button quiet" onClick={() => open(DOCS_URL)}>
              Как сделать аддон
            </button>
          </div>
        </Row>
      </div>

      <Heading>Установлены</Heading>
      {list.length === 0 ? (
        <div className="st-card st-addons-empty">
          Аддонов пока нет. Аддон — это папка с <code>manifest.json</code> и скриптом: он может добавить вкладку
          на остров, ответы в поиск, уведомления и свои настройки.
        </div>
      ) : (
        list.map((addon) => <AddonCard key={addon.folder} addon={addon} settings={settings} />)
      )}
      <div className="st-footnote">
        Аддоны работают в песочнице: им недоступны файлы, буфер обмена, Discord и всё остальное, кроме разрешений,
        которые ты дал. Ставь аддоны только от тех, кому доверяешь.
      </div>
    </>
  );
}

function AddonCard({ addon, settings }: { addon: AddonInfo; settings: Settings }) {
  const prefs = settings.addons;
  const active = isActive(addon, prefs);
  const pending = needsApproval(addon, prefs);
  const [asking, setAsking] = useState(false);
  const asks = required(addon).length > 0;
  const fields = settingFields(addon);
  const had = granted(addon, prefs) ?? [];

  const enable = () => {
    setAsking(false);
    updateSettings({ addons: { enabled: { [addon.id]: required(addon) } } });
  };
  const disable = () => {
    setAsking(false);
    updateSettings({ addons: { enabled: { [addon.id]: null } } });
  };

  return (
    <div className={`st-card st-addon${addon.error ? " broken" : ""}`}>
      <div className="st-addon-head">
        <span className="st-addon-icon">
          <AddonIcon addon={addon} />
        </span>
        <div className="st-addon-title">
          <div className="st-row-title">
            {addon.name}
            {addon.version && <span className="st-addon-version">{addon.version}</span>}
          </div>
          <div className="st-row-hint">
            {addon.error ? (
              <span className="st-error">{addon.error}</span>
            ) : (
              [addon.author, addon.description].filter(Boolean).join(" · ") || addon.folder
            )}
          </div>
        </div>
        <Toggle
          on={active || asking}
          disabled={!!addon.error}
          onChange={(on) => (!on ? disable() : asks ? setAsking(true) : enable())}
        />
      </div>

      {!addon.error && (asking || pending || !active) && (
        <Abilities addon={addon} had={pending ? had : null} />
      )}

      {(asking || pending) && (
        <div className="st-addon-consent">
          <span>{pending ? "Обновлённый аддон просит новые разрешения" : "Разрешить аддону всё, что выше?"}</span>
          <div className="st-buttons">
            <button className="st-button quiet" onClick={pending ? disable : () => setAsking(false)}>
              {pending ? "Выключить" : "Отмена"}
            </button>
            <button className="st-button primary" onClick={enable}>
              Разрешить и включить
            </button>
          </div>
        </div>
      )}

      {active && fields.length > 0 && (
        <div className="st-addon-settings">
          {fields.map((field) => (
            <FieldRow key={field.key} addon={addon} field={field} value={addonConfig(addon, prefs)[field.key]} />
          ))}
        </div>
      )}
    </div>
  );
}

/** What the addon adds to the island and what it's allowed to do; new asks are marked. */
function Abilities({ addon, had }: { addon: AddonInfo; had: string[] | null }) {
  const lines: { text: string; fresh?: boolean }[] = [];
  if (addon.tab) lines.push({ text: `Вкладка «${addon.tab.label}» на острове` });
  if (addon.search) lines.push({ text: "Ответы в поиске" });
  for (const p of addon.permissions) {
    const text = p === "network" ? `${PERMISSION_TEXT.network}: ${addon.network.join(", ")}` : PERMISSION_TEXT[p];
    const fresh = !!had && (!had.includes(p) || (p === "network" && addon.network.some((h) => !had.includes(`network:${h}`))));
    lines.push({ text, fresh });
  }
  if (!lines.length) return null;
  return (
    <ul className="st-addon-abilities">
      {lines.map((l) => (
        <li key={l.text} className={l.fresh ? "fresh" : undefined}>
          {l.text}
          {l.fresh && <span className="st-addon-new">новое</span>}
        </li>
      ))}
    </ul>
  );
}

function FieldRow({ addon, field, value }: { addon: AddonInfo; field: SettingField; value: unknown }) {
  const set = (v: unknown) => updateSettings({ addons: { config: { [addon.id]: { [field.key]: v } } } });

  return (
    <Row title={field.label} hint={field.hint}>
      {field.type === "toggle" ? (
        <Toggle on={value === true} onChange={set} />
      ) : field.type === "select" ? (
        <select className="st-select" value={String(value)} onChange={(e) => set(e.target.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "number" && field.min != null && field.max != null ? (
        <Slider
          value={Number(value) || 0}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          format={(v) => `${v}`}
          onChange={set}
        />
      ) : field.type === "number" ? (
        <TextField
          value={String(value ?? "")}
          onCommit={(v) => {
            const n = Number(v.replace(",", "."));
            if (Number.isFinite(n)) set(n);
          }}
        />
      ) : (
        <TextField
          value={String(value ?? "")}
          placeholder={field.type === "text" ? field.placeholder : undefined}
          secret={field.type === "text" && field.secret}
          onCommit={set}
        />
      )}
    </Row>
  );
}
