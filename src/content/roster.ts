import roster from "./snapshots/roster.json";
import photos from "../../public/players/index.json";
import { CLIP_MOMENTS } from "./clip";
import { MOMENTS } from "./pep";

/**
 * The squad.
 *
 * Every number here was measured off the event feed by `roster.py`; nothing is
 * typed in. `match` is the game just watched and `across` is the whole
 * campaign, which is the pair the cards are built around: a rate on its own is
 * a box score, and a rate against the player's own norm is a coaching point.
 *
 * The photos are Wikimedia Commons under CC BY-SA or CC BY, with the
 * photographer carried alongside because the licence requires it. A player
 * without one is normal rather than broken — outside elite football it is the
 * usual case — so the card falls back to the shirt number.
 */

export type Rates = {
  xt_created: number;
  xt_left: number;
  final_third_entries: number;
  touches: number;
  defensive_actions: number;
  progressive_ratio: number;
  turnover_rate: number;
};

export type Player = {
  key: string;
  name: string;
  nickname: string | null;
  short: string;
  jersey: number | null;
  position: string;
  country: string | null;
  match: Rates & {
    minutes: number;
    passes: number;
    passes_completed: number;
    shots: number;
    options_seen: number;
  };
  across: (Rates & { games: number; minutes: number }) | null;
};

type Photo = { path: string; licence: string; author: string; page: string };

const SNAP = roster as unknown as {
  team: string;
  match_id: number;
  games_measured: number;
  min_minutes: number;
  players: Player[];
};

export const SQUAD = SNAP.players;
export const TEAM = SNAP.team;
export const GAMES_MEASURED = SNAP.games_measured;
export const MIN_MINUTES = SNAP.min_minutes;

const PHOTOS = photos as unknown as Record<string, Photo>;

export function photoFor(p: Player): Photo | null {
  return PHOTOS[p.key] ?? null;
}

/**
 * The measures a card shows, in the order a coach reads them.
 *
 * `xt_left` is the only one where lower is better, which the arrow has to know
 * about or it congratulates a player for wasting more chances.
 */
export type Measure = {
  key: keyof Rates;
  label: string;
  hint: string;
  lowerIsBetter?: boolean;
  decimals: number;
  /**
   * The norm has to clear this before a percentage change means anything.
   *
   * Otamendi gives the ball away 0.06 times per 100 touches across the
   * campaign and 0.49 times in this final, which is a true ratio of +717% and
   * a useless thing to print on a card. A change measured against almost zero
   * is noise wearing a big number.
   */
  floor: number;
};

export const MEASURES: Measure[] = [
  {
    key: "xt_created",
    floor: 0.05,
    label: "threat made",
    hint: "expected threat added by their passes and carries, per 90",
    decimals: 2,
  },
  {
    key: "xt_left",
    floor: 0.05,
    label: "threat left",
    hint: "threat available on a better ball they did not play, per 90",
    lowerIsBetter: true,
    decimals: 2,
  },
  {
    key: "final_third_entries",
    floor: 0.8,
    label: "final third",
    hint: "passes and carries that cross into the final third, per 90",
    decimals: 1,
  },
  {
    key: "progressive_ratio",
    floor: 0.05,
    label: "progressive",
    hint: "share of completed passes that get 10 yards closer to goal",
    decimals: 2,
  },
  {
    key: "defensive_actions",
    floor: 1.0,
    label: "work off it",
    hint: "defensive actions in the opponent half, per 90",
    decimals: 1,
  },
  {
    key: "turnover_rate",
    floor: 0.8,
    label: "turnovers",
    hint: "dispossessions and miscontrols per 100 touches",
    lowerIsBetter: true,
    decimals: 1,
  },
];

/** Their moments in the tape, matched on the surname the clips carry. */
export function momentsFor(p: Player) {
  return CLIP_MOMENTS.filter((m) => m.surname === p.short);
}

/**
 * Every flagged pass of theirs, footage or not.
 *
 * Matched on the full broadcast name rather than the surname: two Martínez
 * played in this final, and a surname match would hand the goalkeeper the
 * centre forward's missed balls.
 */
export function passesFor(p: Player) {
  return MOMENTS.filter((m) => m.player === (p.nickname ?? p.name));
}

/**
 * How this game compared to their norm, as a signed fraction.
 *
 * Returns null with memory off or with only one game measured, because there
 * is no norm to compare against and an arrow drawn anyway would be a
 * fabrication rather than a simplification.
 */
export function drift(p: Player, m: Measure): number | null {
  if (!p.across || p.across.games < 2) return null;
  const norm = p.across[m.key];
  if (!norm || Math.abs(norm) < m.floor) return null;
  return (p.match[m.key] - norm) / Math.abs(norm);
}

/** Who to work with this week: most threat left on the table, per 90. */
export const WORK_ON = [...SQUAD]
  .filter((p) => p.match.options_seen >= 5)
  .sort((a, b) => b.match.xt_left - a.match.xt_left)
  .slice(0, 3);
