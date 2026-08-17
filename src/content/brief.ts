import brief from "./snapshots/active/brief.json";
import tracking from "./snapshots/active/wc-tracking.json";
import { COMPLETION_MODEL, MOMENTS_FOUND, PASSES_WITH_AN_OPTION } from "./pep";
import { TOTALS, XT_ACTIONS, XT_TRAINED_ON } from "./dashboard";
import type { Source } from "@/components/brief/atoms/source-chip";
import type { Chunk } from "@/components/brief/atoms/context-card";
import type { Step } from "@/components/brief/atoms/trace";

/**
 * The brief's material, all of it traceable.
 *
 * Two rules hold this file together, and both exist because an agent product
 * lives or dies on whether its claims can be checked:
 *
 * 1. **Every trace step reports a number the pipeline actually produced.** A
 *    trace listing work that did not happen is worse than no trace — it is
 *    invisible until someone checks, and then nothing else survives either.
 * 2. **Every source chip carries a real HydraDB node id.** The fact ids below
 *    were queried out of the graph, not invented, so a chip resolves to a node
 *    that can be superseded and dated like any other.
 */

type Fact = {
  id: number;
  dimension: string;
  band: string;
  vf: number;
  vt: number;
  obs: number;
  median: number;
};

type Deviation = {
  dimension: string;
  normal_band: string;
  normal_value: number;
  match_value: number;
  delta: number | null;
  /** The exact fact this was measured against — cite this, not a lookup. */
  fact_id: number;
  era_matches: number;
};

const DATA = brief as unknown as {
  team: string;
  facts: Fact[];
  deviation: { deviations: Deviation[] } | null;
  match: { label: string; competition: string; date: string } | null;
  labels: Record<string, string>;
};

export const TEAM = DATA.team;
export const FACTS = DATA.facts;
export const MATCH = DATA.match;
export const LABELS = DATA.labels;

const FRAMES = (tracking as unknown as { frames: unknown[] }).frames.length;
const DETECTIONS = (tracking as unknown as { detections: number }).detections;
const OFFICIALS = (tracking as unknown as { excluded_non_team: number })
  .excluded_non_team;

/** What Pep actually did, with what each stage actually produced. */
export const STEPS: Step[] = [
  { label: "read the footage", detail: `${FRAMES} frames` },
  { label: "found the players", detail: `${DETECTIONS.toLocaleString()} detections` },
  { label: "separated the kits", detail: `${OFFICIALS} officials dropped` },
  {
    label: "compared against elite football",
    detail: `${XT_TRAINED_ON.toLocaleString()} matches`,
  },
  {
    label: "checked which balls were on",
    detail: `${COMPLETION_MODEL.n} passes, ${Math.round(
      COMPLETION_MODEL.completion_rate * 100,
    )}% baseline`,
  },
  {
    label: "read your history back",
    detail: `${TOTALS.in_graph} games, ${FACTS.length} dated facts`,
  },
  {
    label: "sifted for what matters",
    detail: `${PASSES_WITH_AN_OPTION} had an option, ${MOMENTS_FOUND} were chances`,
  },
];

export const TRACE_FOOTER = `replay of a run that happened · xT from ${(
  XT_ACTIONS / 1e6
).toFixed(1)}M actions · graph write 124ms`;

/**
 * What was pulled out of the graph to write the brief. The norms are the two
 * best-evidenced facts this side has, which is also how the reasoning layer
 * picks them.
 */
export const CHUNKS: Chunk[] = FACTS.slice(0, 2).map((f) => ({
  title: LABELS[f.dimension] ?? f.dimension,
  size: `${f.obs} observations`,
  body: `Normally ${f.band}, around ${f.median}. Held across ${f.obs} games before this one.`,
  source: `HydraDB · Fact ${f.id}`,
  badge: "fact",
  tone: "text-accent",
}));

/** Deviations worth a coach's attention, biggest first. */
export const DEVIATIONS: Deviation[] = (DATA.deviation?.deviations ?? [])
  .filter((d) => d.delta !== null)
  .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));

/** Plain English for a dimension, from the reasoning layer's own labels. */
export function labelFor(dimension: string): string {
  return LABELS[dimension] ?? dimension.replace(/_/g, " ");
}

/**
 * Units, because "5.51 lower" is not a quantity a coach can act on and
 * "5.5m lower" is.
 */
const UNIT: Record<string, string> = {
  possession_share_pct: "%",
  press_height: "m",
  defensive_action_height: "m",
  team_width: "m",
  pass_forward_ratio: "",
};

export function unitFor(dimension: string): string {
  return UNIT[dimension] ?? "";
}

/**
 * A citation for a deviation, taken from the row's own `fact_id`.
 *
 * Resolving by dimension instead would be subtly wrong: a team has several
 * facts per dimension over time, and the deviation was measured against the
 * one valid on match day, not the best-evidenced one.
 */
export function sourceFor(d: Deviation): Source | null {
  const f = FACTS.find((x) => x.id === d.fact_id);
  if (!f) return null;
  return {
    id: f.id,
    kind: "fact",
    label: String(f.id).slice(-4),
    detail: `${labelFor(f.dimension)}: normally ${f.band}, around ${f.median}, held across ${f.obs} games.`,
  };
}

export const MODEL_SOURCE: Source = {
  id: XT_TRAINED_ON,
  kind: "model",
  label: "xT",
  detail: `Expected threat, trained on ${XT_TRAINED_ON.toLocaleString()} matches and ${(
    XT_ACTIONS / 1e6
  ).toFixed(1)}M actions.`,
};

export const SUGGESTIONS = [
  "Who should I work with this week?",
  "Are we still pressing as high as we used to?",
  "What changed in the final?",
];
