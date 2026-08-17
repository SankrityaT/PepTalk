"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChalkOverlay } from "@/components/brief/chalk-overlay";
import { KIT } from "@/content/clip";

/**
 * The one video player. Boxes, chalk, and controls that are always on screen.
 *
 * There were three of these and they drifted, which is how the goals section
 * ended up with a video that stops on the moment and no visible way to play it
 * again: the fix had been applied to the walkthrough only. A coach who cannot
 * find a play button assumes the video is broken, and they are not wrong to.
 *
 * Everything drawn over the frame is computed from that frame: boxes from the
 * tracker, chalk in the tracker's own normalised space. Where the tracker has
 * no frame for the current instant nothing is drawn, rather than the last good
 * positions being painted over a cut.
 */

export type Frame = {
  idx: number;
  t: number;
  grass: number;
  players: { box: number[]; team: number }[];
};

const MAX_STALENESS_S = 0.14;

function frameAt(frames: Frame[], t: number): Frame | null {
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

export function TapePlayer({
  src,
  frames,
  /** Stop here, because this is the thing worth looking at. */
  stopAt,
  /**
   * Where the broadcast is on the pitch. A window is cut six seconds before
   * the pass and the director is sometimes still on a close-up, so starting at
   * zero puts two shirts filling the frame as the poster image. Every replay
   * and rewind starts here instead.
   */
  startAt = 0,
  /** Shown over the frame once it stops. */
  stopLabel = "the moment",
  /** Top-left badge, usually a clock. */
  clock,
  /** Whose shape the chalk describes. */
  chalkTeam = 1,
  chalk = true,
  seed = 7,
  autoPlay = true,
  onReachedStop,
  playing,
  onPlayingChange,
}: {
  src: string;
  frames: Frame[];
  stopAt?: number;
  startAt?: number;
  stopLabel?: string;
  clock?: (t: number) => string;
  chalkTeam?: number;
  chalk?: boolean;
  seed?: number;
  autoPlay?: boolean;
  /** Fired once when playback reaches `stopAt`. */
  onReachedStop?: () => void;
  /** Controlled transport, so the session and the tape cannot disagree. */
  playing?: boolean;
  onPlayingChange?: (playing: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const raf = useRef<number>(0);
  const duration = frames.length ? frames[frames.length - 1].t : undefined;

  // Reset for a new clip during render rather than in an effect: an effect
  // paints the previous clip's state for a frame first, and the player is
  // swapped between moments often enough to see it.
  const [loaded, setLoaded] = useState({ src, t: 0, paused: !autoPlay });
  if (loaded.src !== src) setLoaded({ src, t: 0, paused: !autoPlay });
  const t = loaded.src === src ? loaded.t : 0;
  const paused = loaded.src === src ? loaded.paused : !autoPlay;
  const setT = (v: number) => setLoaded((p) => ({ ...p, t: v }));
  const setPaused = (v: boolean) => setLoaded((p) => ({ ...p, paused: v }));

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const go = () => {
      v.currentTime = startAt;
      if (autoPlay) v.play().catch(() => {});
    };
    if (v.readyState >= 1) go();
    else v.addEventListener("loadedmetadata", go, { once: true });
  }, [src, autoPlay]);

  // Fired once per clip: the session listens for it and moves the thread on,
  // so the rhythm follows the passage rather than a stopwatch.
  //
  // Held in a ref because the animation loop below is created once per clip
  // and would otherwise keep calling whichever callback existed at that
  // moment. The first version captured the one from the preview render, where
  // it was undefined, so the session reached its first moment and stopped
  // there forever.
  // Kept current in an effect rather than during render: the loop only ever
  // reads it from a frame callback, long after commit, so there is nothing to
  // gain from the earlier write and a rule against it either way.
  const announced = useRef(false);
  const reportStop = useRef(onReachedStop);
  useEffect(() => {
    reportStop.current = onReachedStop;
  });
  useEffect(() => {
    announced.current = false;
  }, [src]);

  useEffect(() => {
    const tick = () => {
      const v = video.current;
      if (v) {
        setT(v.currentTime);
        if (!v.paused && stopAt !== undefined && v.currentTime >= stopAt) {
          v.pause();
          setPaused(true);
          if (!announced.current) {
            announced.current = true;
            reportStop.current?.();
          }
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopAt, src]);

  // Follow the session's transport when it is driving.
  useEffect(() => {
    const v = video.current;
    if (!v || playing === undefined) return;
    if (playing && v.paused) v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
    setPaused(!playing);
  }, [playing]);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    // Replay rather than resume when we are sitting on the stop point, which
    // is where this player spends most of its life.
    if (v.paused) {
      if (stopAt !== undefined && v.currentTime >= stopAt - 0.05) {
        v.currentTime = startAt;
        announced.current = false;
      }
      v.play().catch(() => {});
      setPaused(false);
      onPlayingChange?.(true);
    } else {
      v.pause();
      setPaused(true);
      onPlayingChange?.(false);
    }
  }, [stopAt, onPlayingChange]);

  const replay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    v.currentTime = startAt;
    announced.current = false;
    v.play().catch(() => {});
    setPaused(false);
    onPlayingChange?.(true);
  }, [onPlayingChange]);

  const frame = frameAt(frames, t);
  const prev = frame ? frames[Math.max(0, frames.indexOf(frame) - 3)] : undefined;
  const dur = duration ?? (stopAt ?? 10) + 4;

  return (
    <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]">
      <div className="relative aspect-video w-full bg-black">
        <video
          ref={video}
          src={src}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
          preload="auto"
          onClick={toggle}
        />

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

        {chalk && frame && (
          <ChalkOverlay
            players={frame.players}
            previous={prev?.players}
            team={chalkTeam}
            seed={seed}
          />
        )}

        <span className="pointer-events-none absolute top-3 left-3 rounded bg-black/75 px-2 py-1 font-mono text-[10px] tabular-nums text-chalk backdrop-blur-sm">
          {clock ? clock(t) : `${t.toFixed(1)}s`}
          {frame ? ` · ${frame.players.length} tracked` : ""}
        </span>

        <AnimatePresence>
          {paused && stopAt !== undefined && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute top-3 right-3 rounded bg-accent px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-canvas uppercase"
            >
              {stopLabel}
            </motion.span>
          )}
        </AnimatePresence>

        {/* A big obvious target when stopped. The small bar below is for
            scrubbing; this is for "make it go". */}
        <AnimatePresence>
          {paused && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={toggle}
              aria-label="Play"
              className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/15"
            >
              <span className="flex size-14 items-center justify-center rounded-full bg-accent/90 text-canvas shadow-lg">
                <svg width="16" height="18" viewBox="0 0 16 18" fill="currentColor">
                  <path d="M0 0l16 9-16 9z" />
                </svg>
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ── Controls. Always on screen, never behind a scroll. ────────── */}
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <button
          onClick={toggle}
          aria-label={paused ? "Play" : "Pause"}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-warm transition-colors hover:bg-white/[0.13] hover:text-chalk"
        >
          {paused ? (
            <svg width="11" height="12" viewBox="0 0 16 18" fill="currentColor">
              <path d="M0 0l16 9-16 9z" />
            </svg>
          ) : (
            <svg width="11" height="12" viewBox="0 0 16 18" fill="currentColor">
              <path d="M0 0h5v18H0zM11 0h5v18h-5z" />
            </svg>
          )}
        </button>

        <div
          className="relative h-5 flex-1 cursor-pointer"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const v = video.current;
            if (v) v.currentTime = ((e.clientX - r.left) / r.width) * dur;
          }}
        >
          <span className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 rounded-full bg-white/[0.09]" />
          <span
            className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-accent"
            style={{ width: `${Math.min(100, (t / dur) * 100)}%` }}
          />
          {stopAt !== undefined && (
            <span
              title={stopLabel}
              className="absolute top-1/2 h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-chalk"
              style={{ left: `${Math.min(100, (stopAt / dur) * 100)}%` }}
            />
          )}
        </div>

        <button
          onClick={replay}
          className="shrink-0 rounded-lg bg-white/[0.05] px-2.5 py-1.5 font-mono text-[10px] text-warm transition-colors hover:bg-white/[0.11] hover:text-chalk"
        >
          run it again
        </button>
      </div>
    </div>
  );
}
