"use client";

import { useState } from "react";
import { StreamText } from "@/components/brief/atoms/stream-text";
import { Turn } from "@/components/brief/atoms/turn";
import conceded from "@/content/snapshots/conceded.json";
import { TapePlayer } from "@/components/tape/tape-player";
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

function surname(full: string): string {
  const p = full.trim().split(/\s+/);
  return p.length > 1 ? p[p.length - 1] : full;
}

function GoalVideo({ goal }: { goal: Goal }) {
  return (
    <TapePlayer
      src={goal.clip ?? ""}
      frames={goal.frames}
      stopAt={goal.goal_at}
      stopLabel="in the net"
      chalkTeam={0}
      seed={goal.clock.length * 13}
    />
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
