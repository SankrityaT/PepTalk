"use client";

import Image from "next/image";
import { motion } from "motion/react";
import {
  MEASURES,
  Player,
  Rates,
  drift,
  momentsFor,
  normFor,
  passesFor,
  photoFor,
} from "@/content/roster";
import type { Measure } from "@/content/roster";

/**
 * One player.
 *
 * The card is built around a pair rather than a number: what they did in the
 * game just watched, against what they usually do. A rate on its own is a box
 * score and a coach already has one of those. The arrow is the whole point, and
 * it is measured against **their own** norm, not a league average, because
 * "below average for a full back" is a fantasy-football fact and "quieter than
 * he has been all tournament" is a coaching one.
 *
 * With memory off the norm is gone and the arrows go with it. The measured
 * numbers stay, because nothing about them needed a graph.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

/** Enough of a change to be worth an arrow rather than noise. */
const MATTERS = 0.12;

function Photo({ p }: { p: Player }) {
  const photo = photoFor(p);

  if (!photo) {
    // Normal, not broken. Outside elite football almost nobody has a freely
    // licensed photograph, so the shirt does the work.
    return (
      <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] font-mono text-[19px] tabular-nums text-muted ring-1 ring-white/[0.07]">
        {p.jersey ?? "?"}
      </span>
    );
  }

  return (
    <span className="relative size-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/[0.09]">
      <Image
        src={`/players/${photo.path}`}
        alt={p.name}
        width={112}
        height={112}
        className="size-full object-cover object-top"
        // The face sits at the top of a standing figure, so the crop is a
        // styling decision here rather than one baked into the file.
      />
      {p.jersey !== null && (
        <span className="absolute right-0 bottom-0 rounded-tl bg-canvas/85 px-1 font-mono text-[10px] tabular-nums text-chalk">
          {p.jersey}
        </span>
      )}
    </span>
  );
}

function Row({
  p,
  m,
  memory,
}: {
  p: Player;
  m: Measure;
  memory: boolean;
}) {
  const here = p.match[m.key as keyof Rates];
  const d = memory ? drift(p, m) : null;
  const norm = memory ? normFor(p, m) : null;

  // Lower is better for threat left and turnovers, so a fall is the good
  // direction. Getting this backwards congratulates a player for wasting more.
  const good = d === null ? null : m.lowerIsBetter ? d < 0 : d > 0;
  const show = d !== null && Math.abs(d) >= MATTERS;

  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="font-mono text-[10px] tracking-[0.06em] text-muted-2 uppercase">
        {m.label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-[12px] tabular-nums text-chalk">
          {here.toFixed(m.decimals)}
        </span>
        {show ? (
          <span
            className={`font-mono text-[10px] tabular-nums ${
              good ? "text-accent" : "text-muted"
            }`}
            title={
              norm
                ? `usually ${norm.value.toFixed(m.decimals)} (${norm.band}), holding since ${norm.since} across ${norm.obs} games`
                : undefined
            }
          >
            {d > 0 ? "▲" : "▼"}
            {Math.round(Math.abs(d) * 100)}%
          </span>
        ) : (
          <span className="font-mono text-[10px] text-muted-2">
            {d === null ? "—" : "·"}
          </span>
        )}
      </span>
    </div>
  );
}

export function PlayerCard({
  p,
  memory,
  index = 0,
  onOpen,
}: {
  p: Player;
  memory: boolean;
  index?: number;
  onOpen?: (p: Player) => void;
}) {
  const photo = photoFor(p);
  const clips = momentsFor(p);
  const flagged = passesFor(p);

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.035, 0.4), ease: EASE }}
      onClick={() => onOpen?.(p)}
      className="flex w-full flex-col rounded-xl bg-surface p-3.5 text-left ring-1 ring-white/[0.06] transition-colors hover:bg-surface-2 hover:ring-white/[0.12]"
    >
      <div className="flex items-start gap-3">
        <Photo p={p} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-chalk">
            {p.nickname ?? p.name}
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-muted">
            {p.position}
          </span>
          <span className="mt-1.5 block font-mono text-[10px] text-muted-2">
            {Math.round(p.match.minutes)} min
            {memory && p.norm && (
              <> · {Object.values(p.norm)[0]?.obs ?? 0} games held</>
            )}
          </span>
        </div>
      </div>

      <div className="mt-3 border-t border-white/[0.05] pt-1.5">
        {MEASURES.map((m) => (
          <Row key={m.key} p={p} m={m} memory={memory} />
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-2 border-t border-white/[0.05] pt-2.5 font-mono text-[10px] text-muted-2">
        {clips.length > 0 && (
          <span className="rounded bg-accent/12 px-1.5 py-0.5 text-accent">
            {clips.length} on tape
          </span>
        )}
        {flagged.length > 0 && <span>{flagged.length} flagged</span>}
        <span className="ml-auto truncate">
          {memory && p.norm
            ? "arrows are against his own dated norm"
            : photo
              ? `photo ${photo.author}`
              : "no free photo"}
        </span>
      </div>
    </motion.button>
  );
}
