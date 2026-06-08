import { useState, useEffect } from "react";
import classNames from "classnames";
import PropTypes from "prop-types";
import { useLocation, Link, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { FormattedMessage, useIntl } from "react-intl";

import { Button } from "../../components/button";
import { Icon } from "../../components/icon";
import { SyncButton } from "../../components/sync-button";
import { isMobileAppContext } from "../../utils/owr-sync";
import { updateLocalList, hasMeaningfulListChange } from "../../utils/owr-list";
import { getItem, setItem } from "../../utils/storage";
import { updateSetting } from "../../state/settings";

import owrLogoWhite from "../../assets/owr-logo-white.svg";
import "./Header.css";

export const Header = ({
  className,
  headline,
  headlineIcon,
  subheadline,
  moreButton,
  to,
  isSection,
  isPreview,
  hasPointsError,
  hasMainNavigation,
  navigationIcon,
  hasHomeButton,
  hasOWRButton,
  filters,
}) => {
  const intl = useIntl();
  const location = useLocation();
  const [showMenu, setShowMenu] = useState(false);
  const isMobile = isMobileAppContext();
  const dispatch = useDispatch();
  const { listId, unitId } = useParams();
  const list = useSelector((state) =>
    state.lists.find(({ id }) => listId === id),
  );
  const settings = useSelector((state) => state.settings);
  const handleBackToOWR = () => {
    if (window.opener && !window.opener.closed) {
      window.open('', 'owr-main');
    } else {
      window.location.href = "/";
    }
  };
  const Component = isSection ? "section" : "header";
  const handleMenuClick = () => {
    setShowMenu(!showMenu);
  };
  const navigationLinks = [
    {
      name: intl.formatMessage({
        id: "footer.about",
      }),
      to: "/about",
      icon: "about",
    },
    {
      name: intl.formatMessage({
        id: "footer.settings",
      }),
      to: "/settings",
      icon: "settings",
    },
    {
      name: intl.formatMessage({
        id: "footer.custom-datasets",
      }),
      to: "/custom-datasets",
      icon: "datasets",
    },
  ];
  const navigation = hasMainNavigation ? navigationLinks : moreButton;

  useEffect(() => {
    setShowMenu(false);
  }, [location.pathname]);

  useEffect(() => {
    const localList = JSON.parse(getItem("owb.lists") || "[]").find(
      (localList) => localList.id === listId,
    );

    if (list && hasMeaningfulListChange(localList, list)) {
      updateLocalList(list);

      const newSettings = { ...settings, lastChanged: new Date().toString() };
      dispatch(updateSetting({ lastChanged: newSettings.lastChanged }));
      setItem("owb.settings", JSON.stringify(newSettings));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  return (
    <>
      <Component
        className={classNames(
          isSection ? "column-header" : "header",
          isMobile && "header--webview",
          className,
        )}
      >
        {to ? (
          <Button
            type="text"
            to={to}
            label={
              isSection
                ? intl.formatMessage({ id: "header.close" })
                : intl.formatMessage({ id: "header.back" })
            }
            color={isSection ? "dark" : "light"}
            icon={isSection ? "close" : "back"}
            showLabelRight={!isSection}
          />
        ) : (
          <>
            {hasOWRButton && !isMobile && (
              <Button
                type="text"
                onClick={handleBackToOWR}
                label="Back to OWR"
                color="light"
                icon="back"
              />
            )}
            {hasHomeButton && !hasOWRButton && (
              <Button
                type="text"
                to="/"
                label={intl.formatMessage({ id: "misc.startpage" })}
                color="light"
                icon="home"
                showLabelRight
              />
            )}
          </>
        )}
        <div className="header__text">
          {headline && (
            <>
              {headline === "Battle Builder" ? (
                <h1 className="header__name">
                  <Link className="header__name-link header__brand" to="/">
                    <img
                      src={owrLogoWhite}
                      alt="OWR"
                      className="header__brand-logo"
                    />
                    {headline}
                  </Link>
                  <SyncButton />
                </h1>
              ) : (
                <h1 className="header__name">
                  {headlineIcon && headlineIcon}
                  <span className="header__name-text">{headline}</span>
                </h1>
              )}
            </>
          )}
          {subheadline && (
            <p className="header__points">
              {subheadline}{" "}
              {hasPointsError && <Icon symbol="error" color="red" />}
            </p>
          )}
        </div>
        {/* Show sync button on sub-pages (editor, unit, etc.) */}
        {headline !== "Battle Builder" && ((hasMainNavigation && !hasHomeButton) || (to && !isSection)) && (
          <SyncButton />
        )}
        {navigation ? (
          <Button
            type="text"
            className={classNames(showMenu && "header__more-button")}
            color={isSection ? "dark" : "light"}
            label={
              navigationIcon
                ? unitId
                  ? intl.formatMessage({ id: "header.moreUnit" })
                  : intl.formatMessage({ id: "header.moreList" })
                : intl.formatMessage({ id: "header.menu" })
            }
            icon={navigationIcon ? navigationIcon : "menu"}
            onClick={handleMenuClick}
            showLabelLeft={!isSection}
          />
        ) : (
          <>
            {to && !filters && (
              <div
                className={classNames(
                  "header__empty-icon",
                  isSection && "header__empty-icon--small",
                )}
              />
            )}
          </>
        )}
        {filters && (
          <Button
            type="text"
            className={classNames(showMenu && "header__more-button")}
            color={isSection ? "dark" : "light"}
            label={intl.formatMessage({ id: "header.filter" })}
            icon="filter"
            onClick={handleMenuClick}
            showLabelLeft
          />
        )}
        {showMenu && navigation && (
          <ul
            className={classNames(
              "header__more",
              !hasMainNavigation && "header__more--secondary-navigation",
            )}
          >
            {navigation.map(
              ({ callback, name, icon, to: moreButtonTo, closeOnClick }) => (
                <li key={name}>
                  <Button
                    type="text"
                    onClick={() => {
                      callback && callback();

                      if (closeOnClick) {
                        setShowMenu(false);
                      }
                    }}
                    to={moreButtonTo}
                    icon={icon}
                  >
                    {name}
                  </Button>
                </li>
              ),
            )}
          </ul>
        )}
        {showMenu && filters && (
          <ul
            className={classNames(
              "header__more",
              !hasMainNavigation && "header__more--secondary-navigation",
            )}
          >
            {filters.map(({ callback, name, description, id, checked }) => (
              <li key={id}>
                <div className="checkbox header__checkbox">
                  <input
                    type="checkbox"
                    id={id}
                    onChange={callback}
                    checked={checked}
                    className="checkbox__input"
                  />
                  <label htmlFor={id} className="checkbox__label">
                    {name}
                  </label>
                </div>
                {description && (
                  <i className="header__filter-description">{description}</i>
                )}
              </li>
            ))}
          </ul>
        )}
      </Component>
    </>
  );
};

Header.propTypes = {
  className: PropTypes.string,
  to: PropTypes.string,
  headline: PropTypes.string,
  headlineIcon: PropTypes.node,
  subheadline: PropTypes.oneOfType([PropTypes.string, PropTypes.node]),
  children: PropTypes.node,
  moreButton: PropTypes.array,
  filters: PropTypes.array,
  isSection: PropTypes.bool,
  hasPointsError: PropTypes.bool,
  hasMainNavigation: PropTypes.bool,
  hasHomeButton: PropTypes.bool,
  hasOWRButton: PropTypes.bool,
  navigationIcon: PropTypes.string,
};
