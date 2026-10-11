import { getCurrentWindow } from "@tauri-apps/api/window";
import { Island } from "./island/Island";
import { CaptureOverlay } from "./capture/CaptureOverlay";
import { SettingsWindow } from "./settings/SettingsWindow";
import { isTauri } from "./island/env";
import "./theme.css";

/**
 * One frontend, three windows: the island, the screen-capture overlay and the
 * settings. In the browser preview, `?settings` opens the settings page.
 */
const label = isTauri ? getCurrentWindow().label : new URLSearchParams(location.search).has("settings") ? "settings" : "main";

export default function App() {
  return label === "capture" ? <CaptureOverlay /> : label === "settings" ? <SettingsWindow /> : <Island />;
}
