import { AnimatePresence, motion } from "motion/react";
import { NowPlaying, formatTime, mediaControl, playerName, trackKey } from "./useMedia";

/** New track slides in from the right, the old one drifts out to the left. */
const swap = {
  initial: { opacity: 0, x: 28, filter: "blur(6px)" },
  animate: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: { opacity: 0, x: -28, filter: "blur(6px)" },
};

export function MediaPanel({ media }: { media: NowPlaying | null }) {
  if (!media) {
    return <div className="panel empty">Сейчас ничего не играет</div>;
  }

  const progress = media.durationMs ? (media.positionMs / media.durationMs) * 100 : 0;
  const key = trackKey(media);

  return (
    <div className="panel media">
      <div className="media-art-slot">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={key}
            className="media-art-motion"
            initial={{ opacity: 0, scale: 0.8, rotate: 6, filter: "blur(8px)" }}
            animate={{ opacity: 1, scale: 1, rotate: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.85, rotate: -6, filter: "blur(8px)" }}
            transition={{ type: "spring", stiffness: 300, damping: 24 }}
          >
            <Art src={media.art} className="media-art" />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="media-body">
        <div className="media-app">{playerName(media.app)}</div>
        <div className="media-text">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={key} {...swap} transition={{ duration: 0.32, ease: "easeOut" }}>
              <div className="media-title" title={media.title}>
                {media.title}
              </div>
              <div className="media-artist" title={media.artist}>
                {media.artist}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {media.durationMs > 0 && (
          <div className="media-progress">
            <span>{formatTime(media.positionMs)}</span>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <span>{formatTime(media.durationMs)}</span>
          </div>
        )}

        <div className="media-controls">
          <button className="icon-btn" aria-label="Предыдущий трек" onClick={() => mediaControl("previous")}>
            <svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5.5v13L9.5 12z" /></svg>
          </button>
          <button className="icon-btn play" aria-label={media.playing ? "Пауза" : "Играть"} onClick={() => mediaControl("toggle")}>
            {media.playing ? (
              <svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <button className="icon-btn" aria-label="Следующий трек" onClick={() => mediaControl("next")}>
            <svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5.5v13L14.5 12z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function Art({ src, className }: { src: string | null; className: string }) {
  return src ? (
    <img className={className} src={src} alt="" draggable={false} />
  ) : (
    <div className={`${className} art-placeholder`}>
      <svg viewBox="0 0 24 24"><path d="M9 18V6l11-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
    </div>
  );
}

/**
 * Small equaliser for the collapsed island. Driven by live audio levels when
 * available (`reactive`), otherwise a canned animation while playing.
 */
export function Bars({ playing, reactive }: { playing: boolean; reactive: boolean }) {
  const mode = reactive ? " reactive" : playing ? " playing" : "";
  return (
    <span className={`bars${mode}`} aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
