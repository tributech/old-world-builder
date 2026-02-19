import { useState, useEffect } from "react";
import { useDispatch } from "react-redux";
import classNames from "classnames";
import { Icon } from "../icon";
import {
  subscribeSyncState,
  forceSync,
  checkAuth,
} from "../../utils/owr-sync";
import { setLists } from "../../state/lists";

import "./SyncButton.css";

export const SyncButton = () => {
  const dispatch = useDispatch();
  const [syncState, setSyncState] = useState({
    isSyncing: false,
    lastSyncedAt: null,
    isAuthenticated: null,
    hasPendingChanges: false,
    authError: false,
  });

  useEffect(() => {
    // Check auth on mount
    checkAuth();

    // Subscribe to sync state changes
    const unsubscribe = subscribeSyncState(setSyncState);
    return unsubscribe;
  }, []);

  const handleClick = async () => {
    if (syncState.isSyncing) return;

    const mergedLists = await forceSync();
    if (mergedLists) {
      dispatch(setLists(mergedLists));
    }
  };

  // Don't show if not authenticated (unless auth error — show so user can retry)
  if (syncState.isAuthenticated === false && !syncState.authError) {
    return null;
  }

  return (
    <button
      className={classNames(
        "sync-button",
        syncState.isSyncing && "sync-button--syncing",
        syncState.authError && "sync-button--error",
        !syncState.isSyncing &&
          !syncState.authError &&
          syncState.hasPendingChanges &&
          "sync-button--dirty"
      )}
      onClick={handleClick}
      disabled={syncState.isSyncing}
      title={
        syncState.authError
          ? "Sync failed — session expired. Tap to retry."
          : syncState.isSyncing
          ? "Syncing..."
          : syncState.hasPendingChanges
          ? "Unsynced changes. Tap to sync now."
          : syncState.lastSyncedAt
          ? `Last synced: ${syncState.lastSyncedAt.toLocaleTimeString()}`
          : "Tap to sync"
      }
    >
      <Icon
        symbol={syncState.authError ? "error" : syncState.isSyncing ? "sync" : "cloud-done"}
        className="sync-button__icon"
      />
    </button>
  );
};
