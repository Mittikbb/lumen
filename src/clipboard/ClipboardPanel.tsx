import { AnimatePresence, motion } from "motion/react";
import { ClipEntry, appName, clipKind, clipboard, timeAgo } from "./useClipboard";

const ICONS = {
  text: <path d="M5 6h14M5 12h14M5 18h9" />,
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  code: <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />,
};

export function ClipboardPanel({ entries }: { entries: ClipEntry[] }) {
  if (entries.length === 0) {
    return <div className="panel empty">Скопируй что-нибудь, и оно появится здесь</div>;
  }

  const hasUnpinned = entries.some((e) => !e.pinned);

  return (
    <div className="panel clip">
      <ul className="clip-list">
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <ClipRow key={entry.id} entry={entry} />
          ))}
        </AnimatePresence>
      </ul>
      {hasUnpinned && (
        <button className="clip-clear" onClick={() => clipboard.clear()}>
          Очистить
        </button>
      )}
    </div>
  );
}

function ClipRow({ entry }: { entry: ClipEntry }) {
  const { image } = entry;
  const kind = clipKind(entry.text);
  const lines = image ? [`Изображение ${image.width}×${image.height}`] : entry.text.trim().split(/\r?\n/);
  const source = appName(entry.app);

  return (
    <motion.li
      layout
      className={`clip-row${entry.pinned ? " pinned" : ""}`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 500, damping: 38 }}
      onClick={() => clipboard.paste(entry.id)}
    >
      <span className={`clip-icon kind-${image ? "image" : kind}`}>
        {image ? (
          <img src={image.thumb} alt="" draggable={false} />
        ) : kind === "color" ? (
          <span className="swatch" style={{ background: entry.text.trim() }} />
        ) : (
          <svg viewBox="0 0 24 24">{ICONS[kind]}</svg>
        )}
      </span>

      <span className="clip-main">
        <span className="clip-text">{lines[0]}</span>
        <span className="clip-meta">
          {source && <>{source} · </>}
          {timeAgo(entry.at)}
          {lines.length > 1 && <> · ещё {lines.length - 1} стр.</>}
        </span>
      </span>

      <span className="clip-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className={`clip-action${entry.pinned ? " on" : ""}`}
          aria-label={entry.pinned ? "Открепить" : "Закрепить"}
          onClick={() => clipboard.pin(entry.id)}
        >
          <svg viewBox="0 0 24 24">
            <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6" />
          </svg>
        </button>
        <button className="clip-action" aria-label="Удалить" onClick={() => clipboard.remove(entry.id)}>
          <svg viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </span>
    </motion.li>
  );
}
