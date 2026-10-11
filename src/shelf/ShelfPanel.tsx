import { useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ShelfItem, dragOut, shelf, useThumb } from "./useShelf";

/** Pointer travel (px) that turns a press on a tile into a drag. */
const DRAG_THRESHOLD = 5;

export function ShelfPanel({ items, dropping }: { items: ShelfItem[]; dropping: boolean }) {
  if (dropping) {
    return (
      <div className="panel shelf-drop">
        <svg viewBox="0 0 24 24">
          <path d="M12 4v11M7 10l5 5 5-5M5 19h14" />
        </svg>
        <span>Брось сюда, и файл подождёт на полке</span>
      </div>
    );
  }

  if (items.length === 0) {
    return <div className="panel empty">Перетащи файлы на остров, и они подождут здесь</div>;
  }

  return (
    <div className="panel shelf">
      <ul className="shelf-grid">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <Tile key={item.id} item={item} />
          ))}
        </AnimatePresence>
      </ul>
      <button className="clip-clear" onClick={() => shelf.clear()}>
        Очистить
      </button>
    </div>
  );
}

function Tile({ item }: { item: ShelfItem }) {
  const thumb = useThumb(item.path);
  const press = useRef<{ x: number; y: number } | null>(null);

  // A press that moves becomes a system drag (into Explorer, Telegram, a
  // browser...); a press that doesn't is a click that opens the file.
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && item.exists) press.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const start = press.current;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
    press.current = null;
    dragOut([item.id]);
  };
  const onMouseUp = () => {
    if (press.current) shelf.open(item.id);
    press.current = null;
  };

  return (
    <motion.li
      layout
      className={`shelf-tile${item.exists ? "" : " missing"}`}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 500, damping: 34 }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => (press.current = null)}
      title={item.path}
    >
      <span className="shelf-thumb">{thumb && <img src={thumb} alt="" draggable={false} />}</span>
      <span className="shelf-name">{item.exists ? item.name : "файл не найден"}</span>

      <span className="shelf-actions" onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
        {item.exists && (
          <button className="clip-action" aria-label="Показать в папке" onClick={() => shelf.reveal(item.id)}>
            <svg viewBox="0 0 24 24">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </button>
        )}
        <button className="clip-action" aria-label="Убрать с полки" onClick={() => shelf.remove(item.id)}>
          <svg viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </span>
    </motion.li>
  );
}
