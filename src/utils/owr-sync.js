/**
 * OWR Cloud Sync - Transparent background sync for logged-in users
 *
 * This module syncs army lists with OWR when user is authenticated:
 * - On app load: pulls lists from OWR and merges with localStorage
 * - On list changes: debounced push to OWR
 *
 * Supports two auth modes:
 * - JWT (mobile): Uses window.__OWR_AUTH__ with Bearer token
 * - Cookie (web): Uses credentials: "include" for session cookies
 */

// Web uses /api/builder/sync (Rails controller with session cookies)
// Mobile uses /api/v1/builder/sync (Grape API with JWT)
const SYNC_PATH_WEB = "/api/builder/sync";
const SYNC_PATH_MOBILE = "/api/v1/builder/sync";
const SYNC_DEBOUNCE_MS = 2000;

let syncTimeout = null;
let isAuthenticated = null;
let isSyncing = false;

/**
 * Get the full sync endpoint URL
 * Uses window.__OWR_CONFIG__.apiBaseUrl for mobile, relative URL for web
 */
const getSyncEndpoint = () => {
  if (isJwtMode()) {
    const config = window.__OWR_CONFIG__;
    const baseUrl = config?.apiBaseUrl || "";
    return `${baseUrl}${SYNC_PATH_MOBILE}`;
  }
  return SYNC_PATH_WEB;
};

/**
 * Check if we're in JWT auth mode (mobile app)
 */
const isJwtMode = () => {
  return window.__OWR_AUTH__?.mode === "jwt" && window.__OWR_AUTH__?.accessToken;
};

/**
 * Get fetch options based on auth mode
 */
const getFetchOptions = (options = {}) => {
  if (isJwtMode()) {
    return {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${window.__OWR_AUTH__.accessToken}`,
      },
    };
  }
  // Web mode: use session cookies
  return {
    ...options,
    credentials: "include",
  };
};

/**
 * Check if user is logged into OWR
 * Caches result to avoid repeated requests
 */
export const checkAuth = async () => {
  // In JWT mode, check if token exists
  if (isJwtMode()) {
    isAuthenticated = true;
    return true;
  }

  if (isAuthenticated !== null) return isAuthenticated;

  try {
    const res = await fetch(getSyncEndpoint(), getFetchOptions());
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
 * Check if running in mobile app context
 * Returns true if JWT auth is configured or running from file:// protocol
 */
export const isMobileAppContext = () => {
  return isJwtMode() || window.location.protocol === "file:";
};

/**
 * Fetch lists from OWR and merge with local lists
 * @param {Array} localLists - Current lists from localStorage
 * @returns {Array} - Merged lists
 */
export const pullFromOWR = async (localLists) => {
  if (!(await checkAuth())) return localLists;

  try {
    const res = await fetch(getSyncEndpoint(), getFetchOptions());
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
      await fetch(
        getSyncEndpoint(),
        getFetchOptions({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lists: addTimestamps(lists) }),
        })
      );
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
