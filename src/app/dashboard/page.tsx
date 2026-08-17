//created by kinjal
"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChalkFilters } from "@/components/chalk-filters";
import { Align } from "@/components/report/align";
import { FixturePicker } from "@/components/report/fixture-picker";
import { MomentClip, hasClip } from "@/components/report/moment-clip";
import { MomentFrame } from "@/components/report/moment-frame";
import { MomentPitch } from "@/components/report/moment-pitch";
import { PepFeed } from "@/components/report/pep-feed";
import { TapeRoom } from "@/components/report/tape-room";
import { ThisWeek } from "@/components/report/this-week";
import { Upload } from "@/components/report/upload";
import { VersusUsual } from "@/components/report/versus-usual";
import { Watching } from "@/components/report/watching";
import { Workspace } from "@/components/shell/workspace";
import { GameProvider, byPlayerIn, useGame } from "@/content/game";
import { MOMENTS, Moment, surname } from "@/content/pep";
import { type Fixture, start, upload } from "@/lib/games";

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

type Stage =
  | "dashboard"
  | "upload"
  | "fixture"
  | "align"
  | "watching"
  | "report";
const EASE = [0.4, 0, 0.2, 1] as const;

export default function ReportPage() {
  const [stage, setStage] = useState<Stage>("dashboard");
  const [roster, setRoster] = useState<string[]>([]);
  const [selected, setSelected] = useState<Moment | null>(MOMENTS[0] ?? null);

  // The upload, carried across the wizard.
  const [file, setFile] = useState<File | null>(null);
  const [video, setVideo] = useState<string>("");
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [team, setTeam] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Whether the footage is a continuous recording with a clock worth reading.
  // A highlights reel is not, so it never sees the alignment step.
  const [alignable, setAlignable] = useState(true);

  // Which game the report shows. Null is the committed example.
  const [gameKey, setGameKey] = useState<string | null>(null);
  const [job, setJob] = useState<string | undefined>();

  // Opening a report from halfway down the dashboard otherwise drops the coach
  // halfway down the report.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [stage]);

  const reset = useCallback(() => {
    setFile(null);
    setVideo("");
    setFixture(null);
    setTeam("");
    setJob(undefined);
    setProgress(0);
    setError(null);
    setSending(false);
  }, []);

  /** Send the footage, then ask which fixture it is. */
  const sendFile = useCallback(async (f: File, names: string[]) => {
    setRoster(names);
    setFile(f);
    setSending(true);
    setError(null);
    try {
      const up = await upload(f, setProgress);
      setVideo(up.video);
      // A short reel has no match clock to read, so the alignment step is
      // skipped rather than shown asking for frames that do not exist.
      setAlignable(up.alignable);
      setStage("fixture");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }, []);

  /** Kick off the run, with or without footage alignment.
   *
   * The fixture and side are passed in rather than read from state, because
   * the picker starts the run in the same tick it chooses them and would
   * otherwise send the previous selection.
   */
  const begin = useCallback(
    async (
      offsets?: { first: number; second: number },
      pick?: { fixture: Fixture; side: string; withFootage?: boolean },
    ) => {
      const f = pick?.fixture ?? fixture;
      const side = pick?.side ?? team;
      if (!f) return;
      // Send the footage when it is aligned, or when the caller has said to
      // use it unaligned. Passed in rather than read from state, which would
      // still hold the previous value in this tick.
      const withFootage = pick?.withFootage ?? !alignable;
      try {
        const { job } = await start({
          matchId: f.match_id,
          team: side,
          video: offsets || withFootage ? video : undefined,
          firstOffset: offsets?.first,
          secondOffset: offsets?.second,
        });
        setJob(job);
        setStage("watching");
      } catch (e) {
        setError((e as Error).message);
        setStage("upload");
      }
    },
    [fixture, team, video, alignable],
  );

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
                setGameKey(null);
                setStage("report");
              }}
              onAddGame={() => {
                reset();
                setStage("upload");
              }}
              onOpenGame={(key) => {
                setGameKey(key);
                setSelected(null);
                setStage("report");
              }}
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
              busy={sending}
              progress={progress}
              error={error}
              onStart={sendFile}
              onExample={(names) => {
                setRoster(names);
                setGameKey(null);
                setJob(undefined);
                setStage("watching");
              }}
            />
          </motion.div>
        )}

        {stage === "fixture" && (
          <motion.div
            key="fixture"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="px-5 pt-14 sm:px-8"
          >
            <BackTo onClick={() => setStage("dashboard")} />
            <FixturePicker
              filename={file?.name}
              lastStep={!alignable}
              onBack={() => setStage("upload")}
              onPick={(f, side) => {
                setFixture(f);
                setTeam(side);
                // Alignment only means something for a continuous recording.
                // A reel goes straight to the run and gets excerpts.
                if (alignable) {
                  setStage("align");
                } else {
                  begin(undefined, { fixture: f, side, withFootage: true });
                }
              }}
            />
          </motion.div>
        )}

        {stage === "align" && (
          <motion.div
            key="align"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="px-5 pt-14 sm:px-8"
          >
            <BackTo onClick={() => setStage("dashboard")} />
            <Align
              video={video}
              onBack={() => setStage("fixture")}
              onDone={(first, second) => begin({ first, second })}
              // No footage at all: the report still has every moment.
              onSkip={() =>
                fixture &&
                begin(undefined, { fixture, side: team, withFootage: false })
              }
              // Footage without alignment: excerpts beside each moment.
              onUseAnyway={() =>
                fixture &&
                begin(undefined, { fixture, side: team, withFootage: true })
              }
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
            className="px-5 py-10 sm:px-8"
          >
            <Watching
              jobId={job}
              onDone={(key) => {
                if (key) setGameKey(key);
                setSelected(null);
                setStage("report");
              }}
              onFailed={setError}
            />
            {error && (
              <div className="mx-auto mt-8 w-full max-w-2xl">
                <button
                  onClick={() => setStage("upload")}
                  className="text-[15px] text-warm-2 underline decoration-white/20 underline-offset-4 transition-colors hover:text-chalk hover:decoration-white/50"
                >
                  Try another game
                </button>
              </div>
            )}
          </motion.div>
        )}

        {stage === "report" && (
          <motion.div
            key="report"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="mx-auto w-full max-w-5xl px-5 sm:px-8"
          >
            <BackTo onClick={() => setStage("dashboard")} />
            <GameProvider gameKey={gameKey}>
              <Report
                roster={roster}
                selected={selected}
                onSelect={setSelected}
              />
            </GameProvider>
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
  const game = useGame();
  const moments = game.moments;
  const players = byPlayerIn(moments);
  const named = new Set(roster.map((r) => surname(r).toLowerCase()));
  // A game added this session has no committed tape; the example does.
  const isExample = game.key === null;

  // Land on something rather than an empty panel.
  const shown = selected ?? moments[0] ?? null;

  if (game.loading) {
    return (
      <p className="py-24 text-center text-[15px] text-muted">
        Opening your report&hellip;
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-20">
      {/* ── Greeting ────────────────────────────────────────────────── */}
      <header>
        <p className="text-[13px] text-muted-2">
          {game.competition} &middot; {game.date}
        </p>
        <h1 className="mt-2 text-[30px] leading-tight font-medium text-chalk sm:text-[40px]">
          Here&rsquo;s your game.
        </h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-warm-2">
          {moments.length === 0
            ? "Pep watched all of it and nothing crossed the bar worth stopping the tape for. That is a result, not an error."
            : `Pep watched all of it. The short version: you kept turning back when the box was open. ${moments.length} times worth showing the group.`}
        </p>
        {game.error && (
          <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-muted">
            Showing the example match: {game.error}
          </p>
        )}
      </header>

      {/* ── The tape ────────────────────────────────────────────────── */}
      {/* First, because it is the thing being talked about. A coach who scrolls
          into a set of diagrams without seeing the footage they came from has
          been handed homework. */}
      {isExample && (
        <section>
          <TapeRoom />
        </section>
      )}

      {/* ── The point of the whole thing ────────────────────────────── */}
      {game.themes.length > 0 && <ThisWeek onSelect={onSelect} />}

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
            {/* The footage first when there is any: a coach recognises their
                game from the picture of it. The freeze frame is the fallback
                and is still the evidence — it shows who was open. */}
            {hasClip(shown) ? (
              <div className="flex flex-col gap-5">
                <MomentClip moment={shown!} />
                {/* Always kept alongside the footage, never replaced by it.
                    The freeze frame is the evidence — it shows who was open —
                    and for an excerpt it is the only thing on screen that is
                    actually this moment. */}
                {shown?.freeze?.length ? (
                  <MomentFrame moment={shown} />
                ) : (
                  <MomentPitch moment={shown} />
                )}
              </div>
            ) : shown?.freeze?.length ? (
              <MomentFrame moment={shown} />
            ) : (
              <MomentPitch moment={shown} />
            )}
            {shown && (
              <>
                <p className="mt-5 text-[16px] leading-relaxed text-warm">
                  {shown.line}
                </p>
                <p className="mt-2 font-mono text-[11px] text-muted-2">
                  {shown.minute}&rsquo; &middot; {surname(shown.player)}{" "}
                  &middot; {shown.freeze?.length ?? 0} players tracked
                </p>
              </>
            )}
          </div>

          <div className="max-h-[32rem] overflow-hidden rounded-lg bg-surface ring-1 ring-white/[0.06]">
            <PepFeed selected={shown?.id ?? null} onSelect={onSelect} />
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

      {/* Reads a committed memory snapshot, so it only has an answer for the
          example match's sides. Rather than render an empty panel for a game
          it knows nothing about, it is left out. */}
      {isExample && <VersusUsual team="Argentina" />}

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
        {game.writtenBy === "numbers" && (
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-muted-2">
            The wording of these lines was computed from the same figures rather
            than written by the model, because no API key was set when this ran.
            The moments and the numbers are unaffected.
          </p>
        )}
      </footer>
    </div>
  );
}
