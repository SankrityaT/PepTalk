//created by kinjal
"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MatchCard } from "@/components/dash/match-card";
import { Sparkline } from "@/components/dash/sparkline";
import { XtPitch } from "@/components/dash/xt-pitch";
import { Roster } from "@/components/roster/roster";
import { Session } from "@/components/session/session";
import { Section, Sidebar } from "@/components/shell/sidebar";
import { KnowledgeGraph } from "@/components/knowledge/knowledge-graph";
import { FEATURED, HISTORY, MATCHES, TEAM, TOTALS, mean, series } from "@/content/dashboard";
import { type AddedGame, added as listAdded } from "@/lib/games";

/**
 * The workspace.
 *
 * Three places, because a coach only has three: the session they came for,
 * their players, and their season. Everything that used to be a fourth through
 * seventh destination is now something Pep shows inside the session, at the
 * point he has a reason to bring it up.
 *
 * The session gets the whole viewport and manages its own scrolling, since the
 * tape has to stay pinned while the thread moves.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

export function Workspace({
  onAddGame,
  onOpenGame,
}: {
  onAddGame?: () => void;
  /** Open an added game's report, by workspace key. */
  onOpenGame?: (key: string) => void;
}) {
  const [section, setSection] = useState<Section>("session");
  // One switch for the whole workspace. It was inside the session, which meant
  // turning it off left the player cards still quoting norms that came out of
  // the graph the coach had just disconnected.
  const [memory, setMemory] = useState(true);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [section]);

  // The graph wants the whole viewport for the same reason the session does:
  // it is a canvas, and a canvas in a scrolling column gets whatever height is
  // left over, which was about half of one.
  const full = section === "session" || section === "memory";

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

      <main
        className={`min-w-0 flex-1 px-4 pb-24 sm:px-6 lg:pb-4 ${
          full ? "pt-4 lg:overflow-hidden" : "pt-6"
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className={full ? "h-full" : ""}
          >
            {section === "session" && (
              <Session memory={memory} onMemory={setMemory} />
            )}
            {section === "games" && (
              <Games onOpenGame={onOpenGame} onAddGame={onAddGame} />
            )}
            {section === "memory" && <KnowledgeGraph />}
            {section === "roster" && <Roster memory={memory} />}
          </motion.div>
        </AnimatePresence>
      </main>
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
      <h1 className="text-[24px] font-medium text-chalk">Your season</h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
        The orange mark is where you pressed; the band is how wide you played.
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

      {/* The whole record, because "22 games on record" above seven cards is a
          number nobody can check, and this build has no graph behind it to go
          and look. The seven with tape are marked; the rest are what the norms
          are built from. */}
      {HISTORY.length > 0 && (
        <div className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[15px] font-medium text-chalk">
              Everything in the graph
            </h2>
            <span className="font-mono text-[11px] text-muted-2">
              {HISTORY.length} matches &middot; {HISTORY[HISTORY.length - 1]?.date.slice(0, 4)} to{" "}
              {HISTORY[0]?.date.slice(0, 4)}
            </span>
          </div>

          <div className="mt-3 overflow-hidden rounded-xl ring-1 ring-white/[0.06]">
            {HISTORY.map((h, i) => (
              <div
                key={h.id}
                className={`grid grid-cols-[74px_1fr_auto] items-center gap-3 px-3 py-2 sm:grid-cols-[86px_1fr_60px_54px_auto] ${
                  i % 2 ? "bg-white/[0.015]" : ""
                }`}
              >
                <span className="font-mono text-[10px] tabular-nums text-muted-2">
                  {h.date}
                </span>
                <span className="truncate text-[13px] text-warm">{h.label}</span>
                <span className="hidden font-mono text-[10px] tabular-nums text-muted sm:block">
                  {h.poss.toFixed(0)}%
                </span>
                <span className="hidden font-mono text-[10px] tabular-nums text-muted sm:block">
                  {h.xg.toFixed(2)} xG
                </span>
                {h.analysed ? (
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] text-accent uppercase">
                    tape
                  </span>
                ) : (
                  <span className="font-mono text-[9px] tracking-[0.08em] text-muted-2 uppercase">
                    norm
                  </span>
                )}
              </div>
            ))}
          </div>

          <p className="mt-3 max-w-3xl text-[12px] leading-relaxed text-muted-2">
            Seven were taken apart end to end, with footage cut and moments
            flagged. The rest is what every norm on this page is measured
            against, which is the point of holding them.
          </p>
        </div>
      )}

      <p className="mt-8 max-w-3xl text-[12px] leading-relaxed text-muted-2">
        Scorelines are the real result, shootouts included. The{" "}
        <em className="not-italic text-muted">models</em> exclude penalties,
        because eight of them would swamp a match&rsquo;s chance count and say
        nothing about how a side played, but who won is not a model input.
      </p>

      {/* The model itself, kept here rather than as a destination of its own.
          A judge wants it; a coach never goes looking for it. */}
      <div className="mt-8 rounded-xl bg-surface p-5 ring-1 ring-white/[0.06]">
        <XtPitch />
      </div>
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
      <span className="font-mono text-[10px] tracking-[0.12em] text-muted-2 uppercase">
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
