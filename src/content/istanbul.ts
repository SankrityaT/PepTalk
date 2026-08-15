import snapshot from "./snapshots/istanbul.json";

/**
 * The worked example: Istanbul, 25 May 2005.
 *
 * One match followed end to end through the whole system, because four
 * separate sections each proving one component is worse for a judge with
 * three minutes than one section showing the machine actually run.
 *
 * Every figure comes from /api/deviation/Liverpool/2302764 on the running
 * graph. Liverpool's "normal" is the era fact the graph held for them at
 * that date, derived from 44 matches; the match values are what they
 * actually did in the first half. Nothing here is authored.
 *
 * The payload is the reason this match leads: Liverpool came back from
 * three down by pressing LOWER and dropping DEEPER than their own norm.
 * The naive answer, attack harder when losing, is the opposite of what
 * worked, so a system that reproduces it is not reciting truisms.
 */

export type Deviation = {
  dimension: string;
  normal_band: string;
  normal_value: number;
  match_value: number;
  delta: number;
  fact_id: number;
  era_matches: number;
};

const data = snapshot as unknown as {
  captured_at: string;
  graph_facts: number;
  match: {
    label: string;
    date: string;
    competition: string;
    possession_share_pct: number;
    press_height: number;
    defensive_action_height: number;
    team_width: number;
    pass_forward_ratio: number;
    shots: number;
    xg: number;
    source: string;
  };
  deviations: Deviation[];
};

export const ISTANBUL = data.match;
export const GRAPH_FACTS = data.graph_facts;

/** Human labels for the dimensions this section shows. */
export const DIMENSION_LABEL: Record<string, string> = {
  press_height: "Press height",
  defensive_action_height: "Defensive line",
  possession_share_pct: "Possession",
  team_width: "Width",
  pass_forward_ratio: "Directness",
};

export const DIMENSION_UNIT: Record<string, string> = {
  press_height: "m",
  defensive_action_height: "m",
  possession_share_pct: "%",
  team_width: "m",
  pass_forward_ratio: "",
};

/**
 * Deviations worth showing, largest movement first.
 *
 * Width and directness moved by a quarter of a metre and four hundredths
 * respectively, which is noise. Showing all five would bury the two that
 * carry the finding, so the section shows the movers and states the count
 * of what it left out rather than silently dropping them.
 */
export const SIGNIFICANT_DEVIATIONS: Deviation[] = data.deviations
  .filter((d) => Math.abs(d.delta) >= 1)
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

export const OMITTED_DEVIATIONS = data.deviations.length - SIGNIFICANT_DEVIATIONS.length;

/** Stage copy for the pipeline. One match, four steps. */
export const PIPELINE = [
  {
    n: "01",
    key: "ingest",
    title: "Watch the half",
    body: "Event data or tracked footage, it makes no difference downstream. Both emit the same match state: where the press triggered, how high the line sat, how wide the shape was, who had the ball.",
    note: "Computer vision plugs into an interface that already exists, so the graph never waited on it.",
  },
  {
    n: "02",
    key: "state",
    title: "Reduce it to state",
    body: "Five measurements, taken the same way for every match in the set. No human tags a single event.",
    note: null,
  },
  {
    n: "03",
    key: "memory",
    title: "Ask what is normal for this team",
    body: "The graph returns the facts it held about Liverpool on that date, not today's. Each one carries the window it was true for and the matches it came from.",
    note: "This is the part a vector store cannot do. Similarity finds a near neighbour; it cannot tell you a fact expired.",
  },
  {
    n: "04",
    key: "read",
    title: "Compare, then say something",
    body: "The deviation from a team's own norm is the signal. A frontier model writes the halftime read from these dated, cited facts, and below the evidence threshold it declines rather than inventing a scouting report.",
    note: null,
  },
] as const;
