import { lazy, Suspense } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./island/env";
import "./theme.css";

// Each window loads only its own code: the island never needs the settings
// pages, and the settings and capture windows never need the island.
const Island = lazy(() => import("./island/Island").then((m) => ({ default: m.Island })));
const CaptureOverlay = lazy(() => import("./capture/CaptureOverlay").then((m) => ({ default: m.CaptureOverlay })));
const SettingsWindow = lazy(() => import("./settings/SettingsWindow").then((m) => ({ default: m.SettingsWindow })));

/**
 * One frontend, three windows: the island, the screen-capture overlay and the
 * settings. In the browser preview, `?settings` opens the settings page.
 */
const label = isTauri ? getCurrentWindow().label : new URLSearchParams(location.search).has("settings") ? "settings" : "main";

export default function App() {
  return (
    <Suspense fallback={null}>
      {label === "capture" ? <CaptureOverlay /> : label === "settings" ? <SettingsWindow /> : <Island />}
    </Suspense>
  );
}
