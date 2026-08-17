"use client";

import { motion } from "motion/react";
import memory from "@/content/snapshots/active/memory-wc2022.json";

/**
 * Versus your usual.
 *
 * The only place the memory graph faces a coach directly, and the only claim on
 * the page that no amount of computer vision could produce: this is not about
 * what happened in the match, it is about how the match differed from what this
 * team normally does.
 *
 * Each row is a dated fact from HydraDB — the norm that was valid on the day of
 * this match — against what the side actually did. The evidence count travels
 * with it, because a norm drawn from twelve matches deserves less weight than
 * one drawn from twenty-five, and hiding that would be the easiest lie on the
 * page.
 */

type Deviation = {
  dimension: string;
  label: string;
  normal_band: string;
  normal_value: number;
  match_value: number;
  delta: number | null;
  era_matches: number;
};

type TeamMemory = {
  matches: number;
  evidence: Record<string, number>;
  deviations: Deviation[];
};

const MEMORY = memory as unknown as Record<string, TeamMemory>;

/** Below this the graph declines to characterise a team at all. */
const MIN_EVIDENCE = 6;

const UNIT: Record<string, string> = {
  possession_share_pct: "%",
  press_height: "m",
  defensive_action_height: "m",
  team_width: "m",
  pass_forward_ratio: "",
};

/** Only surface a difference a coach would act on. */
function notable(d: Deviation): boolean {
  if (d.delta === null) return false;
  const rel = Math.abs(d.delta) / Math.max(Math.abs(d.normal_value), 1);
  return rel >= 0.04;
}

const EASE = [0.4, 0, 0.2, 1] as const;

export function VersusUsual({ team }: { team: string }) {
  const m = MEMORY[team];
  if (!m) return null;

  const enough = m.matches >= MIN_EVIDENCE;
  const rows = m.deviations.filter(notable);

  return (
    <section className="mt-14">
      <h2 className="text-[15px] font-medium text-warm-2">
        {enough ? "How this game differed from your usual" : "Not enough games yet"}
      </h2>

      {!enough ? (
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-warm-2">
          {m.matches} {m.matches === 1 ? "game" : "games"} on record. Below{" "}
          {MIN_EVIDENCE} there is nothing honest to compare against, so this
          section stays empty until you have uploaded a few more.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-warm-2">
          Nothing stood out. Across {m.matches} games on record, this one looked
          like the rest of them.
        </p>
      ) : (
        <>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
            Measured against what this side normally does, drawn from{" "}
            {m.matches} games already in the graph.
          </p>

          <ul className="mt-5 overflow-hidden rounded-lg bg-surface ring-1 ring-white/[0.06]">
            {rows.map((d, i) => {
              const up = (d.delta ?? 0) > 0;
              const unit = UNIT[d.dimension] ?? "";
              return (
                <motion.li
                  key={d.dimension}
                  initial={{ opacity: 0, x: -6 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: i * 0.06, ease: EASE }}
                  className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 border-b border-white/[0.05] px-5 py-5 last:border-b-0"
                >
                  <span className="min-w-[10rem] text-[15px] text-chalk">
                    {d.label}
                  </span>
                  <span className="font-mono text-[11px] text-muted">
                    usually {d.normal_band}
                    <span className="text-muted-2">
                      {" "}
                      ({d.normal_value}
                      {unit})
                    </span>
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-chalk">
                    this game {d.match_value}
                    {unit}
                  </span>
                  <span
                    className={`ml-auto font-mono text-[12px] tabular-nums ${
                      Math.abs(d.delta ?? 0) >= Math.abs(d.normal_value) * 0.1
                        ? "text-accent"
                        : "text-muted"
                    }`}
                  >
                    {up ? "+" : ""}
                    {d.delta}
                    {unit}
                  </span>
                  <span className="w-full font-mono text-[10px] text-muted-2">
                    norm held across {d.era_matches} matches
                  </span>
                </motion.li>
              );
            })}
          </ul>

          <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-muted-2">
            These norms are stored with the dates they were true. Play
            differently for long enough and the graph records that the old fact
            ended, which is the point: a weakness you have fixed should stop
            being reported.
          </p>
        </>
      )}
    </section>
  );
}
