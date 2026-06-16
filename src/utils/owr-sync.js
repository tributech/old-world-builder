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

import { sortByRank } from "./list-ordering";
import { setActiveStorageKey, getItem, setItem } from "./storage";

// Web uses /api/builder/sync (Rails controller with session cookies)
// Mobile uses /api/v1/builder/sync (Grape API with JWT)
const SYNC_PATH_WEB = "/api/builder/sync";
const SYNC_PATH_MOBILE = "/api/v1/builder/sync";
const SYNC_DEBOUNCE_MS = 10000;
const SYNC_RETRY_INTERVAL_MS = 60000;
const AWAY_SYNC_THRESHOLD_MS = 60 * 1000; // Re-sync after 60s away from tab/window
const MIN_SYNC_ANIMATION_MS = 600; // Minimum time to show sync animation
const SOFT_DELETE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TOKEN_REFRESH_TIMEOUT_MS = 10000;

let syncTimeout = null;
let isAuthenticated = null;
let isSyncing = false;
let lastSyncedAt = null;
let hasPendingChanges = false;
let authError = false;
let cloudSyncEntitled = true; // Default true — backwards compatible with prod that doesn't send the field
let refreshPromise = null;
let syncStateListeners = [];
let pendingSync = false;
let periodicSyncTimer = null;
let serverSyncedAt = null; // Server's synced_at ISO8601 string for GET ?synced_at short-circuit
let authProbePromise = null; // In-flight checkAuth fetch — coalesce concurrent callers
let pullPromise = null; // In-flight pullFromOWR — coalesce concurrent callers

/**
 * Subscribe to sync state changes
 * @param {Function} listener - Callback receiving { isSyncing, lastSyncedAt }
 * @returns {Function} - Unsubscribe function
 */
// `hasPendingChanges` is derived from the persisted dirty set at emit time
// so it survives reloads — a fresh module evaluation sees the same dirty
// set the previous session left in localStorage, and the orange indicator
// is honest about unsynced edits immediately on app start.
const computeHasPendingChanges = () => hasPendingChanges || getDirtyIds().size > 0;

export const subscribeSyncState = (listener) => {
  syncStateListeners.push(listener);
  listener({ isSyncing, lastSyncedAt, isAuthenticated, hasPendingChanges: computeHasPendingChanges(), authError, cloudSyncEntitled });
  return () => {
    syncStateListeners = syncStateListeners.filter((l) => l !== listener);
  };
};

/**
 * Notify all listeners of sync state change
 */
const notifySyncState = () => {
  const state = { isSyncing, lastSyncedAt, isAuthenticated, hasPendingChanges: computeHasPendingChanges(), authError, cloudSyncEntitled };
  syncStateListeners.forEach((listener) => listener(state));
};

/**
 * Get current sync state
 */
export const getSyncState = () => ({
  isSyncing,
  lastSyncedAt,
  isAuthenticated,
  hasPendingChanges: computeHasPendingChanges(),
  authError,
  cloudSyncEntitled,
});

const startPeriodicSync = () => {
  if (periodicSyncTimer) return;
  periodicSyncTimer = setInterval(async () => {
    if (!hasPendingChanges || isSyncing || authError) return;
    await syncListsNow({ allowQueue: true });
  }, SYNC_RETRY_INTERVAL_MS);
};

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
 * Request a token refresh from the native mobile bridge.
 * Returns a singleton Promise to prevent races when multiple fetches 401 simultaneously.
 * Resolves true if refresh succeeded, false otherwise.
 */
const requestTokenRefresh = () => {
  if (refreshPromise) return refreshPromise;

  refreshPromise = new Promise((resolve) => {
    const cleanup = () => {
      delete window.__OWR_TOKEN_REFRESH_CALLBACK__;
      refreshPromise = null;
    };

    // Timeout — native didn't respond in time
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, TOKEN_REFRESH_TIMEOUT_MS);

    // Callback for native to invoke with result
    window.__OWR_TOKEN_REFRESH_CALLBACK__ = (success) => {
      clearTimeout(timer);
      cleanup();
      resolve(!!success);
    };

    // Try Android bridge
    if (window.OWRBridge?.requestTokenRefresh) {
      try {
        window.OWRBridge.requestTokenRefresh();
        return; // Wait for callback
      } catch (e) {
        console.warn("OWR Sync: Android bridge requestTokenRefresh failed:", e);
      }
    }

    // Try iOS bridge
    if (window.webkit?.messageHandlers?.owrBridge) {
      try {
        window.webkit.messageHandlers.owrBridge.postMessage("requestTokenRefresh");
        return; // Wait for callback
      } catch (e) {
        console.warn("OWR Sync: iOS bridge requestTokenRefresh failed:", e);
      }
    }

    // No bridge available (web mode) — resolve false immediately
    clearTimeout(timer);
    cleanup();
    resolve(false);
  });

  return refreshPromise;
};

/**
 * Notify native app of auth failure so it can show login screen
 */
const notifyNativeAuthFailure = () => {
  if (window.OWRBridge?.onAuthFailure) {
    try {
      window.OWRBridge.onAuthFailure();
    } catch (e) {
      console.warn("OWR Sync: Android bridge onAuthFailure failed:", e);
    }
  } else if (window.webkit?.messageHandlers?.owrBridge) {
    try {
      window.webkit.messageHandlers.owrBridge.postMessage("authFailure");
    } catch (e) {
      console.warn("OWR Sync: iOS bridge onAuthFailure failed:", e);
    }
  }
};

/**
 * Handle unrecoverable auth failure (401 + refresh failed)
 * Stops all sync activity and shows error state in UI.
 */
const handleAuthFailure = () => {
  isAuthenticated = false;
  authError = true;

  // Stop periodic sync and debounce timers
  if (periodicSyncTimer) {
    clearInterval(periodicSyncTimer);
    periodicSyncTimer = null;
  }
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }

  notifySyncState();
  notifyNativeAuthFailure();
};

/**
 * Fetch wrapper that intercepts 401 responses in JWT mode.
 * Attempts token refresh once, retries the request, then calls handleAuthFailure on second failure.
 */
const owrFetch = async (url, options = {}) => {
  const res = await fetch(url, getFetchOptions(options));

  if (res.status === 401 && isJwtMode()) {
    console.warn("OWR Sync: 401 received, attempting token refresh...");
    const refreshed = await requestTokenRefresh();

    if (refreshed) {
      // Retry with new token
      const retryRes = await fetch(url, getFetchOptions(options));
      if (retryRes.status === 401) {
        handleAuthFailure();
      }
      return retryRes;
    }

    handleAuthFailure();
  }

  return res;
};

/**
 * Make an authenticated API call to OWR.
 * Resolves web-style paths to the correct endpoint for the current auth mode.
 * @param {string} path - Web API path (e.g., '/api/builder/tournaments')
 * @param {Object} options - fetch options
 * @returns {Promise<Response>}
 */
export const owrApiFetch = async (path, options = {}) => {
  const baseUrl = isJwtMode()
    ? window.__OWR_CONFIG__?.apiBaseUrl || ""
    : "";
  const resolvedPath = isJwtMode()
    ? path.replace("/api/builder/", "/api/v1/builder/")
    : path;
  return owrFetch(`${baseUrl}${resolvedPath}`, options);
};

/**
 * Parse a JSON response defensively. Dev environments without the OWR
 * backend (or misconfigured proxies) can return index.html with a 200,
 * which then explodes inside `await res.json()` with an unhelpful
 * "Unexpected token '<'" SyntaxError. Treat any non-JSON body as "no
 * data" so callers can fall back gracefully and the console stays quiet.
 */
export const safeJson = async (res) => {
  if (!res) return null;
  const contentType = res.headers?.get?.("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
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

  // Coalesce concurrent callers (App.initApp + SyncButton + React strict-mode
  // double-fire) onto a single in-flight probe so we don't emit N GETs to /sync
  // before the first one resolves.
  if (authProbePromise) return authProbePromise;

  authProbePromise = (async () => {
    try {
      console.log("   🔍 Checking auth via API...");
      const res = await fetch(getSyncEndpoint(), getFetchOptions());
      isAuthenticated = res.ok;
      console.log("   API response:", res.status, "- authenticated:", isAuthenticated);

      if (res.ok) {
        const data = await safeJson(res);
        if (data) {
          if (data.cloud_sync_entitled !== undefined) {
            cloudSyncEntitled = !!data.cloud_sync_entitled;
          }
          // Cache the lists response to avoid a duplicate GET in pullFromOWR
          checkAuth._cachedData = data;
        }
      }

      notifySyncState();
      return isAuthenticated;
    } catch (e) {
      console.error("   ❌ Auth check failed:", e);
      isAuthenticated = false;
      return false;
    } finally {
      authProbePromise = null;
    }
  })();

  return authProbePromise;
};

/**
 * Reset auth cache (call when user logs in/out)
 */
export const resetAuthCache = () => {
  isAuthenticated = null;
  serverSyncedAt = null;
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

  // Coalesce concurrent pulls (e.g. React strict-mode double-fire) onto one fetch.
  if (pullPromise) return pullPromise;

  pullPromise = pullFromOWRImpl(localLists).finally(() => {
    pullPromise = null;
  });
  return pullPromise;
};

const pullFromOWRImpl = async (localLists) => {
  const authenticated = await checkAuth();
  console.log("   Auth check result:", authenticated);
  if (!cloudSyncEntitled) {
    console.log("   ⏭️ Not entitled to cloud sync, using local lists only");
    return localLists;
  }
  if (!authenticated) {
    console.warn("   ❌ Not authenticated, returning local lists only");
    return localLists;
  }

  const startTime = Date.now();
  isSyncing = true;
  notifySyncState();

  try {
    // Use cached data from checkAuth if available (avoids duplicate GET)
    let data = checkAuth._cachedData;
    checkAuth._cachedData = null;

    if (!data) {
      console.log("   📡 Fetching sync...");
      // Send synced_at for short-circuit when we have a cached timestamp
      const syncPath = serverSyncedAt
        ? `${SYNC_PATH_WEB}?synced_at=${encodeURIComponent(serverSyncedAt)}`
        : SYNC_PATH_WEB;

      const res = await owrApiFetch(syncPath);

      if (!res.ok) {
        console.warn("   ⚠️ Response not OK (", res.status, ")");
        return localLists;
      }

      data = await safeJson(res);
      if (!data) {
        // Non-JSON response (e.g. dev server returned index.html). Bail
        // gracefully — local lists are still authoritative for display.
        return localLists;
      }
    }

    // Update entitlement from response
    if (data.cloud_sync_entitled !== undefined) {
      cloudSyncEntitled = !!data.cloud_sync_entitled;
      notifySyncState();
    }

    // Short-circuit: nothing changed on server since last sync
    if (data.changed === false) {
      console.log("   ✅ Server unchanged, using local lists");
      lastSyncedAt = new Date();
      return localLists;
    }

    const serverLists = data.lists || [];
    console.log("   ✅ Got", serverLists.length, "lists from server");

    // Track server's synced_at for future short-circuit
    if (data.synced_at) {
      serverSyncedAt = data.synced_at;
    }

    // Scope localStorage to this user. setActiveStorageKey purges
    // u.<otherKey>.* — switching back later repulls from the server.
    let effectiveLocalLists = localLists;
    if (data.storage_key) {
      const isUserSwitch = setActiveStorageKey(data.storage_key);
      if (isUserSwitch) {
        effectiveLocalLists = JSON.parse(getItem("owb.lists")) || [];
      }
    }

    const mergedLists = mergeLists(effectiveLocalLists, serverLists);
    setDirtyIds(reconcileDirtyAfterPull(getDirtyIds(), mergedLists));
    console.log("   🔀 Merged to", mergedLists.length, "total lists");
    return mergedLists;
  } catch (e) {
    console.error("   ❌ pullFromOWR error type:", e.constructor.name);
    console.error("   Error message:", e.message);
    console.error("   Full error:", e);
    return localLists;
  } finally {
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
 * Push to OWR after a debounce. The dirty set already records what
 * needs sending; we just trigger a sync round-trip after the debounce
 * window. Argument is ignored (kept for compatibility with callers).
 */
export const pushToOWR = () => {
  if (!cloudSyncEntitled) return; // Pro-only — skip silently
  startPeriodicSync();
  if (syncTimeout) clearTimeout(syncTimeout);
  hasPendingChanges = true;
  notifySyncState();

  syncTimeout = setTimeout(async () => {
    await syncListsNow({ allowQueue: true });
  }, SYNC_DEBOUNCE_MS);
};

/**
 * Flush pending changes immediately (no debounce).
 * Useful when navigating away from the current list context.
 */
export const flushPendingSync = async () => {
  if (!hasPendingChanges) return false;
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }
  return syncListsNow({ allowQueue: true });
};

/**
 * Apply the server's sync response to local lists.
 * Handles both delta responses (deleted_ids present) and full responses.
 *
 * Once the server has accepted our tombstones it owns the broadcast for the
 * next 7 days, so we drop them from localStorage immediately on ack instead of
 * keeping them around until cleanupDeletedLists runs. If the response shows
 * another device resurrected the list, we keep the resurrected version.
 */
const applySyncResponse = (localLists, data, dirtySent = []) => {
  if (data.synced_at) {
    serverSyncedAt = data.synced_at;
  }
  // Server received what we sent — clear ids from dirty IFF local hasn't
  // moved on. Edits that landed during the round-trip stay dirty.
  clearDirty(dirtySent);
  // Server reported ids we claimed in `known` that it has no record of.
  // Mark them dirty so the next sync re-pushes them. (Servers without this
  // field omit it; legacy behaviour falls back to the deleted_ids path.)
  if (Array.isArray(data.unknown_ids) && data.unknown_ids.length) {
    for (const id of data.unknown_ids) markDirty(id);
  }
  let result;
  if (data.deleted_ids) {
    result = applyDelta(localLists, data.lists || [], data.deleted_ids);
  } else if (data.lists) {
    result = mergeLists(localLists, data.lists);
  } else {
    result = localLists;
  }

  const ackedTombstones = new Set();
  for (const list of dirtySent) {
    if (list && list._deleted) ackedTombstones.add(list.id);
  }
  if (!ackedTombstones.size) return result;

  return result.filter((list) => {
    if (!ackedTombstones.has(list.id)) return true;
    return !list._deleted;
  });
};

/**
 * One round-trip with the server: read fresh local lists, build dirty +
 * manifest, POST, apply the response, persist. Returns the merged list
 * array on success, null on failure.
 */
const runSyncRoundTrip = async () => {
  const localLists = JSON.parse(getItem("owb.lists")) || [];
  const timestampedLists = addTimestamps(localLists);
  const { dirty, known } = splitDirtyLists(timestampedLists);

  const res = await owrApiFetch(SYNC_PATH_WEB, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lists: dirty, known }),
  });
  if (!res.ok) throw new Error(`Push failed: ${res.status}`);

  const data = await safeJson(res);
  if (!data) throw new Error("Push response was not JSON");
  const merged = applySyncResponse(localLists, data, dirty);
  setItem("owb.lists", JSON.stringify(merged));
  lastSyncedAt = new Date();
  return merged;
};

const waitMinAnimation = async (startTime) => {
  const remaining = MIN_SYNC_ANIMATION_MS - (Date.now() - startTime);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
};

const syncListsNow = async ({ allowQueue = false } = {}) => {
  if (!(await checkAuth())) return false;
  if (isSyncing) {
    if (allowQueue) pendingSync = true;
    return false;
  }

  const startTime = Date.now();
  isSyncing = true;
  notifySyncState();

  try {
    await runSyncRoundTrip();
    hasPendingChanges = false;
    return true;
  } catch (e) {
    console.warn("OWR sync failed:", e);
    return false;
  } finally {
    await waitMinAnimation(startTime);
    isSyncing = false;
    notifySyncState();
    if (pendingSync) {
      pendingSync = false;
      await syncListsNow({ allowQueue: true });
    }
  }
};

/**
 * Force an immediate sync (no debounce). Used when the user manually
 * triggers sync. Returns the merged non-deleted lists, or null on failure.
 */
export const forceSync = async () => {
  if (authError) {
    authError = false;
    isAuthenticated = true;
    notifySyncState();
  }
  if (!(await checkAuth())) return null;
  if (isSyncing) return null;
  if (syncTimeout) clearTimeout(syncTimeout);

  const startTime = Date.now();
  isSyncing = true;
  notifySyncState();

  try {
    const merged = await runSyncRoundTrip();
    hasPendingChanges = false;
    return merged.filter((l) => !l._deleted);
  } catch (e) {
    console.error("Force sync failed:", e);
    return null;
  } finally {
    await waitMinAnimation(startTime);
    isSyncing = false;
    notifySyncState();
  }
};

/**
 * Persistent dirty set: ids of lists that have local edits not yet
 * confirmed by the server. Backed by `dirtyIds` in localStorage so it
 * survives reloads. Cleared per-id when the server acks the round-trip.
 *
 * If the storage key is missing entirely (first run after this change
 * shipped, or fresh install), seed with every current list id so existing
 * users do one fat sync to bring themselves into the tracked state.
 */
const getDirtyIds = () => {
  const raw = getItem("dirtyIds");
  if (raw !== null) {
    try {
      return new Set(JSON.parse(raw));
    } catch {
      return new Set();
    }
  }
  const lists = JSON.parse(getItem("owb.lists")) || [];
  const seeded = new Set(lists.map((l) => l.id).filter(Boolean));
  setItem("dirtyIds", JSON.stringify([...seeded]));
  return seeded;
};

const setDirtyIds = (set) => {
  setItem("dirtyIds", JSON.stringify([...set]));
};

/**
 * Compute the new dirty set after a pull merge:
 *  - keep existing dirty ids that still exist locally (preserves pending
 *    edits across a pull)
 *  - drop dirty entries for lists that no longer exist locally
 *
 * Local-only ids are deliberately NOT auto-marked dirty. The next POST's
 * `unknown_ids` is the authoritative signal for "server doesn't have this,
 * push it back" — auto-adding here would also defeat the 180-day
 * resurrection guard for tombstones the server has intentionally pruned.
 */
const reconcileDirtyAfterPull = (currentDirty, mergedLists) => {
  const mergedIds = new Set(mergedLists.map((l) => l.id).filter(Boolean));
  const next = new Set();
  for (const id of currentDirty) {
    if (mergedIds.has(id)) next.add(id);
  }
  return next;
};

export const markDirty = (id) => {
  if (!id) return;
  const set = getDirtyIds();
  if (set.has(id)) return;
  set.add(id);
  setDirtyIds(set);
  // Surface the unsynced-changes indicator immediately, independent of
  // pushToOWR's debounce/entitlement gate. The sync round-trip itself
  // still respects entitlement; this just makes the UI honest about
  // there being local edits that haven't reached the server yet.
  if (!hasPendingChanges) {
    hasPendingChanges = true;
    notifySyncState();
  }
};

/**
 * Clear server-acked entries from the dirty set, but only when the local
 * `updated_at` still matches what we sent. If the user edited the same list
 * mid-round-trip, the local `updated_at` has moved on; we keep that id dirty
 * so the next sync ships the new content. (Race fix.)
 */
const clearDirty = (sent) => {
  if (!sent?.length) return;
  const localLists = JSON.parse(getItem("owb.lists")) || [];
  const localById = new Map(localLists.map((l) => [l.id, l]));
  const set = getDirtyIds();
  let mutated = false;
  for (const sentList of sent) {
    if (!sentList?.id) continue;
    const local = localById.get(sentList.id);
    if (local && local.updated_at !== sentList.updated_at) {
      // Local edited since send — keep dirty.
      continue;
    }
    if (set.delete(sentList.id)) mutated = true;
  }
  if (mutated) setDirtyIds(set);
};

/**
 * Split lists into dirty (need sending) and known (full manifest).
 * Server uses `known` to figure out the rest — what client should pull,
 * what client should drop. We just decide what to push.
 */
const splitDirtyLists = (timestampedLists, dirtyIds = getDirtyIds()) => {
  const known = buildKnownManifest(timestampedLists);
  const dirty = timestampedLists.filter((list) => dirtyIds.has(list.id));
  return { dirty, known };
};

/**
 * Build a compact manifest of { id: updated_at } for all local lists.
 * Sent with POST to enable delta responses from the server.
 */
const buildKnownManifest = (lists) => {
  const known = {};
  lists.forEach((list) => {
    if (list.id && list.updated_at) {
      known[list.id] = list.updated_at;
    }
  });
  return known;
};

/**
 * Defensive dedupe: a "send_list" launch from OWR used to prepend the list
 * to storage without checking for an existing entry of the same id, so users
 * who hit that path before the Rails fix landed have duplicates locked in
 * (each subsequent ensureRanks regenerates the second copy's rank, so it
 * never looks like a true duplicate to a naive lex-sort and persists).
 * Keep the most recently `updated_at`'d entry per id.
 */
const dedupeById = (lists) => {
  const byId = new Map();
  for (const list of lists) {
    if (!list?.id) continue;
    const existing = byId.get(list.id);
    if (!existing) {
      byId.set(list.id, list);
      continue;
    }
    const a = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
    const b = list.updated_at ? new Date(list.updated_at).getTime() : 0;
    if (b > a) byId.set(list.id, list);
  }
  return Array.from(byId.values());
};

/**
 * Apply a delta response (changed lists + deleted IDs) to local lists.
 * Used when the server returns only what changed instead of the full array.
 */
const applyDelta = (localLists, deltaLists, deletedIds) => {
  localLists = dedupeById(localLists);
  const deleteSet = new Set(deletedIds || []);
  const deltaMap = new Map();
  deltaLists.forEach((list) => deltaMap.set(list.id, list));

  const localIds = new Set();

  // Update existing lists, remove deleted ones
  const result = [];
  localLists.forEach((list) => {
    localIds.add(list.id);
    if (deleteSet.has(list.id)) return; // Server says remove it
    if (deltaMap.has(list.id)) {
      const delta = deltaMap.get(list.id);
      if (delta._deleted) return; // Server tombstone — drop the list, don't store the marker
      result.push(delta);
    } else {
      if (list._deleted) return; // Stale local tombstone — server has stopped broadcasting it
      result.push(list);
    }
  });

  // Add brand new lists from delta (not already local).
  // Skip server-side tombstones we don't already track locally — there's
  // nothing to delete on this device, and re-adding the tombstone would just
  // resurrect it in storage until cleanupDeletedLists runs.
  deltaLists.forEach((list) => {
    if (!localIds.has(list.id) && !list._deleted) {
      result.push(list);
    }
  });

  return sortByRank(reparentOrphans(result));
};

/**
 * Re-parent orphaned children whose folder no longer exists.
 *
 * Folders and their child lists are independent records merged by per-id
 * last-write-wins; nothing keeps a child and its folder together. Deleting a
 * folder only re-parents the children the deleting device happened to hold
 * (deleteFolderOp), so a child living on another device keeps pointing at a
 * folder that is now gone. sortByRank floats such orphans to the top level for
 * display, but the dangling `folder` pointer is never cleared, so the
 * inconsistency persists and re-surfaces on every device that holds the child.
 *
 * Repair it at the merge seam — the one place that runs on every device on
 * every pull: clear the pointer, bump updated_at so the fix wins LWW
 * everywhere, and markDirty so it actually reaches the server on the next push.
 * Idempotent: a child with a null or live-folder pointer is left untouched, so
 * once repaired it stops being detected and all devices converge.
 */
const reparentOrphans = (lists) => {
  const liveFolderIds = new Set(
    lists.filter((l) => l.type === "folder" && !l._deleted).map((l) => l.id),
  );
  return lists.map((l) => {
    if (l.type === "folder" || l._deleted) return l;
    if (l.folder == null || liveFolderIds.has(l.folder)) return l;
    markDirty(l.id);
    return { ...l, folder: null, updated_at: new Date().toISOString() };
  });
};

/**
 * Merge local and server lists, keeping newest per ID
 * Handles _deleted flag for proper sync of deletions
 * IMPORTANT: Preserves local order to maintain folder structure
 */
const mergeLists = (local, server) => {
  local = dedupeById(local);
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
      // Local list is marked deleted. Only resurrect when the server has a
      // newer non-deleted version (another device modified after our delete).
      // Otherwise drop both the local tombstone and any server tombstone —
      // there's no list to display and no marker worth retaining.
      if (
        serverList &&
        !serverList._deleted &&
        new Date(serverList.updated_at || 0).getTime() >
          new Date(localList.updated_at || 0).getTime()
      ) {
        result.push(serverList);
      }
      return;
    }

    if (!serverList) {
      result.push(localList);
    } else {
      const localTime = localList.updated_at
        ? new Date(localList.updated_at).getTime()
        : 0;
      const serverTime = serverList.updated_at
        ? new Date(serverList.updated_at).getTime()
        : 0;
      if (localTime >= serverTime) {
        result.push(localList);
      } else if (!serverList._deleted) {
        result.push(serverList);
      }
      // else: server tombstone supersedes local list — drop entirely
    }
  });

  // Add any NEW server lists (not in local) at the end
  // Skip server lists that are marked as deleted
  server.forEach((serverList) => {
    if (!processedServerIds.has(serverList.id) && !serverList._deleted) {
      result.push(serverList);
    }
  });

  // Sort by rank to ensure consistent ordering across devices
  return sortByRank(reparentOrphans(result));
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
  const lists = JSON.parse(getItem("owb.lists")) || [];
  const now = Date.now();

  const cleaned = lists.filter((list) => {
    if (!list._deleted) return true; // Keep non-deleted

    // Remove if deleted > 7 days ago
    const deletedAt = list.updated_at ? new Date(list.updated_at).getTime() : 0;
    return now - deletedAt < SOFT_DELETE_RETENTION_MS;
  });

  setItem("owb.lists", JSON.stringify(cleaned));
};

/**
 * Add updated_at timestamps to lists that don't have them
 */
const addTimestamps = (lists) =>
  lists.map((list) => ({
    ...list,
    updated_at: list.updated_at || new Date().toISOString(),
  }));

/**
 * Register visibility/focus listeners that re-sync when the user returns
 * to the tab or window after being away for 60s+.
 * Returns a cleanup function to remove the listeners.
 * @param {Function} onSynced - Called with merged lists after a successful sync
 */
export const setupVisibilitySync = (onSynced) => {
  let hiddenAt = null;

  const onHide = () => {
    hiddenAt = Date.now();
  };

  const onReturn = async () => {
    if (hiddenAt === null) return;
    const awayMs = Date.now() - hiddenAt;
    hiddenAt = null; // prevent double-fire from visibilitychange + focus

    const { isSyncing: syncing, isAuthenticated: authed } = getSyncState();
    if (!authed || syncing || awayMs < AWAY_SYNC_THRESHOLD_MS) return;

    const mergedLists = await forceSync();
    if (mergedLists) onSynced(mergedLists);
  };

  const handleVisibility = () => {
    if (document.hidden) onHide();
    else onReturn();
  };

  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("focus", onReturn);
  window.addEventListener("blur", onHide);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("focus", onReturn);
    window.removeEventListener("blur", onHide);
  };
};

/**
 * Reset auth error state after successful re-login.
 * Called by native apps via window.__OWR_SYNC__.resetAuth()
 */
export const resetAuth = () => {
  authError = false;
  isAuthenticated = true;
  serverSyncedAt = null;
  notifySyncState();
  startPeriodicSync();
};

// Expose resetAuth for native bridge recovery
window.__OWR_SYNC__ = { resetAuth };

// Visible for testing only
export const __test__ = {
  mergeLists,
  applyDelta,
  reparentOrphans,
  splitDirtyLists,
  addTimestamps,
  buildKnownManifest,
  applySyncResponse,
  getDirtyIds,
  markDirty,
  clearDirty,
  reconcileDirtyAfterPull,
};
