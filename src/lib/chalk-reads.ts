/**
 * Coaching marks derived from tracked boxes.
 *
 * Everything here is computed from detections on the frame — the defensive
 * line is drawn through the players actually holding it, arrows are the
 * displacement a player actually covered. None of it is decoration laid over
 * the video to look analytical.
 *
 * Coordinates are the normalised 0-1 box space the tracker emits, so these
 * functions never need to know the rendered size of the video.
 */

export type TrackedPlayer = { box: number[]; team: number };

export type Mark =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; team: number; label: string }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number; team: number }
  | { kind: "circle"; cx: number; cy: number; r: number; team: number; label: string };

/** Feet of a box: the point where the player meets the ground. */
export function foot(p: TrackedPlayer): { x: number; y: number } {
  return { x: (p.box[0] + p.box[2]) / 2, y: p.box[3] };
}

/**
 * The defensive line: a line through the two or three deepest players of a
 * team, where "deep" is toward their own goal.
 *
 * In frame space, further down the image is nearer the camera, so depth cannot
 * be read off y alone. We use the horizontal extreme instead: the side of the
 * frame the team is defending. `defendingLeft` says which.
 */
export function defensiveLine(
  players: TrackedPlayer[],
  team: number,
  defendingLeft: boolean,
): Mark | null {
  const own = players.filter((p) => p.team === team).map(foot);
  if (own.length < 3) return null;

  const sorted = [...own].sort((a, b) => (defendingLeft ? a.x - b.x : b.x - a.x));
  const back = sorted.slice(0, 3);
  if (back.length < 2) return null;

  // Least-squares fit through the back three, drawn across their own extent
  // rather than the whole frame: a line spanning the full width would imply
  // knowledge of players who are off camera.
  const n = back.length;
  const mx = back.reduce((s, p) => s + p.x, 0) / n;
  const my = back.reduce((s, p) => s + p.y, 0) / n;
  const denom = back.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const slope = denom === 0 ? 0 : back.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / denom;

  const xs = back.map((p) => p.x);
  const x1 = Math.min(...xs) - 0.04;
  const x2 = Math.max(...xs) + 0.04;
  return {
    kind: "line",
    x1,
    y1: my + slope * (x1 - mx),
    x2,
    y2: my + slope * (x2 - mx),
    team,
    label: "defensive line",
  };
}

/**
 * Movement arrows, by nearest-neighbour association between frames.
 *
 * The tracker emits no identities, so a player in this frame is matched to the
 * closest box of the same team in the previous one. Over a ~0.4s gap that is
 * reliable enough for direction of travel; it is not player tracking, and two
 * team-mates crossing will occasionally swap. Arrows below a movement floor
 * are dropped so standing players do not sprout noise.
 */
export function movementArrows(
  prev: TrackedPlayer[],
  curr: TrackedPlayer[],
  minMove = 0.012,
  maxMove = 0.12,
): Mark[] {
  const out: Mark[] = [];
  for (const p of curr) {
    const here = foot(p);
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const q of prev) {
      if (q.team !== p.team) continue;
      const there = foot(q);
      const d = Math.hypot(here.x - there.x, here.y - there.y);
      if (d < bestD) {
        bestD = d;
        best = there;
      }
    }
    // maxMove rejects a match that is almost certainly a different player.
    if (!best || bestD < minMove || bestD > maxMove) continue;
    out.push({ kind: "arrow", x1: best.x, y1: best.y, x2: here.x, y2: here.y, team: p.team });
  }
  return out;
}

/**
 * Circle the player in the most space: the one furthest from any opponent.
 *
 * This is the mark a coach actually draws. It is also the one claim on screen
 * that a box cannot make on its own, because it depends on both teams at once.
 */
export function mostSpace(players: TrackedPlayer[], team: number): Mark | null {
  const own = players.filter((p) => p.team === team);
  const opp = players.filter((p) => p.team !== team);
  if (own.length < 2 || opp.length < 2) return null;

  let bestPlayer = null;
  let bestGap = -1;
  for (const p of own) {
    const a = foot(p);
    let nearest = Infinity;
    for (const q of opp) {
      const b = foot(q);
      nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.y - b.y));
    }
    if (nearest > bestGap) {
      bestGap = nearest;
      bestPlayer = a;
    }
  }
  if (!bestPlayer || bestGap < 0.08) return null;
  return {
    kind: "circle",
    cx: bestPlayer.x,
    cy: bestPlayer.y - 0.03,
    r: Math.min(0.07, Math.max(0.035, bestGap * 0.5)),
    team,
    label: "in space",
  };
}

/** Which side of the frame a team is defending, inferred from its own shape. */
export function defendingLeft(players: TrackedPlayer[], team: number): boolean {
  const own = players.filter((p) => p.team === team).map(foot);
  const opp = players.filter((p) => p.team !== team).map(foot);
  if (!own.length || !opp.length) return true;
  const mo = own.reduce((s, p) => s + p.x, 0) / own.length;
  const mp = opp.reduce((s, p) => s + p.x, 0) / opp.length;
  return mo < mp;
}
