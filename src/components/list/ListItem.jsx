import { forwardRef } from "react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import classNames from "classnames";

import "./List.css";

export const ListItem = forwardRef(
  (
    {
      to,
      onClick,
      children,
      className,
      active,
      disabled,
      hide,
      as,
      ...attributes
    },
    ref
  ) => {
    // `as="div"` opts out of the auto-button wrapper so callers can embed
    // other interactive controls (e.g. menu buttons) without nesting
    // <button> in <button>, which is invalid DOM. The div still acts as a
    // click target via role/tabIndex.
    const useDiv = as === "div";
    const Component = to ? Link : useDiv ? "div" : "button";
    const interactiveProps = useDiv
      ? {
          role: "button",
          tabIndex: 0,
          onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick?.(e);
            }
          },
        }
      : {};

    return (
      <li
        {...attributes}
        ref={ref}
        className={classNames(
          "list",
          active && "list--active",
          hide && "list--hidden",
          className
        )}
      >
        <Component
          to={to}
          className={classNames(
            "list__inner",
            disabled && "list__inner--disabled"
          )}
          onClick={onClick}
          {...interactiveProps}
        >
          {children}
        </Component>
      </li>
    );
  }
);

ListItem.propTypes = {
  children: PropTypes.node,
  className: PropTypes.string,
  onClick: PropTypes.func,
  to: PropTypes.string,
  active: PropTypes.bool,
  disabled: PropTypes.bool,
  hide: PropTypes.bool,
  as: PropTypes.oneOf(["div"]),
};
