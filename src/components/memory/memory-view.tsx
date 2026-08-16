"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import memory from "@/content/snapshots/memory.json";

/**
 * Why the graph is not a nice-to-have.
 *
 * Everywhere else this product cites a fact and moves on. This is the one
 * screen that argues, because the claim is easy to make and hard to believe:
 * that storing football in a temporal graph buys something a vector index
 * cannot give you at any embedding size.
 *
 * The argument is made with data rather than asserted. A side's history is
 * cut into eras, each carrying the dates it was true and a chain to whatever
 * replaced it. From that you can ask **what was true on a date**, which is a
 * traversal, and you can ask **when did this stop being true**, which is an
 * edge. A vector store answers "which games resemble this one". Useful, and a
 * different question.
 *
 * The strongest evidence here was not put in by hand. Given every Barcelona
 * match in the open data and no instruction beyond "find the eras", the system
 * cut possession at 2011-03-05 and again at 2012-01-08, and called the 27
 * games between them dominant at 67.0%. That is Guardiola's peak side, located
 * from data, with dates.
 */

type Fact = {
  id: number;
  dimension: string;
  label: string;
  band: string;
  from: string | null;
  to: string | null;
  open: boolean;
  obs: number;
  median: number;
};

type Side = {
  team: string;
  games: number;
  facts: Fact[];
  chain: { from_id: number; to_id: number }[];
  at: Record<string, { dimension: string; label: string; band: string; median: number; id: number; obs: number }[]>;
};

const DATA = memory as unknown as { workspace: Side; showcase: Side };

const EASE = [0.4, 0, 0.2, 1] as const;

function year(iso: string | null): number {
  return iso ? Number(iso.slice(0, 4)) : new Date().getFullYear();
}

/** Eras of one dimension, drawn on a shared time axis. */
function Timeline({ facts, lo, hi }: { facts: Fact[]; lo: number; hi: number }) {
  const span = Math.max(1, hi - lo);
  return (
    <div className="relative h-7 w-full overflow-hidden rounded-md bg-white/[0.04]">
      {facts.map((f, i) => {
        const a = (year(f.from) - lo) / span;
        const b = (year(f.to) - lo) / span;
        const w = Math.max(0.015, b - a);
        return (
          <motion.span
            key={f.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: i * 0.05, ease: EASE }}
            title={`${f.band} · ${f.from} to ${f.to ?? "now"} · ${f.obs} games · median ${f.median}`}
            className="absolute top-0 flex h-full items-center justify-center overflow-hidden border-r border-canvas/60 last:border-r-0"
            style={{
              left: `${a * 100}%`,
              width: `${w * 100}%`,
              // Lightness carries the band, so a run of eras reads as a
              // gradient of intensity rather than a set of unrelated colours.
              background: `hsl(18 82% ${34 + Math.min(3, i) * 6}% / ${f.open ? 0.95 : 0.55})`,
            }}
          >
            <span className="truncate px-1.5 font-mono text-[9px] text-canvas/90">
              {w > 0.12 ? f.band : ""}
            </span>
          </motion.span>
        );
      })}
    </div>
  );
}

export function MemoryView() {
  const [which, setWhich] = useState<"workspace" | "showcase">("showcase");
  const side = DATA[which];

  const byDimension = useMemo(() => {
    const m = new Map<string, Fact[]>();
    for (const f of side.facts) {
      if (!m.has(f.dimension)) m.set(f.dimension, []);
      m.get(f.dimension)!.push(f);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [side]);

  const [lo, hi] = useMemo(() => {
    const ys = side.facts.flatMap((f) => [year(f.from), year(f.to)]);
    return [Math.min(...ys), Math.max(...ys)];
  }, [side]);

  const dates = Object.keys(side.at).sort();
  const [at, setAt] = useState(dates[dates.length - 1] ?? "");
  const snapshot = side.at[at] ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-medium text-chalk">Memory</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
            What this side used to be, when it changed, and what replaced it.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-white/[0.05] p-1">
          {(["workspace", "showcase"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setWhich(k)}
              className={`rounded px-2.5 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase transition-colors ${
                which === k ? "bg-accent text-canvas" : "text-muted hover:text-chalk"
              }`}
            >
              {DATA[k].team}
            </button>
          ))}
        </div>
      </div>

      {/* ── The claim, made concrete ──────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { k: "games read", v: side.games.toLocaleString() },
          { k: "dated facts", v: side.facts.length },
          { k: "supersessions", v: side.chain.length },
          { k: "dimensions", v: byDimension.length },
        ].map((s) => (
          <div key={s.k} className="rounded-xl bg-surface p-4 ring-1 ring-white/[0.06]">
            <span className="font-mono text-[10px] tracking-[0.12em] text-muted-2 uppercase">
              {s.k}
            </span>
            <span className="mt-2 block font-mono text-[24px] leading-none tabular-nums text-chalk">
              {s.v}
            </span>
          </div>
        ))}
      </div>

      {/* ── Eras ──────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-medium text-chalk">
            How {side.team} changed
          </h2>
          <span className="font-mono text-[10px] tabular-nums text-muted-2">
            {lo} to {hi}
          </span>
        </div>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
          Each band is an era the system found on its own, with the dates it
          held. Nobody told it where to cut.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          {byDimension.map(([dim, facts]) => (
            <div key={dim} className="rounded-xl bg-surface p-4 ring-1 ring-white/[0.06]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium text-chalk">
                  {facts[0].label}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-2">
                  {facts.length} {facts.length === 1 ? "era" : "eras"}
                </span>
              </div>
              <div className="mt-2.5">
                <Timeline facts={facts} lo={lo} hi={hi} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted-2">
                {facts.map((f) => (
                  <span key={f.id}>
                    {f.band} {f.from?.slice(0, 4)}
                    {f.open ? "→now" : `→${f.to?.slice(0, 4)}`} ({f.obs})
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── The query that makes the point ────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-[15px] font-medium text-chalk">
          What was true on a date
        </h2>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
          Not the most similar game. The state of this side on that day, read
          off the facts whose validity interval contains it.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {dates.map((d) => (
            <button
              key={d}
              onClick={() => setAt(d)}
              className={`rounded-full px-3 py-1.5 font-mono text-[11px] tabular-nums transition-colors ${
                at === d
                  ? "bg-accent text-canvas"
                  : "bg-white/[0.05] text-warm-2 hover:bg-white/[0.1] hover:text-chalk"
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        <ul className="mt-4 overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]">
          {snapshot.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-white/[0.05] px-4 py-3 last:border-b-0"
            >
              <span className="min-w-[11rem] text-[14px] text-chalk">{f.label}</span>
              <span className="font-mono text-[11px] text-accent">{f.band}</span>
              <span className="font-mono text-[11px] tabular-nums text-muted">
                median {f.median}
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-2">
                Fact {f.id} &middot; {f.obs} games
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Said plainly ──────────────────────────────────────────────── */}
      <section className="mt-8 rounded-xl bg-surface-2 p-5 ring-1 ring-white/[0.08]">
        <h2 className="text-[15px] font-medium text-chalk">
          Why this needs a graph
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className="font-mono text-[10px] tracking-[0.12em] text-muted-2 uppercase">
              a vector index answers
            </span>
            <p className="mt-1.5 text-[14px] leading-relaxed text-warm-2">
              Which games resemble this one. A real question, and not the one a
              coach asks.
            </p>
          </div>
          <div>
            <span className="font-mono text-[10px] tracking-[0.12em] text-accent uppercase">
              this answers
            </span>
            <p className="mt-1.5 text-[14px] leading-relaxed text-warm">
              What was true in March, when it stopped being true, and what
              replaced it. Validity intervals make the first a lookup;{" "}
              <span className="font-mono text-[12px] text-accent">SUPERSEDED_BY</span>{" "}
              makes the second an edge you can walk.
            </p>
          </div>
        </div>
        <p className="mt-4 border-t border-white/[0.07] pt-3 text-[13px] leading-relaxed text-muted">
          It matters because a weakness a side has fixed should stop being
          reported. Without dates on a claim, last season&rsquo;s problem is
          indistinguishable from this week&rsquo;s, and the assistant that
          keeps raising it gets ignored.
        </p>
      </section>
    </div>
  );
}
