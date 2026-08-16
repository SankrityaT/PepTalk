import snapshot from "./snapshots/timelines.json";

/**
 * Full era timelines, per team, per dimension.
 *
 * Captured from the running graph rather than authored. Where `compare-barcelona`
 * holds two sampled points, this holds every era boundary the graph knows about,
 * which is what the scrubber needs: you cannot drag through history you did not
 * fetch.
 *
 * Werder Bremen is in here deliberately. Four matches, zero facts. It is the
 * abstention case, and it exists so the interface can be shown refusing to
 * answer rather than described as capable of refusing.
 */

/** The graph's sentinel for "still true". Mirrors temporal.OPEN_ENDED. */
export const OPEN_ENDED = 99_999_999;

export type Era = {
  id: number;
  band: string;
  valid_from: number;
  valid_to: number;
  observations: number;
  median_value: number | null;
  from_iso: string;
  /** ISO date, or the literal "present". */
  to_iso: string;
  open_ended: boolean;
  cited: string[];
};

export type DimensionTimeline = {
  evidence: number;
  sufficient: boolean;
  eras: Era[];
};

export type TeamTimeline = {
  team: string;
  team_id: number;
  matches: number;
  first_match: string | null;
  last_match: string | null;
  dimensions: Record<string, DimensionTimeline>;
};

type Snapshot = {
  captured_at: string;
  source: string;
  dimensions: { key: string; label: string }[];
  teams: Record<string, TeamTimeline>;
};

const data = snapshot as unknown as Snapshot;

export const CAPTURED_AT = data.captured_at;
export const DIMENSIONS = data.dimensions;
export const TEAMS = Object.values(data.teams);

export function team(name: string): TeamTimeline | undefined {
  return data.teams[name];
}

/**
 * Proleptic Gregorian ordinal <-> Date, matching Python's date.toordinal().
 *
 * Anchored on the Unix epoch, which is ordinal 719163, rather than on year 1.
 * `Date.UTC(1, 0, 1)` does NOT mean 0001-01-01 — JavaScript maps two-digit
 * years onto 1900-1999, so it silently yields 1901 and every date lands
 * nineteen centuries adrift. That bug rendered every era as a sliver at the
 * right-hand edge and made the whole timeline read "no record".
 */
const DAY_MS = 86_400_000;
const UNIX_EPOCH_ORDINAL = 719_163;

export function ordinalToDate(ord: number): Date {
  return new Date((ord - UNIX_EPOCH_ORDINAL) * DAY_MS);
}

export function ordinalToYear(ord: number): number {
  return ordinalToDate(ord).getUTCFullYear();
}

export function dateToOrdinal(d: Date): number {
  return Math.round(d.getTime() / DAY_MS) + UNIX_EPOCH_ORDINAL;
}

export function isoToOrdinal(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return dateToOrdinal(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * The window the scrubber spans for a team.
 *
 * Clamped to the team's own matches rather than a fixed range: Barcelona runs
 * 1974-2021, Manchester City's women run 2018-2024, and a shared axis would
 * leave most teams as a sliver.
 */
export function timelineBounds(t: TeamTimeline): { lo: number; hi: number } {
  const lo = t.first_match ? isoToOrdinal(t.first_match) : 0;
  const hi = t.last_match ? isoToOrdinal(t.last_match) : lo + 365;
  return { lo, hi: Math.max(hi, lo + 365) };
}

/** The era covering a date, or null when the graph holds nothing there. */
export function eraAt(eras: Era[], ord: number): Era | null {
  return eras.find((e) => e.valid_from <= ord && ord < e.valid_to) ?? null;
}

/** Position of an ordinal within the bounds, as a 0-1 fraction. */
export function fraction(ord: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  return Math.min(1, Math.max(0, (ord - lo) / (hi - lo)));
}

/** An era's visible extent, clamped so open-ended eras do not run to infinity. */
export function eraExtent(e: Era, lo: number, hi: number) {
  const start = fraction(Math.max(e.valid_from, lo), lo, hi);
  const end = fraction(Math.min(e.valid_to, hi), lo, hi);
  return { start, width: Math.max(0.004, end - start) };
}

/**
 * Bands, in the order a coach would rank them, so the scrubber can render
 * intensity consistently across dimensions that use different words.
 */
const BAND_RANK: Record<string, number> = {
  low: 0, deep: 0, narrow: 0, patient: 0,
  even: 1, mid: 1, balanced: 1, mixed: 1,
  dominant: 2, high: 2, wide: 2, direct: 2,
};

export function bandRank(band: string): number {
  return BAND_RANK[band] ?? 1;
}

export const DIMENSION_UNIT: Record<string, string> = {
  possession_share_pct: "%",
  press_height: "m",
  defensive_action_height: "m",
  team_width: "m",
  pass_forward_ratio: "",
};

/**
 * How a band reads in a sentence. The scrubber is for a coach, not a schema
 * browser, so "holds the ball" beats "possession_share_pct: dominant".
 */
const PHRASE: Record<string, Record<string, string>> = {
  possession_share_pct: {
    dominant: "Dominates the ball",
    even: "Shares the ball",
    low: "Cedes the ball",
  },
  press_height: {
    high: "Presses high up the pitch",
    mid: "Presses from midfield",
    deep: "Drops off and presses deep",
  },
  defensive_action_height: {
    high: "Defends with a high line",
    mid: "Holds a middle line",
    deep: "Defends deep",
  },
  team_width: {
    wide: "Stretches the pitch wide",
    balanced: "Keeps a balanced width",
    narrow: "Plays narrow",
  },
  pass_forward_ratio: {
    direct: "Plays direct",
    mixed: "Mixes direct and patient",
    patient: "Builds patiently",
  },
};

export function bandPhrase(dimension: string, band: string): string {
  return PHRASE[dimension]?.[band] ?? band;
}
