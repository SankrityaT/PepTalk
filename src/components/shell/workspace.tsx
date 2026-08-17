//created by kinjal
"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Brief } from "@/components/brief/brief";
import { TapeRoom } from "@/components/report/tape-room";
import { MatchCard } from "@/components/dash/match-card";
import { Pipeline } from "@/components/dash/pipeline";
import { Sparkline } from "@/components/dash/sparkline";
import { XtPitch } from "@/components/dash/xt-pitch";
import { Section, Sidebar } from "@/components/shell/sidebar";
import { FEATURED, MATCHES, TEAM, TOTALS, mean, series } from "@/content/dashboard";
import { Moment } from "@/content/pep";
import { type AddedGame, added as listAdded } from "@/lib/games";

/**
 * The workspace.
 *
 * The brief is the front door. Everything the old tile dashboard carried is
 * still here — the threat model, the match feed, the intake strip — but under
 * sections a coach navigates to rather than scrolls past. None of those
 * components changed; only where they are mounted did.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

export function Workspace({
  onOpenMoment,
  onAddGame,
  onOpenGame,
}: {
  onOpenMoment: (m: Moment) => void;
  onAddGame?: () => void;
  /** Open an added game's report, by workspace key. */
  onOpenGame?: (key: string) => void;
}) {
  const [section, setSection] = useState<Section>("brief");

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [section]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        active={section}
        onSelect={setSection}
        team={TEAM}
        squad="First team"
        badge={3}
        onAddGame={onAddGame}
      />

      <main className="min-w-0 flex-1 px-5 pb-24 pt-6 sm:px-8 lg:pb-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            {section === "brief" && <Brief onOpenMoment={onOpenMoment} />}
            {section === "tape" && <Tape />}
            {section === "games" && (
              <Games onOpenGame={onOpenGame} onAddGame={onAddGame} />
            )}
            {section === "model" && <Model />}
            {section === "roster" && <Roster />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function Tape() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-[24px] font-medium text-chalk">Tape</h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
        Every box is a player the tracker found in that frame. Where it has no
        frame, nothing is drawn rather than guessed.
      </p>
      <div className="mt-6">
        <TapeRoom />
      </div>
    </div>
  );
}

function Games({
  onOpenGame,
  onAddGame,
}: {
  onOpenGame?: (key: string) => void;
  onAddGame?: () => void;
}) {
  const pressMean = mean(series("press"));
  const poss = series("poss");
  const xg = series("xg");
  const [added, setAdded] = useState<AddedGame[]>([]);

  // Games this machine has run through the pipeline. The service is optional,
  // so a failure here means "none yet" rather than an error: the rest of the
  // page is committed data and renders regardless.
  useEffect(() => {
    let live = true;
    listAdded()
      .then((r) => live && setAdded(r.games))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-[24px] font-medium text-chalk">Your games</h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
        The orange mark is where you pressed; the band is how wide you played.
        Only games whose footage has been through the pipeline open a report.
      </p>

      {/* ── Games this coach added ──────────────────────────────────── */}
      {added.length > 0 && (
        <div className="mt-7">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-medium text-warm-2">
              Added by you
            </h2>
            {onAddGame && (
              <button
                onClick={onAddGame}
                className="text-[13px] text-accent transition-colors hover:brightness-125"
              >
                Add another
              </button>
            )}
          </div>
          <ul className="mt-3.5 overflow-hidden rounded-lg bg-surface ring-1 ring-white/[0.06]">
            {added.map((g) => (
              <li key={g.key}>
                <button
                  onClick={() => onOpenGame?.(g.key)}
                  className="flex w-full items-baseline justify-between gap-4 border-b border-white/[0.05] px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] text-warm">
                      {g.label}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted-2">
                      {g.competition} {g.season} &middot; from {g.team}&rsquo;s
                      bench
                      {g.has_footage ? "" : " · no footage"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-[12px] tabular-nums text-chalk">
                      {g.moments_found}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-2">
                      moments
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="in the graph" value={String(TOTALS.in_graph)} sub="games on record" />
        <Tile label="this campaign" value={String(TOTALS.matches)} sub="analysed end to end" />
        <Tile label="ball kept" value={`${mean(poss).toFixed(0)}%`} sub="across the run" values={poss} />
        <Tile label="chances made" value={mean(xg).toFixed(2)} sub="expected goals a game" values={xg} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MATCHES.map((m, i) => (
          <MatchCard
            key={m.id}
            m={m}
            index={i}
            pressMean={pressMean}
            featured={m.id === FEATURED}
            onOpen={undefined}
          />
        ))}
      </div>

      <p className="mt-5 max-w-3xl text-[12px] leading-relaxed text-muted-2">
        Scorelines cover open play and extra time. Shootouts are excluded
        everywhere, because eight penalties would swamp a match&rsquo;s chance
        count and tell you nothing about how the side played.
      </p>
    </div>
  );
}

function Model() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-[24px] font-medium text-chalk">How it judges</h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
        The part a coach never opens and a judge opens first.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
        <div className="rounded-xl bg-surface p-5 ring-1 ring-white/[0.06]">
          <XtPitch />
        </div>
        <Pipeline />
      </div>
    </div>
  );
}

function Roster() {
  return (
    <div className="mx-auto w-full max-w-2xl pt-6">
      <h1 className="text-[24px] font-medium text-chalk">Roster</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-warm-2">
        Player cards, their clips, and what to work on with each of them.
      </p>
      <p className="mt-4 rounded-xl bg-surface px-4 py-3.5 text-[13px] leading-relaxed text-muted ring-1 ring-white/[0.06]">
        Not built yet. It needs stable player identity across the footage, which
        means persistent track ids rather than the per-frame detection running
        now, so it is deliberately empty instead of showing invented players.
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  values,
}: {
  label: string;
  value: string;
  sub: string;
  values?: number[];
}) {
  return (
    <div className="rounded-xl bg-surface p-4 ring-1 ring-white/[0.06]">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
        {label}
      </span>
      <span className="mt-2 block font-mono text-[24px] leading-none tabular-nums text-chalk">
        {value}
      </span>
      <span className="mt-2 block text-[12px] leading-snug text-muted">{sub}</span>
      {values && (
        <div className="mt-2.5">
          <Sparkline values={values} />
        </div>
      )}
    </div>
  );
}
