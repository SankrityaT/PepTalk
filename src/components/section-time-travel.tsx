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
  hasChange,
  isoToMonthYear,
  ordinalToISO,
  type Answer,
} from "@/content/tacticbench";

/**
 * Section 03: the time-travel query.
 *
 * Same team, same question, two dates, two answers. This is the page's
 * whole argument and the destination of the hero's primary CTA.
 *
 * Every number here came out of the graph. The dimension picker deliberately
 * includes dimensions that did NOT change between the two dates, and says so
 * plainly when that happens: a system that manufactures a difference to look
 * impressive is exactly what this project is arguing against, and "no change
 * on this dimension" is a correct answer worth showing.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

function CornerTicks() {
  const tick = "absolute h-2.5 w-2.5 border-accent";
  return (
    <>
      <span className={`${tick} -top-px -left-px border-t border-l`} />
      <span className={`${tick} -top-px -right-px border-t border-r`} />
      <span className={`${tick} -bottom-px -left-px border-b border-l`} />
      <span className={`${tick} -bottom-px -right-px border-b border-r`} />
    </>
  );
}

function AnswerPanel({
  answer,
  dimensionLabel,
  emphasis,
}: {
  answer: Answer;
  dimensionLabel: string;
  emphasis: boolean;
}) {
  const fact = answer.fact;

  return (
    <div
      className={`relative border p-5 sm:p-6 ${
        emphasis ? "border-accent/50 bg-accent/[0.06]" : "border-rule bg-white/[0.02]"
      }`}
    >
      {emphasis && <CornerTicks />}

      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          as_of
        </span>
        <span className="font-mono text-[11px] tabular-nums text-accent">
          {answer.at}
        </span>
      </div>

      {!fact ? (
        <p className="mt-6 font-mono text-[12px] leading-relaxed text-muted">
          {answer.note ?? "No fact valid at this date."}
        </p>
      ) : (
        <>
          {/* The answer, as the graph would state it. */}
          <p className="mt-5 font-display text-[2rem] leading-none tracking-[-0.01em] text-chalk sm:text-[2.6rem]">
            {fact.band}
          </p>
          <p className="mt-2 font-mono text-[12px] text-muted">
            median {fact.median_value} · {dimensionLabel}
          </p>

          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-rule pt-4 font-mono text-[11px]">
            <div className="flex flex-col gap-1">
              <dt className="text-[9px] uppercase tracking-[0.14em] text-muted-2">
                valid_from
              </dt>
              <dd className="tabular-nums text-chalk-3">{fact.valid_from_iso}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-[9px] uppercase tracking-[0.14em] text-muted-2">
                valid_to
              </dt>
              <dd className="tabular-nums text-chalk-3">{fact.valid_to_iso}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-[9px] uppercase tracking-[0.14em] text-muted-2">
                observations
              </dt>
              <dd className="tabular-nums text-chalk-3">{fact.observations}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-[9px] uppercase tracking-[0.14em] text-muted-2">
                fact_id
              </dt>
              <dd className="tabular-nums text-chalk-3">{fact.id}</dd>
            </div>
          </dl>

          {/* Citations. The claim is only as good as the matches under it. */}
          {answer.cited_matches && answer.cited_matches.length > 0 && (
            <div className="mt-5 border-t border-rule pt-4">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-2">
                cited matches
              </span>
              <ul className="mt-2.5 flex flex-col gap-1.5">
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
        </>
      )}
    </div>
  );
}

export function SectionTimeTravel() {
  const [dimension, setDimension] = useState(DEFAULT_DIMENSION);

  const result = COMPARE[dimension];
  const label =
    DIMENSIONS.find((d) => d.key === dimension)?.label ?? dimension;
  const changed = hasChange(dimension);

  return (
    <section
      id="time-travel"
      className="relative border-t border-rule bg-canvas py-24 sm:py-32"
    >
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-10">
        <div className="flex items-center gap-3">
          <span className="h-px w-8 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
            03 / Time travel
          </span>
        </div>

        <h2 className="mt-6 max-w-3xl font-display text-[1.7rem] leading-[1.12] tracking-[-0.01em] text-chalk sm:text-[2.6rem]">
          Same team. Same question. Two dates.
        </h2>

        <p className="mt-5 max-w-xl text-[13px] leading-relaxed text-muted sm:text-[15px]">
          Ask the graph about {COMPARE_TEAM} in{" "}
          {isoToMonthYear(COMPARE_AT1)}, then ask the identical question about{" "}
          {isoToMonthYear(COMPARE_AT2)}. Every fact carries the window it was
          true for and the matches it was derived from.
        </p>

        {/* ── Dimension picker ──────────────────────────────────────── */}
        <div className="mt-10 flex flex-wrap gap-2">
          {DIMENSIONS.map((d) => {
            const active = d.key === dimension;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => setDimension(d.key)}
                className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-150 ease-[var(--ease-ui)] ${
                  active
                    ? "border-accent bg-accent text-canvas"
                    : "border-rule text-muted hover:border-rule-strong hover:text-chalk"
                }`}
              >
                {d.label}
                {/* Mark the dimensions that did not move, before a judge
                    clicks one and thinks the demo is broken. */}
                {!hasChange(d.key) && (
                  <span className={active ? "text-canvas/60" : "text-muted-2"}>
                    {" "}
                    · no change
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── The two answers ───────────────────────────────────────── */}
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
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                  Abstained
                </p>
                <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-chalk-2">
                  {result.reason}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {result?.with_memory?.map((answer, i) => (
                    <AnswerPanel
                      key={answer.at}
                      answer={answer}
                      dimensionLabel={label}
                      // Emphasise the later answer only when it actually
                      // differs, so the accent means "this changed".
                      emphasis={changed && i === 1}
                    />
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px]">
                  {changed ? (
                    <span className="text-accent">
                      Different facts returned for the same question.
                    </span>
                  ) : (
                    <span className="text-muted">
                      Same fact at both dates. On this dimension {COMPARE_TEAM}{" "}
                      did not change between these years, and the graph says so
                      rather than inventing a difference.
                    </span>
                  )}
                  {result?.evidence !== undefined && (
                    <span className="text-muted-2">
                      evidence: {result.evidence} observations
                    </span>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
