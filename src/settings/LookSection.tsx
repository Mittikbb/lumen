import { useClock } from "../island/useClock";
import { Heading, Row, Segmented, Slider, Toggle } from "./controls";
import { ACCENTS, GLOW_LEVELS, GLOW_PACES, palette } from "./look";
import { isActive, presetPreview, PRESETS } from "./presets";
import { Accent, Bounce, Finish, GlowLevel, GlowPace, GlowStyle, Look, MotionPrefs, Settings, Speed, updateSettings } from "./useSettings";

const SPEEDS: { value: Speed; label: string }[] = [
  { value: "slow", label: "Медленно" },
  { value: "normal", label: "Обычно" },
  { value: "fast", label: "Быстро" },
];

const STYLES: { value: GlowStyle; label: string }[] = [
  { value: "glow", label: "Свечение" },
  { value: "flow", label: "Перелив" },
];

const FINISHES: { value: Finish; label: string }[] = [
  { value: "solid", label: "Плотная" },
  { value: "smoke", label: "Дымка" },
  { value: "neon", label: "Неон" },
];

const PACES = (Object.keys(GLOW_PACES) as GlowPace[]).map((value) => ({ value, label: GLOW_PACES[value].label }));
const times = (v: number) => `${String(Number(v.toFixed(2))).replace(".", ",")}×`;

const BOUNCES: { value: Bounce; label: string }[] = [
  { value: "calm", label: "Спокойно" },
  { value: "normal", label: "Обычно" },
  { value: "springy", label: "Пружинисто" },
];

/** Внешний вид: presets, glow, colour and motion. */
export function LookSection({ settings }: { settings: Settings }) {
  const { look, motion } = settings;
  const time = useClock(settings.collapsed);
  const set = (patch: Partial<Look>) => updateSettings({ look: patch });
  const move = (patch: Partial<MotionPrefs>) => updateSettings({ motion: patch });

  return (
    <>
      <Heading>Пресеты</Heading>
      <div className="st-presets">
        {PRESETS.map((p) => {
          const { backdrop, capsule } = presetPreview(p);
          return (
            <button
              key={p.id}
              className="st-preset"
              aria-pressed={isActive(p, settings)}
              onClick={() => updateSettings(p.patch)}
            >
              <span className={`st-preset-preview ${backdrop}`}>
                <i style={capsule} />
              </span>
              <span className="st-preset-name">{p.name}</span>
              <span className="st-preset-text">{p.description}</span>
            </button>
          );
        })}
      </div>

      <Heading>Свечение</Heading>
      <div className={`st-preview ${look.finish}`}>
        <div className={`island st-preview-island${look.style === "flow" ? " flow" : ""}${motion.reduced ? " reduced" : ""}`}>
          {settings.collapsed.dot && <span className="orb" />}
          <span className="clock" style={settings.collapsed.dot ? undefined : { margin: "0 auto" }}>
            {time}
          </span>
        </div>
      </div>

      <div className="st-card">
        <Row title="Свечение">
          <Segmented
            value={look.glow}
            options={(Object.keys(GLOW_LEVELS) as GlowLevel[]).map((value) => ({ value, label: GLOW_LEVELS[value].label }))}
            onChange={(glow) => set({ glow })}
          />
        </Row>
        <Row title="Стиль" hint="Перелив — цвета бегут вдоль капсулы">
          <Segmented value={look.style} options={STYLES} onChange={(style) => set({ style })} />
        </Row>
        <Row title="Капсула" hint="Дымка — полупрозрачная, неон — светящийся контур">
          <Segmented value={look.finish} options={FINISHES} onChange={(finish) => set({ finish })} />
        </Row>
        <Row title="Размер" hint="Как далеко расходится ореол">
          <Slider value={look.spread} min={0.5} max={1.8} step={0.1} format={times} onChange={(spread) => set({ spread })} />
        </Row>
        <Row title="Темп" hint="Как быстро свечение дышит и переливается">
          <Segmented value={look.pace} options={PACES} onChange={(pace) => set({ pace })} />
        </Row>
        <Row title="В такт музыке" hint="Свечение и эквалайзер пульсируют под звук">
          <Toggle on={look.beat} onChange={(beat) => set({ beat })} />
        </Row>
        <Row title="Только когда играет музыка" hint="В тишине остров без свечения">
          <Toggle on={look.musicOnly} onChange={(musicOnly) => set({ musicOnly })} />
        </Row>
      </div>

      <Heading>Цвет</Heading>
      <div className="st-card">
        <Row title="Палитра" hint={palette(look).label}>
          <div className="st-swatches" role="radiogroup">
            {(Object.keys(ACCENTS) as Exclude<Accent, "custom">[]).map((accent) => (
              <button
                key={accent}
                role="radio"
                aria-checked={look.accent === accent}
                aria-label={ACCENTS[accent].label}
                title={ACCENTS[accent].label}
                style={{ background: `linear-gradient(135deg, ${ACCENTS[accent].a}, ${ACCENTS[accent].b})` }}
                onClick={() => set({ accent })}
              />
            ))}
            <button
              role="radio"
              className="custom"
              aria-checked={look.accent === "custom"}
              aria-label="Свой цвет"
              title="Свой цвет"
              style={{ background: `linear-gradient(135deg, ${look.customA}, ${look.customB})` }}
              onClick={() => set({ accent: "custom" })}
            />
          </div>
        </Row>
        {look.accent === "custom" && (
          <Row title="Свой цвет" hint="Два оттенка: основной и второй">
            <span className="st-colors">
              <input type="color" aria-label="Основной оттенок" value={look.customA} onChange={(e) => set({ customA: e.target.value })} />
              <input type="color" aria-label="Второй оттенок" value={look.customB} onChange={(e) => set({ customB: e.target.value })} />
            </span>
          </Row>
        )}
        <Row title="Цвет от обложки" hint="Пока играет музыка, свечение берёт цвет обложки трека">
          <Toggle on={look.artColors} onChange={(artColors) => set({ artColors })} />
        </Row>
      </div>

      <Heading>Анимации</Heading>
      <div className="st-card">
        <Row title="Скорость">
          <Segmented value={motion.speed} options={SPEEDS} onChange={(speed) => move({ speed })} />
        </Row>
        <Row title="Упругость" hint="Насколько форма «пружинит» при раскрытии">
          <Segmented value={motion.bounce} options={BOUNCES} onChange={(bounce) => move({ bounce })} />
        </Row>
        <Row title="Размытие при переходах">
          <Toggle on={motion.blur} onChange={(blur) => move({ blur })} />
        </Row>
        <Row title="Вспышка при копировании">
          <Toggle on={motion.copyFlash} onChange={(copyFlash) => move({ copyFlash })} />
        </Row>
        <Row title="Анимация смены трека">
          <Toggle on={motion.trackBump} onChange={(trackBump) => move({ trackBump })} />
        </Row>
        <Row title="Без анимаций" hint="Мгновенные переходы и неподвижное свечение — для слабых ПК">
          <Toggle on={motion.reduced} onChange={(reduced) => move({ reduced })} />
        </Row>
      </div>
    </>
  );
}
