"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  bandPhrase,
  DIMENSIONS,
  DIMENSION_UNIT,
  Era,
  eraAt,
  eraExtent,
  fraction,
  isoToOrdinal,
  ordinalToDate,
  ordinalToYear,
  team as getTeam,
  TEAMS,
  timelineBounds,
} from "@/content/timelines";

/**
 * The memory scrubber.
 *
 * Every football tool shows a pitch. None of them show a team's identity
 * changing. This does: drag the playhead and the claims rewrite underneath it,
 * because that is the one thing this system has and a vector store cannot fake.
 *
 * Three things are deliberate.
 *
 * The era bars are the graph's actual validity intervals, not a chart of the
 * underlying metric. You are looking at stored facts and the dates they were
 * true, which is what makes an expiring claim legible.
 *
 * Crossing a boundary animates the old claim out and the new one in, rather
 * than swapping text. The supersede link is the load-bearing edge in the
 * schema, so it should be the one moment in the interface that feels physical.
 *
 * Scrubbing somewhere the graph is thin renders the abstention state at full
 * size. It is not an error and it is not a toast; it is an answer, and a page
 * whose argument is "knowing when you do not know" cannot hide it in grey text.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

function CornerTicks() {
  const t = "absolute h-3 w-3 border-accent";
  return (
    <>
      <span className={`${t} -top-px -left-px border-t border-l`} />
      <span className={`${t} -top-px -right-px border-t border-r`} />
      <span className={`${t} -bottom-px -left-px border-b border-l`} />
      <span className={`${t} -bottom-px -right-px border-b border-r`} />
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
      {children}
    </span>
  );
}

/** Row label. Kept in its own column so it never enters the drag geometry. */
function TrackLabel({
  label,
  active,
  dimension,
}: {
  label: string;
  active: Era | null;
  dimension: string;
}) {
  return (
    <div className="flex h-9 min-w-0 flex-col justify-center">
      <div className="truncate text-[13px] leading-tight text-chalk-2">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[10px] leading-tight text-muted-2">
        {active ? bandPhrase(dimension, active.band) : "no record"}
      </div>
    </div>
  );
}

/** One dimension's eras. Spans exactly the drag surface, so 0% is the start. */
function EraBar({
  eras,
  lo,
  hi,
  playhead,
  unit,
}: {
  eras: Era[];
  lo: number;
  hi: number;
  playhead: number;
  unit: string;
}) {
  const active = eraAt(eras, playhead);

  return (
    <div className="relative h-9">
      {/* Baseline rule, so an empty track still reads as a track. */}
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule" />

      {eras.map((e) => {
        const { start, width } = eraExtent(e, lo, hi);
        const isActive = active?.id === e.id;
        return (
          <div
            key={e.id}
            className="absolute top-1/2 -translate-y-1/2 transition-all duration-300 ease-[var(--ease-ui)]"
            style={{
              left: `${start * 100}%`,
              width: `${width * 100}%`,
              height: isActive ? 22 : 10,
            }}
          >
            <div
              className={`h-full w-full border transition-colors duration-300 ease-[var(--ease-ui)] ${
                isActive
                  ? "border-accent bg-accent/25"
                  : "border-rule-strong bg-white/[0.04]"
              }`}
            />
            {isActive && e.median_value !== null && width > 0.12 && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] tabular-nums text-chalk">
                {e.median_value}
                {unit}
              </span>
            )}
          </div>
        );
      })}

      {eras.length === 0 && (
        <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-2">
          insufficient history
        </span>
      )}
    </div>
  );
}

export function MemoryScrubber() {
  const [teamName, setTeamName] = useState("Barcelona");
  const t = getTeam(teamName) ?? TEAMS[0];
  const { lo, hi } = useMemo(() => timelineBounds(t), [t]);

  // Start on Guardiola's peak for Barcelona, mid-range otherwise, so the first
  // thing anyone sees is the graph saying something specific.
  const initial = useMemo(() => {
    const guardiola = isoToOrdinal("2011-06-01");
    return teamName === "Barcelona" && guardiola > lo && guardiola < hi
      ? guardiola
      : Math.round(lo + (hi - lo) * 0.75);
  }, [teamName, lo, hi]);

  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  // Reset the playhead when the team changes: an ordinal from Barcelona's 1974
  // start is meaningless on a timeline that begins in 2018.
  //
  // The team is held in state beside the playhead rather than in a ref. A ref
  // read during render is not a supported way to detect a changed prop — React
  // is free to discard the render — so the pair is compared and reset together.
  const [pos, setPos] = useState({ team: teamName, playhead: initial });
  if (pos.team !== teamName) setPos({ team: teamName, playhead: initial });
  const playhead = pos.team === teamName ? pos.playhead : initial;
  // Accepts a value or an updater, matching the useState signature it replaced
  // — two callers pass a function.
  const setPlayhead = (v: number | ((prev: number) => number)) =>
    setPos((p) => ({
      team: p.team,
      playhead: typeof v === "function" ? v(p.playhead) : v,
    }));

  const seek = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      setPlayhead(Math.round(lo + f * (hi - lo)));
    },
    [lo, hi],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    seek(e.clientX);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 365 : 30;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPlayhead((p) => Math.max(lo, p - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPlayhead((p) => Math.min(hi, p + step));
    }
  };

  const headFraction = fraction(playhead, lo, hi);
  const date = ordinalToDate(playhead);
  const dateLabel = date.toISOString().slice(0, 10);

  const primary = t.dimensions["possession_share_pct"];
  const primaryEra = primary ? eraAt(primary.eras, playhead) : null;
  const totalEvidence = Object.values(t.dimensions).reduce(
    (n, d) => n + (d.evidence || 0),
    0,
  );
  const anyFacts = Object.values(t.dimensions).some((d) => d.eras.length > 0);

  const years = useMemo(() => {
    const a = ordinalToYear(lo);
    const b = ordinalToYear(hi);
    const span = b - a;
    const step = span > 30 ? 10 : span > 12 ? 5 : 2;
    const out: number[] = [];
    for (let y = Math.ceil(a / step) * step; y <= b; y += step) out.push(y);
    return out;
  }, [lo, hi]);

  return (
    <div className="relative border border-rule bg-white/[0.02]">
      <CornerTicks />

      {/* ── Team picker ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-4 sm:px-7">
        <Label>Ask about</Label>
        <div className="flex flex-wrap gap-1.5">
          {TEAMS.map((x) => {
            const on = x.team === teamName;
            return (
              <button
                key={x.team}
                onClick={() => setTeamName(x.team)}
                className={`border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors duration-150 ease-[var(--ease-ui)] ${
                  on
                    ? "border-accent bg-accent/15 text-chalk"
                    : "border-rule text-muted hover:border-rule-strong hover:text-chalk-2"
                }`}
              >
                {x.team}
                <span className="ml-1.5 text-muted-2">{x.matches}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── The answer ──────────────────────────────────────────────── */}
      <div className="border-b border-rule px-5 py-7 sm:px-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <Label>On {dateLabel}, this team</Label>
          <span className="font-mono text-[10px] tabular-nums text-muted-2">
            {totalEvidence} observations
          </span>
        </div>

        <div className="mt-3 min-h-[4.5rem]">
          <AnimatePresence mode="wait">
            {!anyFacts ? (
              <motion.div
                key="abstain"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                <p className="font-display text-[26px] leading-tight text-chalk sm:text-[34px]">
                  I don&rsquo;t know.
                </p>
                <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-muted">
                  {t.matches} matches on record, below the six needed to claim
                  anything. Rather than average them into a confident sentence,
                  the graph declines.
                </p>
              </motion.div>
            ) : primaryEra ? (
              <motion.div
                key={primaryEra.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                <p className="font-display text-[26px] leading-tight text-chalk sm:text-[34px]">
                  {bandPhrase("possession_share_pct", primaryEra.band)}.
                </p>
                <p className="mt-2 font-mono text-[11px] text-muted">
                  true {primaryEra.from_iso} &rarr; {primaryEra.to_iso} &middot;{" "}
                  {primaryEra.observations} matches &middot; median{" "}
                  {primaryEra.median_value}
                  {DIMENSION_UNIT["possession_share_pct"]}
                </p>
                {primaryEra.cited.length > 0 && (
                  <p className="mt-1.5 truncate font-mono text-[10px] text-muted-2">
                    from {primaryEra.cited.slice(0, 2).join(" · ")}
                  </p>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="outside"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                <p className="font-display text-[26px] leading-tight text-muted sm:text-[34px]">
                  Nothing on record here.
                </p>
                <p className="mt-2 text-[13px] text-muted-2">
                  Outside the window this team has been observed.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Tracks ──────────────────────────────────────────────────────
          Labels and tracks are separate grid columns, and only the track
          column carries the pointer handlers and the playhead. Measuring the
          drag against the full panel — labels included — offsets the cursor
          from the playhead by the label width, so the start of the timeline
          sits under the labels and the end runs past the right edge.       */}
      <div className="grid grid-cols-[8.5rem_1fr] gap-4 px-5 py-6 sm:grid-cols-[11rem_1fr] sm:px-7">
        <div className="flex min-w-0 flex-col gap-2.5">
          {DIMENSIONS.map((d) => (
            <TrackLabel
              key={d.key}
              label={d.label}
              dimension={d.key}
              active={eraAt(t.dimensions[d.key]?.eras ?? [], playhead)}
            />
          ))}
        </div>

        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Scrub through this team's history"
          aria-valuemin={ordinalToYear(lo)}
          aria-valuemax={ordinalToYear(hi)}
          aria-valuenow={ordinalToYear(playhead)}
          aria-valuetext={dateLabel}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={(e) => dragging && seek(e.clientX)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          className="relative cursor-ew-resize touch-none select-none outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <div className="flex flex-col gap-2.5">
            {DIMENSIONS.map((d) => (
              <EraBar
                key={d.key}
                unit={DIMENSION_UNIT[d.key] ?? ""}
                eras={t.dimensions[d.key]?.eras ?? []}
                lo={lo}
                hi={hi}
                playhead={playhead}
              />
            ))}
          </div>

          {/* Playhead spans the same box the drag is measured against, so the
              line lands exactly under the cursor. */}
          <motion.div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-accent"
            style={{ left: `${headFraction * 100}%` }}
            animate={{ opacity: dragging ? 1 : 0.75 }}
            transition={{ duration: 0.15 }}
          >
            <span className="absolute -top-1.5 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-accent" />
          </motion.div>

          {/* Year axis, inside the same box for the same reason. */}
          <div className="relative mt-4 h-5 border-t border-rule pt-2">
            {years.map((y) => {
              const f = fraction(isoToOrdinal(`${y}-01-01`), lo, hi);
              return (
                <span
                  key={y}
                  className="absolute top-2 -translate-x-1/2 font-mono text-[9px] tabular-nums text-muted-2"
                  style={{ left: `${f * 100}%` }}
                >
                  {y}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-t border-rule px-5 py-3 sm:px-7">
        <Label>Drag the timeline, or use &larr; &rarr; &middot; shift for years</Label>
      </div>
    </div>
  );
}
