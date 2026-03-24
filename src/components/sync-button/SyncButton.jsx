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
import { SyncUpgradeDialog, hasDismissedSyncUpgrade } from "./SyncUpgradeDialog";

import "./SyncButton.css";

export const SyncButton = () => {
  const dispatch = useDispatch();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [syncState, setSyncState] = useState({
    isSyncing: false,
    lastSyncedAt: null,
    isAuthenticated: null,
    hasPendingChanges: false,
    authError: false,
    cloudSyncEntitled: true,
  });

  useEffect(() => {
    checkAuth();
    const unsubscribe = subscribeSyncState(setSyncState);

    // Expose sync trigger for native app bridge
    window.__OWR_SYNC_TRIGGER__ = async () => {
      const mergedLists = await forceSync();
      if (mergedLists) {
        dispatch(setLists(mergedLists));
      }
      return mergedLists;
    };

    return () => {
      unsubscribe();
      delete window.__OWR_SYNC_TRIGGER__;
    };
  }, [dispatch]);

  // Auto-show upgrade dialog once for users who aren't entitled
  useEffect(() => {
    if (!syncState.cloudSyncEntitled && syncState.isAuthenticated && !hasDismissedSyncUpgrade()) {
      setShowUpgrade(true);
    }
  }, [syncState.cloudSyncEntitled, syncState.isAuthenticated]);

  const handleClick = async () => {
    if (!syncState.cloudSyncEntitled) {
      setShowUpgrade(true);
      return;
    }

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

  // Not entitled — show "Go Pro" pill button
  if (!syncState.cloudSyncEntitled) {
    return (
      <>
        <button
          className="sync-button sync-button--go-pro"
          onClick={handleClick}
          title="Upgrade to Pro for cloud sync"
        >
          <Icon symbol="cloud-done" className="sync-button__icon" />
          Go Pro
        </button>
        <SyncUpgradeDialog
          open={showUpgrade}
          onClose={() => setShowUpgrade(false)}
        />
      </>
    );
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
