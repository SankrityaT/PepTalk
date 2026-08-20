//created by kinjal
"use client";

import { useEffect, useRef, useState } from "react";
import type { Moment } from "@/content/pep";

/**
 * The coach's own footage, with the tracker's reading drawn over it.
 *
 * A diagram is the wrong thing to lead with: a coach recognises their game
 * from the picture of it, not from a plan view of dots. So the clip plays
 * here, and every box is a player the model actually found in that frame,
 * coloured by kit after clustering and an officials filter.
 *
 * **Boxes are drawn only where the tracker has that frame.** Broadcast cuts in
 * a single frame, so painting the last wide shot's positions over a close-up
 * lands the boxes on the crowd — which is exactly what happened before the
 * staleness rule existed. Drawing nothing is the honest answer: the system has
 * not seen this frame.
 *
 * Where no clip was cut at all this renders nothing and the caller falls back
 * to the freeze frame, which is still the evidence.
 */

export type TrackedPlayer = { box: number[]; team: number };
export type TrackedFrame = {
  idx: number;
  t: number;
  grass: number;
  players: TrackedPlayer[];
};

export type Read = {
  id: number;
  t: number;
  kind: string;
  headline: string;
  detail: string;
  tracked: number;
};

export type Playable = Moment & {
  clip?: string;
  pass_at?: number;
  excerpt?: boolean;
  frames?: TrackedFrame[];
  detections?: number;
  excluded_non_team?: number;
  reads?: Read[];
};

/** Lighter kit is team 0 by construction. */
const KIT = ["#7ec8f0", "var(--color-accent)"] as const;

/**
 * How far the nearest tracked frame may be from the video's current time
 * before we refuse to draw. Same rule as the full tape player.
 */
const MAX_STALENESS_S = 0.16;

function nearestFrame(frames: TrackedFrame[], t: number): TrackedFrame | null {
  if (!frames.length) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = frames[Math.max(0, lo - 1)];
  const b = frames[lo];
  const best = Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
  return Math.abs(best.t - t) <= MAX_STALENESS_S ? best : null;
}

export function MomentClip({ moment }: { moment: Playable }) {
  const video = useRef<HTMLVideoElement>(null);
  // In state rather than read off the ref during render: the element's own
  // properties are not React's to read while rendering.
  const [clock, setClock] = useState({ t: 0, duration: 0 });
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const raf = useRef<number>(0);

  const src = moment.clip;
  const passAt = moment.pass_at ?? 0;
  const frames = moment.frames ?? [];

  useEffect(() => {
    if (!src) return;
    const tick = () => {
      const v = video.current;
      if (v) {
        setClock((c) =>
          c.t === v.currentTime && c.duration === (v.duration || 0)
            ? c
            : { t: v.currentTime, duration: v.duration || 0 },
        );
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [src]);

  if (!src || failed) return null;

  const { t, duration } = clock;
  const frame = nearestFrame(frames, t);
  const played = duration ? (t / duration) * 100 : 0;
  const mark = duration ? (passAt / duration) * 100 : 0;
  const peak = frames.reduce((n, f) => Math.max(n, f.players.length), 0);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = video.current;
    if (!v || !duration) return;
    const box = e.currentTarget.getBoundingClientRect();
    v.currentTime = ((e.clientX - box.left) / box.width) * duration;
  };

  const reads = moment.reads ?? [];
  // Everything the tracker has said up to now, newest last, so the feed reads
  // in step with the video rather than showing the whole clip at once.
  const said = reads.filter((r) => r.t <= t + 0.05);
  const current = said[said.length - 1];

  return (
    <div className={reads.length ? "grid gap-4 lg:grid-cols-[1.4fr_1fr]" : ""}>
      <div>
      <div className="relative overflow-hidden rounded-lg bg-black">
        {/* Click the picture to stop on the frame you want. A coach pausing on
            the moment is the whole point of showing it. */}
        <button
          type="button"
          onClick={toggle}
          className="block w-full cursor-pointer"
          aria-label={paused ? "Play" : "Pause"}
        >
          <video
            ref={video}
            src={src}
            autoPlay
            loop
            muted
            playsInline
            onError={() => setFailed(true)}
            className="block w-full"
          />
        </button>

        {/* Every box is a player found in this frame. Nothing where the
            tracker has no frame. */}
        <div className="pointer-events-none absolute inset-0">
          {frame?.players.map((p, i) => (
            <span
              key={i}
              className="absolute border"
              style={{
                left: `${p.box[0] * 100}%`,
                top: `${p.box[1] * 100}%`,
                width: `${(p.box[2] - p.box[0]) * 100}%`,
                height: `${(p.box[3] - p.box[1]) * 100}%`,
                borderColor: KIT[p.team] ?? "rgba(255,255,255,0.4)",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
              }}
            />
          ))}
        </div>

        {frames.length > 0 && (
          <span className="pointer-events-none absolute left-2.5 top-2.5 rounded bg-black/70 px-2 py-1 font-mono text-[10px] tabular-nums text-chalk backdrop-blur-sm">
            {frame ? `${frame.players.length} tracked` : "no tracking here"}
          </span>
        )}

        {paused && (
          <span className="pointer-events-none absolute right-2.5 top-2.5 rounded bg-black/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-chalk backdrop-blur-sm">
            paused
          </span>
        )}
      </div>

      {/* Scrubber. The tick marks are the frames the tracker actually read,
          so a coach can see where it had a picture and where it did not. */}
      <div
        onClick={seek}
        className="relative mt-2 h-4 cursor-pointer"
        role="presentation"
      >
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-white/50"
            style={{ width: `${played}%` }}
          />
        </div>
        {duration > 0 &&
          frames.map((f) => (
            <span
              key={f.idx}
              className="absolute top-1/2 h-2 w-[1px] -translate-y-1/2 bg-white/25"
              style={{ left: `${(f.t / duration) * 100}%` }}
            />
          ))}
        {passAt > 0 && !moment.excerpt && duration > 0 && (
          <span
            className="absolute top-1/2 h-3.5 w-[2px] -translate-y-1/2 bg-accent"
            style={{ left: `${mark}%` }}
          />
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-2">
        {moment.excerpt ? (
          <>
            From the footage you sent. It is a highlights reel rather than the
            full match, so this is a passage from the game and not the pass
            below &mdash; that one is drawn on the pitch.
          </>
        ) : (
          <span className="font-mono">
            your footage &middot; the ball is played {passAt.toFixed(1)}s in
          </span>
        )}
        {frames.length > 0 && (
          <>
            {" "}
            <span className="font-mono">
              &middot; {moment.detections ?? 0} detections, {peak} at its
              fullest
            </span>
            . Boxes are drawn only where the tracker actually has that frame.
          </>
        )}
      </p>
      </div>

      {/* ── What Pep sees ───────────────────────────────────────────── */}
      {reads.length > 0 && (
        <div className="flex max-h-[22rem] flex-col overflow-hidden rounded-lg bg-surface ring-1 ring-white/[0.06]">
          <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
              What Pep sees
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-2">
              {fmt(t)} / {fmt(duration)}
            </span>
          </div>

          <ul className="flex-1 overflow-y-auto">
            {said.map((r) => {
              const on = r.id === current?.id;
              return (
                <li
                  key={r.id}
                  className={`border-b border-white/[0.05] px-4 py-3 last:border-b-0 transition-colors ${
                    on ? "bg-accent/[0.09]" : ""
                  }`}
                >
                  <div className="flex items-baseline gap-2.5">
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-2">
                      {fmt(r.t)}
                    </span>
                    <span
                      className={`text-[13px] leading-snug ${on ? "text-chalk" : "text-warm-2"}`}
                    >
                      {r.headline}
                    </span>
                  </div>
                  <p className="mt-1 pl-[3.1rem] text-[11px] leading-relaxed text-muted-2">
                    {r.detail}
                  </p>
                </li>
              );
            })}
            {said.length === 0 && (
              <li className="px-4 py-3 text-[13px] text-muted-2">
                Waiting for the first read&hellip;
              </li>
            )}
          </ul>

          <p className="border-t border-white/[0.07] px-4 py-3 text-[11px] leading-relaxed text-muted-2">
            These are the tracker&rsquo;s own readings. This clip ships no
            camera calibration, so the panel reports what it found and leaves
            the tactics to the event data.
          </p>
        </div>
      )}
    </div>
  );
}

function fmt(s: number): string {
  const n = Math.max(0, Math.floor(s));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

/** Whether a moment has footage behind it. */
export function hasClip(m: Playable | null): boolean {
  return Boolean(m?.clip);
}
