import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "../island/env";

export interface ShelfItem {
  id: number;
  path: string;
  name: string;
  isDir: boolean;
  /** Unix ms. */
  added: number;
  /** False when the file was moved or deleted since it was shelved. */
  exists: boolean;
}

export const shelf = {
  /** Resolves to the names that were added. */
  add: (paths: string[]) => (isTauri ? invoke<string[]>("shelf_add", { paths }) : Promise.resolve([])),
  remove: (id: number) => isTauri && invoke("shelf_remove", { id }),
  clear: () => isTauri && invoke("shelf_clear"),
  open: (id: number) => isTauri && invoke("shelf_open", { id }),
  reveal: (id: number) => isTauri && invoke("shelf_reveal", { id }),
  drag: (ids: number[]) => isTauri && invoke("shelf_drag", { ids }),
};

export function useShelf(): ShelfItem[] {
  const [items, setItems] = useState<ShelfItem[]>([]);

  useEffect(() => {
    if (!isTauri) return;
    invoke<ShelfItem[]>("shelf_list").then(setItems);
    const unlisten = listen<ShelfItem[]>("lumen://shelf", (e) => setItems(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  return items;
}

const thumbCache = new Map<string, string | null>();

/** Preview (or icon) for a shelved file, or null while loading. */
export function useThumb(path: string): string | null {
  const [thumb, setThumb] = useState(() => thumbCache.get(path) ?? null);

  useEffect(() => {
    if (!isTauri) return;
    if (thumbCache.has(path)) {
      setThumb(thumbCache.get(path)!);
      return;
    }
    let alive = true;
    invoke<string | null>("shelf_thumb", { path }).then((url) => {
      thumbCache.set(path, url);
      if (alive) setThumb(url);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  return thumb;
}

/** Set while a file is being dragged out of the shelf, so it isn't re-shelved. */
let draggingOut = false;

export function dragOut(ids: number[]) {
  draggingOut = true;
  Promise.resolve(shelf.drag(ids)).catch(() => (draggingOut = false));
}

/**
 * Files dragged from Explorer onto the island. Returns whether a drag is
 * hovering the island; dropped files go on the shelf and `onAdded` gets
 * their names. Ignores drags while `enabled` is false (shelf tab hidden).
 */
export function useFileDrop(onAdded: (names: string[]) => void, enabled = true): boolean {
  const [dropping, setDropping] = useState(false);
  const callback = useRef(onAdded);
  callback.current = onAdded;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!isTauri) return;
    const dragEnd = listen("lumen://shelf-drag-end", () => (draggingOut = false));

    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (draggingOut || !enabledRef.current) return;
      if (payload.type === "enter") {
        setDropping(true);
      } else if (payload.type === "leave") {
        setDropping(false);
      } else if (payload.type === "drop") {
        setDropping(false);
        shelf.add(payload.paths).then((names) => names.length && callback.current(names));
      }
    });
    return () => {
      dragEnd.then((off) => off());
      unlisten.then((off) => off());
    };
  }, []);

  return dropping;
}
