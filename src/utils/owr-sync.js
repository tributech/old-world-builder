/**
 * OWR Cloud Sync - Transparent background sync for logged-in users
 *
 * This module syncs army lists with OWR when user is authenticated:
 * - On app load: pulls lists from OWR and merges with localStorage
 * - On list changes: debounced push to OWR
 */

const SYNC_ENDPOINT = "/api/builder/sync";
const SYNC_DEBOUNCE_MS = 2000;

let syncTimeout = null;
let isAuthenticated = null;
let isSyncing = false;

/**
 * Check if user is logged into OWR
 * Caches result to avoid repeated requests
 */
export const checkAuth = async () => {
  if (isAuthenticated !== null) return isAuthenticated;

  try {
    const res = await fetch(SYNC_ENDPOINT, { credentials: "include" });
    isAuthenticated = res.ok;
    return isAuthenticated;
  } catch {
    isAuthenticated = false;
    return false;
  }
};

/**
 * Reset auth cache (call when user logs in/out)
 */
export const resetAuthCache = () => {
  isAuthenticated = null;
};

/**
 * Fetch lists from OWR and merge with local lists
 * @param {Array} localLists - Current lists from localStorage
 * @returns {Array} - Merged lists
 */
export const pullFromOWR = async (localLists) => {
  if (!(await checkAuth())) return localLists;

  try {
    const res = await fetch(SYNC_ENDPOINT, { credentials: "include" });
    if (!res.ok) return localLists;

    const { lists: serverLists } = await res.json();
    return mergeLists(localLists, serverLists);
  } catch {
    return localLists;
  }
};

/**
 * Push lists to OWR (debounced to avoid excessive requests)
 * @param {Array} lists - Lists to sync
 */
export const pushToOWR = (lists) => {
  if (syncTimeout) clearTimeout(syncTimeout);

  syncTimeout = setTimeout(async () => {
    if (!(await checkAuth())) return;
    if (isSyncing) return;

    isSyncing = true;
    try {
      await fetch(SYNC_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lists: addTimestamps(lists) }),
      });
    } catch (e) {
      console.warn("OWR sync failed:", e);
    } finally {
      isSyncing = false;
    }
  }, SYNC_DEBOUNCE_MS);
};

/**
 * Merge local and server lists, keeping newest per ID
 */
const mergeLists = (local, server) => {
  const merged = new Map();

  server.forEach((list) => {
    merged.set(list.id, list);
  });

  local.forEach((list) => {
    const existing = merged.get(list.id);
    if (!existing) {
      merged.set(list.id, list);
    } else {
      const localTime = list.updated_at
        ? new Date(list.updated_at).getTime()
        : 0;
      const serverTime = existing.updated_at
        ? new Date(existing.updated_at).getTime()
        : 0;
      if (localTime > serverTime) {
        merged.set(list.id, list);
      }
    }
  });

  return Array.from(merged.values());
};

/**
 * Add updated_at timestamps to lists that don't have them
 */
const addTimestamps = (lists) =>
  lists.map((list) => ({
    ...list,
    updated_at: list.updated_at || new Date().toISOString(),
  }));
