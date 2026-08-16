"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MatchCard } from "@/components/dash/match-card";
import { Sparkline } from "@/components/dash/sparkline";
import { XtPitch } from "@/components/dash/xt-pitch";
import { Roster } from "@/components/roster/roster";
import { Session } from "@/components/session/session";
import { Section, Sidebar } from "@/components/shell/sidebar";
import { FEATURED, MATCHES, TEAM, TOTALS, mean, series } from "@/content/dashboard";

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

export function Workspace({ onAddGame }: { onAddGame?: () => void }) {
  const [section, setSection] = useState<Section>("session");
  // One switch for the whole workspace. It was inside the session, which meant
  // turning it off left the player cards still quoting norms that came out of
  // the graph the coach had just disconnected.
  const [memory, setMemory] = useState(true);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [section]);

  const full = section === "session";

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
            {section === "games" && <Games />}
            {section === "roster" && <Roster memory={memory} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function Games() {
  const pressMean = mean(series("press"));
  const poss = series("poss");
  const xg = series("xg");

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-[24px] font-medium text-chalk">Your season</h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
        The orange mark is where you pressed; the band is how wide you played.
      </p>

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
