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

  // Don't show if not authenticated
  if (syncState.isAuthenticated === false) {
    return null;
  }

  return (
    <button
      className={classNames(
        "sync-button",
        syncState.isSyncing && "sync-button--syncing"
      )}
      onClick={handleClick}
      disabled={syncState.isSyncing}
      title={
        syncState.isSyncing
          ? "Syncing..."
          : syncState.lastSyncedAt
          ? `Last synced: ${syncState.lastSyncedAt.toLocaleTimeString()}`
          : "Tap to sync"
      }
    >
      <Icon
        symbol={syncState.isSyncing ? "sync" : "cloud-done"}
        className="sync-button__icon"
      />
    </button>
  );
};
