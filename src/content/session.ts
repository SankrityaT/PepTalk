import { CLIP_MOMENTS, ClipMoment } from "./clip";
import { STEPS, TRACE_FOOTER } from "./brief";
import { MOMENTS_FOUND, PASSES_WITH_AN_OPTION } from "./pep";
import { TOTALS } from "./dashboard";
import conceded from "./snapshots/conceded.json";
import knowledge from "./snapshots/knowledge.json";
import scout from "./snapshots/scout.json";
import type { Step } from "@/components/brief/atoms/trace";
import type { Source } from "@/components/brief/atoms/prompt-bar";

/**
 * The session, as an ordered list of beats.
 *
 * Everything the interface shows is in this list, which is the point. The
 * previous build had seven destinations and five of them had no video on them
 * at all, because a screen is easy to add and a screen full of prose is easier
 * still. A beat cannot be added without deciding what the tape does while it is
 * on, which is the constraint that was missing.
 *
 * Nothing here is generated. Every clip was cut from the real match and checked
 * against the broadcast clock; every number came out of the graph.
 */

export type Frame = {
  idx: number;
  t: number;
  grass: number;
  players: { box: number[]; team: number }[];
};

export type Goal = {
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
  passage: {
    minute: number;
    second: number;
    type: string;
    team: string;
    player: string | null;
  }[];
  defence: {
    from_box: boolean;
    distance_to_goal: number;
    defenders_visible?: number;
    defenders_goal_side?: number;
    nearest_defender_yds?: number;
    defenders_in_box?: number;
  };
};

type Dim = {
  dimension: string;
  label: string;
  value: number;
  band: string;
  obs: number;
  percentile: number;
  peers: number;
  median: number;
};

type Norm = { band: string; value: number; obs: number; since: string | null; id: number };
type Flat = { band: string; observations: number } | null;

const GOALS = (conceded as unknown as { team: string; goals: Goal[] }).goals;
const KNOW = knowledge as unknown as {
  team: string;
  scale: {
    teams: number;
    matches: number;
    facts: number;
    supersessions: number;
    competitions: { name: string; matches: number }[];
  };
  dimensions: Dim[];
};
const SCOUT = scout as unknown as {
  team: string;
  labels: Record<string, string>;
  mine: { norms: Record<string, Norm>; flat: Record<string, Flat> };
  opponents: Record<
    string,
    { norms: Record<string, Norm>; flat: Record<string, Flat>; games: number }
  >;
};

export const TEAM = KNOW.team;
export const SCALE = KNOW.scale;

/** An inline exhibit. These used to be whole screens a coach never opened. */
export type EvidenceCard =
  | {
      kind: "benchmark";
      title: string;
      dimensions: Dim[];
      scale: typeof KNOW.scale;
    }
  | {
      kind: "opponent";
      title: string;
      opponent: string;
      games: number;
      labels: Record<string, string>;
      mine: { norms: Record<string, Norm>; flat: Record<string, Flat> };
      theirs: { norms: Record<string, Norm>; flat: Record<string, Flat> };
    }
  | { kind: "threat"; title: string };

export type Beat =
  | { id: string; kind: "say"; text: string; withoutMemory?: string }
  | { id: string; kind: "trace"; steps: Step[]; footer: string }
  | { id: string; kind: "moment"; moment: ClipMoment }
  | { id: string; kind: "goal"; goal: Goal }
  | { id: string; kind: "evidence"; card: EvidenceCard }
  | {
      id: string;
      kind: "ask";
      question: string;
      options: { key: string; label: string; primary?: boolean }[];
    };

/**
 * Which clip a beat wants on screen, or null to hold whatever is already
 * there. This one function is the entire coupling between the thread and the
 * tape, and the rule it encodes is that the video never disappears.
 */
export function clipFor(beat: Beat): { src: string; stopAt?: number; label: string } | null {
  if (beat.kind === "moment") {
    return {
      src: beat.moment.clip,
      stopAt: beat.moment.pass_at,
      label: "the moment",
    };
  }
  if (beat.kind === "goal" && beat.goal.clip) {
    return { src: beat.goal.clip, stopAt: beat.goal.goal_at, label: "in the net" };
  }
  return null;
}

const attacking = CLIP_MOMENTS.filter((m) => m.side === "attacking");
const defending = CLIP_MOMENTS.filter((m) => m.side === "defending");
const openPlay = GOALS.filter((g) => g.kind !== "Penalty");
const penalties = GOALS.filter((g) => g.kind === "Penalty");

const standout = [...KNOW.dimensions].sort(
  (a, b) => Math.abs(50 - b.percentile) - Math.abs(50 - a.percentile),
)[0];

const opponent = Object.keys(SCOUT.opponents)[0];

function momentBeats(list: ClipMoment[]): Beat[] {
  return list.map((m) => ({ id: `moment-${m.key}`, kind: "moment" as const, moment: m }));
}

/**
 * The order is a coaching order, not a data order: what you did with the ball,
 * then what happened in front of you, then how that compares to everyone else,
 * then who is next. A coach can stop after any of them and have had something
 * worth their time.
 */
export const BEATS: Beat[] = [
  {
    id: "greet",
    kind: "say",
    text: `Morning, coach. I went through the game and held it against the ${TOTALS.in_graph} of yours I already have.`,
    // Without dated facts there is no "yours" to hold it against: the graph
    // can still say a game happened, not what was normal when it did.
    withoutMemory:
      "Morning, coach. I went through the game and found the moments worth showing you. What I cannot do is tell you whether any of it is normal for you.",
  },
  { id: "trace", kind: "trace", steps: STEPS, footer: TRACE_FOOTER },
  {
    id: "intro-moments",
    kind: "say",
    text: `${PASSES_WITH_AN_OPTION.toLocaleString()} passes had a better option somewhere, but only ${MOMENTS_FOUND} were a ball that would have made a chance. Here are the ones I have footage for.`,
  },
  ...momentBeats(attacking),
  {
    id: "after-attacking",
    kind: "say",
    text: "Both of those were a ball into the box you had and did not take. Same picture twice.",
    withoutMemory:
      "Both of those were a ball into the box you had and did not take. Whether that is a habit or a bad afternoon, I cannot tell you.",
  },
  ...momentBeats(defending),
  {
    id: "after-defending",
    kind: "say",
    text: "Those two were theirs. Chances that were there and did not arrive, which is the half of the game you got away with.",
  },
  {
    id: "ask-goals",
    kind: "ask",
    question: "Want to look at the three you conceded?",
    options: [
      { key: "yes", label: "Yes, show me", primary: true },
      { key: "no", label: "Not now" },
    ],
  },
  ...openPlay.map((g) => ({ id: `goal-${g.key}`, kind: "goal" as const, goal: g })),
  ...penalties.map((g) => ({ id: `goal-${g.key}`, kind: "goal" as const, goal: g })),
  {
    id: "after-goals",
    kind: "say",
    text: "All three to the same man. Two from the spot, so watch what happened before the whistle rather than the kick.",
    withoutMemory:
      "All three to the same man. I can show you them; I cannot tell you whether this is how you usually concede.",
  },
  {
    id: "benchmark",
    kind: "evidence",
    card: {
      kind: "benchmark",
      title: standout
        ? `You are ${standout.percentile <= 50 ? "lower" : "higher"} for ${standout.label} than ${standout.percentile <= 50 ? 100 - standout.percentile : standout.percentile}% of the sides I know`
        : "Where you sit",
      dimensions: KNOW.dimensions,
      scale: KNOW.scale,
    },
  },
  {
    id: "opponent",
    kind: "evidence",
    card: {
      kind: "opponent",
      title: `Next up: ${opponent}`,
      opponent,
      games: SCOUT.opponents[opponent].games,
      labels: SCOUT.labels,
      mine: SCOUT.mine,
      theirs: SCOUT.opponents[opponent],
    },
  },
  {
    id: "close",
    kind: "say",
    text: "That is the session. Ask me about any player, any clip, or anything I just showed you.",
    withoutMemory:
      "That is the game itself, and it holds up on its own. Turn the memory back on and the same footage gets a season and 354 sides behind it.",
  },
];

export const SUGGESTIONS = [
  "Who should I work with this week?",
  "Show me the goals again",
  "Are we still pressing as high as we used to?",
];

/**
 * What the composer can reach, counted off the same snapshots the session is
 * built from. A menu that offers something the workspace does not hold is
 * worse than no menu, so every row here is a length or a total rather than a
 * sentence someone typed.
 */
export const SOURCES: Source[] = [
  {
    key: "attach",
    name: "Add footage",
    desc: "a match file from this machine",
    glyph: "clip",
    attach: true,
  },
  {
    key: "tape",
    name: "Match tape",
    desc: `${BEATS.filter((b) => clipFor(b)).length} clips cut from this game`,
    glyph: "tape",
  },
  {
    key: "graph",
    name: "The graph",
    desc: `${KNOW.scale.facts.toLocaleString()} dated facts, ${KNOW.scale.teams} sides`,
    glyph: "graph",
  },
  {
    key: "season",
    name: "Your season",
    desc: `${TOTALS.in_graph} games on record`,
    glyph: "season",
  },
  {
    key: "opponent",
    name: opponent,
    desc: `${SCOUT.opponents[opponent].games} of theirs in the graph`,
    glyph: "shield",
  },
];

/**
 * Commands, each one a jump to a beat that exists. `to` is resolved against
 * BEATS at the call site, so a command can never point at a beat this
 * workspace did not build.
 */
export const COMMANDS: { key: string; label: string; hint: string; to: string }[] = [
  { key: "moments", label: "moments", hint: "a better ball was on", to: "intro-moments" },
  ...(GOALS.length
    ? [
        {
          key: "goals",
          label: "goals",
          hint: `the ${GOALS.length} conceded`,
          to: `goal-${GOALS[0].key}`,
        },
      ]
    : []),
  { key: "season", label: "season", hint: `you against ${KNOW.scale.teams} sides`, to: "benchmark" },
  { key: "next", label: "next", hint: `what ${opponent} do`, to: "opponent" },
  { key: "again", label: "again", hint: "from the top", to: "greet" },
];
