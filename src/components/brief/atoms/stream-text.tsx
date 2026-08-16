"use client";

import { useEffect, useState } from "react";

/**
 * Words resolving out of blur, the way an agent writes.
 *
 * Streaming is not decoration here. It sets the pace of the brief: a coach
 * reads at roughly the speed the words land, so the stream is what stops the
 * page arriving as a wall and makes the "stop and ask" beat land as a pause
 * rather than an interruption.
 *
 * Everything is revealed on a timer rather than fetched token by token,
 * because the analysis already ran — this is a replay of a result, and the
 * brief says so rather than implying a live model call.
 *
 * `onDone` is what lets the parent chain blocks: each block streams, reports
 * in, and the next one starts.
 */

const WORD_MS = 42;

export function StreamText({
  text,
  className = "",
  startDelay = 0,
  onDone,
}: {
  text: string;
  className?: string;
  startDelay?: number;
  onDone?: () => void;
}) {
  const words = text.split(" ");

  // Reset during render rather than in an effect. React's documented way to
  // adjust state when a prop changes: an effect would paint the old stream
  // for a frame before rewinding it, and lint rightly objects to it.
  const [state, setState] = useState({ text, shown: 0 });
  if (state.text !== text) setState({ text, shown: 0 });
  const shown = state.text === text ? state.shown : 0;
  const setShown = (fn: (s: number) => number) =>
    setState((p) => ({ text: p.text, shown: fn(p.shown) }));

  useEffect(() => {
    if (shown >= words.length) {
      // Fires once the last word has landed, not once it was scheduled.
      const t = setTimeout(() => onDone?.(), 120);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => setShown((s) => s + 1),
      shown === 0 ? startDelay : WORD_MS,
    );
    return () => clearTimeout(t);
    // `onDone` deliberately excluded: parents pass inline closures, and
    // including it restarts the stream on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, words.length, startDelay]);

  return (
    <span className={className}>
      {words.slice(0, shown).map((w, i) => (
        <span
          key={i}
          style={{ animation: "word-in 260ms var(--ease-ui) both" }}
        >
          {w}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}
