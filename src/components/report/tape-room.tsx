"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import reads from "@/content/snapshots/tape-reads.json";
import {
  DETECTIONS,
  DURATION,
  KIT,
  OFFICIALS,
  VIDEO,
  clock,
  nearestFrame,
} from "@/lib/tape";

/**
 * The tape, with Pep talking over it.
 *
 * This is the thing the product is actually for: footage runs, the machine
 * reads it, and a coach is told what it found — on the video, not on a diagram
 * beside the video.
 *
 * Every box is a player YOLO11 found in that frame, after per-frame kit
 * clustering and an officials filter. The feed on the right streams in step
 * with playback, and each line reports the tracker's real state at that
 * timestamp.
 *
 * **What the feed will not say.** Tactical claims — overloads, spare men,
 * someone free — were built here first and cut, because a broadcast clip with
 * no camera calibration cannot support them. The count in a shot follows the
 * camera, not the pitch: the strongest "overload" measured was 12 against 4.
 * "Nobody near him" fired in 286 of 297 frames, so it selected nothing. Kit
 * clustering skews far enough to report twelve France shirts, two more than a
 * team can field.
 *
 * So the tactical reasoning lives on the event stream, where there are pitch
 * coordinates and a ball, and this panel restricts itself to what the pixels
 * genuinely support. That division is the honest one, and it is stated on
 * screen rather than buried here.
 */

type Entry = {
  id: number;
  t: number;
  kind: string;
  headline: string;
  detail: string;
  tracked: number;
};

const FEED = (reads as unknown as { entries: Entry[] }).entries;
const EASE = [0.4, 0, 0.2, 1] as const;

export function TapeRoom({ startAt = 0 }: { startAt?: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [t, setT] = useState(startAt);
  const [playing, setPlaying] = useState(true);
  const raf = useRef<number>(0);

  // Jump to the segment the coach opened, once the file is seekable.
  useEffect(() => {
    const v = video.current;
    if (!v || !startAt) return;
    const go = () => {
      v.currentTime = startAt;
    };
    if (v.readyState >= 1) go();
    else v.addEventListener("loadedmetadata", go, { once: true });
  }, [startAt]);

  // Driven off requestAnimationFrame rather than `timeupdate`, which fires
  // about four times a second and makes the boxes visibly trail the players
  // they belong to. Synced while paused too, so scrubbing moves them.
  useEffect(() => {
    const tick = () => {
      const v = video.current;
      if (v) setT(v.currentTime);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const frame = useMemo(() => nearestFrame(t), [t]);

  // Everything Pep has said by now. The feed accumulates rather than replacing
  // so a coach can look away and still catch up.
  const said = useMemo(() => FEED.filter((e) => e.t <= t + 0.05), [t]);
  const current = said[said.length - 1] ?? null;

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [said.length]);

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

  const seek = useCallback((to: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = to;
    setT(to);
  }, []);

  return (
    <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-1.5 w-1.5">
            {playing && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
            )}
            <span
              className={`relative inline-flex h-1.5 w-1.5 rounded-full bg-accent ${
                playing ? "" : "opacity-40"
              }`}
            />
          </span>
          <span className="text-[15px] font-medium text-chalk">
            {playing ? "Pep is watching" : "Paused"}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted-2">
            {clock(t)} / {clock(DURATION)}
          </span>
        </div>
        <span className="truncate font-mono text-[10px] text-muted-2">
          {DETECTIONS.toLocaleString()} detections &middot;{" "}
          {OFFICIALS} officials dropped
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_19rem]">
        {/* ── The video ─────────────────────────────────────────────────── */}
        <div className="border-b border-white/[0.06] lg:border-r lg:border-b-0">
          <div className="relative aspect-video w-full bg-black">
            <video
              ref={video}
              src={VIDEO}
              className="absolute inset-0 h-full w-full object-cover"
              playsInline
              muted
              loop
              autoPlay
              preload="auto"
              onClick={toggle}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />

            {/* Boxes. Stored normalised, so this layer needs no knowledge of
                the rendered video size. */}
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
                    boxShadow: `0 0 0 1px rgba(0,0,0,0.45)`,
                  }}
                />
              ))}
            </div>

            {/* The live count, over the picture. */}
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded bg-black/70 px-2 py-1 backdrop-blur-sm">
              <span className="h-1 w-1 rounded-full bg-accent" />
              <span className="font-mono text-[10px] tabular-nums text-chalk">
                {frame ? `${frame.players.length} tracked` : "no tracking"}
              </span>
            </div>

            {!frame && (
              <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-muted backdrop-blur-sm">
                not a live shot — drawing nothing
              </div>
            )}

            {!playing && (
              <button
                onClick={toggle}
                aria-label="Play"
                className="absolute inset-0 flex items-center justify-center bg-black/35 transition-colors hover:bg-black/25"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/90 text-canvas">
                  <svg width="16" height="18" viewBox="0 0 16 18" fill="currentColor">
                    <path d="M0 0l16 9-16 9z" />
                  </svg>
                </span>
              </button>
            )}
          </div>

          {/* ── Scrubber, with a tick per thing Pep said ───────────────── */}
          <div className="px-5 py-4">
            <div
              className="relative h-6 cursor-pointer"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                seek(((e.clientX - r.left) / r.width) * DURATION);
              }}
            >
              <div className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 rounded-full bg-white/[0.08]" />
              <div
                className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-accent"
                style={{ width: `${(t / DURATION) * 100}%` }}
              />
              {FEED.map((e) => (
                <span
                  key={e.id}
                  className={`absolute top-1/2 h-2 w-[2px] -translate-y-1/2 rounded-full ${
                    e.t <= t ? "bg-accent" : "bg-white/25"
                  }`}
                  style={{ left: `${(e.t / DURATION) * 100}%` }}
                />
              ))}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-2">
              Boxes are drawn only where the tracker actually has that frame.
              Where it does not, nothing is drawn rather than guessed.
            </p>
          </div>
        </div>

        {/* ── Pep's feed ────────────────────────────────────────────────── */}
        <div className="flex max-h-[30rem] flex-col">
          <div className="border-b border-white/[0.06] px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
              what Pep sees
            </span>
          </div>

          <ul ref={list} className="flex-1 overflow-y-auto px-4 py-3">
            <AnimatePresence initial={false}>
              {said.map((e) => {
                const on = current?.id === e.id;
                return (
                  <motion.li
                    key={e.id}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className="mb-2.5 last:mb-0"
                  >
                    <button
                      onClick={() => seek(e.t)}
                      className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-200 ${
                        on
                          ? "bg-accent/[0.12] ring-1 ring-accent/25"
                          : "bg-white/[0.03] hover:bg-white/[0.06]"
                      }`}
                    >
                      <span className="flex items-baseline gap-2">
                        <span
                          className={`font-mono text-[10px] tabular-nums ${
                            on ? "text-accent" : "text-muted-2"
                          }`}
                        >
                          {clock(e.t)}
                        </span>
                        <span className="text-[13px] leading-snug text-warm">
                          {e.headline}
                        </span>
                      </span>
                      <span className="mt-1 block font-mono text-[10px] leading-relaxed text-muted-2">
                        {e.detail}
                      </span>
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>

          <p className="border-t border-white/[0.06] px-4 py-3 font-mono text-[9px] leading-relaxed text-muted-2">
            These are the tracker&rsquo;s own readings. This clip ships no camera
            calibration, so the panel reports what it found and leaves the
            tactics to the event data below.
          </p>
        </div>
      </div>
    </div>
  );
}
