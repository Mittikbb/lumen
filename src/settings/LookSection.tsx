import { useClock } from "../island/useClock";
import { Heading, Row, Segmented, Toggle } from "./controls";
import { ACCENTS, GLOW_LEVELS } from "./look";
import { isActive, PRESETS } from "./presets";
import { Accent, Bounce, GlowLevel, Look, MotionPrefs, Settings, Speed, updateSettings } from "./useSettings";

const SPEEDS: { value: Speed; label: string }[] = [
  { value: "slow", label: "Медленно" },
  { value: "normal", label: "Обычно" },
  { value: "fast", label: "Быстро" },
];

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
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className="st-preset"
            aria-pressed={isActive(p, settings)}
            disabled={!p.patch}
            onClick={() => p.patch && updateSettings(p.patch)}
          >
            <span className={`st-preset-preview ${p.preview}`}>
              <i />
            </span>
            <span className="st-preset-name">
              {p.name}
              {!p.patch && <em>скоро</em>}
            </span>
            <span className="st-preset-text">{p.description}</span>
          </button>
        ))}
      </div>

      <Heading>Свечение и цвет</Heading>
      <div className="st-preview">
        <div className={`island st-preview-island${motion.reduced ? " reduced" : ""}`}>
          <span className="orb" />
          <span className="clock">{time}</span>
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
        <Row title="Цвет" hint={ACCENTS[look.accent]?.label}>
          <div className="st-swatches" role="radiogroup">
            {(Object.keys(ACCENTS) as Accent[]).map((accent) => (
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
          </div>
        </Row>
        <Row title="Цвет от обложки" hint="Пока играет музыка, свечение берёт цвет обложки трека">
          <Toggle on={look.artColors} onChange={(artColors) => set({ artColors })} />
        </Row>
        <Row title="В такт музыке" hint="Свечение и эквалайзер пульсируют под звук">
          <Toggle on={look.beat} onChange={(beat) => set({ beat })} />
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
