"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { StreamText } from "@/components/brief/atoms/stream-text";
import { Turn } from "@/components/brief/atoms/turn";
import conceded from "@/content/snapshots/conceded.json";
import { KIT } from "@/content/clip";
import type { FreezePlayer } from "@/content/pep";

/**
 * How the goals went in.
 *
 * Everything else in the brief asks what the side failed to do with the ball.
 * This is the other half, and the half a coach loses sleep over.
 *
 * The read is measured off the freeze frame at the shot: how many bodies were
 * goal side of the ball, how far the nearest one was, how many were in the box.
 * What it will not do is say who should have picked the scorer up. That needs
 * to know who was responsible for whom, which is a coaching decision the data
 * does not carry, so the panel reports positions and lets the coach draw the
 * conclusion.
 *
 * Penalties are deliberately not given a defensive read. "Nearest defender ten
 * yards" for a spot kick is arithmetic about a wall, and it would invite a
 * coach to study a shape that was never being asked to defend.
 */

type Passage = {
  minute: number;
  second: number;
  type: string;
  team: string;
  player: string | null;
  location: number[] | null;
};

type Frame = {
  idx: number;
  t: number;
  grass: number;
  players: { box: number[]; team: number }[];
};

type Goal = {
  key: string;
  clock: string;
  scorer: string;
  kind: string;
  xg: number;
  line: string;
  clip: string | null;
  goal_at?: number;
  frames: Frame[];
  detections: number;
  passage: Passage[];
  freeze: FreezePlayer[];
  defence: {
    from_box: boolean;
    distance_to_goal: number;
    defenders_visible?: number;
    defenders_goal_side?: number;
    nearest_defender_yds?: number;
    defenders_in_box?: number;
  };
};

const DATA = conceded as unknown as {
  team: string;
  match: string;
  goals: Goal[];
};

const MAX_STALENESS_S = 0.14;

function frameAt(frames: Frame[], t: number): Frame | null {
  if (!frames.length) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = frames[Math.max(0, lo - 1)];
  const b = frames[lo];
  const best = Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
  return Math.abs(best.t - t) <= MAX_STALENESS_S ? best : null;
}

function surname(full: string): string {
  const p = full.trim().split(/\s+/);
  return p.length > 1 ? p[p.length - 1] : full;
}

function GoalVideo({ goal }: { goal: Goal }) {
  const video = useRef<HTMLVideoElement>(null);
  const raf = useRef<number>(0);
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);

  const stopAt = goal.goal_at ?? 0;

  useEffect(() => {
    const tick = () => {
      const v = video.current;
      if (v) {
        setT(v.currentTime);
        if (!v.paused && stopAt && v.currentTime >= stopAt) {
          v.pause();
          setPaused(true);
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [stopAt]);

  const frame = frameAt(goal.frames, t);

  const replay = () => {
    const v = video.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
    setPaused(false);
  };

  return (
    <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]">
      <div className="relative aspect-video w-full bg-black">
        <video
          ref={video}
          src={goal.clip ?? undefined}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
          preload="auto"
          autoPlay
          onClick={replay}
        />
        <div className="pointer-events-none absolute inset-0">
          {frame?.players.map((p, i) => (
            <span
              key={i}
              className="absolute border"
              style={{
                left: `${p.box[0] * 100}%`,
                top: `${p.box[1] * 100}%`,
                width: `${(p.box[2] - p.box[0]) * 100}%`,
                height: `${(p.box[3] - p.box[1]) * 100}%`,
                borderColor: KIT[p.team] ?? "rgba(255,255,255,0.4)",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
              }}
            />
          ))}
        </div>

        <span className="pointer-events-none absolute top-3 left-3 rounded bg-black/75 px-2 py-1 font-mono text-[10px] tabular-nums text-chalk backdrop-blur-sm">
          {frame ? `${frame.players.length} tracked` : "no tracking"}
        </span>

        <AnimatePresence>
          {paused && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute top-3 right-3 rounded bg-accent px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-canvas uppercase"
            >
              in the net
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <span className="font-mono text-[10px] text-muted-2">
          {goal.detections.toLocaleString()} detections &middot; build up from{" "}
          {goal.passage[0]?.minute}:{String(goal.passage[0]?.second ?? 0).padStart(2, "0")}
        </span>
        <button
          onClick={replay}
          className="rounded-lg bg-white/[0.05] px-2.5 py-1.5 font-mono text-[10px] text-warm transition-colors hover:bg-white/[0.11] hover:text-chalk"
        >
          run it again
        </button>
      </div>
    </div>
  );
}

/** The passage that produced it, as a chain a coach can follow. */
function Passage({ passage }: { passage: Passage[] }) {
  const moves = passage.filter((p) => p.type === "Pass" || p.type === "Carry");
  if (moves.length < 2) return null;
  return (
    <div className="mt-3 border-t border-white/[0.05] pt-3">
      <span className="font-mono text-[10px] tracking-[0.12em] text-muted-2 uppercase">
        how it arrived
      </span>
      <ol className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        {moves.map((p, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="font-mono text-[10px] text-muted-2">&rarr;</span>}
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                p.team === DATA.team
                  ? "bg-white/[0.07] text-warm-2"
                  : "bg-accent/12 text-accent"
              }`}
            >
              {p.player ? surname(p.player) : p.type}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Conceded({ onDone }: { onDone?: () => void }) {
  const goals = DATA.goals;
  const [shown, setShown] = useState(1);
  const withClip = goals.filter((g) => g.clip).length;

  return (
    <div className="flex flex-col gap-3.5">
      <Turn>
        <p className="text-[15px] leading-relaxed text-warm">
          <StreamText
            text={`You conceded three, all of them to the same man. Two were penalties, so the defending that mattered happened before the whistle. ${
              withClip === 1 ? "One was open play, and I have the footage." : ""
            }`}
            onDone={() => setShown(goals.length)}
          />
        </p>
      </Turn>

      {goals.slice(0, shown).map((g, i) => (
        <Turn key={g.key} showWho={false}>
          <div className="rounded-xl bg-surface p-3.5 ring-1 ring-white/[0.06]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] tabular-nums text-accent">
                  {g.clock}
                </span>
                <span className="text-[13px] font-medium text-chalk">
                  {surname(g.scorer)}
                </span>
                <span className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-muted uppercase">
                  {g.kind}
                </span>
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-2">
                {g.xg.toFixed(2)} xG
              </span>
            </div>

            <p className="mt-2 text-[14px] leading-relaxed text-warm">{g.line}</p>

            {g.clip && (
              <div className="mt-3">
                <GoalVideo goal={g} />
              </div>
            )}

            {g.defence.defenders_in_box !== undefined && (
              <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-muted">
                {g.defence.defenders_in_box} of yours in the box &middot;{" "}
                {g.defence.defenders_goal_side} goal side of the ball &middot;
                nearest {g.defence.nearest_defender_yds} yds
              </p>
            )}

            <Passage passage={g.passage} />
          </div>
        </Turn>
      ))}

      {shown >= goals.length && (
        <Turn showWho={false}>
          <p className="text-[14px] leading-relaxed text-warm-2">
            <StreamText
              text="The open play one was a one two straight through the line. He went wide, gave it, and was through on the return before anyone turned."
              onDone={onDone}
            />
          </p>
        </Turn>
      )}
    </div>
  );
}
