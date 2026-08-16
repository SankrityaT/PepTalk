"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import data from "@/content/snapshots/wc-tracking.json";
import { handArc, handArrow, handLine, seededRandom } from "@/lib/hand-drawn";
import {
  Mark,
  defendingLeft,
  defensiveLine,
  mostSpace,
  movementArrows,
} from "@/lib/chalk-reads";

/**
 * The tape.
 *
 * Footage runs, the machine reads it, a coach gets told something. That is the
 * product. An earlier version of this was a draggable timeline of validity
 * intervals, which was a schema browser wearing chalk — nobody opens a schema
 * browser at halftime.
 *
 * Everything overlaid is real. 58 frames of the 2022 World Cup final went
 * through YOLO11 detection, per-frame kit clustering and an officials filter;
 * every box is a player who was standing there. Boxes are stored normalised so
 * the overlay tracks the video element at any size.
 *
 * The reads on the right are computed from the boxes on screen, not fetched.
 * Where a number depends on pitch coordinates we do not have — this clip ships
 * no camera calibration — the panel says so rather than inventing one.
 */

type Player = { box: number[]; team: number };
type Frame = { idx: number; t: number; grass: number; players: Player[] };

const TAPE = data as unknown as {
  source: string;
  video: string;
  frames: Frame[];
  detections: number;
  excluded_non_team: number;
};

const FRAMES = TAPE.frames;
const EASE = [0.4, 0, 0.2, 1] as const;

/** Lighter kit is team 0 by construction. On this match: Argentina. */
const TEAM = [
  { name: "Argentina", colour: "#7ec8f0" },
  { name: "France", colour: "var(--color-accent)" },
] as const;

/**
 * How far the nearest tracked frame may be from the video's current time
 * before we refuse to draw anything.
 *
 * This is the correctness guard. Broadcast cuts between a wide shot and a
 * close-up in a single frame, and non-football frames are dropped during
 * tracking — so there are stretches with no tracking at all. Without this,
 * positions from the last wide shot get painted over a close-up of Di Maria and
 * the boxes land on the crowd, which is exactly what happened.
 *
 * Drawing nothing is the honest answer: the system has not seen this frame.
 */
const MAX_STALENESS_S = 0.16;

function nearestFrame(t: number): Frame | null {
  if (!FRAMES.length) return null;
  let lo = 0;
  let hi = FRAMES.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (FRAMES[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = FRAMES[Math.max(0, lo - 1)];
  const b = FRAMES[lo];
  const best = Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
  return Math.abs(best.t - t) <= MAX_STALENESS_S ? best : null;
}

function CornerTicks() {
  const t = "absolute h-3 w-3 border-accent";
  return (
    <>
      <span className={`${t} -top-px -left-px border-t border-l`} />
      <span className={`${t} -top-px -right-px border-t border-r`} />
      <span className={`${t} -bottom-px -left-px border-b border-l`} />
      <span className={`${t} -bottom-px -right-px border-b border-r`} />
    </>
  );
}

/** Compactness of a team in the frame, in screen terms. */
function readTeam(f: Frame, team: number) {
  const p = f.players.filter((x) => x.team === team);
  if (p.length < 3) return null;
  const cx = p.map((x) => (x.box[0] + x.box[2]) / 2);
  const feet = p.map((x) => x.box[3]);
  return {
    n: p.length,
    spread: Math.max(...cx) - Math.min(...cx),
    depth: Math.max(...feet) - Math.min(...feet),
    lead: Math.max(...cx),
  };
}

export function Tape() {
  const video = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const raf = useRef<number>(0);

  // Drive overlay state off requestAnimationFrame rather than timeupdate:
  // timeupdate fires roughly 4x a second, which makes boxes visibly lag the
  // players they belong to.
  //
  // Synced unconditionally rather than only while playing, so scrubbing a
  // paused video moves the boxes too.
  useEffect(() => {
    const tick = () => {
      const v = video.current;
      if (v) setT(v.currentTime);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  // Poll readiness on mount as well as listening for the event. A cached or
  // fast-loading video reaches readyState 4 before React attaches
  // onLoadedData, so the event never fires for us and the overlay stays empty
  // over a perfectly good video — which is exactly what happened.
  useEffect(() => {
    const v = video.current;
    if (v && v.readyState >= 2) setReady(true);
  }, []);

  const frame = useMemo(() => nearestFrame(t), [t]);
  const prevFrame = useMemo(() => {
    if (!frame) return null;
    const i = FRAMES.indexOf(frame);
    return i > 0 ? FRAMES[i - 1] : null;
  }, [frame]);
  const a = useMemo(() => (frame ? readTeam(frame, 0) : null), [frame]);
  const b = useMemo(() => (frame ? readTeam(frame, 1) : null), [frame]);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }, []);

  const clock = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(
    Math.floor(t % 60),
  ).padStart(2, "0")}`;

  return (
    <div className="relative border border-rule bg-white/[0.02]">
      <CornerTicks />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-1.5 w-1.5 bg-accent ${playing ? "animate-pulse" : "opacity-40"}`}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
            {playing ? "Reading tape" : "Paused"}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-2">{clock}</span>
        </div>
        <span className="truncate font-mono text-[10px] text-muted-2">{TAPE.source}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_17rem]">
        {/* ── Footage + overlay ─────────────────────────────────────── */}
        <div className="border-b border-rule lg:border-r lg:border-b-0">
          <div className="relative aspect-video w-full bg-black">
            <video
              ref={video}
              src={TAPE.video}
              className="absolute inset-0 h-full w-full object-cover"
              playsInline
              muted
              loop
              preload="metadata"
              onLoadedData={() => setReady(true)}
              onClick={toggle}
            />

            {/* Boxes. Normalised coordinates, so this layer needs no knowledge
                of the rendered video size. */}
            <div className="pointer-events-none absolute inset-0">
              {ready &&
                frame?.players.map((p, i) => {
                  const [x1, y1, x2, y2] = p.box;
                  const c = TEAM[p.team]?.colour ?? "var(--color-muted)";
                  return (
                    <span
                      key={i}
                      className="absolute border"
                      style={{
                        left: `${x1 * 100}%`,
                        top: `${y1 * 100}%`,
                        width: `${(x2 - x1) * 100}%`,
                        height: `${(y2 - y1) * 100}%`,
                        borderColor: c,
                        boxShadow: `0 0 6px ${c}55`,
                      }}
                    />
                  );
                })}
            </div>

            {/* Chalk. The coach's marks: where the line is holding, who moved,
                who is free. Drawn in the same hand as the rest of the site. */}
            {ready && frame && <ChalkLayer frame={frame} prev={prevFrame} />}

            {/* Readout, bottom-left, like a camera. When there is no tracking
                for this frame it says so: replays, close-ups and celebrations
                are not football, and claiming to read them would be a lie the
                rest of the product is built on not telling. */}
            <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 bg-black/60 px-2 py-1">
              {frame ? (
                <>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
                    tracked
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-chalk">
                    {frame.players.length}
                  </span>
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 bg-muted-2" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-2">
                    not a live shot
                  </span>
                </>
              )}
            </div>

            {!playing && (
              <button
                onClick={toggle}
                aria-label="Play the tape"
                className="absolute inset-0 flex items-center justify-center bg-black/35 transition-colors hover:bg-black/20"
              >
                <span className="border border-accent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-chalk">
                  Play
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 px-4 py-3">
            <button
              onClick={toggle}
              className="border border-rule px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-chalk transition-colors hover:bg-white/5"
            >
              {playing ? "Pause" : "Play"}
            </button>
            <input
              type="range"
              min={0}
              max={90}
              step={0.1}
              value={t}
              onChange={(e) => {
                const v = video.current;
                if (v) v.currentTime = Number(e.target.value);
                setT(Number(e.target.value));
              }}
              aria-label="Scrub the tape"
              className="h-1 w-full cursor-ew-resize appearance-none bg-rule accent-[var(--color-accent)]"
            />
          </div>
        </div>

        {/* ── Live read ─────────────────────────────────────────────── */}
        <div className="flex flex-col">
          <div className="border-b border-rule px-5 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              Live read
            </span>
          </div>

          {[
            { s: a, t: TEAM[0] },
            { s: b, t: TEAM[1] },
          ].map(({ s, t: team }) => (
            <div key={team.name} className="border-b border-rule px-5 py-4">
              <div className="flex items-center gap-2">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: team.colour }}
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chalk-2">
                  {team.name}
                </span>
                <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-2">
                  {s ? `${s.n} in shot` : "—"}
                </span>
              </div>

              <AnimatePresence mode="wait">
                <motion.dl
                  key={(frame?.idx ?? -1) + team.name}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15, ease: EASE }}
                  className="mt-3 flex flex-col gap-1.5"
                >
                  {s ? (
                    <>
                      <Row k="spread" v={`${Math.round(s.spread * 100)}%`} />
                      <Row k="depth" v={`${Math.round(s.depth * 100)}%`} />
                    </>
                  ) : (
                    <span className="font-mono text-[10px] text-muted-2">
                      too few in shot to read
                    </span>
                  )}
                </motion.dl>
              </AnimatePresence>
            </div>
          ))}

          <div className="px-5 py-4">
            <p className="font-mono text-[10px] leading-relaxed text-muted-2">
              Spread and depth are measured in frame, not on the pitch: this clip
              ships no camera calibration, so metres would be a guess. Detection
              and kit clustering run on the frames themselves.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The chalk overlay.
 *
 * A 1000x562 viewBox stretched over the video, so the normalised box space maps
 * straight onto it and the marks scale with the player rather than the window.
 *
 * The seed is derived from the frame index, so the hand-wobble is stable for a
 * given frame instead of reshuffling every render — a line that jitters while
 * the video is paused reads as a glitch, not as chalk.
 */
function ChalkLayer({ frame, prev }: { frame: Frame; prev: Frame | null }) {
  const W = 1000;
  const H = 562;

  const marks = useMemo(() => {
    const out: Mark[] = [];
    for (const team of [0, 1]) {
      const line = defensiveLine(frame.players, team, defendingLeft(frame.players, team));
      if (line) out.push(line);
    }
    const space = mostSpace(frame.players, 0) ?? mostSpace(frame.players, 1);
    if (space) out.push(space);
    if (prev) out.push(...movementArrows(prev.players, frame.players));
    return out;
  }, [frame, prev]);

  const rand = useMemo(() => seededRandom(frame.idx || 1), [frame.idx]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <g className="chalk-stroke" fill="none" strokeLinecap="round">
        {marks.map((m, i) => {
          const colour = TEAM[m.team]?.colour ?? "var(--color-chalk)";
          if (m.kind === "line") {
            return (
              <path
                key={i}
                d={handLine(m.x1 * W, m.y1 * H, m.x2 * W, m.y2 * H, rand, 3)}
                stroke={colour}
                strokeWidth={2.2}
                opacity={0.85}
              />
            );
          }
          if (m.kind === "arrow") {
            return (
              <path
                key={i}
                d={handArrow(m.x1 * W, m.y1 * H, m.x2 * W, m.y2 * H, rand, 13)}
                stroke={colour}
                strokeWidth={1.8}
                opacity={0.7}
              />
            );
          }
          return (
            <g key={i}>
              <path
                d={handArc(m.cx * W, m.cy * H, m.r * W, 0, Math.PI * 2, rand)}
                stroke="var(--color-chalk)"
                strokeWidth={2}
                opacity={0.9}
              />
              <text
                x={m.cx * W}
                y={m.cy * H - m.r * W - 8}
                textAnchor="middle"
                className="font-mono"
                fontSize={13}
                fill="var(--color-chalk)"
                opacity={0.8}
                style={{ filter: "none" }}
              >
                {m.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="font-mono text-[10px] text-muted">{k}</dt>
      <dd className="font-mono text-[11px] tabular-nums text-chalk">{v}</dd>
    </div>
  );
}
