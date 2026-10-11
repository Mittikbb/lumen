/** True when running inside the Tauri shell, false in a plain browser (vite dev preview). */
export const isTauri = "__TAURI_INTERNALS__" in window;
