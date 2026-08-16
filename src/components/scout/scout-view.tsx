"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import scout from "@/content/snapshots/scout.json";

/**
 * Preparing for the next one.
 *
 * Watching the last game is half the job. The half a coach is actually paid
 * for is the week before the next one, and that is a retrieval problem: what
 * does this opponent do, since when, and where does it differ from us.
 *
 * The switch at the top is the honest part. Turning memory off does not fake a
 * worse answer, it runs the query a store without validity intervals would
 * have to run: take the single best-evidenced claim about a side and report
 * it. That claim averages across every era the side has been through and
 * describes none of them, which is exactly the failure the dates exist to
 * prevent. Both answers below come out of the same graph; only the query
 * changes.
 */

type Norm = {
  band: string;
  value: number;
  obs: number;
  since: string | null;
  id: number;
};

type Flat = {
  band: string;
  observations: number;
  valid_from: number;
  valid_to: number;
} | null;

type Side = { norms: Record<string, Norm>; flat: Record<string, Flat>; games?: number };

const DATA = scout as unknown as {
  team: string;
  labels: Record<string, string>;
  mine: Side;
  opponents: Record<string, Side>;
};

const EASE = [0.4, 0, 0.2, 1] as const;

const UNIT: Record<string, string> = {
  possession_share_pct: "%",
  press_height: "m",
  defensive_action_height: "m",
  team_width: "m",
  pass_forward_ratio: "",
};

/** The gap that is worth a coach's week, and what it means. */
function edge(dim: string, mine: Norm, theirs: Norm, label: string): string | null {
  const gap = mine.value - theirs.value;
  const rel = Math.abs(gap) / Math.max(Math.abs(theirs.value), 1);
  if (rel < 0.05) return null;

  if (dim === "press_height") {
    return gap < 0
      ? `They press ${Math.abs(gap).toFixed(0)}m higher than you. Space in behind if you can get past the first line.`
      : `You press ${gap.toFixed(0)}m higher than they do. Their build-up will be under more pressure than it is used to.`;
  }
  if (dim === "defensive_action_height") {
    return gap < 0
      ? `Their line sits ${Math.abs(gap).toFixed(0)}m higher. Runs in behind are on.`
      : `They defend ${gap.toFixed(0)}m deeper than you. Expect a low block and few gaps in behind.`;
  }
  if (dim === "possession_share_pct") {
    return gap < 0
      ? `They keep the ball more than you do. Plan for spells without it.`
      : `You keep the ball more. They will be happy to sit and counter.`;
  }
  if (dim === "team_width") {
    return gap < 0
      ? `They play wider. Your full-backs will be stretched.`
      : `You play wider than they do. The flanks are where the room is.`;
  }
  if (dim === "pass_forward_ratio") {
    return gap < 0
      ? `They go forward more directly. Second balls will matter.`
      : `You are more direct than they are. They will try to slow it down.`;
  }
  return `${label}: ${gap > 0 ? "you higher" : "they higher"} by ${Math.abs(gap).toFixed(1)}.`;
}

export function ScoutView() {
  const names = Object.keys(DATA.opponents);
  const [who, setWho] = useState(names[0]);
  const [memory, setMemory] = useState(true);

  const them = DATA.opponents[who];
  const dims = useMemo(
    () => Object.keys(DATA.labels).filter((d) => DATA.mine.norms[d] && them?.norms[d]),
    [them],
  );

  const edges = dims
    .map((d) => edge(d, DATA.mine.norms[d], them.norms[d], DATA.labels[d]))
    .filter(Boolean) as string[];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-medium text-chalk">Next match</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
            What they do, since when, and where it differs from you.
          </p>
        </div>

        {/* ── The ablation ──────────────────────────────────────────────── */}
        <button
          onClick={() => setMemory((m) => !m)}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 ring-1 transition-colors ${
            memory
              ? "bg-accent/10 text-accent ring-accent/30"
              : "bg-white/[0.05] text-muted ring-white/10"
          }`}
        >
          <span
            className={`relative h-4 w-7 rounded-full transition-colors ${
              memory ? "bg-accent" : "bg-white/20"
            }`}
          >
            <span
              className={`absolute top-0.5 size-3 rounded-full bg-canvas transition-all ${
                memory ? "left-3.5" : "left-0.5"
              }`}
            />
          </span>
          <span className="font-mono text-[11px] tracking-[0.08em] uppercase">
            memory {memory ? "on" : "off"}
          </span>
        </button>
      </div>

      {/* ── Who ───────────────────────────────────────────────────────── */}
      <div className="mt-5 flex flex-wrap gap-2">
        {names.map((n) => (
          <button
            key={n}
            onClick={() => setWho(n)}
            className={`rounded-full px-3 py-1.5 text-[12px] transition-colors ${
              who === n
                ? "bg-accent text-canvas"
                : "bg-white/[0.05] text-warm-2 hover:bg-white/[0.1] hover:text-chalk"
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {!memory && (
          <motion.p
            key="warn"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-5 rounded-xl bg-white/[0.05] px-4 py-3 text-[13px] leading-relaxed text-muted ring-1 ring-white/[0.08]"
          >
            Memory off. This is the same graph queried without validity
            intervals: the single best-evidenced claim about each side, which
            averages across every era they have been through and describes
            none of them. No dates, no idea whether it is still true.
          </motion.p>
        )}
      </AnimatePresence>

      {/* ── Side by side ──────────────────────────────────────────────── */}
      <section className="mt-5">
        <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]">
          <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-3 border-b border-white/[0.06] px-4 py-3">
            <span className="text-[13px] font-medium text-chalk">
              {DATA.team}
            </span>
            <span className="font-mono text-[10px] tracking-[0.12em] text-muted-2 uppercase">
              versus
            </span>
            <span className="text-right text-[13px] font-medium text-accent">
              {who}
              {them.games ? (
                <span className="ml-2 font-mono text-[10px] text-muted-2">
                  {them.games} games
                </span>
              ) : null}
            </span>
          </div>

          {dims.map((d, i) => {
            const a = DATA.mine.norms[d];
            const b = them.norms[d];
            const fa = DATA.mine.flat[d];
            const fb = them.flat[d];
            const unit = UNIT[d] ?? "";
            return (
              <motion.div
                key={d}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, delay: i * 0.04, ease: EASE }}
                className="border-b border-white/[0.05] px-4 py-3 last:border-b-0"
              >
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <span className="text-[13px] text-warm">
                    {memory ? (
                      <>
                        {a.band}{" "}
                        <span className="font-mono text-[11px] tabular-nums text-muted">
                          {a.value}
                          {unit}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">{fa?.band ?? "unknown"}</span>
                    )}
                  </span>

                  <span className="font-mono text-[10px] tracking-[0.1em] text-muted-2 uppercase">
                    {DATA.labels[d]}
                  </span>

                  <span className="text-right text-[13px] text-warm">
                    {memory ? (
                      <>
                        {b.band}{" "}
                        <span className="font-mono text-[11px] tabular-nums text-muted">
                          {b.value}
                          {unit}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">{fb?.band ?? "unknown"}</span>
                    )}
                  </span>
                </div>

                <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] gap-3 font-mono text-[10px] text-muted-2">
                  <span>
                    {memory
                      ? `since ${a.since ?? "?"} · ${a.obs} games`
                      : "no date"}
                  </span>
                  <span />
                  <span className="text-right">
                    {memory
                      ? `since ${b.since ?? "?"} · ${b.obs} games`
                      : "no date"}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ── What to do about it ───────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="text-[15px] font-medium text-chalk">
          {memory ? "What that gives you" : "What is left without memory"}
        </h2>

        {memory ? (
          <ul className="mt-3 flex flex-col gap-2">
            {edges.map((e) => (
              <motion.li
                key={e}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="rounded-xl bg-surface px-4 py-3 text-[14px] leading-relaxed text-warm ring-1 ring-white/[0.06]"
              >
                {e}
              </motion.li>
            ))}
            {edges.length === 0 && (
              <li className="rounded-xl bg-surface px-4 py-3 text-[14px] text-warm-2 ring-1 ring-white/[0.06]">
                Nothing separates you by enough to plan around. Two sides that
                play alike.
              </li>
            )}
          </ul>
        ) : (
          <div className="mt-3 rounded-xl bg-surface px-4 py-4 ring-1 ring-white/[0.06]">
            <p className="text-[14px] leading-relaxed text-muted">
              Two lists of bands with no dates on them. You cannot say whether
              any of it is still true, when it changed, or whether the side you
              face on Saturday is the side those numbers describe.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-2">
              This is the same data. What is missing is the thing the graph
              stores and an index does not: when each claim was true, and what
              replaced it.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
