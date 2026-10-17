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
let failed = false;
let refreshing: Promise<unknown> | null = null;
let revision = 0;
const listeners = new Set<(n: number) => void>();

function apply(cache: LookupCache | null) {
  if (!cache || !applyIndex(cache.index)) return;
  fetchedAt = cache.fetchedAt;
  failed = false;
  changed();
}

function changed() {
  revision++;
  listeners.forEach((l) => l(revision));
}

/** "ready" once a copy is in; before that, "loading" or "failed". */
export const lookupState = (): "ready" | "loading" | "failed" => (fetchedAt ? "ready" : failed ? "failed" : "loading");

/** Downloads lumen.json again; every window gets it through `lumen://lookup`. */
export function refreshLookup(): Promise<LookupCache> {
  if (!refreshing) {
    failed = false;
    changed();
    refreshing = invoke<LookupCache>("lookup_refresh")
      .catch((err) => {
        failed = true;
        changed();
        throw err;
      })
      .finally(() => (refreshing = null));
  }
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

/** Fetches again if there's no copy or it's over an hour old; failures leave what's there. */
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
