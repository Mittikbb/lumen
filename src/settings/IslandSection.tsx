import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../island/env";
import { Heading, Row, Segmented, Slider, Toggle } from "./controls";
import { CollapsedPrefs, IslandPrefs, NoticePrefs, Settings, updateSettings } from "./useSettings";

interface Monitor {
  name: string;
  width: number;
  height: number;
  primary: boolean;
}

const px = (v: number) => `${v} px`;
const ms = (v: number) => `${v} мс`;
const times = (v: number) => `${String(Number(v.toFixed(2))).replace(".", ",")}×`;

/** Остров: shape, hover behaviour, what the collapsed island shows, notices. */
export function IslandSection({ settings }: { settings: Settings }) {
  const { island, collapsed, notices, display } = settings;
  const shape = (patch: Partial<IslandPrefs>) => updateSettings({ island: patch });
  const rest = (patch: Partial<CollapsedPrefs>) => updateSettings({ collapsed: patch });
  const notice = (patch: Partial<NoticePrefs>) => updateSettings({ notices: patch });
  const monitors = useMonitors();

  return (
    <>
      <Heading>Форма</Heading>
      <div className="st-card">
        <Row title="Ширина в покое">
          <Slider value={island.width} min={160} max={340} step={4} format={px} onChange={(width) => shape({ width })} />
        </Row>
        <Row title="Высота в покое">
          <Slider value={island.height} min={30} max={52} format={px} onChange={(height) => shape({ height })} />
        </Row>
        <Row title="Ширина развёрнутого">
          <Slider
            value={island.expandedWidth}
            min={480}
            max={760}
            step={10}
            format={px}
            onChange={(expandedWidth) => shape({ expandedWidth })}
          />
        </Row>
        <Row title="Скругление развёрнутого">
          <Slider value={island.radius} min={8} max={40} format={px} onChange={(radius) => shape({ radius })} />
        </Row>
        <Row title="Отступ от верха экрана" hint={display.position ? "Пока остров передвинут, не действует" : undefined}>
          <Slider value={island.offsetTop} min={0} max={40} format={px} onChange={(offsetTop) => shape({ offsetTop })} />
        </Row>
      </div>

      <Heading>Поведение</Heading>
      <div className="st-card">
        <Row title="Монитор">
          <select
            className="st-select"
            value={display.monitor ?? ""}
            onChange={(e) => updateSettings({ display: { monitor: e.target.value || null } })}
          >
            <option value="">Основной</option>
            {monitors.map((m, i) => (
              <option key={m.name} value={m.name}>
                {`Монитор ${i + 1} · ${m.width}×${m.height}${m.primary ? " · основной" : ""}`}
              </option>
            ))}
          </select>
        </Row>
        <Row
          title="Положение"
          hint={display.position ? "Передвинут вручную" : "Зажмите Ctrl и перетащите остров мышью куда угодно"}
        >
          {display.position && (
            <button className="st-button quiet" onClick={() => updateSettings({ display: { position: null } })}>
              Вернуть наверх
            </button>
          )}
        </Row>
        <Row title="Прятать в полноэкранных приложениях" hint="Игры, видео на весь экран, презентации">
          <Toggle
            on={display.hideFullscreen}
            onChange={(hideFullscreen) => updateSettings({ display: { hideFullscreen } })}
          />
        </Row>
        <Row title="Прятать при развёрнутых окнах" hint="Когда активное окно развёрнуто на весь экран">
          <Toggle
            on={display.hideMaximized}
            onChange={(hideMaximized) => updateSettings({ display: { hideMaximized } })}
          />
        </Row>
        <Row
          title="Раскрывать"
          hint={island.openOn === "click" ? "Сворачивается, когда уводишь курсор" : "Когда курсор задерживается на острове"}
        >
          <Segmented
            value={island.openOn}
            options={[
              { value: "hover", label: "При наведении" },
              { value: "click", label: "По клику" },
            ]}
            onChange={(openOn) => shape({ openOn })}
          />
        </Row>
        {island.openOn === "hover" && (
          <Row title="Задержка раскрытия" hint="Сколько держать курсор над островом">
            <Slider
              value={island.openDelay}
              min={0}
              max={600}
              step={20}
              format={ms}
              onChange={(openDelay) => shape({ openDelay })}
            />
          </Row>
        )}
        <Row title="Задержка сворачивания" hint="Сколько остров ждёт после ухода курсора">
          <Slider
            value={island.closeDelay}
            min={100}
            max={1500}
            step={20}
            format={ms}
            onChange={(closeDelay) => shape({ closeDelay })}
          />
        </Row>
        <Row title="Притяжение к курсору" hint="0 — остров не тянется к мыши">
          <Slider value={island.pull} min={0} max={2} step={0.25} format={times} onChange={(pull) => shape({ pull })} />
        </Row>
      </div>

      <Heading>В покое</Heading>
      <div className="st-card">
        <Row title="24-часовой формат">
          <Toggle on={collapsed.clock24} onChange={(clock24) => rest({ clock24 })} />
        </Row>
        <Row title="Секунды">
          <Toggle on={collapsed.seconds} onChange={(seconds) => rest({ seconds })} />
        </Row>
        <Row title="Дата" hint="День недели и число рядом с часами">
          <Toggle on={collapsed.date} onChange={(date) => rest({ date })} />
        </Row>
        <Row title="Погода" hint="Температура рядом с часами">
          <Toggle on={collapsed.weather} onChange={(weather) => rest({ weather })} />
        </Row>
        <Row title="Играющий трек" hint="Обложка и название вместо часов">
          <Toggle on={collapsed.track} onChange={(track) => rest({ track })} />
        </Row>
      </div>

      <Heading>Уведомления</Heading>
      <div className="st-card">
        <Row title="Скопировано">
          <Toggle on={notices.copy} onChange={(copy) => notice({ copy })} />
        </Row>
        <Row title="Положено на полку">
          <Toggle on={notices.shelf} onChange={(shelf) => notice({ shelf })} />
        </Row>
        <Row title="Скоро дождь">
          <Toggle on={notices.rain} onChange={(rain) => notice({ rain })} />
        </Row>
        <Row title="Bluetooth-устройства" hint="Наушники, клавиатура, мышь: подключение и заряд">
          <Toggle on={notices.bluetooth} onChange={(bluetooth) => notice({ bluetooth })} />
        </Row>
        <Row title="Раскладка клавиатуры" hint="Капля под островом: RU, EN…">
          <Toggle on={notices.layout} onChange={(layout) => notice({ layout })} />
        </Row>
        <Row title="Caps Lock" hint="Та же капля: CAPS или abc">
          <Toggle on={notices.caps} onChange={(caps) => notice({ caps })} />
        </Row>
        <Row title="Длительность">
          <Slider value={notices.duration} min={0.5} max={2} step={0.25} format={times} onChange={(duration) => notice({ duration })} />
        </Row>
      </div>
    </>
  );
}

function useMonitors(): Monitor[] {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  useEffect(() => {
    if (isTauri) invoke<Monitor[]>("overlay_monitors").then(setMonitors);
  }, []);
  return monitors;
}
