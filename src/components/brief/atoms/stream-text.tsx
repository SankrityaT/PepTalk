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
  const words = tokenise(text);

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
          className={w.bold ? "font-medium text-chalk" : undefined}
        >
          {w.text}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}

/**
 * Split into words, each carrying whether it is emphasised.
 *
 * The model is asked to bold the two or three things that matter, so a coach
 * skimming an answer lands on the name and the figure. A markdown renderer is
 * the wrong tool here: this reveals a word at a time, and a parser wants a
 * whole document.
 *
 * Emphasis is resolved before the split rather than per word, because it spans
 * them: "**0.8 threat on the table per 90**" opens on the first word and
 * closes on the seventh. Marking each word with the state of the emphasis at
 * that point survives being cut off mid-phrase, which is exactly what streaming
 * does to it.
 */
export type Word = { text: string; bold: boolean };

function tokenise(text: string): Word[] {
  const out: Word[] = [];
  let bold = false;
  for (const chunk of text.split("**")) {
    for (const word of chunk.split(" ")) {
      // Splitting on a marker at a word boundary leaves empty strings behind.
      if (word) out.push({ text: word, bold });
    }
    bold = !bold;
  }
  return out;
}
