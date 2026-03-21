import { forwardRef, useCallback, useEffect } from "react";
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
      resetTrigger,
      ...attributes
    },
    ref
  ) => {
    const stableSwipeLeft = useCallback(() => onSwipeLeft?.(), [onSwipeLeft]);
    const stableSwipeRight = useCallback(
      () => onSwipeRight?.(),
      [onSwipeRight]
    );

    const { containerRef, contentStyle, swipeState, reset } = useSwipeGesture({
      onSwipeLeft: stableSwipeLeft,
      onSwipeRight: stableSwipeRight,
      disabled,
    });

    // Reset swipe only when resetTrigger becomes falsy (dialog closed)
    const prevTrigger = useCallback(() => {}, []); // stable ref
    useEffect(() => {
      if (!resetTrigger) {
        reset();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetTrigger]);

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
        {/* Only render the action matching the swipe direction */}
        {(swipeState === "swiping-right" || swipeState === "open-right") && (
          <div className="swipeable-list__action swipeable-list__action--pin">
            <Icon symbol="pin" />
            <span>{isPinned ? "Unpin" : "Pin"}</span>
          </div>
        )}
        {(swipeState === "swiping-left" || swipeState === "open-left") && (
          <div className="swipeable-list__action swipeable-list__action--delete">
            <Icon symbol="delete" />
            <span>Delete</span>
          </div>
        )}

        {/* Slider — slides to reveal actions */}
        <div className="swipeable-list__slider" style={contentStyle}>
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
