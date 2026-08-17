import clip from "./snapshots/active/clip-moments.json";
import type { FreezePlayer } from "./pep";

/**
 * The moments, with the footage they actually happened in.
 *
 * This is the piece that was missing for a long time. The flagged moments are
 * spread across a two hour match, and a ninety second clip from minute twenty
 * contained none of them, so the walkthrough could only show a diagram.
 *
 * The fix was to read the broadcast clock out of the overlay and cut the real
 * seconds out of a full match recording. One offset per period, because the
 * half time break is not on the match clock:
 *
 *     period 1   video = match + 96s
 *     period 2   video = match + 599s
 *
 * Every cut was verified by reading its clock back off the first frame: 08:25,
 * 31:25, 63:07, 72:21, with the scoreline progressing 0-0, 1-0, 2-0, 2-0. The
 * pass lands 6 seconds into each clip, so there is a run in before it.
 */

export type TrackedPlayer = { box: number[]; team: number };
export type TrackedFrame = {
  idx: number;
  t: number;
  grass: number;
  players: TrackedPlayer[];
};

export type ClipMoment = {
  id: number;
  key: string;
  /** Public path to the cut footage. */
  clip: string;
  /** Where in the clip the pass happens, in seconds. */
  pass_at: number;
  match_clock: string;
  minute: number;
  player: string;
  surname: string;
  team: string;
  line: string;
  numbers: string;
  played_zone: string;
  best_zone: string;
  played_value: number;
  best_value: number;
  played_backwards: boolean;
  times_better: number | null;
  played_completion: number;
  best_completion: number;
  best_defenders: number;
  best_distance: number;
  difficulty: "straightforward" | "tight" | "hard";
  no_riskier: boolean;
  from: [number, number];
  played_to: [number, number];
  best_to: [number, number];
  missed: number;
  freeze: FreezePlayer[];
  side: "attacking" | "defending";
  frames: TrackedFrame[];
  detections: number;
};

const DATA = clip as unknown as {
  match_id: number;
  source: string;
  moments: ClipMoment[];
};

export const CLIP_MOMENTS = DATA.moments;

/** Lighter kit is team 0 by construction. On this match: Argentina. */
export const KIT = ["#7ec8f0", "var(--color-accent)"] as const;

/**
 * How far the nearest tracked frame may be from the video's current time
 * before we refuse to draw. Without it the last good frame's boxes get painted
 * over a cut and land on the crowd.
 */
export const MAX_STALENESS_S = 0.14;

export function frameAt(m: ClipMoment, t: number): TrackedFrame | null {
  const f = m.frames;
  if (!f.length) return null;
  let lo = 0;
  let hi = f.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (f[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = f[Math.max(0, lo - 1)];
  const b = f[lo];
  const best = Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
  return Math.abs(best.t - t) <= MAX_STALENESS_S ? best : null;
}

/** Clip time back to the match clock, for the badge over the video. */
export function clockAt(m: ClipMoment, t: number): string {
  const [mm, ss] = m.match_clock.split(":").map(Number);
  const s = Math.max(0, Math.round(mm * 60 + ss + (t - m.pass_at)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
