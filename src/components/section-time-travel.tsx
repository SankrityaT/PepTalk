"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  COMPARE,
  COMPARE_AT1,
  COMPARE_AT2,
  COMPARE_TEAM,
  DEFAULT_DIMENSION,
  DIMENSIONS,
  durationFor,
  hasChange,
  isoToMonthYear,
  ordinalToISO,
  phraseFor,
  unitFor,
  type Answer,
} from "@/content/tacticbench";

/**
 * Section 03: the time-travel query.
 *
 * Same team, same question, two dates, two answers.
 *
 * Written for the two audiences the page actually has. A coach reads a
 * sentence: "they dominated the ball, 67%, and it held for ten months." A
 * judge opens the evidence drawer and gets the fact id, the validity
 * window, the observation count and the matches it was derived from.
 *
 * The default view carries no schema vocabulary. An earlier version led
 * with as_of, valid_from and fact_id, which reads as a database browser
 * rather than a product; the internals are still one click away, they are
 * just no longer the first thing anyone sees.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

function Evidence({ answer }: { answer: Answer }) {
  const fact = answer.fact;
  if (!fact) return null;

  return (
    <div className="mt-5 border-t border-rule pt-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 font-mono text-[11px]">
        <div className="flex flex-col gap-1">
          <dt className="text-[9px] uppercase tracking-[0.14em] text-muted-2">
            true from
          </dt>
          <dd className="tabular-nums text-chalk-3">{fact.valid_from_iso}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[9px] uppercase tracking-[0.14em] text-muted-2">
            true until
          </dt>
          <dd className="tabular-nums text-chalk-3">{fact.valid_to_iso}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[9px] uppercase tracking-[0.14em] text-muted-2">
            matches seen
          </dt>
          <dd className="tabular-nums text-chalk-3">{fact.observations}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[9px] uppercase tracking-[0.14em] text-muted-2">
            fact id
          </dt>
          <dd className="tabular-nums text-chalk-3">{fact.id}</dd>
        </div>
      </dl>

      {answer.cited_matches && answer.cited_matches.length > 0 && (
        <div className="mt-4">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-2">
            derived from
          </span>
          <ul className="mt-2 flex flex-col gap-1.5">
            {answer.cited_matches.map((m) => (
              <li
                key={`${m.label}-${m.date_ord}`}
                className="flex items-baseline justify-between gap-3 font-mono text-[11px]"
              >
                <span className="text-chalk-3">{m.label}</span>
                <span className="shrink-0 tabular-nums text-muted-2">
                  {ordinalToISO(m.date_ord)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AnswerCard({
  answer,
  dimensionKey,
  emphasis,
  open,
  onToggle,
}: {
  answer: Answer;
  dimensionKey: string;
  emphasis: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const fact = answer.fact;

  return (
    <div
      className={`relative flex flex-col border p-6 sm:p-7 ${
        emphasis
          ? "border-accent/50 bg-accent/[0.06]"
          : "border-rule bg-white/[0.02]"
      }`}
    >
      {/* The question's date, in prose rather than a field name. */}
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        In {isoToMonthYear(answer.at)}
      </p>

      {!fact ? (
        <p className="mt-5 text-[15px] leading-relaxed text-muted">
          {answer.note ?? "Nothing on record at this date."}
        </p>
      ) : (
        <>
          {/* The answer as a person would say it. */}
          <p className="mt-4 font-display text-[1.4rem] leading-[1.2] tracking-[-0.01em] text-chalk sm:text-[1.85rem]">
            They {phraseFor(dimensionKey, fact.band)}.
          </p>

          <p className="mt-3 text-[14px] leading-relaxed text-muted">
            <span className="text-accent tabular-nums">
              {fact.median_value}
              {unitFor(dimensionKey)}
            </span>{" "}
            across {fact.observations} matches, {durationFor(fact)}.
          </p>

          <div className="mt-auto">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className="mt-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2 transition-colors duration-150 ease-[var(--ease-ui)] hover:text-chalk"
            >
              <span
                className={`inline-block transition-transform duration-200 ease-[var(--ease-ui)] ${
                  open ? "rotate-45" : ""
                }`}
              >
                +
              </span>
              {open ? "Hide evidence" : "Show evidence"}
            </button>

            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: EASE }}
                  className="overflow-hidden"
                >
                  <Evidence answer={answer} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  );
}

export function SectionTimeTravel() {
  const [dimension, setDimension] = useState(DEFAULT_DIMENSION);
  const [openEvidence, setOpenEvidence] = useState<number | null>(null);

  const result = COMPARE[dimension];
  const label = DIMENSIONS.find((d) => d.key === dimension)?.label ?? dimension;
  const changed = hasChange(dimension);

  return (
    <section
      id="time-travel"
      className="relative border-t border-rule bg-canvas py-24 sm:py-32"
    >
      <div className="mx-auto w-full max-w-5xl px-5 sm:px-10">
        <div className="flex items-center gap-3">
          <span className="h-px w-8 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
            03 / Time travel
          </span>
        </div>

        {/* The question, stated once, as a question. */}
        <h2 className="mt-6 max-w-3xl font-display text-[1.7rem] leading-[1.14] tracking-[-0.01em] text-chalk sm:text-[2.5rem]">
          How did {COMPARE_TEAM} play?
        </h2>

        <p className="mt-5 max-w-xl text-[13px] leading-relaxed text-muted sm:text-[15px]">
          Ask once about {isoToMonthYear(COMPARE_AT1)} and once about{" "}
          {isoToMonthYear(COMPARE_AT2)}. Same team, same question, and the
          answer is allowed to have changed.
        </p>

        {/* ── What to ask about ─────────────────────────────────────── */}
        <div className="mt-9">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-2">
            Ask about
          </span>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {DIMENSIONS.map((d) => {
              const active = d.key === dimension;
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => {
                    setDimension(d.key);
                    setOpenEvidence(null);
                  }}
                  className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-150 ease-[var(--ease-ui)] ${
                    active
                      ? "border-accent bg-accent text-canvas"
                      : "border-rule text-muted hover:border-rule-strong hover:text-chalk"
                  }`}
                >
                  {d.label}
                  {/* Flagged up front, so nobody clicks one of these and
                      concludes the demo is broken. */}
                  {!hasChange(d.key) && (
                    <span className={active ? "text-canvas/60" : "text-muted-2"}>
                      {" "}
                      · unchanged
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── The answers ───────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={dimension}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="mt-6"
          >
            {result?.abstained ? (
              <div className="border border-rule bg-white/[0.02] p-8">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                  Not enough history
                </p>
                <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-chalk-2">
                  {result.reason}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
                  {result?.with_memory?.map((answer, i) => (
                    <AnswerCard
                      key={answer.at}
                      answer={answer}
                      dimensionKey={dimension}
                      emphasis={changed && i === 1}
                      open={openEvidence === i}
                      onToggle={() =>
                        setOpenEvidence(openEvidence === i ? null : i)
                      }
                    />
                  ))}
                </div>

                <p className="mt-5 text-[13px] leading-relaxed text-muted sm:text-[14px]">
                  {changed ? (
                    <>
                      <span className="text-accent">The answer changed.</span> A
                      store that only matched on similarity would have returned
                      one of these for both questions.
                    </>
                  ) : (
                    <>
                      The answer did not change. On {label}, {COMPARE_TEAM} were
                      the same team at both dates, and saying so is the correct
                      result rather than a missing one.
                    </>
                  )}
                </p>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
