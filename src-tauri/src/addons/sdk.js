// window.lumen: the addon API. It runs inside the addon's sandboxed frame and
// talks to the island over postMessage; the island checks every call against
// the permissions the user granted. See docs/addons.md.
(() => {
  "use strict";
  const island = window.parent;
  const pending = new Map();
  const listeners = new Map();
  let seq = 0;
  let provider = null;
  let info = { id: "", version: "", settings: {} };

  const post = (message) => island.postMessage({ lumen: 1, ...message }, "*");

  const call = (method, ...args) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      post({ call: id, method, args });
    });

  const emit = (event, data) => {
    for (const fn of listeners.get(event) ?? []) {
      try {
        fn(data);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const on = (event, fn) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  };

  window.addEventListener("message", async (e) => {
    const m = e.data;
    if (e.source !== island || !m || m.lumen !== 1) return;
    if ("reply" in m) {
      const p = pending.get(m.reply);
      pending.delete(m.reply);
      if (p) m.ok ? p.resolve(m.value) : p.reject(new Error(m.error));
    } else if ("event" in m) {
      if (m.event === "settings") info = { ...info, settings: m.data };
      emit(m.event, m.data);
    } else if ("request" in m && m.method === "search") {
      try {
        const items = provider ? await provider(String(m.args[0] ?? "")) : [];
        post({ response: m.request, ok: true, value: Array.isArray(items) ? items : [] });
      } catch (err) {
        post({ response: m.request, ok: false, error: String(err?.message ?? err) });
      }
    }
  });

  const ready = call("ready").then((value) => {
    info = value;
    return value;
  });

  const lumen = {
    /** Resolves once the island has answered; settings are filled in by then. */
    ready,
    get id() {
      return info.id;
    },
    get version() {
      return info.version;
    },
    /** The addon's settings (from manifest "settings"), live. */
    get settings() {
      return info.settings;
    },
    /** Events: "settings", "media", "tab:show", "tab:hide", "action", "select". */
    on,
    /** A short notice in the collapsed island. Needs "notify". */
    notify: (title, detail = "") => call("notify", { title: String(title), detail: String(detail) }),
    /** A lasting line in the collapsed island, like a download in progress. Needs "notify". */
    activity: {
      show: (activity) => call("activity", activity),
      hide: () => call("activity", null),
    },
    /** The addon's own tab (manifest "tab"). */
    tab: {
      render: (view) => call("render", view),
      onAction: (fn) => on("action", (e) => fn(e.action, e.value)),
    },
    /** Results in search (manifest "search": true). */
    search: {
      provide: (fn) => {
        provider = fn;
      },
      onSelect: (fn) => on("select", (e) => fn(e.id)),
    },
    /** Needs "clipboard". */
    copy: (text) => call("copy", String(text)),
    /** Opens an http(s) link in the browser. Needs "links". */
    open: (url) => call("open", String(url)),
    /** HTTPS to the hosts in manifest "network". Needs "network". */
    fetch: async (url, init = {}) => {
      const headers = Object.entries(init.headers ?? {}).map(([k, v]) => [String(k), String(v)]);
      const body = init.body == null ? null : typeof init.body === "string" ? init.body : JSON.stringify(init.body);
      const r = await call("fetch", { url: String(url), method: init.method ?? "GET", headers, body });
      return {
        status: r.status,
        ok: r.status >= 200 && r.status < 300,
        headers: Object.fromEntries(r.headers.map(([k, v]) => [k.toLowerCase(), v])),
        text: async () => r.body,
        json: async () => JSON.parse(r.body),
      };
    },
    /** Saved across restarts, up to 1 MB per addon. */
    storage: {
      get: async (key, fallback = null) => (await call("storage.get", String(key))) ?? fallback,
      set: (key, value) => call("storage.set", String(key), value),
      remove: (key) => call("storage.set", String(key), null),
    },
    /** What's playing: { title, artist, app, playing } or null. Needs "media". */
    media: {
      get: () => call("media"),
    },
  };

  Object.defineProperty(window, "lumen", { value: Object.freeze(lumen) });
})();
