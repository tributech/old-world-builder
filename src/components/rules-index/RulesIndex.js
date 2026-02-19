import React, { useState, useEffect } from "react";
import { FormattedMessage } from "react-intl";
import { useParams } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import classNames from "classnames";

import { Dialog } from "../../components/dialog";
import { Spinner } from "../../components/spinner";
import { normalizeRuleName } from "../../utils/string";
import { closeRulesIndex } from "../../state/rules-index";
import { isMobileAppContext } from "../../utils/owr-sync";

import { rulesMap, synonyms } from "./rules-map";
import "./RulesIndex.css";

export const RulesIndex = () => {
  const { open, activeRule } = useSelector((state) => state.rulesIndex);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { listId } = useParams();
  const isMobile = isMobileAppContext();
  const list = useSelector((state) =>
    state.lists.find(({ id }) => listId === id)
  );
  const listArmyComposition = list?.armyComposition || list?.army;
  const dispatch = useDispatch();
  const handleClose = () => {
    setIsLoading(true);
    setLoadError(false);
    dispatch(closeRulesIndex());
  };

  const normalizedName =
    activeRule.includes("renegade") && listArmyComposition?.includes("renegade")
      ? normalizeRuleName(activeRule)
      : normalizeRuleName(activeRule.replace(" {renegade}", ""));
  const synonym = synonyms[normalizedName];
  const ruleData = rulesMap[normalizedName] || rulesMap[synonym];
  const rulePath = ruleData?.url;

  // Timeout for loading - if iframe doesn't load in 10 seconds, show error
  useEffect(() => {
    if (!open || !rulePath || !isLoading) return;
    const timeout = setTimeout(() => {
      if (isLoading) setLoadError(true);
    }, 10000);
    return () => clearTimeout(timeout);
  }, [open, rulePath, isLoading]);

  return (
    <Dialog open={open} onClose={handleClose}>
      {rulePath ? (
        <>
          {loadError ? (
            <p>
              {isMobile
                ? "Rules lookup requires an internet connection."
                : "Failed to load rules. Please check your connection."}
            </p>
          ) : (
            <>
              <iframe
                onLoad={() => setIsLoading(false)}
                onError={() => setLoadError(true)}
                className={classNames(
                  "rules-index__iframe",
                  !isLoading && "rules-index__iframe--show"
                )}
                src={`https://tow.whfb.app/${rulePath}?minimal=true&utm_source=owb&utm_medium=referral`}
                title="Warhammer: The Old World Online Rules Index"
                height="500"
                width="700"
              />
              {isLoading && <Spinner className="rules-index__spinner" />}
            </>
          )}
        </>
      ) : (
        <p>
          <FormattedMessage id="editor.noRuleFound" />
        </p>
      )}
    </Dialog>
  );
};
