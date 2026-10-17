import { ReactNode, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../island/env";
import { addonAction, addonView, currentActivity, useAddonRevision } from "./host";
import { addonAsset, isPicture } from "./useAddons";
import type { AddonInfo } from "./types";

/**
 * An addon's tab. The addon never touches the island's page: it sends a small
 * tree of known parts (text, rows, buttons, lists...) and the island draws it
 * in its own style. Anything unknown or malformed in the tree is skipped.
 */
export function AddonPanel({ addon }: { addon: AddonInfo }) {
  useAddonRevision();
  const view = addonView(addon.id);
  if (view === undefined) return <div className="panel empty">{addon.name} запускается…</div>;
  const budget = { nodes: 400 };
  return (
    <div className="panel addon-panel">
      <Node node={view} addon={addon} depth={0} budget={budget} path="0" />
    </div>
  );
}

type Props = { node: unknown; addon: AddonInfo; depth: number; budget: { nodes: number }; path: string };

const MAX_DEPTH = 10;
const str = (v: unknown, max = 500) => (v == null ? "" : String(v)).slice(0, max);
const gap = (v: unknown) => (typeof v === "number" ? Math.min(32, Math.max(0, v)) : 8);
const ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
const JUSTIFY: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" };

function Node({ node, addon, depth, budget, path }: Props): ReactNode {
  if (depth > MAX_DEPTH || --budget.nodes < 0 || node == null || node === false) return null;
  if (typeof node === "string" || typeof node === "number") return <span className="ad-text">{str(node)}</span>;
  if (typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  const act = (action: unknown, value?: unknown) => typeof action === "string" && addonAction(addon.id, action, value);

  switch (n.type) {
    case "column":
    case "row": {
      const children = Array.isArray(n.children) ? n.children : [];
      return (
        <div
          className={`ad-${n.type}${n.scroll ? " scroll" : ""}${n.grow ? " grow" : ""}`}
          style={{
            gap: gap(n.gap),
            alignItems: ALIGN[str(n.align)],
            justifyContent: JUSTIFY[str(n.justify)],
          }}
        >
          {children.map((child, i) => (
            <Node key={i} node={child} addon={addon} depth={depth + 1} budget={budget} path={`${path}.${i}`} />
          ))}
        </div>
      );
    }
    case "text":
      return <span className={`ad-text ${str(n.style, 10) || "body"}${n.grow ? " grow" : ""}`}>{str(n.text, 2000)}</span>;
    case "button":
      return (
        <button className={`ad-button ${str(n.style, 10) || "normal"}`} onClick={() => act(n.action, n.value)}>
          {typeof n.icon === "string" && <AddonIcon addon={addon} icon={n.icon} bare />}
          {str(n.label, 60)}
        </button>
      );
    case "input":
      return <AddonInput key={path} node={n} onSubmit={(value) => act(n.action, value)} />;
    case "list": {
      const items = Array.isArray(n.items) ? n.items.slice(0, 100) : [];
      if (!items.length) return n.empty ? <div className="ad-empty">{str(n.empty, 200)}</div> : null;
      return (
        <ul className="ad-list">
          {items.map((raw, i) => {
            if (!raw || typeof raw !== "object") return null;
            const item = raw as Record<string, unknown>;
            budget.nodes--;
            const clickable = typeof item.action === "string";
            return (
              <li
                key={str(item.id ?? i, 100)}
                className={`ad-item${clickable ? " clickable" : ""}`}
                onClick={() => act(item.action, item.value ?? item.id)}
              >
                {typeof item.icon === "string" && <AddonIcon addon={addon} icon={item.icon} />}
                <span className="ad-item-main">
                  <span className="ad-item-title">{str(item.title, 300)}</span>
                  {item.subtitle != null && <span className="ad-item-sub">{str(item.subtitle, 300)}</span>}
                </span>
                {item.trailing != null && <span className="ad-item-trailing">{str(item.trailing, 40)}</span>}
              </li>
            );
          })}
        </ul>
      );
    }
    case "progress": {
      const value = typeof n.value === "number" ? Math.min(1, Math.max(0, n.value)) : 0;
      return (
        <div className="ad-progress">
          {n.label != null && <span className="ad-progress-label">{str(n.label, 100)}</span>}
          <span className="ad-progress-track">
            <motion.i initial={false} animate={{ width: `${value * 100}%` }} />
          </span>
        </div>
      );
    }
    case "stat":
      return (
        <div className="ad-stat">
          <span className="ad-stat-value">{str(n.value, 30)}</span>
          <span className="ad-stat-label">{str(n.label, 60)}</span>
        </div>
      );
    case "image": {
      const src = addonAsset(addon.id, n.src);
      if (!src) return null;
      const size = (v: unknown) => (typeof v === "number" ? Math.min(400, Math.max(8, v)) : undefined);
      return (
        <img
          className="ad-image"
          src={src}
          alt=""
          draggable={false}
          style={{ width: size(n.width), height: size(n.height), borderRadius: size(n.radius) }}
        />
      );
    }
    case "divider":
      return <hr className="ad-divider" />;
    case "spacer":
      return <span className="ad-spacer" />;
    default:
      return null;
  }
}

// Typing needs the normally non-activating window to take keyboard focus.
const takeFocus = () => isTauri && invoke("overlay_take_focus");
const releaseFocus = () => isTauri && invoke("overlay_release_focus", { restoreFocus: false });

function AddonInput({ node, onSubmit }: { node: Record<string, unknown>; onSubmit: (value: string) => void }) {
  const initial = str(node.value, 2000);
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  // A new value from the addon replaces what's typed.
  useEffect(() => setValue(initial), [initial]);
  useEffect(() => () => void releaseFocus(), []);

  return (
    <label className="search-box ad-input">
      <input
        ref={input}
        value={value}
        placeholder={str(node.placeholder, 100)}
        spellCheck={false}
        onMouseDown={() => takeFocus()}
        onFocus={() => takeFocus()}
        onBlur={() => releaseFocus()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onSubmit(value);
            if (node.clear !== false) setValue("");
          } else if (e.key === "Escape") {
            input.current?.blur();
          }
        }}
      />
      <kbd>Enter</kbd>
    </label>
  );
}

/**
 * An addon's picture: a file from its folder or a data: image, a glyph (an
 * emoji or a letter), or else the addon's own icon or first letter.
 */
export function AddonIcon({ addon, icon, bare }: { addon: AddonInfo; icon?: string | null; bare?: boolean }) {
  const own = icon ?? addon.icon;
  if (own && isPicture(own)) {
    const src = addonAsset(addon.id, own);
    if (src) return <img className="ad-icon" src={src} alt="" draggable={false} />;
  }
  if (own && !isPicture(own) && own.trim()) {
    return <span className={`ad-icon glyph${bare ? " bare" : ""}`}>{[...own.trim()].slice(0, 2).join("")}</span>;
  }
  const hue = [...addon.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="ad-icon letter" style={{ background: `hsl(${hue} 45% 32%)` }}>
      {addon.name.trim()[0]?.toUpperCase()}
    </span>
  );
}

/** The collapsed island while an addon has a live activity (the newest one). */
export function AddonActivityView({ reduced }: { reduced: boolean }) {
  useAddonRevision();
  const activity = currentActivity();
  if (!activity) return null;
  const slide = reduced ? {} : { initial: { opacity: 0, y: 8, filter: "blur(4px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" } };
  return (
    <motion.div key={`activity:${activity.addon.id}`} className="download addon-activity" {...slide}>
      <span className="download-icon">
        <AddonIcon addon={activity.addon} icon={activity.icon} bare />
      </span>
      <span className="download-name">{activity.title}</span>
      {activity.detail && <span className="download-meta">{activity.detail}</span>}
      {activity.progress != null && (
        <span className="addon-activity-bar">
          <motion.i initial={false} animate={{ width: `${activity.progress * 100}%` }} />
        </span>
      )}
    </motion.div>
  );
}
