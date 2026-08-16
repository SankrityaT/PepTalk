"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Brief } from "@/components/brief/brief";
import { Conceded } from "@/components/brief/conceded";
import { Walkthrough } from "@/components/brief/walkthrough";
import { KnowledgeView } from "@/components/memory/knowledge-view";
import { TapeRoom } from "@/components/report/tape-room";
import { MatchCard } from "@/components/dash/match-card";
import { Pipeline } from "@/components/dash/pipeline";
import { Sparkline } from "@/components/dash/sparkline";
import { XtPitch } from "@/components/dash/xt-pitch";
import { Section, Sidebar } from "@/components/shell/sidebar";
import { FEATURED, MATCHES, TEAM, TOTALS, mean, series } from "@/content/dashboard";
import { Moment } from "@/content/pep";

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
}: {
  onOpenMoment: (m: Moment) => void;
  onAddGame?: () => void;
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
            {section === "brief" && (
              <Brief
                onOpenMoment={onOpenMoment}
                onReview={() => setSection("watch")}
              />
            )}
            {section === "watch" && <Watch />}
            {section === "knows" && <KnowledgeView />}
            {section === "games" && <Games />}
            {section === "model" && <Model />}
            {section === "roster" && <Roster />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

/**
 * One place to watch the game.
 *
 * Review, Goals against and Tape were three separate nav rows that all meant
 * "look at the footage", and a coach could not tell from the labels which was
 * which. They are tabs now.
 */
function Watch() {
  const [tab, setTab] = useState<"moments" | "goals" | "passage">("moments");
  const tabs = [
    { k: "moments", label: "Moments", hint: "balls that were on" },
    { k: "goals", label: "Goals against", hint: "how they went in" },
    { k: "passage", label: "Full passage", hint: "90 seconds, tracked" },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <h1 className="text-[24px] font-medium text-chalk">Watch the game</h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
        Footage on the left, Pep beside it. He stops on the things worth
        stopping on.
      </p>

      <div className="mt-5 flex flex-wrap gap-1.5 border-b border-white/[0.07] pb-3">
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`rounded-lg px-3 py-2 text-left transition-colors ${
              tab === t.k
                ? "bg-white/[0.08] text-chalk"
                : "text-warm-2 hover:bg-white/[0.04] hover:text-chalk"
            }`}
          >
            <span className="block text-[13px] font-medium">{t.label}</span>
            <span className="block font-mono text-[10px] text-muted-2">
              {t.hint}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "moments" && <Walkthrough />}
        {tab === "goals" && <Conceded />}
        {tab === "passage" && <TapeRoom />}
      </div>
    </div>
  );
}

function Games() {
  const pressMean = mean(series("press"));
  const poss = series("poss");
  const xg = series("xg");

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-[24px] font-medium text-chalk">Your games</h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
        The orange mark is where you pressed; the band is how wide you played.
        Only games whose footage has been through the pipeline open a report.
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
