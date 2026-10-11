import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useCursor } from "./useCursor";
import { useHitRegion } from "./useHitRegion";
import { useClock } from "./useClock";
import { trackKey, useMedia } from "../media/useMedia";
import { useAudioLevels } from "../media/useAudioLevels";
import { useGlowFromArt } from "../media/useGlowFromArt";
import { Art, Bars, MediaPanel } from "../media/MediaPanel";
import { useClipboard } from "../clipboard/useClipboard";
import { ClipboardPanel } from "../clipboard/ClipboardPanel";
import { LauncherPanel } from "../launcher/LauncherPanel";
import { launcher, useLauncherOpen } from "../launcher/useLauncher";

const COLLAPSED = { width: 220, height: 40 };
const EXPANDED = { width: 560, height: 230 };
/** Tabs with more content get a taller island. */
const EXPANDED_HEIGHT: Partial<Record<string, number>> = { clipboard: 320, launcher: 320 };

const OPEN_DELAY = 120;
const CLOSE_DELAY = 380;
/** How far (px) from the island the pointer starts to pull on it. */
const PULL_RADIUS = 220;

const shapeSpring = { type: "spring", stiffness: 420, damping: 32, mass: 0.9 } as const;
const leanSpring = { stiffness: 260, damping: 18, mass: 0.6 };

const TABS = [
  { id: "media", label: "Медиа" },
  { id: "clipboard", label: "Буфер" },
  { id: "launcher", label: "Поиск" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function Island() {
  const ref = useRef<HTMLDivElement>(null);
  const cursor = useCursor();
  const time = useClock();
  const media = useMedia();
  useGlowFromArt(media?.art);
  const reactive = useAudioLevels() && !!media?.playing;
  const track = media ? trackKey(media) : "";
  const [hovered, setHovered] = useState(false);
  const [tab, setTab] = useState<TabId>("media");
  const clips = useClipboard();
  const launcherOpen = useLauncherOpen();
  const expanded = hovered || launcherOpen;

  // Alt+Space: jump to the search tab. Clicking anywhere else closes it.
  useEffect(() => {
    if (!launcherOpen) return;
    setTab("launcher");
    const onBlur = () => launcher.close(false);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [launcherOpen]);

  useHitRegion(ref);

  // Hover intent: open a beat after the pointer arrives, close a bit after it leaves.
  const inside = cursor?.inside ?? false;
  useEffect(() => {
    if (inside === hovered) return;
    const t = setTimeout(() => setHovered(inside), inside ? OPEN_DELAY : CLOSE_DELAY);
    return () => clearTimeout(t);
  }, [inside, hovered]);

  // Liquid lean: while collapsed, the island stretches toward a nearby pointer.
  const x = useSpring(0, leanSpring);
  const y = useSpring(0, leanSpring);
  const scaleX = useSpring(1, leanSpring);
  const scaleY = useSpring(1, leanSpring);

  useEffect(() => {
    const el = ref.current;
    let pull = 0;
    let dx = 0;
    let dy = 0;
    if (el && cursor && !expanded) {
      const cx = el.offsetLeft + el.offsetWidth / 2;
      const cy = el.offsetTop + el.offsetHeight / 2;
      dx = cursor.x - cx;
      dy = cursor.y - cy;
      pull = clamp(1 - Math.hypot(dx, dy) / PULL_RADIUS, 0, 1);
    }
    x.set(clamp(dx * 0.08, -16, 16) * pull);
    y.set(clamp(dy * 0.05, 0, 8) * pull);
    scaleX.set(1 + 0.07 * pull);
    scaleY.set(1 + 0.1 * pull);
  }, [cursor, expanded, x, y, scaleX, scaleY]);

  // Track change: a quick squash-and-stretch "gulp", layered on top of the lean.
  const bump = useMotionValue(1);
  const lastTrack = useRef(track);
  useEffect(() => {
    if (!track || track === lastTrack.current) return;
    const first = !lastTrack.current;
    lastTrack.current = track;
    if (first) return;
    animate(bump, [1, 1.08, 0.97, 1], { duration: 0.55, ease: "easeOut" });
  }, [track, bump]);
  const bumpX = useTransform(() => scaleX.get() * bump.get());
  const bumpY = useTransform(() => scaleY.get() * (2 - bump.get()));

  const size = expanded ? { ...EXPANDED, height: EXPANDED_HEIGHT[tab] ?? EXPANDED.height } : COLLAPSED;

  return (
    <div className="stage">
      <motion.div
        ref={ref}
        className={`island${media?.playing ? " is-playing" : ""}${reactive ? " reactive" : ""}`}
        initial={false}
        animate={{
          width: size.width,
          height: size.height,
          borderRadius: expanded ? 30 : COLLAPSED.height / 2,
        }}
        transition={shapeSpring}
        style={{ x, y, scaleX: bumpX, scaleY: bumpY, transformOrigin: "50% 0%" }}
      >
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              key="expanded"
              className="expanded"
              initial={{ opacity: 0, filter: "blur(6px)" }}
              animate={{ opacity: 1, filter: "blur(0px)", transition: { delay: 0.08 } }}
              exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.12 } }}
            >
              <div className="tabs" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    className="tab"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => {
                      setTab(t.id);
                      if (t.id === "launcher") launcher.open();
                    }}
                  >
                    {t.label}
                  </button>
                ))}
                <span className="clock">{time}</span>
              </div>
              {tab === "media" ? (
                <MediaPanel media={media} />
              ) : tab === "clipboard" ? (
                <ClipboardPanel entries={clips} />
              ) : (
                <LauncherPanel open={launcherOpen} />
              )}
            </motion.div>
          ) : (
            <motion.div
              key="collapsed"
              className="collapsed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.1 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            >
              {media ? (
                <>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={track}
                      className="mini-track"
                      initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
                      transition={{ duration: 0.3 }}
                    >
                      <Art src={media.art} className="mini-art" />
                      <span className="mini-title">{media.title}</span>
                    </motion.div>
                  </AnimatePresence>
                  <Bars playing={media.playing} reactive={reactive} />
                </>
              ) : (
                <>
                  <span className="orb" />
                  <span className="clock">{time}</span>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
