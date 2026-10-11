import { getCurrentWindow } from "@tauri-apps/api/window";
import { Island } from "./island/Island";
import { CaptureOverlay } from "./capture/CaptureOverlay";
import { isTauri } from "./island/env";
import "./theme.css";

/** One frontend, two windows: the island and the screen-capture overlay. */
const isCaptureWindow = isTauri && getCurrentWindow().label === "capture";

export default function App() {
  return isCaptureWindow ? <CaptureOverlay /> : <Island />;
}
