"use client";

import { useEffect, useRef, useState } from "react";
import { KIT, VIDEO, nearestFrame, peakTracked } from "@/lib/tape";

/**
 * A highlight, as moving footage.
 *
 * The brief listed its findings as pitch diagrams, and a diagram is the wrong
 * thing to lead with: a coach recognises their game from the picture of it,
 * not from a plan view of dots. So each highlight is the actual clip, looping
 * its own segment, with the tracking drawn over the top.
 *
 * All three cards share one `<video src>`, so the browser fetches the file
 * once and each element just seeks to a different point. Three separate
 * downloads of the same 6MB would be the obvious way to build this and the
 * wrong one.
 *
 * The overlay obeys the same staleness rule as the full player: where the
 * tracker has no frame for this instant, nothing is drawn.
 */

export function ClipCard({
  from,
  to,
  label,
  active = false,
  onOpen,
}: {
  from: number;
  to: number;
  label: string;
  active?: boolean;
  onOpen?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(from);
  const raf = useRef<number>(0);

  // Loop the segment. `timeupdate` fires about four times a second, which is
  // slow enough to overshoot the end of a seven-second window visibly.
  useEffect(() => {
    const tick = () => {
      const v = video.current;
      if (v) {
        if (v.currentTime < from - 0.2 || v.currentTime > to) v.currentTime = from;
        setT(v.currentTime);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [from, to]);

  const frame = nearestFrame(t);
  const peak = peakTracked(from, to);

  return (
    <button
      onClick={onOpen}
      className={`group relative w-full overflow-hidden rounded-xl bg-black text-left ring-1 transition-all duration-200 ease-[var(--ease-ui)] ${
        active
          ? "ring-accent/60"
          : "ring-white/[0.08] hover:ring-white/[0.2]"
      }`}
    >
      <div className="relative aspect-video w-full">
        <video
          ref={video}
          src={`${VIDEO}#t=${from}`}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
          loop
          autoPlay
          preload="auto"
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

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2.5 pt-8">
          <span className="block text-[13px] font-medium text-chalk">
            {label}
          </span>
          <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-warm-2">
            {frame ? `${frame.players.length} tracked` : "no tracking"} &middot;{" "}
            {peak} at its fullest
          </span>
        </div>

        <span className="pointer-events-none absolute right-2.5 top-2.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-chalk backdrop-blur-sm">
          {Math.round(to - from)}s
        </span>

        <span className="pointer-events-none absolute left-2.5 top-2.5 rounded bg-accent/90 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-canvas opacity-0 transition-opacity group-hover:opacity-100">
          open
        </span>
      </div>
    </button>
  );
}
