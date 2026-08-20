//created by kinjal
"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChalkFilters } from "@/components/chalk-filters";
import { PepTalkMark } from "@/components/logo-marks";
import { Align } from "@/components/report/align";
import { FixturePicker } from "@/components/report/fixture-picker";
import { GameReport } from "@/components/report/game-report";
import { Upload } from "@/components/report/upload";
import { Watching } from "@/components/report/watching";
import { Workspace } from "@/components/shell/workspace";
import { GameProvider } from "@/content/game";
import { MOMENTS, Moment } from "@/content/pep";
import { type Fixture, start, upload } from "@/lib/games";

/**
 * The coach's workspace.
 *
 * One screen that matters, and it is the session: the tape pinned on the left,
 * Pep working down the right. Everything that used to be a separate
 * destination is now something he shows during it.
 */

type Stage =
  "dashboard" | "upload" | "fixture" | "align" | "watching" | "report";
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
          >
            <WizardShell stage="upload" onHome={() => setStage("dashboard")}>
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
            </WizardShell>
          </motion.div>
        )}

        {stage === "fixture" && (
          <motion.div
            key="fixture"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <WizardShell stage="fixture" onHome={() => setStage("dashboard")}>
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
            </WizardShell>
          </motion.div>
        )}

        {stage === "align" && (
          <motion.div
            key="align"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <WizardShell stage="align" onHome={() => setStage("dashboard")}>
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
            </WizardShell>
          </motion.div>
        )}

        {stage === "watching" && (
          <motion.div
            key="watching"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <WizardShell stage="watching" onHome={() => setStage("dashboard")}>
              <Watching
                jobId={job}
                onDone={(key) => {
                  // Straight to the dashboard, showing the game they just
                  // added. The pipeline has already pointed `snapshots/active`
                  // at it — that is the last thing it does — but those imports
                  // are static, so only a full document load reads the new
                  // files. `router.push` would keep the current bundle and
                  // render the previous game's data under the new game's name.
                  // Same reload the game switcher does, for the same reason.
                  if (key) {
                    window.location.reload();
                    return;
                  }
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
            </WizardShell>
          </motion.div>
        )}

        {stage === "report" && (
          <motion.div
            key="report"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="px-4 pt-4 sm:px-6"
          >
            {/* The session's own header, so a report opened from an added game
                sits in the same chrome as the one on the dashboard. */}
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-surface/40 px-4 py-3 ring-1 ring-white/[0.05]">
              <span className="flex items-center gap-2">
                <PepTalkMark size={18} className="text-chalk" />
                <span className="font-display text-[13px] text-chalk">Pep</span>
                <span className="font-mono text-[10px] tracking-[0.1em] text-muted-2 uppercase">
                  your game
                </span>
              </span>
              <button
                onClick={() => setStage("dashboard")}
                className="font-mono text-[10px] text-muted transition-colors hover:text-chalk"
              >
                &larr; dashboard
              </button>
            </div>
            <GameProvider gameKey={gameKey}>
              <GameReport
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

/** The four screens that add a game, in the order a coach meets them. */
const WIZARD: Stage[] = ["upload", "fixture", "align", "watching"];

/**
 * The chrome the add-a-game screens sit in.
 *
 * The same header the session uses — the mark, the name, a position on the
 * right — so adding your own game reads as the product you were already in
 * rather than a form bolted onto the side of it. The way home lives here too:
 * a coach who cannot get back to the dashboard is stuck.
 */
function WizardShell({
  stage,
  onHome,
  children,
}: {
  stage: Stage;
  onHome: () => void;
  children: React.ReactNode;
}) {
  const step = WIZARD.indexOf(stage);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-4 sm:px-6">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surface/40 px-4 py-3 ring-1 ring-white/[0.05]">
        <span className="flex items-center gap-2">
          <PepTalkMark size={18} className="text-chalk" />
          <span className="font-display text-[13px] text-chalk">Pep</span>
          <span className="font-mono text-[10px] tracking-[0.1em] text-muted-2 uppercase">
            adding a game
          </span>
        </span>
        <span className="flex items-center gap-3">
          {step >= 0 && (
            <span className="font-mono text-[10px] tabular-nums text-muted-2">
              {step + 1}/{WIZARD.length}
            </span>
          )}
          <button
            onClick={onHome}
            className="font-mono text-[10px] text-muted transition-colors hover:text-chalk"
          >
            &larr; dashboard
          </button>
        </span>
      </div>
      <div className="pt-10">{children}</div>
    </div>
  );
}
