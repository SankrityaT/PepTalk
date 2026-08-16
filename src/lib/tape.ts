import tracking from "@/content/snapshots/wc-tracking.json";

/**
 * The tracking, shared.
 *
 * Both the full player and the small looping clips need to answer the same
 * question — "which players were on screen at this instant" — so the lookup
 * and the staleness rule live here rather than being copied and drifting.
 */

export type Player = { box: number[]; team: number };
export type Frame = { idx: number; t: number; grass: number; players: Player[] };

const TAPE = tracking as unknown as {
  source: string;
  video: string;
  frames: Frame[];
  detections: number;
  excluded_non_team: number;
};

export const FRAMES = TAPE.frames;
export const VIDEO = TAPE.video;
export const SOURCE = TAPE.source;
export const DETECTIONS = TAPE.detections;
export const OFFICIALS = TAPE.excluded_non_team;
export const DURATION = FRAMES.length ? FRAMES[FRAMES.length - 1].t : 90;

/** Lighter kit is team 0 by construction. On this match: Argentina. */
export const KIT = ["#7ec8f0", "var(--color-accent)"] as const;

/**
 * How far the nearest tracked frame may be from the video's current time
 * before we refuse to draw.
 *
 * Broadcast cuts in a single frame, so without this the last wide shot's
 * positions get painted over a close-up and the boxes land on the crowd —
 * which is exactly what happened. Drawing nothing is the honest answer: the
 * system has not seen this frame.
 */
export const MAX_STALENESS_S = 0.16;

export function nearestFrame(t: number): Frame | null {
  if (!FRAMES.length) return null;
  let lo = 0;
  let hi = FRAMES.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (FRAMES[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = FRAMES[Math.max(0, lo - 1)];
  const b = FRAMES[lo];
  const best = Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
  return Math.abs(best.t - t) <= MAX_STALENESS_S ? best : null;
}

export function clock(t: number): string {
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(
    Math.floor(t % 60),
  ).padStart(2, "0")}`;
}

/**
 * Segments of the clip worth showing as highlights.
 *
 * Picked by scanning every seven-second window and keeping only those with no
 * tracking gap wider than `MAX_STALENESS_S` — then ranking what survives by
 * mean player count. 59 of the windows qualify.
 *
 * Two wrong measures were tried first, and both failed the same way. Choosing
 * by eye put a card on a close-up of two players arguing. Choosing by *peak*
 * count then rewarded a window containing one good frame surrounded by holes,
 * so the card sat there reading "no tracking" — the staleness guard doing its
 * job and looking like a bug. The gap constraint is the one that matters: a
 * card must never be caught mid-hole.
 *
 *   0.0– 7.0s  mean 14.3, min 11, max gap 0.17s
 *  13.5–20.5s  mean 15.1, min 11, max gap 0.17s
 *  66.3–73.3s  mean 11.2, min  9, max gap 0.17s
 */
export const CLIPS = [
  { id: 0, from: 0.0, to: 7.0, label: "Building from the back" },
  { id: 1, from: 13.5, to: 20.5, label: "Into the final third" },
  { id: 2, from: 66.3, to: 73.3, label: "Late in the half" },
] as const;

/** Peak tracked count across a segment — a real figure, not an estimate. */
export function peakTracked(from: number, to: number): number {
  let peak = 0;
  for (const f of FRAMES) {
    if (f.t >= from && f.t <= to) peak = Math.max(peak, f.players.length);
  }
  return peak;
}
