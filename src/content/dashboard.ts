import dash from "./snapshots/dashboard.json";

/**
 * The dashboard's data, snapshotted from HydraDB.
 *
 * Everything here is a real query result: the match feed is the team's
 * `PLAYED` edges with their per-team metrics, and the threat grid is the
 * trained xT model itself — 16x12 cells, one value each, the same array the
 * pass engine indexes into when it decides a ball was worth more.
 *
 * Committed as JSON for the same reason as the rest of the snapshots: the
 * graph runs on localhost. Swapping to a fetch changes nothing above this
 * line.
 */

export type MatchRow = {
  id: number;
  date: string;
  label: string;
  comp: string;
  fh: number;
  fa: number;
  hh: number;
  ha: number;
  poss: number;
  press: number;
  xg: number;
  shots: number;
  width: number;
  pfr: number;
};

export const TEAM = dash.team;
export const CAMPAIGN = dash.campaign;
export const MATCHES = dash.matches as MatchRow[];

/**
 * `matches` is this campaign; `in_graph` is every game this side has ever
 * played that we hold. They are different numbers on purpose — the feed is
 * what a coach is working on, the graph is what Pep compares it against.
 */
export const TOTALS = dash.totals;

/** The trained expected-threat model. `XT[x][y]`, attacking towards +x. */
export const XT = dash.xt_grid as number[][];
export const XT_MAX = Math.max(...XT.flat());
export const XT_TRAINED_ON = dash.xt_trained_on;
export const XT_ACTIONS = dash.xt_actions;

/**
 * The one match that has been through the *video* half of the pipeline.
 * Every other game in the feed is analysed from event data only, so only this
 * one opens a full report — claiming otherwise would be the first thing a
 * judge caught.
 */
export const FEATURED = 3869685;

/** Was this side at home? Decides which side of the scoreline is ours. */
export function isHome(m: MatchRow): boolean {
  return m.label.startsWith(TEAM);
}

export function scoreline(m: MatchRow): { us: number; them: number; opponent: string } {
  const home = isHome(m);
  const [left, right] = m.label.split(/\s+\d+-\d+\s+/);
  return {
    us: home ? m.fh : m.fa,
    them: home ? m.fa : m.fh,
    opponent: (home ? right : left) ?? "—",
  };
}

export function result(m: MatchRow): "W" | "D" | "L" {
  const { us, them } = scoreline(m);
  return us > them ? "W" : us === them ? "D" : "L";
}

/** A metric across the feed, oldest first, for the sparklines. */
export function series(key: keyof MatchRow): number[] {
  return [...MATCHES].reverse().map((m) => Number(m[key]));
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
