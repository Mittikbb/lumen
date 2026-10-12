import { ReactNode, useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useCursor } from "./useCursor";
import { useHitRegion } from "./useHitRegion";
import { useClock } from "./useClock";
import { trackKey, useMedia } from "../media/useMedia";
import { useAudioLevels } from "../media/useAudioLevels";
import { Art, Bars, MediaPanel } from "../media/MediaPanel";
import { clipPreview, useClipboard, useCopyEvents } from "../clipboard/useClipboard";
import { ClipboardPanel } from "../clipboard/ClipboardPanel";
import { LauncherPanel } from "../launcher/LauncherPanel";
import { launcher, useLauncherOpen } from "../launcher/useLauncher";
import { useFileDrop, useShelf } from "../shelf/useShelf";
import { ShelfPanel } from "../shelf/ShelfPanel";
import { setCity, useWeather } from "../weather/useWeather";
import { WeatherPanel } from "../weather/WeatherPanel";
import { WeatherIcon } from "../weather/WeatherIcon";
import { condition } from "../weather/conditions";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./env";
import { DEFAULT_SETTINGS, formatShortcut, openSettings, useSettings } from "../settings/useSettings";
import { useLook } from "../settings/look";
import { TABS, TabId } from "./tabs";
import { useDiscord } from "../discord/useDiscord";
import { CallPanel, MiniCall } from "../discord/CallPanel";
import type { MotionPrefs } from "../settings/useSettings";

/** Collapsed island while showing a short notice, e.g. "added to shelf". */
const NOTICE_WIDTH = 290;
const NOTICE_MS = 2600;
const WEATHER_NOTICE_MS = 6000;
const COPY_NOTICE_MS = 1800;
const UPDATE_NOTICE_MS = 8000;
/** Matches the .copied animation in theme.css. */
const COPY_FLASH_MS = 700;
/** After a specific notice (e.g. OCR), the generic "copied" one stays quiet this long. */
const QUIET_COPY_MS = 1500;
const EXPANDED_HEIGHT_DEFAULT = 230;
const CALL_TAB_WIDTH = 80;
/** Tabs with more content get a taller island. */
const EXPANDED_HEIGHT: Partial<Record<string, number>> = {
  call: 262,
  weather: 300,
  shelf: 270,
  clipboard: 320,
  launcher: 320,
};

/** How far (px) from the island the pointer starts to pull on it. */
const PULL_RADIUS = 220;

const SPEED = { slow: 0.55, normal: 1, fast: 1.6 };
const DAMPING = { calm: 40, normal: 32, springy: 20 };

/** The shape spring for the chosen speed and bounce; instant when motion is off. */
const shapeTransition = (m: MotionPrefs) =>
  m.reduced
    ? { duration: 0 }
    : ({ type: "spring", stiffness: 420 * SPEED[m.speed], damping: DAMPING[m.bounce], mass: 0.9 } as const);

const leanSpring = { stiffness: 260, damping: 18, mass: 0.6 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const capture = (mode: "shot" | "text") => isTauri && invoke("capture_start", { mode });

const SHOT_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const SETTINGS_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4L10.7 6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z" />
  </svg>
);

const UPDATE_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);

const SCAN_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    <path d="M8 9h8M8 12h8M8 15h5" />
  </svg>
);

export function Island() {
  const ref = useRef<HTMLDivElement>(null);
  const cursor = useCursor();
  const media = useMedia();
  const settings = useSettings();
  const prefs = settings ?? DEFAULT_SETTINGS;
  const { island: shape, collapsed: rest, notices, motion: moves } = prefs;
  const time = useClock(rest);
  const look = settings?.look;
  const hotkeys = prefs.hotkeys;
  const voice = useDiscord().voice;
  const blur = moves.blur && !moves.reduced;
  const noticeMs = (ms: number) => ms * notices.duration;
  useLook(look, media?.art);
  const reactive = useAudioLevels() && !!media?.playing && look?.beat !== false;
  const track = media ? trackKey(media) : "";
  const [hovered, setHovered] = useState(false);
  const [tab, setTab] = useState<TabId>("media");
  const clips = useClipboard();
  const launcherOpen = useLauncherOpen();
  const shelfItems = useShelf();
  const hidden = settings?.hiddenTabs ?? [];
  const tabs = TABS.filter(
    (t) => t.id === "launcher" || (!hidden.includes(t.id) && (t.id !== "call" || !!voice)),
  );
  const showsTab = (id: TabId) => tabs.some((t) => t.id === id);
  const [notice, setNotice] = useState<{
    title: string;
    detail: string;
    icon?: ReactNode;
    ms?: number;
  } | null>(null);

  // Files dragged onto the island land on the shelf.
  const dropping = useFileDrop((names) => {
    const detail = names.length > 1 ? `${names[0]} и ещё ${names.length - 1}` : names[0];
    if (notices.shelf) setNotice({ title: "Положено на полку", detail, ms: noticeMs(NOTICE_MS) });
  }, showsTab("shelf"));
  useEffect(() => {
    if (dropping) setTab("shelf");
  }, [dropping]);
  // The open tab was switched off in settings: fall back to the first one left.
  const tabShown = showsTab(tab);
  const firstTab = tabs[0].id;
  useEffect(() => {
    if (!tabShown) setTab(firstTab);
  }, [tabShown, firstTab]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.ms ?? NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  // A hidden weather tab means no weather at all, so nothing is fetched.
  const weatherCity = settings && showsTab("weather") ? settings.city : undefined;
  const weather = useWeather(weatherCity, prefs.weather, (alert) => {
    if (notices.rain) setNotice({ ...alert, icon: <WeatherIcon sky="rain" />, ms: noticeMs(WEATHER_NOTICE_MS) });
  });

  const expanded = hovered || launcherOpen || dropping;

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
    const t = setTimeout(() => setHovered(inside), inside ? shape.openDelay : shape.closeDelay);
    return () => clearTimeout(t);
  }, [inside, hovered, shape.openDelay, shape.closeDelay]);

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
    // Strength comes from the pull slider (0 switches it off).
    if (el && cursor && !expanded && !moves.reduced) {
      const cx = el.offsetLeft + el.offsetWidth / 2;
      const cy = el.offsetTop + el.offsetHeight / 2;
      dx = cursor.x - cx;
      dy = cursor.y - cy;
      pull = clamp(1 - Math.hypot(dx, dy) / PULL_RADIUS, 0, 1) * shape.pull;
    }
    x.set(clamp(dx * 0.08, -16, 16) * pull);
    y.set(clamp(dy * 0.05, 0, 8) * pull);
    scaleX.set(1 + 0.07 * pull);
    scaleY.set(1 + 0.1 * pull);
  }, [cursor, expanded, moves.reduced, shape.pull, x, y, scaleX, scaleY]);

  // Track change: a quick squash-and-stretch "gulp", layered on top of the lean.
  const bump = useMotionValue(1);
  const lastTrack = useRef(track);
  useEffect(() => {
    if (!track || track === lastTrack.current) return;
    const first = !lastTrack.current;
    lastTrack.current = track;
    if (first || !moves.trackBump || moves.reduced) return;
    animate(bump, [1, 1.08, 0.97, 1], { duration: 0.55, ease: "easeOut" });
  }, [track, bump, moves.trackBump, moves.reduced]);
  const bumpX = useTransform(() => scaleX.get() * bump.get());
  const bumpY = useTransform(() => scaleY.get() * (2 - bump.get()));

  // Notices from the backend, e.g. "text recognised" after OCR.
  const quietCopyUntil = useRef(0);
  const noticeMsRef = useRef(noticeMs);
  noticeMsRef.current = noticeMs;
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<{ title: string; detail: string; kind?: string }>("lumen://notice", (e) => {
      quietCopyUntil.current = Date.now() + QUIET_COPY_MS;
      const update = e.payload.kind === "update";
      setNotice({
        title: e.payload.title,
        detail: e.payload.detail,
        icon: update ? UPDATE_ICON : SCAN_ICON,
        ms: noticeMsRef.current(update ? UPDATE_NOTICE_MS : NOTICE_MS),
      });
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  // Copying anything: a small gulp, a flash of glow with a light sweeping
  // across the capsule, and (when collapsed) a short "copied" notice.
  useCopyEvents(clips, (entry) => {
    const flash = moves.copyFlash && !moves.reduced;
    if (flash) animate(bump, [1, 1.06, 0.98, 1], { duration: 0.45, ease: "easeOut" });
    const el = ref.current;
    if (el && flash) {
      el.classList.remove("copied");
      void el.offsetWidth; // restart the CSS animation on rapid copies
      el.classList.add("copied");
      setTimeout(() => el.classList.remove("copied"), COPY_FLASH_MS);
    }
    if (Date.now() < quietCopyUntil.current || !notices.copy) return;
    setNotice({
      title: "Скопировано",
      detail: clipPreview(entry),
      icon: entry.image ? (
        <img className="notice-thumb" src={entry.image.thumb} alt="" />
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="9" y="9" width="11" height="11" rx="2.5" />
          <path d="M5 15V6a2 2 0 0 1 2-2h8" />
        </svg>
      ),
      ms: noticeMs(COPY_NOTICE_MS),
    });
  });

  const collapsedSize = { width: shape.width, height: shape.height };
  const size = expanded
    ? {
        // The extra "Звонок" tab needs room, or the clock gets cut off.
        width: shape.expandedWidth + (showsTab("call") ? CALL_TAB_WIDTH : 0),
        height: EXPANDED_HEIGHT[tab] ?? EXPANDED_HEIGHT_DEFAULT,
      }
    : notice
      ? { ...collapsedSize, width: Math.max(NOTICE_WIDTH, shape.width + 70) }
      : voice && showsTab("call")
        ? { ...collapsedSize, width: Math.max(collapsedSize.width, 250) }
        : collapsedSize;
  const fade = (px: number) => (blur ? `blur(${px}px)` : "blur(0px)");

  return (
    <div className="stage" style={{ paddingTop: shape.offsetTop }}>
      <motion.div
        ref={ref}
        className={`island${media?.playing ? " is-playing" : ""}${reactive ? " reactive" : ""}${moves.reduced ? " reduced" : ""}`}
        initial={false}
        animate={{
          width: size.width,
          height: size.height,
          borderRadius: expanded ? shape.radius : shape.height / 2,
        }}
        transition={shapeTransition(moves)}
        style={{ x, y, scaleX: bumpX, scaleY: bumpY, transformOrigin: "50% 0%" }}
      >
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              key="expanded"
              className="expanded"
              initial={{ opacity: 0, filter: fade(6) }}
              animate={{ opacity: 1, filter: "blur(0px)", transition: { delay: moves.reduced ? 0 : 0.08 } }}
              exit={{ opacity: 0, filter: fade(6), transition: { duration: moves.reduced ? 0 : 0.12 } }}
            >
              <div className="tabs" role="tablist">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    className="tab"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => {
                      setTab(t.id);
                      // Search keeps the island open; leaving it hands control
                      // back to hover, so the island can collapse again.
                      if (t.id === "launcher") launcher.open();
                      else if (launcherOpen) launcher.close(true);
                    }}
                  >
                    {t.label}
                  </button>
                ))}
                <span className="tools">
                  <button
                    className="tool"
                    aria-label="Скриншот области"
                    title={`Скриншот области · ${formatShortcut(hotkeys.screenshot)}`}
                    onClick={() => capture("shot")}
                  >
                    {SHOT_ICON}
                  </button>
                  <button
                    className="tool"
                    aria-label="Текст с экрана"
                    title={`Текст с экрана · ${formatShortcut(hotkeys.text)}`}
                    onClick={() => capture("text")}
                  >
                    {SCAN_ICON}
                  </button>
                  <button className="tool" aria-label="Настройки" title="Настройки" onClick={openSettings}>
                    {SETTINGS_ICON}
                  </button>
                </span>
                <span className="clock">{time}</span>
              </div>
              {tab === "call" && voice ? (
                <CallPanel voice={voice} />
              ) : tab === "media" ? (
                <MediaPanel media={media} />
              ) : tab === "weather" ? (
                settings ? (
                  <WeatherPanel
                    city={settings.city}
                    forecast={weather.forecast}
                    error={weather.error}
                    onCity={setCity}
                  />
                ) : (
                  <div className="panel empty">Загружаю погоду…</div>
                )
              ) : tab === "shelf" ? (
                <ShelfPanel items={shelfItems} dropping={dropping} />
              ) : tab === "clipboard" ? (
                <ClipboardPanel entries={clips ?? []} />
              ) : (
                <LauncherPanel open={launcherOpen} hotkeys={hotkeys} engine={prefs.search.engine} />
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
              {notice ? (
                <motion.div
                  key="notice"
                  className="notice"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {notice.icon ?? (
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M4 13l4 4L20 7" />
                    </svg>
                  )}
                  <span className="notice-title">{notice.title}</span>
                  <span className="notice-detail">{notice.detail}</span>
                </motion.div>
              ) : voice && showsTab("call") ? (
                <MiniCall voice={voice} />
              ) : media && rest.track ? (
                <>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={track}
                      className="mini-track"
                      initial={{ opacity: 0, y: 10, filter: fade(4) }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, y: -10, filter: fade(4) }}
                      transition={{ duration: moves.reduced ? 0 : 0.3 }}
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
                  <span className="collapsed-right">
                    {rest.weather && weatherCity && weather.forecast && (
                      <span className="mini-weather">
                        <WeatherIcon sky={condition(weather.forecast.code).sky} day={weather.forecast.day} />
                        {weather.forecast.temp}°
                      </span>
                    )}
                    <span className="clock">{time}</span>
                  </span>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
