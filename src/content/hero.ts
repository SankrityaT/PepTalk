/**
 * Hero content and the three tactical states it scrubs between.
 *
 * =========================================================================
 * PROVENANCE WARNING
 *
 * Every `state` below is currently PLACEHOLDER GEOMETRY. The coordinates and
 * metrics are hand-authored to be directionally true to the documented
 * tactical shift, but they have NOT come out of the evaluation harness.
 *
 * Before this page ships, each state must be replaced with real values read
 * from results/provenance.json, and `verified` flipped to true. The page's
 * whole argument is that its numbers are reproducible; shipping invented
 * coordinates under that claim would undo it.
 *
 * The <ProvenanceNotice /> component reads these flags and renders a visible
 * dev-only warning while any state is unverified, so this cannot ship
 * silently.
 * =========================================================================
 *
 * Why Barcelona 2011 to 2021: the source data runs 1974 to 2021, and that
 * span covers Guardiola's peak press through Koeman, a real and documented
 * shift in exactly the dimensions we measure. The graph should find it
 * unaided.
 */

export type PlayerMark = {
  /** Percentage across the pitch, 0 = own goal line, 100 = opponent goal line. */
  x: number;
  /** Percentage across the width, 0 = left touchline, 100 = right touchline. */
  y: number;
};

/** A coach's motion arrow, in the same percentage space as PlayerMark. */
export type Arrow = {
  from: PlayerMark;
  to: PlayerMark;
  /** Drawn in accent rather than chalk. At most one per era. */
  accent?: boolean;
};

export type TacticalState = {
  /** Display label: the era, as a judge would name it. */
  era: string;
  /** Season the state describes. */
  season: string;
  /**
   * The year the era is named by. Deliberately separate from `season`:
   * "2010/11" is Guardiola's 2011, and slicing the string would print 2010.
   */
  year: number;
  /** ISO date the fact becomes valid. */
  validFrom: string;
  /** ISO date the fact is superseded, or null if it is the current belief. */
  validTo: string | null;
  formation: string;
  /** Metres upfield from own goal line where the press is triggered. */
  pressHeight: number;
  /** Metres upfield from own goal line the defensive line sits. */
  defensiveLine: number;
  /** Metres between the widest two players in possession. */
  teamWidth: number;
  buildUpSide: "left" | "right" | "central";
  /** The one-line tactical claim the graph would store for this era. */
  claim: string;
  /** Two or three words naming the shape, for the board annotation. */
  shapeLabel: string;
  /** Eleven marks, goalkeeper first. */
  players: PlayerMark[];
  /** Movement arrows a coach would draw for this era. */
  arrows: Arrow[];
  /** True once these values are read from results/provenance.json. */
  verified: boolean;
};

/**
 * Three points in one club's history. Same team, same question, three
 * answers.
 *
 * The pitch renders left to right: x=0 is Barcelona's own goal, x=100 the
 * opponent's. So a rising pressHeight means a team pushing further up.
 */
export const TACTICAL_STATES: TacticalState[] = [
  {
    era: "Guardiola",
    season: "2010/11",
    year: 2011,
    validFrom: "2010-08-29",
    validTo: "2012-05-05",
    formation: "4-3-3",
    pressHeight: 52,
    defensiveLine: 48,
    teamWidth: 44,
    buildUpSide: "central",
    claim:
      "Presses in the opposition half. Wins the ball back within six seconds.",
    shapeLabel: "High block",
    players: [
      { x: 6, y: 50 },
      { x: 34, y: 16 },
      { x: 30, y: 38 },
      { x: 30, y: 62 },
      { x: 34, y: 84 },
      { x: 48, y: 50 },
      { x: 58, y: 30 },
      { x: 58, y: 70 },
      { x: 76, y: 12 },
      { x: 78, y: 50 },
      { x: 76, y: 88 },
    ],
    arrows: [
      { from: { x: 58, y: 30 }, to: { x: 73, y: 20 }, accent: true },
      { from: { x: 48, y: 50 }, to: { x: 64, y: 50 } },
      { from: { x: 58, y: 70 }, to: { x: 73, y: 80 } },
    ],
    verified: false,
  },
  {
    era: "Luis Enrique",
    season: "2014/15",
    year: 2015,
    validFrom: "2014-08-23",
    validTo: "2017-05-21",
    formation: "4-3-3",
    pressHeight: 44,
    defensiveLine: 41,
    teamWidth: 56,
    buildUpSide: "right",
    claim:
      "Presses less, transitions faster. Attacks direct through the front three.",
    shapeLabel: "Mid block",
    players: [
      { x: 6, y: 50 },
      { x: 28, y: 12 },
      { x: 24, y: 38 },
      { x: 24, y: 62 },
      { x: 28, y: 88 },
      { x: 42, y: 46 },
      { x: 50, y: 26 },
      { x: 50, y: 68 },
      { x: 80, y: 8 },
      { x: 82, y: 50 },
      { x: 80, y: 92 },
    ],
    arrows: [
      { from: { x: 42, y: 46 }, to: { x: 74, y: 14 }, accent: true },
      { from: { x: 50, y: 68 }, to: { x: 76, y: 88 } },
      { from: { x: 24, y: 38 }, to: { x: 46, y: 46 } },
    ],
    verified: false,
  },
  {
    era: "Koeman",
    season: "2020/21",
    year: 2021,
    validFrom: "2020-09-27",
    validTo: null,
    formation: "3-5-2",
    pressHeight: 33,
    defensiveLine: 32,
    teamWidth: 61,
    buildUpSide: "left",
    claim:
      "Sits deeper. Builds slowly from the back and concedes the first phase.",
    shapeLabel: "Low block",
    players: [
      { x: 6, y: 50 },
      { x: 20, y: 30 },
      { x: 18, y: 50 },
      { x: 20, y: 70 },
      { x: 36, y: 8 },
      { x: 34, y: 38 },
      { x: 32, y: 50 },
      { x: 34, y: 62 },
      { x: 36, y: 92 },
      { x: 62, y: 40 },
      { x: 62, y: 60 },
    ],
    arrows: [
      { from: { x: 18, y: 50 }, to: { x: 32, y: 28 }, accent: true },
      { from: { x: 20, y: 70 }, to: { x: 34, y: 62 } },
      { from: { x: 34, y: 38 }, to: { x: 50, y: 44 } },
    ],
    verified: false,
  },
];

export const HERO_COPY = {
  eyebrow: "Match tape / already watched",
  // Short, because a hero is a claim and not an explanation. The version this
  // replaces ran to fourteen words and three sentences under it, which is a
  // paragraph wearing a headline's clothes. Everything it said is still on the
  // page; it is just further down, where a reader has agreed to read.
  headline: "The assistant coach that remembers.",
  sub: "He watches the game before you sit down. Every number he gives you carries the date it was true.",
  primaryCta: { label: "Open the session", href: "/dashboard" },
  secondaryCta: { label: "GitHub", href: "https://github.com/SankrityaT/PepTalk" },
} as const;

/** True when every state on the page traces to the harness. */
export const ALL_STATES_VERIFIED = TACTICAL_STATES.every((s) => s.verified);

/**
 * Section 02: the claim.
 *
 * The page's single full-bleed orange band, spent on one sentence. HydraDB's
 * own design language uses that device exactly once, so using it twice would
 * cost it its weight.
 *
 * The years are 2011 and 2021 rather than 2011 and 2024 because the source
 * data runs 1974 to 2021. Guardiola's peak press against Koeman's low block
 * is a real documented shift in the dimensions we measure, so the graph
 * should surface it unaided.
 */
export const CLAIM_COPY = {
  index: "02",
  label: "The claim",
  lead: "A vector store thinks",
  subjectA: "Barcelona 2011",
  middle: "and",
  subjectB: "Barcelona 2021",
  tail: "are the same team.",
  punchline: "HydraDB doesn't.",
  // The old line spent three clauses on what similarity gets wrong and never
  // said what replaces it, which leaves the punchline unearned. Two sentences:
  // the failure, then the fix.
  footnote:
    "Similarity finds the nearest neighbour. It cannot tell that a fact expired, so it averages the eras and describes neither.",
  answer:
    "Every fact here carries the dates it was true and a link to whatever replaced it. Ask about 2011 and about 2021 and you get two answers, both correct.",
} as const;
