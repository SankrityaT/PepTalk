"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PlayerCard } from "@/components/roster/player-card";
import { Answer } from "@/components/session/answer";
import { MomentFrame } from "@/components/report/moment-frame";
import { TapePlayer } from "@/components/tape/tape-player";
import {
  GAMES_MEASURED,
  MEASURES,
  MIN_MINUTES,
  Player,
  SQUAD,
  WORK_ON,
  drift,
  momentsFor,
  normFor,
  passesFor,
  photoFor,
} from "@/content/roster";

/**
 * Players.
 *
 * This screen was empty for a long time behind a note saying it needed track
 * ids. It did not: everything on a card is in the event feed, and the tracking
 * question only ever applied to writing a name on a box in the video.
 *
 * Sorted by minutes, because that is the order a coach holds their squad in.
 * The three at the top are the ones with the most threat left on the table,
 * which is the one measure here that names something to go and work on.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

export function Roster({ memory = true }: { memory?: boolean }) {
  const [open, setOpen] = useState<Player | null>(null);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-[24px] font-medium text-chalk">Players</h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
        Everyone who played over {MIN_MINUTES} minutes, measured off the game
        and held against {GAMES_MEASURED} of theirs.{" "}
        {memory
          ? "Arrows compare a player to his own norm, never to a league average."
          : "With the memory off there is no norm to compare against, so the numbers stand alone."}
      </p>

      {WORK_ON.length > 0 && (
        <div className="mt-5 rounded-xl bg-surface p-4 ring-1 ring-white/[0.06]">
          <span className="font-mono text-[10px] tracking-[0.12em] text-muted-2 uppercase">
            most left on the table
          </span>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {WORK_ON.map((p) => (
              <button
                key={p.key}
                onClick={() => setOpen(p)}
                className="flex items-baseline gap-2 text-left"
              >
                <span className="text-[14px] text-chalk">{p.short}</span>
                <span className="font-mono text-[12px] tabular-nums text-accent">
                  {p.match.xt_left.toFixed(2)}
                </span>
                <span className="font-mono text-[10px] text-muted-2">
                  across {p.match.options_seen} passes with an option
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-[12px] leading-relaxed text-muted">
            Threat that was available on a better ball and did not get played.
            Every other number says what a player did; this one says what was on
            and did not happen.{" "}
            {memory
              ? "Open a card to see whether it is more than he usually leaves."
              : "Whether that is more than any of them usually leaves needs the memory."}
          </p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SQUAD.map((p, i) => (
          <PlayerCard key={p.key} p={p} memory={memory} index={i} onOpen={setOpen} />
        ))}
      </div>

      <p className="mt-5 max-w-3xl text-[12px] leading-relaxed text-muted-2">
        Photographs are Wikimedia Commons under CC BY-SA or CC BY, credited per
        player. A squad outside elite football will have none, which is the
        normal case and why a card without one falls back to the shirt.
      </p>

      <AnimatePresence>
        {open && <Detail p={open} memory={memory} onClose={() => setOpen(null)} />}
      </AnimatePresence>
    </div>
  );
}

function Detail({
  p,
  memory,
  onClose,
}: {
  p: Player;
  memory: boolean;
  onClose: () => void;
}) {
  const photo = photoFor(p);
  const clips = momentsFor(p);
  const flagged = passesFor(p);
  const worst = [...flagged].sort((a, b) => b.missed - a.missed)[0];
  const [clip, setClip] = useState(0);
  const tape = clips[clip];

  // What this player measured, handed to retrieval so the answer beside his
  // footage is grounded in the same numbers on the card rather than in whatever
  // the model happens to know about him.
  const measured: Record<string, string | number> = {
    player: p.nickname ?? p.name,
    position: p.position,
    "minutes in this game": Math.round(p.match.minutes),
    "threat created per 90 in this game": p.match.xt_created,
    "threat left on the table per 90 in this game": p.match.xt_left,
    "final third entries per 90 in this game": p.match.final_third_entries,
    "turnovers per 100 touches in this game": p.match.turnover_rate,
    "passes completed in this game": `${p.match.passes_completed} of ${p.match.passes}`,
    "moments on tape": clips.length,
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-canvas/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        transition={{ duration: 0.26, ease: EASE }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl bg-surface p-5 ring-1 ring-white/10 sm:rounded-2xl"
      >
        <div className="flex items-start gap-4">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/players/${photo.path}`}
              alt={p.name}
              className="size-20 shrink-0 rounded-xl object-cover object-top ring-1 ring-white/10"
            />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-medium text-chalk">
              {p.nickname ?? p.name}
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              {p.jersey !== null && <span className="font-mono">#{p.jersey} · </span>}
              {p.position}
              {p.country && ` · ${p.country}`}
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-muted-2">
              {Math.round(p.match.minutes)} min in this game · {p.match.touches.toFixed(0)}{" "}
              touches per 90 · {p.match.passes_completed}/{p.match.passes} passes
              {p.match.shots > 0 && ` · ${p.match.shots} shots`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-white/[0.08] hover:text-chalk"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* His footage on the left, Pep on the right: the same shape as the
            session, because it is the same job. A player with no clips shows
            the freeze frame of his costliest ball instead, which is real and
            derived rather than a placeholder. */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            {tape ? (
              <>
                <TapePlayer
                  key={tape.key}
                  src={tape.clip}
                  frames={tape.frames}
                  stopAt={tape.pass_at}
                  stopLabel={`${p.short}, ${tape.match_clock}`}
                  chalkTeam={1}
                  autoPlay={false}
                />
                {clips.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {clips.map((c, i) => (
                      <button
                        key={c.key}
                        onClick={() => setClip(i)}
                        className={`rounded px-2 py-1 font-mono text-[10px] transition-colors ${
                          i === clip
                            ? "bg-accent/15 text-accent"
                            : "bg-white/[0.05] text-muted hover:text-chalk"
                        }`}
                      >
                        {c.match_clock}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[13px] leading-relaxed text-warm">{tape.line}</p>
              </>
            ) : worst ? (
              <>
                <MomentFrame moment={worst} className="w-full" />
                <p className="text-[13px] leading-relaxed text-warm">{worst.line}</p>
                <p className="font-mono text-[10px] leading-relaxed text-muted-2">
                  No footage cut for him yet, so this is the freeze frame at the
                  instant he played it. Every dot is a real player.
                </p>
              </>
            ) : (
              <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] leading-relaxed text-muted ring-1 ring-white/[0.06]">
                No moment of his was flagged in this game, so there is nothing to
                show you rather than something to fill the space.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <Answer
              key={`${p.key}::${memory}`}
              question={`What should I work on with ${p.nickname ?? p.name} this week?`}
              memory={memory}
              match={measured}
            />

        <div className="overflow-hidden rounded-lg bg-surface-2 ring-1 ring-white/[0.06]">
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-white/[0.06] px-3 py-2 font-mono text-[10px] tracking-[0.1em] text-muted-2 uppercase">
            <span />
            <span className="w-16 text-right">this game</span>
            <span className="w-16 text-right">{memory ? "his norm" : "—"}</span>
          </div>
          {MEASURES.map((m) => {
            const d = memory ? drift(p, m) : null;
            const good = d === null ? null : m.lowerIsBetter ? d < 0 : d > 0;
            return (
              <div
                key={m.key}
                className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 border-b border-white/[0.04] px-3 py-2 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block text-[12.5px] text-warm">{m.label}</span>
                  <span className="block text-[11px] leading-snug text-muted-2">
                    {m.hint}
                  </span>
                </span>
                <span
                  className={`w-16 text-right font-mono text-[13px] tabular-nums ${
                    good === null ? "text-chalk" : good ? "text-accent" : "text-chalk"
                  }`}
                >
                  {p.match[m.key].toFixed(m.decimals)}
                </span>
                <span
                  className="w-16 text-right font-mono text-[12px] tabular-nums text-muted"
                  title={
                    memory && normFor(p, m)
                      ? `holding since ${normFor(p, m)!.since} across ${normFor(p, m)!.obs} games`
                      : undefined
                  }
                >
                  {memory && normFor(p, m)
                    ? normFor(p, m)!.value.toFixed(m.decimals)
                    : "—"}
                </span>
              </div>
            );
          })}
        </div>

        {!memory && (
          <p className="mt-2.5 text-[12px] leading-relaxed text-muted">
            That is the game itself and it is all measured. What is missing is
            the second column: whether any of it is normal for him, and when it
            last changed.
          </p>
        )}

          </div>
        </div>

        {photo && (
          <p className="mt-4 border-t border-white/[0.05] pt-3 font-mono text-[10px] text-muted-2">
            photo {photo.author}, {photo.licence} ·{" "}
            <a href={photo.page} target="_blank" rel="noreferrer" className="underline">
              source
            </a>
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}
