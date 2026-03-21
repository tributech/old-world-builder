import { forwardRef, useCallback } from "react";
import { Link } from "react-router-dom";
import classNames from "classnames";

import { Icon } from "../icon";
import { useSwipeGesture } from "../../hooks/useSwipeGesture";

import "./SwipeableListItem.css";

/**
 * A list item with swipe-to-reveal actions (pin right, delete left).
 * Replaces ListItem for regular (non-folder) army lists on the home page.
 * Uses forwardRef so OrderableList's cloneElement can attach rbd drag props.
 */
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
    const stableSwipeLeft = useCallback(() => onSwipeLeft?.(), [onSwipeLeft]);
    const stableSwipeRight = useCallback(
      () => onSwipeRight?.(),
      [onSwipeRight]
    );

    const { containerRef, contentStyle, swipeState } = useSwipeGesture({
      onSwipeLeft: stableSwipeLeft,
      onSwipeRight: stableSwipeRight,
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
        {/* Left action: Pin/Unpin (revealed on swipe right) */}
        <div className="swipeable-list__action swipeable-list__action--pin">
          <Icon symbol="pin" />
          <span>{isPinned ? "Unpin" : "Pin"}</span>
        </div>

        {/* Slideable content */}
        <Component
          to={to}
          className={classNames(
            "list__inner",
            "swipeable-list__content",
            disabled && "list__inner--disabled"
          )}
          style={contentStyle}
          onClick={handleClick}
        >
          {children}
        </Component>

        {/* Right action: Delete (revealed on swipe left) */}
        <div className="swipeable-list__action swipeable-list__action--delete">
          <Icon symbol="delete" />
          <span>Delete</span>
        </div>
      </li>
    );
  }
);
