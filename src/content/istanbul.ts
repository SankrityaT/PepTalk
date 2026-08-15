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

export type MemoryFact = {
  fact_id: number;
  dimension: string;
  label: string;
  band: string;
  valid_from: string;
  valid_to: string;
  observations: number;
  median_value: number;
  cited_matches: string[];
};

const data = snapshot as unknown as {
  captured_at: string;
  graph_facts: number;
  opponent_memory: {
    team: string;
    as_of: string;
    sufficient: boolean;
    total_evidence: number;
    facts: MemoryFact[];
  };
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

/**
 * What the graph holds about the opponent at that date.
 *
 * Deliberately not described anywhere as "what we knew before kick-off".
 * These facts carry valid_from 2005-05-25 and cite the final among their
 * source matches, so they are the club's profile as the graph holds it,
 * not a pre-match scouting report. Claiming otherwise would be a leak.
 */
export const OPPONENT_MEMORY = data.opponent_memory;

/** Plain phrasing for an opponent fact, so the screen reads like a product. */
const BAND_PHRASE: Record<string, Record<string, string>> = {
  possession_share_pct: { dominant: "Keeps the ball", even: "Shares the ball", low: "Plays without it" },
  press_height: { high: "Presses high", mid: "Presses from midfield", low: "Sits off" },
  defensive_action_height: { high: "High line", mid: "Middle block", low: "Deep block" },
  team_width: { wide: "Stretches the pitch", balanced: "Balanced shape", narrow: "Plays narrow" },
  pass_forward_ratio: { direct: "Goes direct", mixed: "Mixes it", patient: "Builds patiently" },
};

export function bandPhrase(dimension: string, band: string): string {
  return BAND_PHRASE[dimension]?.[band] ?? band;
}

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

/**
 * The pipeline, as a strip rather than four paragraphs.
 *
 * Explaining each stage in prose was the page telling a judge how the
 * product works instead of showing it working. The halftime screen does
 * that job; this is just the spine, so the order stays legible.
 */
export const PIPELINE_STRIP = ["Footage", "State", "Memory", "Read"] as const;
