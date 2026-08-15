"use client";

import Image from "next/image";
import { motion } from "motion/react";
import {
  DIMENSION_LABEL,
  DIMENSION_UNIT,
  GRAPH_FACTS,
  ISTANBUL,
  OMITTED_DEVIATIONS,
  PIPELINE,
  SIGNIFICANT_DEVIATIONS,
  type Deviation,
} from "@/content/istanbul";

/**
 * Section 04: the whole system, on one match.
 *
 * Four separate sections each proving one component is the wrong shape for
 * a judge with three minutes. This runs the machine end to end on Istanbul,
 * 25 May 2005: ingest, state, memory, read. Computer vision, the data, the
 * temporal graph and the model all appear once, in the order they actually
 * fire, against numbers that came out of the running service.
 *
 * The payload is counterintuitive on purpose. Liverpool came back from
 * three down by pressing lower and sitting deeper than their own norm. A
 * system that reproduces that is demonstrably not reciting "attack harder
 * when losing".
 */

const EASE = [0.4, 0, 0.2, 1] as const;

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-12%" },
  transition: { duration: 0.6, ease: EASE },
};

/** A deviation, drawn as a bar running from the team's norm to the match. */
function DeviationRow({ d }: { d: Deviation }) {
  const unit = DIMENSION_UNIT[d.dimension] ?? "";
  const label = DIMENSION_LABEL[d.dimension] ?? d.dimension;

  // Both values sit on a shared scale so the two rows are comparable.
  const scaleMax = Math.max(d.normal_value, d.match_value) * 1.15;
  const normalPct = (d.normal_value / scaleMax) * 100;
  const matchPct = (d.match_value / scaleMax) * 100;
  const lower = d.delta < 0;

  return (
    <div className="border-t border-rule py-5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-chalk">
          {label}
        </span>
        <span className="font-mono text-[13px] tabular-nums text-accent">
          {d.delta > 0 ? "+" : ""}
          {d.delta.toFixed(2)}
          {unit}
        </span>
      </div>

      {/* Norm on top, the match beneath it. The gap between the two bar ends
          is the finding, so they share a baseline and a scale. */}
      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-2">
            usually
          </span>
          <div className="relative h-1.5 flex-1 bg-white/[0.06]">
            <motion.div
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: "-12%" }}
              transition={{ duration: 0.8, ease: EASE }}
              style={{ width: `${normalPct}%` }}
              className="absolute inset-y-0 left-0 origin-left bg-chalk/45"
            />
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
            {d.normal_value}
            {unit}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-2">
            that night
          </span>
          <div className="relative h-1.5 flex-1 bg-white/[0.06]">
            <motion.div
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: "-12%" }}
              transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
              style={{ width: `${matchPct}%` }}
              className="absolute inset-y-0 left-0 origin-left bg-accent"
            />
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-accent">
            {d.match_value}
            {unit}
          </span>
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        {lower ? "Lower" : "Higher"} than Liverpool&apos;s own norm across{" "}
        {d.era_matches} matches.
      </p>
    </div>
  );
}

function Stage({
  stage,
  children,
}: {
  stage: (typeof PIPELINE)[number];
  children?: React.ReactNode;
}) {
  return (
    <motion.div {...reveal} className="grid grid-cols-1 gap-6 border-t border-rule py-10 lg:grid-cols-12 lg:gap-10">
      <div className="lg:col-span-4">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] tabular-nums text-accent">
            {stage.n}
          </span>
          <h3 className="font-display text-[1.15rem] leading-tight tracking-[-0.01em] text-chalk sm:text-[1.4rem]">
            {stage.title}
          </h3>
        </div>
      </div>

      <div className="lg:col-span-8">
        <p className="max-w-2xl text-[14px] leading-relaxed text-muted sm:text-[15px]">
          {stage.body}
        </p>
        {stage.note && (
          <p className="mt-3 max-w-2xl border-l border-accent/40 pl-3 text-[13px] leading-relaxed text-muted-2">
            {stage.note}
          </p>
        )}
        {children}
      </div>
    </motion.div>
  );
}

export function SectionHowItWorks() {
  const [ingest, state, memory, read] = PIPELINE;

  return (
    <section
      id="how-it-works"
      className="relative border-t border-rule bg-canvas py-24 sm:py-32"
    >
      <div className="mx-auto w-full max-w-5xl px-5 sm:px-10">
        <motion.div {...reveal}>
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
              04 / How it works
            </span>
          </div>

          <h2 className="mt-6 max-w-3xl font-display text-[1.7rem] leading-[1.14] tracking-[-0.01em] text-chalk sm:text-[2.5rem]">
            One match, end to end.
          </h2>

          <p className="mt-5 max-w-xl text-[13px] leading-relaxed text-muted sm:text-[15px]">
            {ISTANBUL.label}, {ISTANBUL.competition}, {ISTANBUL.date}. Three
            down at the break. Every number below came out of the graph, which
            currently holds {GRAPH_FACTS.toLocaleString()} dated facts.
          </p>
        </motion.div>

        {/* ── The bench. The situation, before any analysis. ─────────── */}
        <motion.figure {...reveal} className="relative mt-12 overflow-hidden">
          <Image
            src="/img/halftime-bench.jpg"
            alt="A footballer sitting alone on a dressing-room bench at halftime, head down, a three-mark tally chalked on the wall behind him."
            width={1600}
            height={1067}
            className="w-full"
            priority={false}
          />
          <figcaption className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-2">
            Halftime. {ISTANBUL.label.split(" ").slice(-1)[0]} three down.
          </figcaption>
        </motion.figure>

        {/* ── 01 Ingest ─────────────────────────────────────────────── */}
        <div className="mt-14">
          <Stage stage={ingest} />

          {/* ── 02 State ────────────────────────────────────────────── */}
          <Stage stage={state}>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {(
                [
                  ["press_height", ISTANBUL.press_height],
                  ["defensive_action_height", ISTANBUL.defensive_action_height],
                  ["possession_share_pct", ISTANBUL.possession_share_pct],
                  ["team_width", ISTANBUL.team_width],
                  ["pass_forward_ratio", ISTANBUL.pass_forward_ratio],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex flex-col gap-1">
                  <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-2">
                    {DIMENSION_LABEL[key]}
                  </dt>
                  <dd className="font-mono text-[15px] tabular-nums text-chalk">
                    {value}
                    {DIMENSION_UNIT[key]}
                  </dd>
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-2">
                  Source
                </dt>
                <dd className="font-mono text-[15px] text-muted">
                  {ISTANBUL.source.replace("_", " ")}
                </dd>
              </div>
            </dl>
          </Stage>

          {/* ── 03 Memory ───────────────────────────────────────────── */}
          <Stage stage={memory} />

          {/* ── 04 Read ─────────────────────────────────────────────── */}
          <Stage stage={read}>
            <div className="mt-6">
              {SIGNIFICANT_DEVIATIONS.map((d) => (
                <DeviationRow key={d.dimension} d={d} />
              ))}
              {OMITTED_DEVIATIONS > 0 && (
                <p className="border-t border-rule pt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
                  {OMITTED_DEVIATIONS} further dimensions moved by less than a
                  unit and are not shown
                </p>
              )}
            </div>
          </Stage>
        </div>

        {/* ── The finding ───────────────────────────────────────────── */}
        <motion.div
          {...reveal}
          className="mt-12 border-l-2 border-accent bg-white/[0.02] py-6 pr-6 pl-6"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
            The finding
          </p>
          <p className="mt-4 max-w-2xl font-display text-[1.25rem] leading-[1.3] tracking-[-0.01em] text-chalk sm:text-[1.6rem]">
            Liverpool pressed lower and dropped deeper than they normally did,
            in the half they scored three.
          </p>
          <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-muted">
            Every instinct says attack harder when you are losing. The graph
            says the opposite is what happened, because it compared the half to
            what this team actually was in 2005 rather than to a general idea of
            how football works. That is the whole product.
          </p>
        </motion.div>

        {/* ── The coach. What the output is for. ────────────────────── */}
        <motion.figure {...reveal} className="relative mt-12 overflow-hidden">
          <Image
            src="/img/coach-touchline.jpg"
            alt="A manager at the touchline mid-instruction, pointing across a chalk-drawn pitch."
            width={1600}
            height={1067}
            className="w-full"
          />
          <figcaption className="mt-3 max-w-xl font-mono text-[10px] uppercase leading-relaxed tracking-[0.14em] text-muted-2">
            Fifteen minutes to decide. The output is one thing to change, not a
            dashboard.
          </figcaption>
        </motion.figure>
      </div>
    </section>
  );
}
