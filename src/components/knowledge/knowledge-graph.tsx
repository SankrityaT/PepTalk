"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSim, rotate, type SimNode } from "@/lib/force-3d";
import graphData from "@/content/snapshots/active/graph.json";

/**
 * What Pep knows, drawn.
 *
 * "A temporal graph with supersession chains and citations back to evidence"
 * is a sentence. A coach has no way to tell whether it is true, and neither
 * does a judge reading a README. This draws the thing, so the claim is settled
 * by looking rather than by trusting.
 *
 * Deliberately not the default force-graph look. Every node kind gets its own
 * mark rather than a coloured circle: the team is the centre circle off a
 * pitch, a match is a small square because that is how HydraDB's own docs mark
 * a list item, a fact is a diamond, and a turn is barely a speck. You should be
 * able to tell what you are looking at with the labels off.
 *
 * `SUPERSEDED_BY` is drawn loudest, which is an argument rather than a
 * decoration. It is the relationship a vector index has no way to hold, so it
 * is the one edge worth being able to see across the room.
 *
 * The layout keeps breathing after it settles. A frozen lattice reads as a
 * diagram, and this is a memory that is still being written to.
 */

type RawNode = {
  id: string;
  kind: string;
  label: string;
  sub?: string;
  weight?: number;
  value?: number | null;
  clip?: string | null;
  photo?: string;
};

type Raw = { team: string; nodes: RawNode[]; edges: { s: string; t: string; kind: string }[] };

const DATA = graphData as unknown as Raw;

const ACCENT = "255, 87, 26";
const CHALK = "255, 255, 255";
const WARM = "216, 210, 204";
const MUTED = "153, 153, 153";

/** Which relationships are worth seeing from a distance. */
const EDGE_TONE: Record<string, { rgb: string; alpha: number; width: number }> = {
  SUPERSEDED_BY: { rgb: ACCENT, alpha: 0.85, width: 1.7 },
  CITES: { rgb: ACCENT, alpha: 0.42, width: 1.0 },
  HAS_FACT: { rgb: CHALK, alpha: 0.13, width: 0.7 },
  PLAYED: { rgb: WARM, alpha: 0.2, width: 0.8 },
  FIELDED: { rgb: WARM, alpha: 0.22, width: 0.8 },
  HAS_SESSION: { rgb: ACCENT, alpha: 0.3, width: 0.9 },
  HAS_TURN: { rgb: ACCENT, alpha: 0.2, width: 0.7 },
  OBSERVED_IN: { rgb: CHALK, alpha: 0.05, width: 0.5 },
};

/**
 * Every node with footage behind it.
 *
 * Thirteen of them: the final, and a ball each for the twelve players who have
 * one cut. Enough that memories can surface from all over the cloud rather
 * than from one corner of it.
 */
const WITH_FOOTAGE = DATA.nodes.filter((n) => n.clip);

/** How long one surfaced memory lives, in milliseconds. */
const FLARE_IN = 700;
const FLARE_HOLD = 5200;
const FLARE_OUT = 900;
const FLARE_LIFE = FLARE_IN + FLARE_HOLD + FLARE_OUT;

/** At most this many at once. Three is a sky; six is a video wall. */
const FLARE_MAX = 2;

type Flare = { key: number; node: RawNode };

const KIND_LABEL: Record<string, string> = {
  team: "the side",
  match: "a match played",
  player: "a player fielded",
  fact: "a dated fact",
  session: "a conversation",
  turn: "something said",
};

export function KnowledgeGraph() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const [hover, setHover] = useState<RawNode | null>(null);
  const [picked, setPicked] = useState<RawNode | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [flares, setFlares] = useState<Flare[]>([]);

  const byId = useMemo(() => new Map(DATA.nodes.map((n) => [n.id, n])), []);
  const sim = useMemo(() => createSim(DATA.nodes, DATA.edges), []);

  // Kept in refs, not state: these change on every pointer move and every
  // frame, and putting them through React would re-render the tree sixty times
  // a second to draw into a canvas that does not need React at all.
  const view = useRef({ yaw: 0.5, pitch: -0.25, zoom: 1, spin: true });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const screen = useRef(new Map<string, { x: number; y: number; r: number; z: number }>());
  const hoverId = useRef<string | null>(null);
  const pickedId = useRef<string | null>(null);
  const filterRef = useRef<string | null>(null);
  const queryRef = useRef("");
  /** The live flare elements, so the frame loop can move them without React. */
  const flareEls = useRef(new Map<number, HTMLDivElement | null>());
  const flareBorn = useRef(new Map<number, number>());

  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);
  useEffect(() => {
    queryRef.current = query.trim().toLowerCase();
  }, [query]);
  useEffect(() => {
    pickedId.current = picked?.id ?? null;
  }, [picked]);

  const draw = useCallback(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr;
      cv.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // A little warmth behind the cloud. On flat black the graph reads as a
    // scatter plot on a page; with something behind it, it reads as a thing
    // sitting in a space, which is the difference between a chart and an
    // object you want to turn around.
    const glow = ctx.createRadialGradient(
      w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.62,
    );
    glow.addColorStop(0, "rgba(255, 87, 26, 0.055)");
    glow.addColorStop(0.45, "rgba(255, 87, 26, 0.018)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const { yaw, pitch, zoom } = view.current;
    const cx = w / 2;
    const cy = h / 2;
    const focal = 900;
    const scale = Math.min(w, h) / 900;

    // Project once, reuse for edges, nodes and hit testing.
    const pts = screen.current;
    pts.clear();
    const depth: { n: SimNode; x: number; y: number; k: number; z: number }[] = [];
    for (const n of sim.nodes) {
      const r = rotate(n, yaw, pitch);
      const k = (focal / (focal + r.z + 520)) * zoom * scale;
      const x = cx + r.x * k;
      const y = cy + r.y * k;
      pts.set(n.id, { x, y, r: k, z: r.z });
      depth.push({ n, x, y, k, z: r.z });
    }
    depth.sort((a, b) => b.z - a.z);

    const hoverNear = hoverId.current ? sim.near.get(hoverId.current) : null;
    const pickNear = pickedId.current ? sim.near.get(pickedId.current) : null;
    const focusId = pickedId.current ?? hoverId.current;
    const focusNear = pickNear ?? hoverNear;
    const kindFilter = filterRef.current;
    const q = queryRef.current;

    const lit = (id: string) => {
      if (q) {
        const n = byId.get(id);
        return !!n && (n.label + " " + (n.sub ?? "")).toLowerCase().includes(q);
      }
      if (!focusId) return true;
      return id === focusId || !!focusNear?.has(id);
    };

    // ── edges, behind everything ─────────────────────────────────────────
    for (const e of DATA.edges) {
      const a = pts.get(e.s);
      const b = pts.get(e.t);
      if (!a || !b) continue;

      const tone = EDGE_TONE[e.kind] ?? { rgb: CHALK, alpha: 0.08, width: 0.6 };
      const on = lit(e.s) && lit(e.t);
      const dimmed = (focusId || q) && !on;
      if (dimmed && tone.alpha < 0.3) continue;

      // Fade with distance so the far side of the cloud recedes rather than
      // crowding the near side.
      const dep = Math.max(0.25, Math.min(1, (a.r + b.r) / 2));
      ctx.globalAlpha = tone.alpha * dep * (dimmed ? 0.12 : 1);
      ctx.strokeStyle = `rgb(${tone.rgb})`;
      ctx.lineWidth = tone.width * (on && focusId ? 1.6 : 1);

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      if (e.kind === "SUPERSEDED_BY" || e.kind === "CITES") {
        // A slight bow, so two facts that supersede each other read as a
        // relationship with a direction rather than as a strut.
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const nx = -(b.y - a.y) * 0.12;
        const ny = (b.x - a.x) * 0.12;
        ctx.quadraticCurveTo(mx + nx, my + ny, b.x, b.y);
      } else {
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }

    // ── nodes, far to near ───────────────────────────────────────────────
    for (const d of depth) {
      const raw = byId.get(d.n.id);
      if (!raw) continue;

      const on = lit(d.n.id);
      const hidden = kindFilter && raw.kind !== kindFilter;
      const dim = ((focusId || q) && !on) || hidden;
      const a = dim ? 0.07 : Math.max(0.3, Math.min(1, d.k * 1.25));
      const r = Math.max(1.1, d.k * 9 * (raw.weight ?? 1));

      const isFocus = d.n.id === focusId;

      // Everything still true gets a soft halo. It costs one extra arc per
      // live node and it is what stops several hundred small marks reading as
      // gravel: the open edge of the memory glows, the closed past does not.
      const alive =
        raw.kind === "team" ||
        raw.kind === "session" ||
        !!raw.clip ||
        (raw.kind === "fact" && (raw.sub ?? "").includes("to present"));
      if (alive && !dim) {
        // Nodes holding footage breathe, slightly out of phase with each
        // other, so the cloud looks like it has things waiting in it.
        const pulse = raw.clip
          ? 1 + 0.55 * Math.sin(beat.current + d.n.x * 0.01)
          : 1;
        const halo = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, r * 5.2 * pulse);
        halo.addColorStop(0, `rgba(${ACCENT}, ${0.20 * a * pulse})`);
        halo.addColorStop(1, "rgba(255, 87, 26, 0)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(d.x, d.y, r * 5.2 * (raw.clip ? 1.4 : 1), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = a;

      switch (raw.kind) {
        case "team": {
          // The centre circle, because that is what a coach draws first.
          ctx.strokeStyle = `rgb(${CHALK})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(d.x, d.y, r * 1.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = a * 0.5;
          ctx.beginPath();
          ctx.arc(d.x, d.y, r * 2.4, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case "match": {
          // Square, and orange-ringed when there is footage behind it.
          const s = r * 1.15;
          ctx.fillStyle = `rgb(${WARM})`;
          ctx.fillRect(d.x - s / 2, d.y - s / 2, s, s);
          if (raw.clip) {
            ctx.strokeStyle = `rgb(${ACCENT})`;
            ctx.lineWidth = 1.2;
            ctx.strokeRect(d.x - s, d.y - s, s * 2, s * 2);
          }
          break;
        }
        case "player": {
          ctx.fillStyle = `rgb(${CHALK})`;
          ctx.beginPath();
          ctx.arc(d.x, d.y, r * 0.62, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = a * 0.55;
          ctx.strokeStyle = `rgb(${CHALK})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(d.x, d.y, r * 1.25, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case "fact": {
          // Diamond. Orange when the fact is still open, which is what makes
          // the live edge of the memory visible from a distance.
          const open = (raw.sub ?? "").includes("to present");
          ctx.fillStyle = open ? `rgb(${ACCENT})` : `rgb(${MUTED})`;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y - r * 0.85);
          ctx.lineTo(d.x + r * 0.85, d.y);
          ctx.lineTo(d.x, d.y + r * 0.85);
          ctx.lineTo(d.x - r * 0.85, d.y);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "session": {
          ctx.strokeStyle = `rgb(${ACCENT})`;
          ctx.lineWidth = 1.3;
          ctx.strokeRect(d.x - r * 0.9, d.y - r * 0.9, r * 1.8, r * 1.8);
          break;
        }
        default: {
          ctx.fillStyle = `rgb(${ACCENT})`;
          ctx.beginPath();
          ctx.arc(d.x, d.y, r * 0.42, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (isFocus) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = `rgb(${ACCENT})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(d.x, d.y, r * 2.9, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Labels only for things big enough and near enough to earn one.
      const bigEnough = raw.kind === "team" || raw.kind === "player" || raw.kind === "match";
      if ((isFocus || (bigEnough && d.k > 0.78 && !dim)) && raw.label) {
        ctx.globalAlpha = isFocus ? 1 : Math.min(0.7, (d.k - 0.7) * 3);
        ctx.fillStyle = `rgb(${isFocus ? ACCENT : WARM})`;
        ctx.font = `${Math.round(11 * Math.min(1.3, d.k))}px var(--font-mono), monospace`;
        ctx.textAlign = "center";
        ctx.fillText(raw.label.slice(0, 26), d.x, d.y - r * 2.2);
      }
    }
    ctx.globalAlpha = 1;
  }, [byId, sim]);

  /**
   * Memories surface on their own, and sink again.
   *
   * Nothing here is triggered by a click. A node with footage behind it will
   * every so often bring it up, hold it for a few seconds and let it go, and
   * then a different one somewhere else in the cloud does the same. The
   * feeling wanted is the tesseract in Interstellar: you are looking at a
   * structure, and moments from inside it keep catching the light.
   *
   * Only nodes currently facing the viewer are eligible. A memory fading up
   * behind the cloud and showing through it looks like a bug rather than
   * like depth.
   */
  useEffect(() => {
    let n = 0;
    const spawn = () => {
      setFlares((live) => {
        const now = performance.now();
        const kept = live.filter((f) => now - (flareBorn.current.get(f.key) ?? now) < FLARE_LIFE);
        if (kept.length >= FLARE_MAX) return kept;

        const busy = new Set(kept.map((f) => f.node.id));
        const eligible = WITH_FOOTAGE.filter((node) => {
          if (busy.has(node.id)) return false;
          const p = screen.current.get(node.id);
          // Front half of the cloud, and comfortably inside the frame.
          return !!p && p.z < 40 && p.x > 150 && p.y > 90;
        });
        if (!eligible.length) return kept;

        const node = eligible[Math.floor(Math.random() * eligible.length)];
        const key = ++n;
        flareBorn.current.set(key, now);
        return [...kept, { key, node }];
      });
    };

    const first = setTimeout(spawn, 1800);
    const every = setInterval(spawn, 2600);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  /**
   * One loop: settle, then keep simulating gently, spinning and drawing.
   *
   * The first two seconds run hot and decay, so the cloud visibly finds its
   * own shape instead of appearing pre-arranged. Pre-settling in an effect was
   * the first approach and it both blocked the first paint and threw away the
   * one moment where the layout explains itself.
   */
  const heat = useRef(1);
  /** Drives the slow breath on nodes that hold footage. */
  const beat = useRef(0);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      const dt = last ? Math.min(64, t - last) : 16;
      last = t;
      heat.current = Math.max(0.055, heat.current * 0.985);
      beat.current += dt * 0.0016;
      sim.tick(heat.current);
      if (view.current.spin && !drag.current) {
        view.current.yaw += 0.00013 * dt;
      }
      draw();

      // Flares ride the cloud. Their position comes from the same projection
      // the canvas just used, so a surfaced memory stays pinned to its node
      // while the whole thing turns, and fades with its node's depth.
      const now = performance.now();
      for (const [key, el] of flareEls.current) {
        if (!el) continue;
        const born = flareBorn.current.get(key) ?? now;
        const age = now - born;
        const id = el.dataset.node ?? "";
        const p = screen.current.get(id);
        if (!p) continue;

        const rise =
          age < FLARE_IN
            ? age / FLARE_IN
            : age < FLARE_IN + FLARE_HOLD
              ? 1
              : Math.max(0, 1 - (age - FLARE_IN - FLARE_HOLD) / FLARE_OUT);
        const eased = rise * rise * (3 - 2 * rise);
        const depth = Math.max(0.35, Math.min(1, p.r));

        el.style.opacity = String(eased * depth);
        // Drifts up a little as it fades, which is what makes it read as
        // surfacing rather than as a popup.
        el.style.transform =
          `translate3d(${p.x - 78}px, ${p.y - 62 - (1 - eased) * 14}px, 0)` +
          ` scale(${(0.82 + 0.18 * eased) * depth})`;
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [sim, draw]);

  /** Nearest drawn node to a screen point, or nothing. */
  const at = useCallback((mx: number, my: number): RawNode | null => {
    let best: { id: string; d: number } | null = null;
    for (const [id, p] of screen.current) {
      const dx = p.x - mx;
      const dy = p.y - my;
      const d = dx * dx + dy * dy;
      const reach = Math.max(11, p.r * 16) ** 2;
      if (d < reach && (!best || d < best.d)) best = { id, d };
    }
    return best ? byId.get(best.id) ?? null : null;
  }, [byId]);

  const onMove = (e: React.PointerEvent) => {
    const box = canvas.current?.getBoundingClientRect();
    if (!box) return;
    const mx = e.clientX - box.left;
    const my = e.clientY - box.top;

    if (drag.current) {
      view.current.yaw += (mx - drag.current.x) * 0.006;
      view.current.pitch = Math.max(
        -1.3,
        Math.min(1.3, view.current.pitch + (my - drag.current.y) * 0.006),
      );
      drag.current = { x: mx, y: my };
      return;
    }

    const found = at(mx, my);
    if ((found?.id ?? null) !== hoverId.current) {
      hoverId.current = found?.id ?? null;
      setHover(found);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-[24px] font-medium text-chalk">What Pep knows</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
            Every node here is a row in HydraDB. Orange is what is still true;
            grey is what used to be, and the orange lines between them are the
            edges saying which replaced which.
          </p>
        </div>
        <span className="font-mono text-[11px] text-muted-2">
          {DATA.nodes.length} nodes · {DATA.edges.length} edges
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="find anything in the graph"
          className="w-56 rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[11px] text-chalk ring-1 ring-white/[0.08] outline-none placeholder:text-muted-2 focus:ring-accent/40"
        />
        {Object.entries(KIND_LABEL).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(filter === k ? null : k)}
            className={`rounded-md px-2 py-1 font-mono text-[10px] tracking-[0.06em] transition-colors ${
              filter === k
                ? "bg-accent text-canvas"
                : "bg-white/[0.05] text-muted hover:bg-white/[0.1] hover:text-warm"
            }`}
            title={label}
          >
            {k}
          </button>
        ))}
        <button
          onClick={() => {
            view.current.spin = !view.current.spin;
          }}
          className="ml-auto rounded-md bg-white/[0.05] px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:bg-white/[0.1] hover:text-warm"
        >
          drag to turn it
        </button>
      </div>

      <div
        ref={wrap}
        className="relative mt-3 min-h-0 flex-1 overflow-hidden rounded-xl bg-[#050505] ring-1 ring-white/[0.07]"
      >
        <canvas
          ref={canvas}
          className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={(e) => {
            const box = canvas.current?.getBoundingClientRect();
            if (!box) return;
            drag.current = { x: e.clientX - box.left, y: e.clientY - box.top };
            (e.target as Element).setPointerCapture?.(e.pointerId);
          }}
          onPointerUp={(e) => {
            const box = canvas.current?.getBoundingClientRect();
            drag.current = null;
            if (!box) return;
            const found = at(e.clientX - box.left, e.clientY - box.top);
            setPicked(found);
          }}
          onPointerMove={onMove}
          onPointerLeave={() => {
            drag.current = null;
            hoverId.current = null;
            setHover(null);
          }}
          onWheel={(e) => {
            view.current.zoom = Math.max(
              0.35,
              Math.min(3.2, view.current.zoom * (e.deltaY > 0 ? 0.93 : 1.07)),
            );
          }}
        />

        {/* What is under the cursor, before you commit to clicking it. */}
        {hover && !picked && (
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-sm rounded-lg bg-black/80 px-3 py-2 ring-1 ring-white/10 backdrop-blur-sm">
            <p className="font-mono text-[9px] tracking-[0.12em] text-accent uppercase">
              {KIND_LABEL[hover.kind] ?? hover.kind}
            </p>
            <p className="mt-1 text-[13px] text-chalk">{hover.label}</p>
            {hover.sub && (
              <p className="mt-0.5 font-mono text-[10px] text-muted">{hover.sub}</p>
            )}
          </div>
        )}

        {/* Memories catching the light. Positioned by the frame loop, not by
            React: they follow their node as the cloud turns, and a re-render
            per frame to move two small boxes would be absurd. */}
        {flares.map((f) => (
          <div
            key={f.key}
            data-node={f.node.id}
            ref={(el) => {
              flareEls.current.set(f.key, el);
            }}
            className="pointer-events-none absolute top-0 left-0 w-[156px] origin-center will-change-transform"
            style={{ opacity: 0 }}
          >
            <div className="overflow-hidden rounded-lg shadow-[0_0_40px_rgba(255,87,26,0.35)] ring-1 ring-accent/50">
              <video
                className="block w-full"
                src={f.node.clip ?? undefined}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-hidden
              />
            </div>
            <p className="mt-1 truncate text-center font-mono text-[9px] tracking-[0.08em] text-accent/90 uppercase">
              {f.node.label}
            </p>
          </div>
        ))}

        {picked && <Detail node={picked} onClose={() => setPicked(null)} />}
      </div>
    </div>
  );
}

/**
 * One node, opened.
 *
 * A match with footage plays it here rather than sending anyone to another
 * screen, which is the whole reason for drawing the graph rather than listing
 * it: the video is a property of a node, so it should come out of the node.
 */
function Detail({ node, onClose }: { node: RawNode; onClose: () => void }) {
  return (
    <div className="absolute top-3 right-3 w-[19rem] overflow-hidden rounded-xl bg-surface/95 ring-1 ring-white/12 backdrop-blur">
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-3 py-2.5">
        <div className="min-w-0">
          <p className="font-mono text-[9px] tracking-[0.12em] text-accent uppercase">
            {KIND_LABEL[node.kind] ?? node.kind}
          </p>
          <p className="mt-1 truncate text-[14px] text-chalk">{node.label}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:bg-white/[0.08] hover:text-chalk"
        >
          close
        </button>
      </div>

      {node.clip && (
        <video
          className="block w-full"
          src={node.clip}
          autoPlay
          muted
          loop
          playsInline
          aria-label={`Footage from ${node.label}`}
        />
      )}

      {node.photo && node.kind === "player" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={node.photo}
          alt={node.label}
          // These are press portraits, 492 by 640. A short landscape box with
          // object-top crops them between the forehead and the nose, which is
          // what this looked like. A 4:3 box loses far less, and the crop
          // point sits below the top of the frame so the chin survives.
          className="block aspect-[4/3] w-full object-cover object-[center_22%]"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}

      <div className="px-3 py-2.5">
        {node.sub && (
          <p className="font-mono text-[10px] leading-relaxed text-warm-2">{node.sub}</p>
        )}
        {typeof node.value === "number" && node.value !== 0 && (
          <p className="mt-1.5 font-mono text-[11px] text-accent">median {node.value}</p>
        )}
        <p className="mt-2 font-mono text-[9px] text-muted-2">{node.id}</p>
      </div>
    </div>
  );
}
