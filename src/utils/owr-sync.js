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
const MIN_SYNC_ANIMATION_MS = 600; // Minimum time to show sync animation
const SOFT_DELETE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let syncTimeout = null;
let isAuthenticated = null;
let isSyncing = false;
let lastSyncedAt = null;
let syncStateListeners = [];

/**
 * Subscribe to sync state changes
 * @param {Function} listener - Callback receiving { isSyncing, lastSyncedAt }
 * @returns {Function} - Unsubscribe function
 */
export const subscribeSyncState = (listener) => {
  syncStateListeners.push(listener);
  // Immediately notify with current state
  listener({ isSyncing, lastSyncedAt, isAuthenticated });
  return () => {
    syncStateListeners = syncStateListeners.filter((l) => l !== listener);
  };
};

/**
 * Notify all listeners of sync state change
 */
const notifySyncState = () => {
  const state = { isSyncing, lastSyncedAt, isAuthenticated };
  syncStateListeners.forEach((listener) => listener(state));
};

/**
 * Get current sync state
 */
export const getSyncState = () => ({ isSyncing, lastSyncedAt, isAuthenticated });

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
  console.log("🔐 OWR Sync: checkAuth() called");
  console.log("   isJwtMode():", isJwtMode());

  // In JWT mode, check if token exists
  if (isJwtMode()) {
    console.log("   ✅ JWT mode - authenticated");
    isAuthenticated = true;
    return true;
  }

  if (isAuthenticated !== null) {
    console.log("   📦 Using cached auth result:", isAuthenticated);
    return isAuthenticated;
  }

  try {
    console.log("   🔍 Checking auth via API...");
    const res = await fetch(getSyncEndpoint(), getFetchOptions());
    isAuthenticated = res.ok;
    console.log("   API response:", res.status, "- authenticated:", isAuthenticated);
    return isAuthenticated;
  } catch (e) {
    console.error("   ❌ Auth check failed:", e);
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
  console.log("📥 OWR Sync: pullFromOWR() called with", localLists.length, "local lists");

  const authenticated = await checkAuth();
  console.log("   Auth check result:", authenticated);
  if (!authenticated) {
    console.warn("   ❌ Not authenticated, returning local lists only");
    return localLists;
  }

  try {
    const endpoint = getSyncEndpoint();
    console.log("   📡 Fetching from:", endpoint);
    console.log("   Fetch options:", JSON.stringify(getFetchOptions()));

    const res = await fetch(endpoint, getFetchOptions());
    console.log("   Response status:", res.status);
    console.log("   Response ok:", res.ok);
    console.log("   Response headers:", res.headers);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Could not read response");
      console.warn("   ⚠️ Response not OK (", res.status, ")");
      console.warn("   Error body:", errorText);
      return localLists;
    }

    const data = await res.json();
    const serverLists = data.lists || [];
    console.log("   ✅ Got", serverLists.length, "lists from server");

    const mergedLists = mergeLists(localLists, serverLists);
    console.log("   🔀 Merged to", mergedLists.length, "total lists");
    return mergedLists;
  } catch (e) {
    console.error("   ❌ pullFromOWR error type:", e.constructor.name);
    console.error("   Error message:", e.message);
    console.error("   Full error:", e);
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

    const startTime = Date.now();
    isSyncing = true;
    notifySyncState();

    try {
      await fetch(
        getSyncEndpoint(),
        getFetchOptions({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lists: addTimestamps(lists) }),
        })
      );
      lastSyncedAt = new Date();
    } catch (e) {
      console.warn("OWR sync failed:", e);
    } finally {
      // Ensure minimum animation time
      const elapsed = Date.now() - startTime;
      const remaining = MIN_SYNC_ANIMATION_MS - elapsed;
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      isSyncing = false;
      notifySyncState();
    }
  }, SYNC_DEBOUNCE_MS);
};

/**
 * Force an immediate sync (no debounce)
 * Used when user manually triggers sync
 */
export const forceSync = async () => {
  if (!(await checkAuth())) return null;
  if (isSyncing) return null;

  // Clear any pending debounced sync
  if (syncTimeout) clearTimeout(syncTimeout);

  const startTime = Date.now();
  isSyncing = true;
  notifySyncState();

  try {
    // Get current local lists
    const localLists = JSON.parse(localStorage.getItem("owb.lists")) || [];

    // Push to server
    const pushRes = await fetch(
      getSyncEndpoint(),
      getFetchOptions({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lists: addTimestamps(localLists) }),
      })
    );

    if (!pushRes.ok) {
      throw new Error(`Push failed: ${pushRes.status}`);
    }

    // Pull merged result from server
    const pullRes = await fetch(getSyncEndpoint(), getFetchOptions());
    if (!pullRes.ok) {
      throw new Error(`Pull failed: ${pullRes.status}`);
    }

    const data = await pullRes.json();
    const serverLists = data.lists || [];
    const mergedLists = mergeLists(localLists, serverLists);

    // Save merged lists
    localStorage.setItem("owb.lists", JSON.stringify(mergedLists));
    lastSyncedAt = new Date();

    return mergedLists.filter((l) => !l._deleted);
  } catch (e) {
    console.error("Force sync failed:", e);
    return null;
  } finally {
    // Ensure minimum animation time
    const elapsed = Date.now() - startTime;
    const remaining = MIN_SYNC_ANIMATION_MS - elapsed;
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    isSyncing = false;
    notifySyncState();
  }
};

/**
 * Merge local and server lists, keeping newest per ID
 * Handles _deleted flag for proper sync of deletions
 * IMPORTANT: Preserves local order to maintain folder structure
 */
const mergeLists = (local, server) => {
  // Index server lists for quick lookup
  const serverMap = new Map();
  server.forEach((list) => {
    serverMap.set(list.id, list);
  });

  // Track which server lists we've processed
  const processedServerIds = new Set();

  // Build result preserving LOCAL ORDER
  const result = [];

  // First, iterate through local lists in order
  local.forEach((localList) => {
    const serverList = serverMap.get(localList.id);
    processedServerIds.add(localList.id);

    if (localList._deleted) {
      // Local list is marked deleted
      if (serverList) {
        const localTime = localList.updated_at
          ? new Date(localList.updated_at).getTime()
          : 0;
        const serverTime = serverList.updated_at
          ? new Date(serverList.updated_at).getTime()
          : 0;
        // If server is newer, undo the delete
        if (serverTime > localTime) {
          result.push(serverList);
        }
        // Otherwise, keep it deleted (don't add to result)
      }
      // If not on server, just skip (it's deleted)
      return;
    }

    if (!serverList) {
      // Only exists locally, keep it
      result.push(localList);
    } else {
      // Exists on both - keep the newer one
      const localTime = localList.updated_at
        ? new Date(localList.updated_at).getTime()
        : 0;
      const serverTime = serverList.updated_at
        ? new Date(serverList.updated_at).getTime()
        : 0;
      result.push(localTime >= serverTime ? localList : serverList);
    }
  });

  // Add any NEW server lists (not in local) at the end
  // Skip server lists that are marked as deleted
  server.forEach((serverList) => {
    if (!processedServerIds.has(serverList.id) && !serverList._deleted) {
      result.push(serverList);
    }
  });

  return result;
};

/**
 * Filter out deleted lists for display purposes
 */
export const filterDeletedLists = (lists) => lists.filter((l) => !l._deleted);

/**
 * Clean up soft-deleted lists from localStorage
 * Only removes lists deleted more than 7 days ago
 */
export const cleanupDeletedLists = () => {
  const lists = JSON.parse(localStorage.getItem("owb.lists")) || [];
  const now = Date.now();

  const cleaned = lists.filter((list) => {
    if (!list._deleted) return true; // Keep non-deleted

    // Remove if deleted > 7 days ago
    const deletedAt = list.updated_at ? new Date(list.updated_at).getTime() : 0;
    return now - deletedAt < SOFT_DELETE_RETENTION_MS;
  });

  localStorage.setItem("owb.lists", JSON.stringify(cleaned));
};

/**
 * Add updated_at timestamps to lists that don't have them
 */
const addTimestamps = (lists) =>
  lists.map((list) => ({
    ...list,
    updated_at: list.updated_at || new Date().toISOString(),
  }));
