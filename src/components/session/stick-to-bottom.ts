"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Follow the bottom of a growing thread, unless the coach is reading.
 *
 * The rule everyone gets wrong is scrolling to the bottom whenever anything
 * arrives. Pep streams a word at a time and a beat can run for several
 * seconds, so a coach who scrolls up to re-read the De Paul numbers gets
 * yanked back to the bottom on the very next word. That is worse than no
 * auto-scroll at all: it makes the history unreadable while the session is
 * running, which is exactly when someone wants to look at it.
 *
 * So: follow only while already at the bottom. Scroll up and the following
 * stops on the spot; scroll back down and it resumes. That is the whole
 * behaviour, and the rest of this file is the two things that make it
 * actually work.
 *
 * **Distance decides, not events.** A programmatic scroll fires the same
 * `scroll` events a finger does, so any implementation that tries to classify
 * events ends up chasing its own tail. Whether we are pinned is derived purely
 * from how far the container currently sits from its bottom, which a scroll we
 * caused leaves at roughly zero and a scroll the coach caused does not. There
 * is nothing to disambiguate.
 *
 * **Growth is observed, not guessed.** Following on a React dependency runs
 * after render but before the browser has laid the new text out, so it scrolls
 * to the old height and lands a line short every time. A ResizeObserver on the
 * content fires after layout with the real height, which is the only moment
 * the correct scroll position is knowable.
 */

/**
 * How close to the bottom still counts as being at it. Roughly one line of
 * Pep's copy, so a coach who nudges the wheel a notch is still followed and
 * one who deliberately scrolls up is not. Also absorbs the sub-pixel drift
 * that fractional device pixel ratios leave in scrollHeight.
 */
const NEAR_BOTTOM_PX = 64;

export type StickToBottom = {
  /** Put on the element with `overflow-y-auto`. */
  viewport: React.RefObject<HTMLDivElement | null>;
  /** Put on the immediate child that holds the content. */
  content: React.RefObject<HTMLDivElement | null>;
  /** False once the coach has scrolled away from the bottom. */
  pinned: boolean;
  /** Whether anything arrived while they were away. Drives "jump to latest". */
  missed: boolean;
  /** Go back to the bottom and start following again. */
  follow: () => void;
};

export function useStickToBottom(): StickToBottom {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  const [pinned, setPinned] = useState(true);
  const [missed, setMissed] = useState(false);

  // The observer callback needs the current value and must not be rebuilt
  // every time it changes, or the observer is torn down mid-stream.
  const pinnedNow = useRef(true);
  const setPin = (v: boolean) => {
    pinnedNow.current = v;
    setPinned(v);
    if (v) setMissed(false);
  };

  const toBottom = (el: HTMLDivElement, smooth: boolean) => {
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  const follow = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    setPin(true);
    toBottom(el, true);
  }, []);

  useEffect(() => {
    const el = viewport.current;
    const inner = content.current;
    if (!el || !inner) return;

    const atBottom = () =>
      el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;

    const onScroll = () => {
      const now = atBottom();
      if (now !== pinnedNow.current) setPin(now);
    };

    // Instant rather than smooth while following. The thread grows a word at a
    // time, so each correction is a few pixels and reads as continuous motion;
    // a smooth scroll per word would queue animations against each other and
    // visibly lag behind the text.
    const onGrow = () => {
      if (pinnedNow.current) toBottom(el, false);
      else setMissed(true);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onGrow);
    ro.observe(inner);

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  return { viewport, content, pinned, missed, follow };
}
