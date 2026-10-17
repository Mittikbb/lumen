import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../island/env";
import { applyIndex } from "./httpCodes";

/** lumen.json as the backend keeps it, in memory only. */
export interface LookupCache {
  /** When it was downloaded, ms since 1970. */
  fetchedAt: number;
  index: unknown;
}

/** A copy older than this is fetched again when search opens. */
const STALE_MS = 60 * 60 * 1000;

let fetchedAt = 0;
let refreshing: Promise<unknown> | null = null;
let revision = 0;
const listeners = new Set<(n: number) => void>();

function apply(cache: LookupCache | null) {
  if (!cache || !applyIndex(cache.index)) return;
  fetchedAt = cache.fetchedAt;
  revision++;
  listeners.forEach((l) => l(revision));
}

/** Downloads lumen.json again; every window gets it through `lumen://lookup`. */
export function refreshLookup(): Promise<LookupCache> {
  refreshing ??= invoke<LookupCache>("lookup_refresh").finally(() => (refreshing = null));
  return refreshing as Promise<LookupCache>;
}

let started = false;

/** The copy the backend already has (after an island reload), a fresh one if
 * there's none or it's old, and every later download. */
function start() {
  if (started || !isTauri) return;
  started = true;
  listen<LookupCache>("lumen://lookup", (e) => apply(e.payload));
  invoke<LookupCache | null>("lookup_cached").then((cache) => {
    apply(cache);
    ensureFresh();
  });
}

/** Fetches again if the copy is over an hour old; failures leave what's there. */
export function ensureFresh() {
  if (isTauri && started && Date.now() - fetchedAt > STALE_MS && !refreshing) refreshLookup().catch(() => {});
}

/**
 * Keeps the "h:" data from Protocol-list while the lookup is on; the number
 * changes whenever a new copy is laid over, for re-running the search.
 */
export function useLookupData(enabled: boolean): number {
  const [n, setN] = useState(revision);
  useEffect(() => {
    if (!enabled) return;
    start();
    listeners.add(setN);
    return () => {
      listeners.delete(setN);
    };
  }, [enabled]);
  return n;
}
