import { Dialog } from "../dialog";
import { Button } from "../button";
import owrLogo from "../../assets/owr-logo-black.svg";

import "./SyncUpgradeDialog.css";

const DISMISSED_KEY = "owb.sync_upgrade_dismissed";

export const hasDismissedSyncUpgrade = () =>
  localStorage.getItem(DISMISSED_KEY) === "true";

export const SyncUpgradeDialog = ({ open, onClose }) => {
  //const isNativeApp = true; // TODO: revert to !!window.__OWR_AUTH__
  const isNativeApp = !!window.__OWR_AUTH__

  const handleUpgrade = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    if (isNativeApp) {
      window.open("https://oldworldrankings.com/purchase", "_blank");
    } else {
      window.location.href = "/purchase";
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleDismiss}>
      <div className="sync-upgrade">
        <div className="sync-upgrade__icon">
          <img src={owrLogo} alt="OWR" className="sync-upgrade__logo" />
        </div>
        <h2 className="sync-upgrade__title">Cloud Sync</h2>
        <p className="sync-upgrade__description">
          Sync your army lists across all your devices. Your lists are saved
          to the cloud and stay up to date everywhere you use Battle Builder.
        </p>
        <p className="sync-upgrade__description">
          Cloud sync is available with <strong>OWR Pro</strong>.
          {isNativeApp && " Upgrade at oldworldrankings.com."}
        </p>
        {!isNativeApp && (
          <div className="sync-upgrade__actions">
            <Button type="primary" fullWidth onClick={handleUpgrade}>
              Upgrade now
            </Button>
            <Button type="text" fullWidth onClick={handleDismiss}>
              Maybe later
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
};
