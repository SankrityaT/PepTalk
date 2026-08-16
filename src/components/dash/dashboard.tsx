"use client";

import { motion } from "motion/react";
import { MatchCard } from "@/components/dash/match-card";
import { Pipeline } from "@/components/dash/pipeline";
import { Sparkline } from "@/components/dash/sparkline";
import { XtPitch } from "@/components/dash/xt-pitch";
import {
  CAMPAIGN,
  FEATURED,
  MATCHES,
  TEAM,
  TOTALS,
  mean,
  result,
  series,
} from "@/content/dashboard";
import { MOMENTS_FOUND, THEMES } from "@/content/pep";

/**
 * What the coach opens into.
 *
 * The deliberate choice here is that **nothing is asked of them**. No upload
 * box, no empty state, no "get started". Pep has already watched the season and
 * the page is the finished work — the same way you open a banking app to a
 * balance rather than a form.
 *
 * Order is by what a coach does with it, not by what is impressive:
 *   1. the standing of the season, in four numbers
 *   2. what to work on this week          — the only actionable thing
 *   3. the model doing the judging        — the credibility exhibit
 *   4. the games, newest first            — the drill-down
 *
 * Upload lives in the top bar as a secondary action, because adding a game is
 * something a coach does once a week and reads a report five times.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

function Tile({
  label,
  value,
  unit,
  sub,
  values,
  seriesLabel,
  live = false,
  delay = 0,
}: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  values?: number[];
  /** Set when the trend plots something other than the headline figure. */
  seriesLabel?: string;
  live?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: EASE }}
      className="flex flex-col rounded-xl bg-surface p-4 ring-1 ring-white/[0.06]"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
        {label}
      </span>
      <span className="mt-2.5 flex items-baseline gap-1">
        <span className="font-mono text-[26px] leading-none tabular-nums text-chalk">
          {value}
        </span>
        {unit && <span className="font-mono text-[13px] text-muted">{unit}</span>}
      </span>
      <span className="mt-2 text-[12px] leading-snug text-muted">{sub}</span>
      {values && (
        <div className="mt-3">
          <Sparkline values={values} live={live} />
          {seriesLabel && (
            <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.1em] text-muted-2">
              {seriesLabel}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

export function Dashboard({
  onOpenMatch,
  onAddGame,
}: {
  onOpenMatch: () => void;
  onAddGame: () => void;
}) {
  const poss = series("poss");
  const xg = series("xg");
  const shots = series("shots");
  const pressMean = mean(series("press"));

  const form = MATCHES.slice(0, 5).map(result);

  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-5"
      >
        <div className="flex items-center gap-3">
          <span className="font-display text-[15px] text-chalk">Pep Talk</span>
          <span className="h-3 w-px bg-white/15" />
          <span className="text-[14px] text-warm-2">{TEAM}</span>
          <span className="flex items-center gap-1">
            {form.map((r, i) => (
              <span
                key={i}
                title={r}
                className={`h-1.5 w-1.5 rounded-full ${
                  r === "W" ? "bg-accent" : r === "D" ? "bg-white/30" : "bg-white/12"
                }`}
              />
            ))}
          </span>
        </div>
        <button
          onClick={onAddGame}
          className="rounded-lg bg-white/[0.06] px-4 py-2 text-[13px] text-warm transition-colors duration-150 ease-[var(--ease-ui)] hover:bg-white/[0.11] hover:text-chalk"
        >
          + Add a game
        </button>
      </motion.div>

      {/* ── Greeting ──────────────────────────────────────────────────── */}
      <motion.header
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="pt-8"
      >
        <h1 className="text-[28px] leading-tight font-medium text-chalk sm:text-[36px]">
          Morning, coach.
        </h1>
        <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-warm-2">
          Pep has been through all {TOTALS.matches} games of the campaign, and
          held them against the {TOTALS.in_graph} of yours already in the graph.
          Three things are worth twenty minutes at training this week.
        </p>
      </motion.header>

      {/* ── The season, in four numbers ───────────────────────────────── */}
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="games in the graph"
          value={String(TOTALS.in_graph)}
          sub={`${TOTALS.matches} of them this campaign`}
          delay={0.05}
        />
        <Tile
          label="ball kept"
          value={mean(poss).toFixed(0)}
          unit="%"
          sub="across the season"
          values={poss}
          delay={0.1}
        />
        <Tile
          label="chances made"
          value={mean(xg).toFixed(2)}
          unit="xG"
          sub={`${mean(shots).toFixed(0)} shots a game`}
          values={xg}
          delay={0.15}
        />
        {/* Scoped to the last game on purpose: 803 is what the pass engine
            found in that match, not a season total, and rounding it up to one
            would be the easiest lie on the page. */}
        <Tile
          label="better balls found"
          value={MOMENTS_FOUND.toLocaleString()}
          sub="in your last game alone"
          values={shots}
          seriesLabel="shots per game"
          live
          delay={0.2}
        />
      </div>

      {/* ── This week ─────────────────────────────────────────────────── */}
      {THEMES.length > 0 && (
        <section className="mt-12">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-medium text-chalk">
              Work on this at training
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
              this week
            </span>
          </div>
          <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {THEMES.map((t, i) => (
              <motion.li
                key={t.title}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.07, ease: EASE }}
                className="flex flex-col rounded-xl bg-surface p-5 ring-1 ring-white/[0.06]"
              >
                <span className="font-mono text-[11px] tabular-nums text-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2.5 text-[16px] font-medium leading-snug text-chalk">
                  {t.title}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-warm-2">
                  {t.why}
                </p>
                <button
                  onClick={onOpenMatch}
                  className="mt-4 self-start font-mono text-[10px] uppercase tracking-[0.1em] text-muted transition-colors hover:text-accent"
                >
                  {t.moment_ids.length} clips &rarr;
                </button>
              </motion.li>
            ))}
          </ul>
        </section>
      )}

      {/* ── The model, and the intake ─────────────────────────────────── */}
      <section className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
        <div className="rounded-xl bg-surface p-5 ring-1 ring-white/[0.06]">
          <XtPitch />
        </div>
        <Pipeline />
      </section>

      {/* ── The games ─────────────────────────────────────────────────── */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-medium text-chalk">Your games</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
            {CAMPAIGN}
          </span>
        </div>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
          The orange mark is where you pressed; the band is how wide you played.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MATCHES.map((m, i) => (
            <MatchCard
              key={m.id}
              m={m}
              index={i}
              pressMean={pressMean}
              featured={m.id === FEATURED}
              // Only the match we actually ran the video pipeline over opens a
              // report. The rest are analysed from event data and say so.
              onOpen={m.id === FEATURED ? onOpenMatch : undefined}
            />
          ))}
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-muted-2">
          Scorelines cover open play and extra time. Shootouts are excluded
          everywhere, because eight penalties would swamp a match&rsquo;s chance
          count and tell you nothing about how the side played.
        </p>
      </section>

      {/* ── Provenance ────────────────────────────────────────────────── */}
      <footer className="mt-14 border-t border-white/[0.07] pt-6">
        <p className="max-w-3xl text-[13px] leading-relaxed text-muted-2">
          Each game above is a row in the memory graph, stored with the date it
          was true. That is what lets Pep say a habit has changed rather than
          just describing this weekend — and why the dashboard gets sharper the
          longer you use it, instead of resetting every match.
        </p>
      </footer>
    </div>
  );
}
