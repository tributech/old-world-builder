import { useState } from "react";
import classNames from "classnames";
import PropTypes from "prop-types";

import { Button } from "../../components/button";

import "./Page.css";

export const Header = ({
  className,
  headline,
  subheadline,
  moreButton,
  to,
}) => {
  const [showMenu, setShowMenu] = useState(false);

  const handleMenuClick = () => {
    setShowMenu(!showMenu);
  };

  return (
    <header className={classNames("header", className)}>
      {to && <Button type="text" to={to} label="Zurück" icon="back" />}
      <div className="header__text">
        {headline && <h1 className="header__name">{headline}</h1>}
        {subheadline && <p className="header__points">{subheadline}</p>}
      </div>
      {moreButton ? (
        <Button
          type="text"
          label="Mehr Optionen"
          icon="more"
          onClick={handleMenuClick}
        />
      ) : (
        <>{to && <div className="header__empty-icon" />}</>
      )}
      {showMenu && (
        <ul className="header__more">
          {moreButton.map(({ callback, name_de, icon, to: moreButtonTo }) => (
            <li key={name_de}>
              <Button
                type="text"
                onClick={callback}
                to={moreButtonTo}
                icon={icon}
              >
                {name_de}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
};

Header.propTypes = {
  className: PropTypes.string,
  to: PropTypes.string,
  headline: PropTypes.string,
  subheadline: PropTypes.string,
  children: PropTypes.node,
  moreButton: PropTypes.array,
};

export const Main = ({ className, children }) => {
  return <main className={classNames("main", className)}>{children}</main>;
};