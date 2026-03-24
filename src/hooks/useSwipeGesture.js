import { useRef, useState, useCallback, useEffect } from "react";

const DEAD_ZONE = 10; // px before intent is decided
const SWIPE_MAX = 80; // max reveal distance in px
const SNAP_THRESHOLD = 40; // px to snap open
const VELOCITY_THRESHOLD = 0.3; // px/ms for flick
const TRANSITION = "transform 0.3s ease";

export const useSwipeGesture = ({
  onSwipeLeft,
  onSwipeRight,
  disabled = false,
} = {}) => {
  const containerRef = useRef(null);
  const sliderRef = useRef(null);
  const touchRef = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    intent: "undecided",
    currentOffset: 0,
  });

  // Only used for final snap states — NOT updated during gesture
  // idle | open-left | open-right
  const [swipeState, setSwipeState] = useState("idle");

  const setSliderTransform = useCallback((px, animate) => {
    const el = sliderRef.current;
    if (!el) return;
    el.style.transition = animate ? TRANSITION : "none";
    el.style.transform = `translateX(${px}px)`;
    el.style.willChange = px !== 0 ? "transform" : "auto";
  }, []);

  const setDirection = useCallback((dir) => {
    const el = containerRef.current;
    if (!el) return;
    if (dir) {
      el.setAttribute("data-swiping", dir);
    } else {
      el.removeAttribute("data-swiping");
    }
  }, []);

  const reset = useCallback(() => {
    setSliderTransform(0, true);
    setSwipeState("idle");
    setDirection(null);
    touchRef.current.intent = "undecided";
    touchRef.current.currentOffset = 0;
  }, [setSliderTransform, setDirection]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    const handleTouchStart = (e) => {
      const touch = e.touches[0];
      touchRef.current.startX = touch.clientX;
      touchRef.current.startY = touch.clientY;
      touchRef.current.startTime = Date.now();
      touchRef.current.intent = "undecided";
      // Kill any running transition so the slider tracks the finger immediately
      const slider = sliderRef.current;
      if (slider) slider.style.transition = "none";
    };

    const handleTouchMove = (e) => {
      const touch = e.touches[0];
      const t = touchRef.current;
      const deltaX = touch.clientX - t.startX;
      const deltaY = touch.clientY - t.startY;

      if (t.intent === "undecided") {
        const totalMove = Math.abs(deltaX) + Math.abs(deltaY);
        if (totalMove < DEAD_ZONE) return;

        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          t.intent = "horizontal";
          e.preventDefault();
          e.stopPropagation();
        } else {
          t.intent = "vertical";
          return;
        }
      }

      if (t.intent === "horizontal") {
        e.preventDefault();
        e.stopPropagation();
        const clamped = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, deltaX));
        t.currentOffset = clamped;
        // Direct DOM updates — no React re-render
        setSliderTransform(clamped, false);
        setDirection(clamped >= 0 ? "right" : "left");
      }
    };

    const handleTouchEnd = () => {
      const t = touchRef.current;
      if (t.intent !== "horizontal") {
        t.intent = "undecided";
        return;
      }

      const elapsed = Date.now() - t.startTime;
      const velocity = Math.abs(t.currentOffset) / elapsed;
      const exceeds =
        Math.abs(t.currentOffset) >= SNAP_THRESHOLD ||
        velocity >= VELOCITY_THRESHOLD;

      if (exceeds && t.currentOffset > 0) {
        // Swiped right → pin/unpin: snap open, fire, reset
        setSliderTransform(SWIPE_MAX, true);
        setSwipeState("open-right");
        setDirection("right");
        setTimeout(() => {
          onSwipeRight?.();
          setSliderTransform(0, true);
          setSwipeState("idle");
          setDirection(null);
        }, 200);
      } else if (exceeds && t.currentOffset < 0) {
        // Swiped left → delete: snap open and STAY open.
        // Caller shows dialog; reset() is called externally when dialog closes.
        setSliderTransform(-SWIPE_MAX, true);
        setSwipeState("open-left");
        setDirection("left");
        setTimeout(() => {
          onSwipeLeft?.();
        }, 300);
      } else {
        // Snap back
        setSliderTransform(0, true);
        setSwipeState("idle");
        setDirection(null);
      }

      t.intent = "undecided";
      t.currentOffset = 0;
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, {
      capture: true,
      passive: false,
    });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove, { capture: true });
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [disabled, onSwipeLeft, onSwipeRight, setSliderTransform, setDirection]);

  return { containerRef, sliderRef, swipeState, reset };
};
