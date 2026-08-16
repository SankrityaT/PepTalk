"use client";

import { motion } from "motion/react";
import { MatchRow, result, scoreline } from "@/content/dashboard";

/**
 * One game Pep has already been through.
 *
 * The card carries a **shape fingerprint** rather than a thumbnail: a pitch the
 * size of a postage stamp with the side's press line and average width drawn on
 * it. A still frame from the video would look busier and say nothing — every
 * match looks like grass and shirts. This says how the team stood up, and two
 * cards side by side are instantly comparable, which is the whole point of a
 * feed.
 *
 * Every figure is the `PLAYED` edge from HydraDB. The one sentence underneath
 * is derived from those figures in code, not written per match — there is no
 * hand-authored prose hiding in this dashboard.
 */

const PITCH_LENGTH_M = 105;
const PITCH_WIDTH_M = 68;

const W = 100;
const H = 64;

const EASE = [0.4, 0, 0.2, 1] as const;

const RESULT_TONE = {
  W: "text-accent",
  D: "text-muted",
  L: "text-muted-2",
} as const;

/**
 * The card's one line, derived. Ordered by what a coach would notice first:
 * a scoring problem beats a possession note, which beats a pressing note.
 */
function read(m: MatchRow, pressMean: number): string {
  const { us } = scoreline(m);
  if (m.xg >= 1.8 && us <= 1) {
    return `Made ${m.xg.toFixed(1)} goals' worth of chances and took ${us}.`;
  }
  if (m.poss >= 60) {
    return `Had the ball ${Math.round(m.poss)}% of the game and ${m.shots} shots from it.`;
  }
  if (m.poss <= 46) {
    return `Gave up the ball — ${Math.round(m.poss)}% — and still got ${m.shots} away.`;
  }
  const dp = m.press - pressMean;
  if (Math.abs(dp) >= 3) {
    return `Pressed ${Math.abs(dp).toFixed(0)}m ${dp > 0 ? "higher" : "deeper"} than your usual.`;
  }
  return `${m.shots} shots, ${m.xg.toFixed(1)} expected goals. A normal night.`;
}

export function MatchCard({
  m,
  pressMean,
  featured = false,
  onOpen,
  index = 0,
}: {
  m: MatchRow;
  pressMean: number;
  featured?: boolean;
  onOpen?: () => void;
  index?: number;
}) {
  const { us, them, opponent } = scoreline(m);
  const r = result(m);

  // Press line: distance up the pitch, drawn as a vertical mark.
  const px = (m.press / PITCH_LENGTH_M) * W;
  // Width: a band centred on the pitch's middle.
  const bh = (m.width / PITCH_WIDTH_M) * H;

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay: Math.min(index, 8) * 0.045, ease: EASE }}
      onClick={onOpen}
      disabled={!onOpen}
      className={`group relative flex w-full flex-col gap-3.5 rounded-xl p-4 text-left ring-1 transition-all duration-200 ease-[var(--ease-ui)] ${
        featured
          ? "bg-surface-2 ring-accent/30 hover:ring-accent/60"
          : "bg-surface ring-white/[0.06] enabled:hover:bg-surface-2 enabled:hover:ring-white/[0.14]"
      } ${onOpen ? "cursor-pointer" : "cursor-default"}`}
    >
      {/* ── Line 1: when, and what happened ─────────────────────────── */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-2">
          {m.date}
        </span>
        <span className={`font-mono text-[11px] font-medium tabular-nums ${RESULT_TONE[r]}`}>
          {r} {us}&ndash;{them}
        </span>
      </div>

      <div className="flex items-start gap-3.5">
        {/* ── The fingerprint ───────────────────────────────────────── */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[52px] w-[81px] shrink-0 rounded bg-[#080808] ring-1 ring-white/[0.05]"
          aria-hidden
        >
          <rect
            x={0}
            y={(H - bh) / 2}
            width={W}
            height={bh}
            fill="rgba(216,210,204,0.07)"
          />
          <g fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth={0.8}>
            <line x1={W / 2} y1={0} x2={W / 2} y2={H} />
            <circle cx={W / 2} cy={H / 2} r={8} />
            <rect x={0.4} y={18} width={13} height={28} />
            <rect x={W - 13.4} y={18} width={13} height={28} />
          </g>
          <line
            x1={px}
            y1={(H - bh) / 2 - 3}
            x2={px}
            y2={(H + bh) / 2 + 3}
            stroke="var(--color-accent)"
            strokeWidth={1.6}
            className="transition-opacity duration-200 group-hover:opacity-100"
            opacity={0.85}
          />
        </svg>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-chalk">
            {opponent}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-2">
            {m.comp}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] tabular-nums text-muted">
            <span>{Math.round(m.poss)}% ball</span>
            <span>{m.xg.toFixed(2)} xG</span>
            <span>{m.shots} shots</span>
          </div>
        </div>
      </div>

      <p className="text-[13px] leading-relaxed text-warm-2">
        {read(m, pressMean)}
      </p>

      <div className="flex items-center justify-between gap-3 border-t border-white/[0.05] pt-3">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-2">
          <span
            className={`h-1 w-1 rounded-full ${onOpen ? "bg-accent" : "bg-white/25"}`}
          />
          {onOpen ? "video analysed" : "data only"}
        </span>
        <span
          className={`font-mono text-[10px] ${
            onOpen
              ? "text-muted transition-colors group-hover:text-accent"
              : "text-muted-2"
          }`}
        >
          {onOpen ? "open report →" : "no footage sent"}
        </span>
      </div>
    </motion.button>
  );
}
