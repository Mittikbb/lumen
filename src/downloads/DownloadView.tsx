import { motion } from "motion/react";
import { Download, Finished, formatBytes, revealDownload } from "./useDownloads";

const ARROW = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
const CHECK = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M4 13l4 4L20 7" />
  </svg>
);

/**
 * The collapsed island while something downloads: the file's name, how much
 * is in and how fast, over a light running along the bottom edge; then, for
 * a few seconds, that it's done. A click on a finished one shows it in its
 * folder.
 */
export function DownloadView({ active, done, reduced }: { active: Download[]; done: Finished | null; reduced: boolean }) {
  const current = active[0];
  const more = active.length - 1;
  const slide = reduced ? {} : { initial: { opacity: 0, y: 8, filter: "blur(4px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" } };

  if (current) {
    return (
      <motion.div key="downloading" className="download" {...slide}>
        <span className="download-icon">{ARROW}</span>
        <span className="download-name">{current.name ?? "Загрузка…"}</span>
        <span className="download-meta">
          {formatBytes(current.bytes)}
          {current.speed > 0 && ` · ${formatBytes(current.speed)}/с`}
          {more > 0 && ` · ещё ${more}`}
        </span>
        <i className={`download-bar${reduced ? " still" : ""}`} />
      </motion.div>
    );
  }
  if (!done) return null;
  return (
    <motion.div
      key="downloaded"
      className="download done"
      title="Показать в папке"
      onClick={(e) => {
        e.stopPropagation();
        revealDownload(done.path);
      }}
      {...slide}
    >
      <span className="download-icon">{CHECK}</span>
      <span className="download-name">{done.name}</span>
      <span className="download-meta">Загружено · {formatBytes(done.bytes)}</span>
      <i className="download-bar full" />
    </motion.div>
  );
}
