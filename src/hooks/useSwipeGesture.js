import { useRef, useState, useCallback, useEffect } from "react";

const DEAD_ZONE = 10; // px before intent is decided
const SWIPE_MAX = 80; // max reveal distance in px
const SNAP_THRESHOLD = 40; // px to snap open
const VELOCITY_THRESHOLD = 0.3; // px/ms for flick

export const useSwipeGesture = ({
  onSwipeLeft,
  onSwipeRight,
  disabled = false,
} = {}) => {
  const containerRef = useRef(null);
  const touchRef = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    intent: "undecided",
    currentOffset: 0,
  });

  const [offset, setOffset] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  // idle | swiping-left | swiping-right | open-left | open-right
  const [swipeState, setSwipeState] = useState("idle");

  const reset = useCallback(() => {
    setTransitioning(true);
    setOffset(0);
    setSwipeState("idle");
    touchRef.current.intent = "undecided";
    touchRef.current.currentOffset = 0;
    setTimeout(() => setTransitioning(false), 300);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    const handleTouchStart = (e) => {
      const touch = e.touches[0];
      touchRef.current.startX = touch.clientX;
      touchRef.current.startY = touch.clientY;
      touchRef.current.startTime = Date.now();
      touchRef.current.intent = "undecided";
      setTransitioning(false);
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
        setOffset(clamped);
        setSwipeState(clamped >= 0 ? "swiping-right" : "swiping-left");
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
        setTransitioning(true);
        setOffset(SWIPE_MAX);
        setSwipeState("open-right");
        setTimeout(() => {
          onSwipeRight?.();
          setTransitioning(true);
          setOffset(0);
          setSwipeState("idle");
          setTimeout(() => setTransitioning(false), 300);
        }, 200);
      } else if (exceeds && t.currentOffset < 0) {
        // Swiped left → delete: snap open and STAY open.
        // Caller shows dialog; reset() is called externally when dialog closes.
        setTransitioning(true);
        setOffset(-SWIPE_MAX);
        setSwipeState("open-left");
        setTimeout(() => {
          setTransitioning(false);
          onSwipeLeft?.();
        }, 300);
      } else {
        // Snap back
        setTransitioning(true);
        setOffset(0);
        setSwipeState("idle");
        setTimeout(() => setTransitioning(false), 300);
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
  }, [disabled, onSwipeLeft, onSwipeRight]);

  const contentStyle = {
    transform: `translateX(${offset}px)`,
    transition: transitioning ? "transform 0.3s ease" : "none",
    willChange: offset !== 0 ? "transform" : "auto",
  };

  return { containerRef, contentStyle, swipeState, reset };
};
