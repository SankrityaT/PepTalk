"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Choice } from "@/components/brief/atoms/choice";
import { StreamText } from "@/components/brief/atoms/stream-text";
import { MomentFrame } from "@/components/report/moment-frame";
import { Moment, surname } from "@/content/pep";

/**
 * Going through them one by one, in the stream.
 *
 * The point of the brief is that a coach never leaves it. An earlier version
 * put "take me through" on a button that navigated to another page, which
 * threw away the thread and made the coach find their place again. Here the
 * walkthrough appends: each moment lands as a new block, Pep says his line
 * over it, then asks whether to carry on.
 *
 * One at a time on purpose. Eight moments dumped at once is a report; one
 * moment with a question after it is a conversation, and a coach can stop
 * whenever they have had enough. Stopping early is a first-class outcome, not
 * an abandonment.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

export function Walkthrough({
  moments,
  onDone,
}: {
  moments: Moment[];
  /** Fired when the coach reaches the end or stops early. */
  onDone?: (seen: number) => void;
}) {
  // How many are on screen. Starts at one, because the coach already said yes.
  const [shown, setShown] = useState(1);
  const [finished, setFinished] = useState(false);
  const [streamed, setStreamed] = useState(0);

  const list = moments.slice(0, shown);
  const atEnd = shown >= moments.length;
  // The next question only appears once the current line has finished landing.
  const ready = streamed >= shown;

  return (
    <div className="flex flex-col gap-4">
      {list.map((m, i) => (
        <motion.article
          key={m.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]"
        >
          <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.05] px-4 py-2.5">
            <span className="flex items-baseline gap-2.5">
              <span className="font-mono text-[11px] tabular-nums text-accent">
                {m.minute}&rsquo;
              </span>
              <span className="text-[13px] font-medium text-chalk">
                {surname(m.player)}
              </span>
            </span>
            <span className="font-mono text-[10px] tracking-[0.1em] text-muted-2 uppercase">
              {i + 1} of {moments.length}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1fr_1fr]">
            <MomentFrame moment={m} />

            <div className="flex flex-col">
              <p className="text-[15px] leading-relaxed text-warm">
                <StreamText
                  text={m.line}
                  onDone={() => setStreamed((s) => Math.max(s, i + 1))}
                />
              </p>

              <div className="mt-auto pt-4">
                <p className="font-mono text-[10px] leading-relaxed text-muted">
                  {m.numbers}
                </p>
                <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[10px] text-muted-2">
                  <span>played {m.played_zone}</span>
                  <span className="text-muted-2">&middot;</span>
                  <span>available {m.best_zone}</span>
                </p>
                {m.no_riskier && (
                  <span className="mt-2.5 inline-block rounded border border-accent/40 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-accent uppercase">
                    no riskier
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.article>
      ))}

      <AnimatePresence mode="wait">
        {ready && !finished && !atEnd && (
          <Choice
            key={`more-${shown}`}
            question={
              shown === 1
                ? "That is the first one. Want the next?"
                : `${moments.length - shown} left. Keep going?`
            }
            onPick={(k) => {
              if (k === "next") setShown((s) => s + 1);
              else if (k === "all") setShown(moments.length);
              else {
                setFinished(true);
                onDone?.(shown);
              }
            }}
            options={[
              { key: "next", label: "Next one", primary: true },
              { key: "all", label: "Show me all of them" },
              { key: "stop", label: "That is enough" },
            ]}
          />
        )}

        {ready && !finished && atEnd && (
          <motion.p
            key="end"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="text-[15px] leading-relaxed text-warm-2"
          >
            <StreamText
              text={`That is all ${moments.length} of them. Ask me about any player or any clip and I will pull it up.`}
              onDone={() => onDone?.(moments.length)}
            />
          </motion.p>
        )}

        {finished && (
          <motion.p
            key="stopped"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[14px] leading-relaxed text-muted"
          >
            Stopped there. The rest are waiting whenever you want them.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
