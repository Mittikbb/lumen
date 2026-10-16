import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { NowPlaying, formatTime, mediaControl, playerName, trackKey } from "./useMedia";
import { useVolume } from "./useVolume";
import { useSettings } from "../settings/useSettings";

type Volume = ReturnType<typeof useVolume>;

/** New track slides in from the right, the old one drifts out to the left. */
const swap = {
  initial: { opacity: 0, x: 28, filter: "blur(6px)" },
  animate: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: { opacity: 0, x: -28, filter: "blur(6px)" },
};

export function MediaPanel({ media }: { media: NowPlaying | null }) {
  const settings = useSettings();
  const volume = useVolume(settings?.media.volumeSlider !== false ? (media?.app ?? null) : null);

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
        <div className="media-app">{playerName(media.app, settings?.players.names)}</div>
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

        {media.durationMs > 0 ? (
          <div className="media-progress">
            <span>{formatTime(media.positionMs)}</span>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <span>{formatTime(media.durationMs)}</span>
          </div>
        ) : (
          // Players like Telegram don't report length: show how long it's been
          // playing (when we saw it start) and a running bar instead.
          <div className="media-progress">
            {media.positionMs > 0 && <span>{formatTime(media.positionMs)}</span>}
            <div className={`bar unknown${media.playing ? " live" : ""}`}>
              <div className="bar-fill" />
            </div>
          </div>
        )}

        <div className="media-controls-row">
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
          <VolumeSlider name={playerName(media.app, settings?.players.names)} volume={volume} />
        </div>
      </div>
    </div>
  );
}

/**
 * The player's volume in the Windows mixer (not the system one, and not the
 * slider inside the player, which Windows can't reach). A speaker icon right
 * of the controls; the slider slides out on hover, the wheel works too.
 */
function VolumeSlider({ name, volume: { state, setVolume, toggleMute } }: { name: string; volume: Volume }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  if (!state) return null;
  const { volume, muted } = state;

  const updateFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pos = (e.clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, pos));
    setVolume(clamped);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromPointer(e);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      updateFromPointer(e);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      setDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    setVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05));
  };

  const percent = Math.round(volume * 100);

  return (
    <div
      className={`media-volume${dragging ? " dragging" : ""}${muted ? " muted" : ""}`}
      onWheel={onWheel}
      title={`Громкость ${name} в микшере Windows: ${percent}%`}
    >
      <div
        ref={trackRef}
        className="vol-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="vol-bar">
          <div className="vol-fill" style={{ width: `${volume * 100}%` }} />
          <div className="vol-thumb" style={{ left: `${volume * 100}%` }} />
        </div>
      </div>
      <button
        type="button"
        className="icon-btn vol-btn"
        aria-label={muted ? "Включить звук" : "Выключить звук"}
        onClick={() => toggleMute()}
      >
        <VolumeIcon volume={volume} muted={muted} />
      </button>
    </div>
  );
}

function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" />
        <line x1="22" y1="9" x2="16" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="16" y1="9" x2="22" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (volume < 0.45) {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24">
      <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M19 5a9.5 9.5 0 0 1 0 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Album art, or a note placeholder when there is none or it fails to load. */
export function Art({ src, className }: { src: string | null; className: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  return src && broken !== src ? (
    <img className={className} src={src} alt="" draggable={false} onError={() => setBroken(src)} />
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
