"use client";

import { motion } from "motion/react";
import { XtPitch } from "@/components/dash/xt-pitch";
import type { EvidenceCard } from "@/content/session";

/**
 * The exhibits, inline.
 *
 * Each of these used to be a screen of its own that a coach had to know to
 * navigate to, and mostly did not. They belong in the conversation, at the
 * moment Pep has a reason to bring them up.
 *
 * They all read the `memory` switch. Off is not a mock: it is the same data
 * queried the way a store with no validity intervals must query it, taking the
 * single best-evidenced claim about a side. The result speaks for itself, which
 * is why the switch is worth having.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

const UNIT: Record<string, string> = {
  possession_share_pct: "%",
  press_height: "m",
  defensive_action_height: "m",
  team_width: "m",
  pass_forward_ratio: "",
};

function Frame({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="rounded-xl bg-surface-2 p-4 ring-1 ring-white/[0.08]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[14px] font-medium text-chalk">{title}</span>
        {note && (
          <span className="font-mono text-[10px] tracking-[0.1em] text-muted-2 uppercase">
            {note}
          </span>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </motion.div>
  );
}

export function Evidence({
  card,
  memory,
}: {
  card: EvidenceCard;
  memory: boolean;
}) {
  if (card.kind === "threat") {
    return (
      <Frame title={card.title} note="the model">
        <XtPitch />
      </Frame>
    );
  }

  if (card.kind === "benchmark") {
    return (
      <Frame
        title={memory ? card.title : "Where you sit"}
        note={`${card.scale.teams} sides`}
      >
        {!memory ? (
          <p className="text-[13px] leading-relaxed text-muted">
            Without dates on a claim there is no such thing as a side&rsquo;s
            current norm, so there is nothing to rank against. This comparison
            does not exist.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2.5">
              {card.dimensions.map((d) => {
                const odd = d.percentile >= 85 || d.percentile <= 15;
                return (
                  <div key={d.dimension}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] text-warm-2">{d.label}</span>
                      <span className="font-mono text-[10px] tabular-nums text-muted">
                        {d.value}
                        {UNIT[d.dimension] ?? ""}
                        <span className="ml-2 text-muted-2">
                          {d.percentile}th of {d.peers}
                        </span>
                      </span>
                    </div>
                    <div className="relative mt-1 h-4 overflow-hidden rounded bg-white/[0.05]">
                      <span className="absolute inset-y-0 left-[25%] w-1/2 bg-white/[0.04]" />
                      <span
                        className={`absolute inset-y-0.5 w-[3px] rounded-full ${
                          odd ? "bg-accent" : "bg-warm"
                        }`}
                        style={{
                          left: `calc(${Math.min(98, Math.max(1, d.percentile))}% - 1.5px)`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 border-t border-white/[0.07] pt-2.5 font-mono text-[10px] leading-relaxed text-muted-2">
              {card.scale.matches.toLocaleString()} matches already in the
              graph. Nothing was trained for you.
            </p>
          </>
        )}
      </Frame>
    );
  }

  // Opponent.
  const dims = Object.keys(card.labels).filter(
    (d) => card.mine.norms[d] && card.theirs.norms[d],
  );
  return (
    <Frame title={card.title} note={`${card.games} games on record`}>
      <div className="overflow-hidden rounded-lg bg-surface ring-1 ring-white/[0.06]">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 border-b border-white/[0.06] px-3 py-2 font-mono text-[10px] tracking-[0.1em] text-muted-2 uppercase">
          <span>you</span>
          <span />
          <span className="text-right text-accent">{card.opponent}</span>
        </div>
        {dims.map((d) => {
          const a = card.mine.norms[d];
          const b = card.theirs.norms[d];
          const fa = card.mine.flat[d];
          const fb = card.theirs.flat[d];
          const u = UNIT[d] ?? "";
          return (
            <div
              key={d}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-white/[0.05] px-3 py-2 last:border-b-0"
            >
              <span className="text-[12px] text-warm">
                {memory ? (
                  <>
                    {a.band}{" "}
                    <span className="font-mono text-[10px] tabular-nums text-muted">
                      {a.value}
                      {u}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">{fa?.band ?? "unknown"}</span>
                )}
              </span>
              <span className="font-mono text-[9px] tracking-[0.08em] text-muted-2 uppercase">
                {card.labels[d]}
              </span>
              <span className="text-right text-[12px] text-warm">
                {memory ? (
                  <>
                    {b.band}{" "}
                    <span className="font-mono text-[10px] tabular-nums text-muted">
                      {b.value}
                      {u}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">{fb?.band ?? "unknown"}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-2.5 text-[12px] leading-relaxed text-muted">
        {memory ? (
          <>
            Held since {card.theirs.norms[dims[0]]?.since ?? "?"} across{" "}
            {card.theirs.norms[dims[0]]?.obs ?? "?"} games. That is what you are
            preparing against.
          </>
        ) : (
          <>
            Two lists of bands with no dates. Identical on most rows, and no way
            to tell whether any of it still describes the side you play.
          </>
        )}
      </p>
    </Frame>
  );
}
