"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChalkFilters } from "@/components/chalk-filters";
import { MomentFrame } from "@/components/report/moment-frame";
import { MomentPitch } from "@/components/report/moment-pitch";
import { PepFeed } from "@/components/report/pep-feed";
import { TapeRoom } from "@/components/report/tape-room";
import { ThisWeek } from "@/components/report/this-week";
import { Upload } from "@/components/report/upload";
import { VersusUsual } from "@/components/report/versus-usual";
import { Watching } from "@/components/report/watching";
import { Workspace } from "@/components/shell/workspace";
import { MATCH, MOMENTS, Moment, byPlayer, surname } from "@/content/pep";

/**
 * The coach interface.
 *
 * Warmer than the landing page on purpose. The landing page speaks HydraDB's
 * language — pure black, hairlines, monospace micro-labels — which is right for
 * a developer meeting an infrastructure brand. A volunteer coach opening a
 * report on a Sunday needs something else: sans for reading, mono only for
 * numbers, surfaces that lift off the page, and roughly twice the air.
 *
 * It opens with what to do rather than what happened. The coach was at the
 * game; they do not need a recap. They need Tuesday's session.
 *
 * The front door is the dashboard, not the upload box. A coach who has been
 * using this for a season does not arrive wanting to fill in a form — they
 * arrive wanting to know what Pep found while they were at work. Upload is a
 * button in the corner, which is the right size for something you do once a
 * week against something you read five times.
 */

type Stage = "dashboard" | "upload" | "watching" | "report";
const EASE = [0.4, 0, 0.2, 1] as const;

export default function ReportPage() {
  const [stage, setStage] = useState<Stage>("dashboard");
  const [roster, setRoster] = useState<string[]>([]);
  const [selected, setSelected] = useState<Moment | null>(MOMENTS[0] ?? null);

  // Opening a report from halfway down the dashboard otherwise drops the coach
  // halfway down the report.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [stage]);

  return (
    <main className="min-h-screen">
      <ChalkFilters />
      <AnimatePresence mode="wait">
        {stage === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Workspace
              // Picking a clip in the brief carries that exact moment into the
              // report, rather than dropping the coach on whatever was
              // selected last.
              onOpenMoment={(m) => {
                setSelected(m);
                setStage("report");
              }}
              onAddGame={() => setStage("upload")}
            />
          </motion.div>
        )}

        {stage === "upload" && (
          <motion.div
            key="upload"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="px-5 pt-14 sm:px-8"
          >
            <BackTo onClick={() => setStage("dashboard")} />
            <Upload
              onStart={(names) => {
                setRoster(names);
                setStage("watching");
              }}
            />
          </motion.div>
        )}

        {stage === "watching" && (
          <motion.div
            key="watching"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="py-10"
          >
            <Watching onDone={() => setStage("report")} />
          </motion.div>
        )}

        {stage === "report" && (
          <motion.div
            key="report"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="mx-auto w-full max-w-5xl"
          >
            <BackTo onClick={() => setStage("dashboard")} />
            <Report roster={roster} selected={selected} onSelect={setSelected} />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

/** The way home. A coach who cannot get back to the dashboard is stuck. */
function BackTo({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mb-8 font-mono text-[11px] text-muted transition-colors hover:text-chalk"
    >
      &larr; dashboard
    </button>
  );
}

function Report({
  roster,
  selected,
  onSelect,
}: {
  roster: string[];
  selected: Moment | null;
  onSelect: (m: Moment) => void;
}) {
  const players = byPlayer();
  const named = new Set(roster.map((r) => surname(r).toLowerCase()));

  return (
    <div className="flex flex-col gap-20">
      {/* ── Greeting ────────────────────────────────────────────────── */}
      <header>
        <p className="text-[13px] text-muted-2">
          {MATCH.competition} &middot; {MATCH.date}
        </p>
        <h1 className="mt-2 text-[30px] leading-tight font-medium text-chalk sm:text-[40px]">
          Here&rsquo;s your game.
        </h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-warm-2">
          Pep watched all of it. The short version: you kept turning back when
          the box was open. {MOMENTS.length} times worth showing the group.
        </p>
      </header>

      {/* ── The tape ────────────────────────────────────────────────── */}
      {/* First, because it is the thing being talked about. A coach who scrolls
          into a set of diagrams without seeing the footage they came from has
          been handed homework. */}
      <section>
        <TapeRoom />
      </section>

      {/* ── The point of the whole thing ────────────────────────────── */}
      <ThisWeek onSelect={onSelect} />

      {/* ── The evidence ────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[15px] font-medium text-warm-2">
          The moments behind that
        </h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
          Pick one and Pep draws what was played against what was on.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_21rem]">
          <div className="rounded-lg bg-surface p-5 ring-1 ring-white/[0.06]">
            {/* The freeze frame when we have one — showing the eleven other
                players is the difference between an assertion and evidence.
                Falls back to the bare chalk pitch for older snapshots. */}
            {selected?.freeze?.length ? (
              <MomentFrame moment={selected} />
            ) : (
              <MomentPitch moment={selected} />
            )}
            {selected && (
              <>
                <p className="mt-5 text-[16px] leading-relaxed text-warm">
                  {selected.line}
                </p>
                <p className="mt-2 font-mono text-[11px] text-muted-2">
                  {selected.minute}&rsquo; &middot; {surname(selected.player)}{" "}
                  &middot; {selected.freeze?.length ?? 0} players tracked
                </p>
              </>
            )}
          </div>

          <div className="max-h-[32rem] overflow-hidden rounded-lg bg-surface ring-1 ring-white/[0.06]">
            <PepFeed selected={selected?.id ?? null} onSelect={onSelect} />
          </div>
        </div>
      </section>

      {/* ── Players ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[15px] font-medium text-warm-2">
          Who to have a word with
        </h2>

        <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((p) => {
            const inSquad = named.size === 0 || named.has(surname(p.player).toLowerCase());
            return (
              <li
                key={p.player}
                className="rounded-lg bg-surface p-5 ring-1 ring-white/[0.06]"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[16px] font-medium text-chalk">
                    {surname(p.player)}
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-muted-2">
                    {p.moments.length}
                  </span>
                </div>
                <p className="mt-2.5 text-[14px] leading-relaxed text-warm-2">
                  {p.moments.length > 1
                    ? `${p.moments.length} times you had a forward ball on and took the safer one.`
                    : p.moments[0].no_riskier
                      ? "Once, with a better ball available that was no harder to play."
                      : "Once, though the better ball was a genuinely hard ask."}
                </p>
                <button
                  onClick={() => onSelect(p.moments[0])}
                  className="mt-4 rounded bg-white/[0.05] px-3 py-1.5 font-mono text-[11px] tabular-nums text-warm transition-colors hover:bg-accent/20 hover:text-chalk"
                >
                  show me {p.moments[0].minute}&rsquo;
                </button>
                {!inSquad && (
                  <span className="mt-3 block text-[12px] text-muted-2">
                    came off the bench
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <VersusUsual team="Argentina" />

      {/* ── Provenance ──────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.07] pt-8">
        <p className="max-w-3xl text-[13px] leading-relaxed text-muted-2">
          Every moment here was computed, not written. How dangerous a pass is
          comes from a model trained on 3,961 matches of elite football; how
          likely it was to arrive comes from a model fitted on this match&rsquo;s
          own passing. Pep only raises a moment when a better ball existed{" "}
          <em className="not-italic text-muted">after</em> accounting for the
          chance it got cut out, which is why the spectacular ones usually
          aren&rsquo;t recommended.
        </p>
      </footer>
    </div>
  );
}
