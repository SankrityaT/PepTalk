/**
 * A small force layout in three dimensions.
 *
 * Written rather than installed, for two reasons. Every force-graph library
 * ships a look, and a page that arrives at the default look of a popular
 * library announces exactly which library it is. And the layout wants tuning
 * against this particular data: a few hundred facts hanging off two dozen
 * players is a different shape from a social network, and the parameters that
 * make it legible are not the ones a general library defaults to.
 *
 * Plain O(n squared) repulsion. Three hundred and seventy six nodes is seventy
 * thousand pairs a tick, which a browser does without noticing, and a
 * Barnes-Hut octree here would be three hundred lines of code buying nothing.
 * If this ever draws the whole store it will need one; it does not.
 *
 * The layout never fully stops. Settling to a frozen lattice reads as a
 * diagram, and the thing being drawn is a memory that is still being written
 * to, so a low residual jitter is left in on purpose.
 */

export type Vec = { x: number; y: number; z: number };

export type SimNode = Vec & {
  id: string;
  vx: number;
  vy: number;
  vz: number;
  /** Relative mass. Heavier nodes sit nearer the middle and move less. */
  weight: number;
  /** Held in place while a pointer drags it. */
  pinned?: boolean;
};

export type SimEdge = { s: string; t: string; kind: string };

/**
 * How far apart an edge wants its ends, by relationship.
 *
 * These are the numbers that turn a hairball into something readable. Evidence
 * edges are the loosest because a fact cites matches that are already pulled
 * elsewhere by their own team, and holding them tight drags the whole match
 * ring inward. Supersession is the tightest: a chain of facts about one
 * dimension should read as a chain, not as four unrelated points.
 */
const REST: Record<string, number> = {
  PLAYED: 190,
  FIELDED: 150,
  HAS_FACT: 62,
  OBSERVED_IN: 260,
  SUPERSEDED_BY: 40,
  HAS_SESSION: 170,
  HAS_TURN: 70,
  CITES: 150,
};

const PULL: Record<string, number> = {
  PLAYED: 0.010,
  FIELDED: 0.012,
  HAS_FACT: 0.030,
  OBSERVED_IN: 0.0022,
  SUPERSEDED_BY: 0.055,
  HAS_SESSION: 0.010,
  HAS_TURN: 0.026,
  CITES: 0.008,
};

export type Sim = {
  nodes: SimNode[];
  index: Map<string, SimNode>;
  /** Neighbour ids, for highlighting a node's own corner of the graph. */
  near: Map<string, Set<string>>;
  tick: (alpha: number) => void;
};

export function createSim(
  raw: { id: string; weight?: number }[],
  edges: SimEdge[],
  seed = 1,
): Sim {
  // Deterministic start. A layout that comes out differently on every reload
  // cannot be screenshotted, described, or reasoned about when it looks wrong.
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };

  const nodes: SimNode[] = raw.map((n) => {
    // Seeded on a sphere rather than in a cube. A cube start leaves visible
    // corners for the first second, which is the first second anyone watches.
    const th = rnd() * Math.PI * 2;
    const ph = Math.acos(2 * rnd() - 1);
    const r = 260 + rnd() * 90;
    return {
      id: n.id,
      x: r * Math.sin(ph) * Math.cos(th),
      y: r * Math.sin(ph) * Math.sin(th),
      z: r * Math.cos(ph),
      vx: 0,
      vy: 0,
      vz: 0,
      weight: n.weight ?? 1,
    };
  });

  const index = new Map(nodes.map((n) => [n.id, n]));

  const near = new Map<string, Set<string>>();
  for (const n of nodes) near.set(n.id, new Set());
  const live: { a: SimNode; b: SimNode; rest: number; pull: number }[] = [];
  for (const e of edges) {
    const a = index.get(e.s);
    const b = index.get(e.t);
    if (!a || !b) continue;
    live.push({ a, b, rest: REST[e.kind] ?? 120, pull: PULL[e.kind] ?? 0.02 });
    near.get(e.s)?.add(e.t);
    near.get(e.t)?.add(e.s);
  }

  const REPULSION = 2100;
  const CENTRE = 0.0016;
  const DAMPING = 0.86;

  function tick(alpha: number) {
    const n = nodes.length;

    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = a.z - b.z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1) {
          // Two nodes exactly on top of each other have no direction to
          // separate along, so give them one rather than dividing by zero.
          dx = rnd() - 0.5;
          dy = rnd() - 0.5;
          dz = rnd() - 0.5;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const f = (REPULSION * alpha) / d2;
        const ux = (dx / d) * f;
        const uy = (dy / d) * f;
        const uz = (dz / d) * f;
        // Heavier nodes are shoved less, which keeps the team and the players
        // near the middle while several hundred facts arrange themselves.
        a.vx += ux / a.weight;
        a.vy += uy / a.weight;
        a.vz += uz / a.weight;
        b.vx -= ux / b.weight;
        b.vy -= uy / b.weight;
        b.vz -= uz / b.weight;
      }
    }

    for (const { a, b, rest, pull } of live) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const f = ((d - rest) / d) * pull * alpha;
      const ux = dx * f;
      const uy = dy * f;
      const uz = dz * f;
      a.vx += ux / a.weight;
      a.vy += uy / a.weight;
      a.vz += uz / a.weight;
      b.vx -= ux / b.weight;
      b.vy -= uy / b.weight;
      b.vz -= uz / b.weight;
    }

    for (const p of nodes) {
      if (p.pinned) {
        p.vx = p.vy = p.vz = 0;
        continue;
      }
      p.vx -= p.x * CENTRE * alpha;
      p.vy -= p.y * CENTRE * alpha;
      p.vz -= p.z * CENTRE * alpha;
      p.vx *= DAMPING;
      p.vy *= DAMPING;
      p.vz *= DAMPING;
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;
    }
  }

  return { nodes, index, near, tick };
}

/** Spin a point around Y then X. Yaw first so dragging sideways feels level. */
export function rotate(p: Vec, yaw: number, pitch: number): Vec {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  return { x: x1, y: p.y * cx - z1 * sx, z: p.y * sx + z1 * cx };
}
