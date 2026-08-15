/**
 * Hand-drawn geometry.
 *
 * Turns exact shapes into paths that look like someone drew them with a
 * piece of chalk. The technique is the one Rough.js uses, sample points
 * along the true shape, push each one off course a little, then smooth the
 * result, implemented here directly so we don't take a dependency for
 * four functions.
 *
 * Everything is driven by a seeded PRNG. That matters for more than
 * repeatability: these paths are generated during render, and an unseeded
 * Math.random() would produce different geometry on the server than on the
 * client and trip a hydration mismatch.
 */

export type Rand = () => number;

/** mulberry32: small, fast, good enough for visual jitter. */
export function seededRandom(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Point = [number, number];

/** Symmetric jitter in [-amount, amount]. */
function wobble(rand: Rand, amount: number): number {
  return (rand() * 2 - 1) * amount;
}

/**
 * Smooth a polyline into a cubic path using Catmull-Rom control points.
 * Without this the jittered points read as a jagged zigzag rather than a
 * wavering line.
 */
function smoothPath(points: Point[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  }

  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    // Catmull-Rom to cubic Bezier, tension 1/6.
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;

    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

/**
 * A straight line, drawn by hand.
 *
 * Endpoints get less jitter than the middle, when you draw to a corner you
 * aim at it, but your hand drifts in between.
 */
export function handLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rand: Rand,
  amount = 2.4,
): string {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(3, Math.round(length / 42));
  const points: Point[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Taper jitter to near-zero at both ends.
    const taper = Math.sin(t * Math.PI);
    const jx = wobble(rand, amount) * taper;
    const jy = wobble(rand, amount) * taper;
    points.push([x1 + (x2 - x1) * t + jx, y1 + (y2 - y1) * t + jy]);
  }

  return smoothPath(points);
}

/** A rectangle as four independent hand-drawn strokes. */
export function handRect(
  x: number,
  y: number,
  w: number,
  h: number,
  rand: Rand,
  amount = 2.4,
): string {
  return [
    handLine(x, y, x + w, y, rand, amount),
    handLine(x + w, y, x + w, y + h, rand, amount),
    handLine(x + w, y + h, x, y + h, rand, amount),
    handLine(x, y + h, x, y, rand, amount),
  ].join(" ");
}

/**
 * A circle or arc, drawn by hand.
 *
 * Overshoots the end angle slightly on full circles, because nobody closes a
 * freehand circle exactly on the start point.
 */
export function handArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  rand: Rand,
  amount = 2.2,
): string {
  const sweep = endAngle - startAngle;
  const isFullCircle = Math.abs(sweep) >= Math.PI * 1.99;
  const overshoot = isFullCircle ? 0.16 : 0;
  const steps = Math.max(8, Math.round((Math.abs(sweep) / (Math.PI * 2)) * 34));
  const points: Point[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = startAngle + (sweep + overshoot) * t;
    // Radius breathes slightly around the circle.
    const rr = r + wobble(rand, amount);
    points.push([cx + Math.cos(angle) * rr, cy + Math.sin(angle) * rr]);
  }

  return smoothPath(points);
}

/**
 * A small cross, the way a coach marks a player on a board.
 * Two strokes, deliberately not meeting at their centres.
 */
export function handCross(
  cx: number,
  cy: number,
  size: number,
  rand: Rand,
): string {
  const s = size / 2;
  const skew = () => wobble(rand, size * 0.18);
  return [
    handLine(cx - s + skew(), cy - s + skew(), cx + s + skew(), cy + s + skew(), rand, 1),
    handLine(cx + s + skew(), cy - s + skew(), cx - s + skew(), cy + s + skew(), rand, 1),
  ].join(" ");
}

/**
 * An arrow: shaft plus two barbs, all hand-drawn.
 * Used for the motion arrows over the pitch.
 */
export function handArrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rand: Rand,
  headLength = 16,
): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = 0.42;
  return [
    handLine(x1, y1, x2, y2, rand, 2.2),
    handLine(
      x2,
      y2,
      x2 - Math.cos(angle - spread) * headLength,
      y2 - Math.sin(angle - spread) * headLength,
      rand,
      1,
    ),
    handLine(
      x2,
      y2,
      x2 - Math.cos(angle + spread) * headLength,
      y2 - Math.sin(angle + spread) * headLength,
      rand,
      1,
    ),
  ].join(" ");
}
