/**
 * User-scoped storage abstraction (OWR sprout)
 *
 * Prefixes user-specific keys with `u.{storageKey}.` so different users on the
 * same browser don't collide. The storageKey comes from the backend sync API.
 *
 * Scoped keys: owb.lists, owb.settings, dirtyIds  (+ owb.game.* by prefix)
 * Non-scoped (browser-level): lang, owb.timezone, owb.datasets, etc.
 *
 * STORAGE BACKEND
 * ---------------
 * `owb.lists` is the only large value (full unit rosters; a power user crosses
 * 3MB). localStorage counts UTF-16 = 2 bytes/char against a ~5MB mobile cap, so
 * the blob blew the quota on phones and `setItem` threw. `owb.lists` therefore
 * lives in IndexedDB (disk-based, roomy, plain JSON) behind a synchronous
 * in-memory cache, so every existing getItem/setItem call site stays unchanged.
 * Everything else is small and stays in localStorage. App boot awaits `ready`
 * (the one-time IndexedDB hydrate) before mounting — see index.jsx.
 */

const ACTIVE_KEY = "owb.activeStorageKey";
const SCOPED_KEYS = ["owb.lists", "owb.settings", "dirtyIds"];
// Prefix-scoped keys are matched by startsWith (e.g. `owb.game.<listId>`).
const SCOPED_PREFIXES = ["owb.game."];
// Of the scoped keys, only these large ones are backed by IndexedDB; the rest
// stay in localStorage (small, and read synchronously at boot for color scheme).
const IDB_BASE_KEYS = new Set(["owb.lists"]);
// localStorage-resident scoped keys for the first-login unscoped→scoped move.
const LS_SCOPED_KEYS = ["owb.settings", "dirtyIds"];

let activeKey = localStorage.getItem(ACTIVE_KEY) || null;

const isScopedKey = (baseKey) =>
  SCOPED_KEYS.includes(baseKey) ||
  SCOPED_PREFIXES.some((p) => baseKey.startsWith(p));

const resolveKey = (baseKey) =>
  activeKey && isScopedKey(baseKey) ? `u.${activeKey}.${baseKey}` : baseKey;

const usesIdb = (baseKey) => IDB_BASE_KEYS.has(baseKey);
const baseOf = (fullKey) =>
  fullKey.startsWith("u.") ? fullKey.replace(/^u\.[^.]+\./, "") : fullKey;

// ---------------------------------------------------------------------------
// IndexedDB key-value store for the large blob(s). db === null means IndexedDB
// is unavailable (e.g. old private-mode Safari) → we transparently fall back to
// localStorage for these keys too (small libraries still work).
// ---------------------------------------------------------------------------
const IDB_NAME = "owb";
const IDB_STORE = "kv";
const cache = new Map(); // resolvedKey -> string, for IDB-routed keys
let db = null;

const idbOpen = () =>
  new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });

const idbLoadAll = () =>
  new Promise((resolve) => {
    const out = [];
    try {
      const req = db
        .transaction(IDB_STORE, "readonly")
        .objectStore(IDB_STORE)
        .openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          out.push([cur.key, cur.value]);
          cur.continue();
        } else resolve(out);
      };
      req.onerror = () => resolve(out);
    } catch (e) {
      resolve(out);
    }
  });

// Persist / unpersist an IDB-routed key. Write-through is fire-and-forget; the
// in-memory cache is the synchronous source of truth at runtime.
const persist = (k, v) => {
  if (db) {
    try {
      db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(v, k);
      return;
    } catch (e) {
      /* fall through to localStorage */
    }
  }
  try {
    localStorage.setItem(k, v);
  } catch (e) {}
};
const unpersist = (k) => {
  if (db) {
    try {
      db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).delete(k);
      return;
    } catch (e) {}
  }
  localStorage.removeItem(k);
};

let resolveReady;
export const ready = new Promise((r) => {
  resolveReady = r;
});

/** "idb" when IndexedDB backs the list store, "ls" on localStorage fallback. */
export const storageBackend = () => (db ? "idb" : "ls");

const hydrate = async () => {
  db = await idbOpen();
  if (db) {
    for (const [k, v] of await idbLoadAll()) cache.set(k, v);
  }
  migrateListsFromLocalStorage();
  if (activeKey) purgeOtherScopes(activeKey);
  resolveReady();
};

// ---------------------------------------------------------------------------
// Public API (synchronous, unchanged signatures)
// ---------------------------------------------------------------------------
export const getItem = (key) => {
  const k = resolveKey(key);
  if (usesIdb(key)) return cache.has(k) ? cache.get(k) : null;
  return localStorage.getItem(k);
};

export const setItem = (key, val) => {
  const k = resolveKey(key);
  if (usesIdb(key)) {
    const s = String(val);
    cache.set(k, s);
    persist(k, s);
    return;
  }
  localStorage.setItem(k, val);
};

export const removeItem = (key) => {
  const k = resolveKey(key);
  if (usesIdb(key)) {
    cache.delete(k);
    unpersist(k);
    return;
  }
  localStorage.removeItem(k);
};

export const getActiveStorageKey = () => activeKey;

/**
 * Set the active storage key (called when sync response arrives).
 * On first login, migrates unscoped data to the scoped key. Always purges
 * any other-user scoped data. Returns true if a different user was active.
 */
export const setActiveStorageKey = (key) => {
  if (!key || key === activeKey) return false;
  const prev = activeKey;
  activeKey = key;
  localStorage.setItem(ACTIVE_KEY, key);
  if (!prev) migrateUnscopedToScoped(key);
  purgeOtherScopes(key);
  return prev !== null;
};

// Remove every `u.<otherKey>.*` entry (localStorage AND the IDB-backed cache),
// keeping only `keepKey`. Server is source of truth for synced (Pro) users; a
// future switch back repulls. Local-only users only ever have one scope.
const purgeOtherScopes = (keepKey) => {
  const keepPrefix = `u.${keepKey}.`;
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("u.") && !k.startsWith(keepPrefix)) toRemove.push(k);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
  for (const k of [...cache.keys()]) {
    if (k.startsWith("u.") && !k.startsWith(keepPrefix)) {
      cache.delete(k);
      unpersist(k);
    }
  }
};

/**
 * First-login migration: move unscoped data into the user-scoped key.
 * localStorage-resident keys move in place; owb.lists moves within the cache/IDB.
 */
const migrateUnscopedToScoped = (key) => {
  for (const base of LS_SCOPED_KEYS) {
    const scoped = `u.${key}.${base}`;
    const data = localStorage.getItem(base);
    if (data && !localStorage.getItem(scoped)) {
      localStorage.setItem(scoped, data);
      localStorage.removeItem(base);
    }
  }
  const scoped = `u.${key}.owb.lists`;
  if (cache.has("owb.lists") && !cache.has(scoped)) {
    const v = cache.get("owb.lists");
    cache.set(scoped, v);
    persist(scoped, v);
    cache.delete("owb.lists");
    unpersist("owb.lists");
  }
};

/**
 * One-time on hydrate: pull any owb.lists blob out of localStorage into the
 * cache/IDB. Local-only (non-Pro) users keep their lists this way. Anything
 * that can't JSON.parse — a previously-compressed or corrupt blob — is dropped
 * (and, for Pro users, re-synced clean from the server).
 */
const migrateListsFromLocalStorage = () => {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || baseOf(k) !== "owb.lists") continue;
    toRemove.push(k);
    const v = localStorage.getItem(k);
    try {
      JSON.parse(v);
    } catch (e) {
      continue; // corrupt/compressed → drop, don't carry it over
    }
    if (!cache.has(k)) {
      cache.set(k, v);
      persist(k, v);
    }
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
};

hydrate();
