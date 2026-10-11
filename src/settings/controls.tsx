import { ReactNode, useEffect, useRef, useState } from "react";

/** A labelled setting: title and hint on the left, the control on the right. */
export function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="st-row">
      <div className="st-row-text">
        <div className="st-row-title">{title}</div>
        {hint && <div className="st-row-hint">{hint}</div>}
      </div>
      <div className="st-row-control">{children}</div>
    </div>
  );
}

export function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button className="st-toggle" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

/** A small caption above a card. */
export const Heading = ({ children }: { children: ReactNode }) => <div className="st-heading">{children}</div>;

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="st-segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** How often a dragged slider saves, so the island follows along without a flood of writes. */
const SLIDER_COMMIT_MS = 120;

/**
 * A range slider that previews live: it saves at most every 120 ms while
 * dragging and once more on release.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  const timer = useRef(0);
  const pending = useRef<number | null>(null);

  // Follow outside changes (another window, a preset) unless mid-drag.
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);

  const flush = () => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    if (pending.current !== null) onChange(pending.current);
    pending.current = null;
  };

  const input = (next: number) => {
    setLocal(next);
    pending.current = next;
    if (!timer.current) timer.current = window.setTimeout(flush, SLIDER_COMMIT_MS);
  };

  const release = () => {
    dragging.current = false;
    flush();
  };

  const fill = ((local - min) / (max - min)) * 100;

  return (
    <div className="st-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={release}
        onKeyUp={release}
        onBlur={release}
        onChange={(e) => input(Number(e.target.value))}
      />
      <span className="st-slider-value">{format(local)}</span>
    </div>
  );
}

/** A text field that saves when you leave it or press Enter, not on every key. */
export function TextField({
  value,
  placeholder,
  secret,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  secret?: boolean;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(false);
  useEffect(() => setText(value), [value]);
  const commit = () => text !== value && onCommit(text.trim());

  return (
    <label className="st-text">
      <input
        type={secret && !shown ? "password" : "text"}
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
      {secret && text && (
        <button type="button" className="st-text-reveal" onClick={() => setShown(!shown)}>
          {shown ? "Скрыть" : "Показать"}
        </button>
      )}
    </label>
  );
}
