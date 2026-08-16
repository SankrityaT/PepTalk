import clip from "./snapshots/clip-moments.json";
import type { FreezePlayer } from "./pep";

/**
 * The moments that are actually in the footage.
 *
 * This is the piece that had been missing. The eight headline moments come
 * from the whole match, and none of them fall inside the ninety second clip we
 * hold, so showing them "on the tape" would have meant drawing one passage of
 * play over a different one.
 *
 * The fix was to read the broadcast clock off the overlay: the first frame
 * shows 20:25 and the frame at 88s shows 21:52, which is 87 seconds of match
 * for 87.5 seconds of video. The clip is one continuous real time passage with
 * no cuts, and the offset between video time and match time is 1224.5s.
 *
 * With that, every pass the engine flagged between 20:24 and 21:54 lands at a
 * known second of the video. Seven of them do. The player names come free from
 * the event stream, so no identity model is needed for these.
 */

export type ClipMoment = {
  id: number;
  video_t: number;
  minute: number;
  player: string;
  name: string;
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
};

const DATA = clip as unknown as {
  match_id: number;
  video: string;
  clock_offset_s: number;
  clip_from: string;
  clip_to: string;
  moments: ClipMoment[];
};

export const CLIP_MOMENTS = DATA.moments;
export const CLOCK_OFFSET = DATA.clock_offset_s;
export const CLIP_FROM = DATA.clip_from;
export const CLIP_TO = DATA.clip_to;

/** Match clock at a given point in the video, as the broadcast showed it. */
export function matchClock(videoT: number): string {
  const s = Math.floor(videoT + CLOCK_OFFSET);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
