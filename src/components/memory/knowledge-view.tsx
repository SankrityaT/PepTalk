"use client";

import { motion } from "motion/react";
import knowledge from "@/content/snapshots/knowledge.json";

/**
 * What Pep already knows, and where this side sits inside it.
 *
 * This is the product's actual argument, and it took a while to say plainly.
 * Nobody trains a model for a coach. The graph already holds every match in
 * the open data, and a side's own games are measured against that body rather
 * than against themselves.
 *
 * An earlier version of this screen showed one club's eras on a timeline. It
 * was true and it was the wrong thing: it read as a tool that knows two teams.
 * The number that matters is not how Barcelona changed, it is that a coach's
 * 22 games are being placed against 354 sides they will never play.
 *
 * Every percentile here is a query, not a stored figure. A side's current norm
 * for a dimension is compared against the current norm of every other side
 * that has enough evidence to have one, which is what the validity intervals
 * are for: "current" means the fact whose interval has not closed.
 */

type Dim = {
  dimension: string;
  label: string;
  value: number;
  band: string;
  obs: number;
  percentile: number;
  peers: number;
  median: number;
  top: { team: string; v: number }[];
};

const DATA = knowledge as unknown as {
  team: string;
  scale: {
    teams: number;
    matches: number;
    facts: number;
    supersessions: number;
    competitions: { name: string; matches: number }[];
  };
  dimensions: Dim[];
};

const EASE = [0.4, 0, 0.2, 1] as const;

const UNIT: Record<string, string> = {
  possession_share_pct: "%",
  press_height: "m",
  defensive_action_height: "m",
  team_width: "m",
  pass_forward_ratio: "",
};

/**
 * How unusual a value is, said in words. A coach does not think in
 * percentiles, but "narrower than nine in ten" is a sentence.
 */
function read(d: Dim, team: string): string {
  const p = d.percentile;
  const noun = d.label.toLowerCase();
  if (p >= 90) return `Higher ${noun} than ${p}% of sides in the graph.`;
  if (p <= 10) return `Lower ${noun} than all but ${p}% of sides in the graph.`;
  if (p >= 70) return `Above most sides for ${noun}.`;
  if (p <= 30) return `Below most sides for ${noun}.`;
  return `About average for ${noun}.`;
}

function Bar({ d }: { d: Dim }) {
  const unusual = d.percentile >= 85 || d.percentile <= 15;
  return (
    <div className="relative h-9 w-full overflow-hidden rounded-md bg-white/[0.04]">
      {/* The middle half of the distribution, so "unusual" is visible rather
          than asserted. */}
      <span className="absolute inset-y-0 left-[25%] w-1/2 bg-white/[0.04]" />
      <span className="absolute inset-y-0 left-1/2 w-px bg-white/15" />
      <motion.span
        initial={{ opacity: 0, scaleY: 0.4 }}
        animate={{ opacity: 1, scaleY: 1 }}
        transition={{ duration: 0.45, ease: EASE }}
        className={`absolute inset-y-1 w-[3px] rounded-full ${
          unusual ? "bg-accent" : "bg-warm"
        }`}
        style={{ left: `calc(${Math.min(98, Math.max(1, d.percentile))}% - 1.5px)` }}
      />
      <span className="absolute inset-y-0 left-2 flex items-center font-mono text-[9px] text-muted-2">
        less
      </span>
      <span className="absolute inset-y-0 right-2 flex items-center font-mono text-[9px] text-muted-2">
        more
      </span>
    </div>
  );
}

export function KnowledgeView() {
  const { team, scale, dimensions } = DATA;
  const standout = [...dimensions].sort(
    (a, b) => Math.abs(50 - b.percentile) - Math.abs(50 - a.percentile),
  )[0];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-[24px] font-medium text-chalk">What Pep knows</h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-warm-2">
        Nothing is trained for you. The graph already holds every match in the
        open data, and your games are measured against all of it.
      </p>

      {/* ── The body of knowledge ─────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { k: "teams", v: scale.teams.toLocaleString() },
          { k: "matches read", v: scale.matches.toLocaleString() },
          { k: "dated facts", v: scale.facts.toLocaleString() },
          { k: "times a fact changed", v: scale.supersessions.toLocaleString() },
        ].map((s, i) => (
          <motion.div
            key={s.k}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.05, ease: EASE }}
            className="rounded-xl bg-surface p-4 ring-1 ring-white/[0.06]"
          >
            <span className="font-mono text-[10px] tracking-[0.12em] text-muted-2 uppercase">
              {s.k}
            </span>
            <span className="mt-2 block font-mono text-[26px] leading-none tabular-nums text-chalk">
              {s.v}
            </span>
          </motion.div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {scale.competitions.slice(0, 9).map((c) => (
          <span
            key={c.name}
            className="rounded-full bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] text-muted"
          >
            {c.name}
            <span className="ml-1.5 tabular-nums text-muted-2">{c.matches}</span>
          </span>
        ))}
      </div>

      {/* ── Where this side sits ──────────────────────────────────────── */}
      <section className="mt-9">
        <h2 className="text-[15px] font-medium text-chalk">
          Where {team} sits in it
        </h2>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
          Each mark is this side against every other side with enough games to
          have a norm. Not a similar match: the whole population.
        </p>

        {standout && (
          <p className="mt-3 rounded-xl bg-accent/[0.07] px-4 py-3 text-[14px] leading-relaxed text-warm ring-1 ring-accent/20">
            {read(standout, team)} That is the one worth talking about, and it
            is the sort of thing you cannot see from your own games alone.
          </p>
        )}

        <div className="mt-4 flex flex-col gap-3">
          {dimensions.map((d) => (
            <div
              key={d.dimension}
              className="rounded-xl bg-surface p-4 ring-1 ring-white/[0.06]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="flex items-baseline gap-2.5">
                  <span className="text-[14px] font-medium text-chalk">
                    {d.label}
                  </span>
                  <span className="font-mono text-[11px] text-accent">
                    {d.band}
                  </span>
                </span>
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  {d.value}
                  {UNIT[d.dimension] ?? ""}
                  <span className="ml-2 text-muted-2">
                    median {d.median}
                    {UNIT[d.dimension] ?? ""}
                  </span>
                </span>
              </div>

              <div className="mt-2.5">
                <Bar d={d} />
              </div>

              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[12px] text-warm-2">{read(d, team)}</span>
                <span className="font-mono text-[10px] tabular-nums text-muted-2">
                  {d.percentile}th of {d.peers} sides &middot; from {d.obs} of
                  your games
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Why this needs the graph ──────────────────────────────────── */}
      <section className="mt-8 rounded-xl bg-surface-2 p-5 ring-1 ring-white/[0.08]">
        <h2 className="text-[15px] font-medium text-chalk">
          Why this is a graph and not a model
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className="font-mono text-[10px] tracking-[0.12em] text-muted-2 uppercase">
              the usual way
            </span>
            <p className="mt-1.5 text-[14px] leading-relaxed text-warm-2">
              Fit something to a club&rsquo;s own games. It needs a lot of them
              before it says anything, and it only ever knows that club.
            </p>
          </div>
          <div>
            <span className="font-mono text-[10px] tracking-[0.12em] text-accent uppercase">
              this way
            </span>
            <p className="mt-1.5 text-[14px] leading-relaxed text-warm">
              {scale.matches.toLocaleString()} matches are already in the graph.
              A side with a dozen games gets placed against{" "}
              {scale.teams.toLocaleString()} others immediately, and every new
              upload sharpens the picture for everyone rather than starting a
              new one.
            </p>
          </div>
        </div>
        <p className="mt-4 border-t border-white/[0.07] pt-3 text-[13px] leading-relaxed text-muted">
          Facts carry the dates they were true, so &ldquo;current&rdquo; is a
          query rather than a guess, and a habit a side has fixed stops being
          reported instead of following them around forever.
        </p>
      </section>
    </div>
  );
}
