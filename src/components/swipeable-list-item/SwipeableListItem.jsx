import { forwardRef } from "react";
import { Link } from "react-router-dom";
import classNames from "classnames";

import { Icon } from "../icon";
import { useSwipeGesture } from "../../hooks/useSwipeGesture";

import "./SwipeableListItem.css";

export const SwipeableListItem = forwardRef(
  (
    {
      to,
      onClick,
      children,
      className,
      active,
      hide,
      disabled,
      isPinned,
      onSwipeLeft,
      onSwipeRight,
      ...attributes
    },
    ref
  ) => {
    // The hook keeps a ref to the latest callbacks, so passing fresh
    // arrow functions every render is fine — listeners are attached once.
    const { containerRef, sliderRef, swipeState } = useSwipeGesture({
      onSwipeLeft,
      onSwipeRight,
      disabled,
    });

    const mergedRef = (node) => {
      containerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    };

    const Component = to ? Link : "button";

    const handleClick = (e) => {
      if (swipeState !== "idle") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      onClick?.(e);
    };

    return (
      <li
        {...attributes}
        ref={mergedRef}
        className={classNames(
          "list",
          "swipeable-list",
          active && "list--active",
          hide && "list--hidden",
          className
        )}
      >
        {/* Both actions always rendered behind the slider (z-index:0).
            CSS uses data-swiping attribute to show only the relevant action. */}
        <div className="swipeable-list__action swipeable-list__action--pin">
          <Icon symbol="pin" />
          <span>{isPinned ? "Unpin" : "Pin"}</span>
        </div>
        <div className="swipeable-list__action swipeable-list__action--delete">
          <Icon symbol="delete" />
          <span>Delete</span>
        </div>

        {/* Slider — slides to reveal actions via direct DOM transform */}
        <div className="swipeable-list__slider" ref={sliderRef}>
          <Component
            to={to}
            className={classNames(
              "list__inner",
              disabled && "list__inner--disabled"
            )}
            onClick={handleClick}
          >
            {children}
          </Component>
        </div>
      </li>
    );
  }
);
