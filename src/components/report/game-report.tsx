//created by kinjal
"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PromptBar } from "@/components/brief/atoms/prompt-bar";
import { Turn } from "@/components/brief/atoms/turn";
import { ChalkFilters } from "@/components/chalk-filters";
import { PepTalkMark } from "@/components/logo-marks";
import { Answer } from "@/components/session/answer";
import { MomentFrame } from "@/components/report/moment-frame";
import { MomentPitch } from "@/components/report/moment-pitch";
import { TapePlayer } from "@/components/tape/tape-player";
import { byPlayerIn, useGame, type PlayableMoment } from "@/content/game";
import { Moment, surname } from "@/content/pep";
import type { Frame } from "@/content/session";

/**
 * An added game's report, in the session's shape.
 *
 * The dashboard's session settled the language for this product: the tape is
 * pinned on the left and never leaves, and everything Pep has to say runs down
 * a thread on the right. A game a coach adds themselves gets the same screen,
 * because arriving at a different-looking page for your own footage reads as a
 * different product rather than the same one with your match in it.
 *
 * What is deliberately not shared with `Session` is the beat script. That one
 * walks a written thread over a committed match; this has whatever the pipeline
 * found in a game nobody has seen, so the thread is built from the moments
 * themselves. The chrome, the proportions and the transport are the same.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

/** Moments carry a clip, and the tracker's reading of it, once footage exists. */
function clipOf(
  m: Moment | null,
): { src: string; stopAt?: number; frames: Frame[]; excerpt: boolean } | null {
  const p = m as PlayableMoment | null;
  if (!p?.clip) return null;
  return {
    src: p.clip,
    // An excerpt is footage from this match but not from this pass, so there
    // is no instant to stop on and pretending otherwise would be a lie.
    stopAt: p.excerpt ? undefined : p.pass_at,
    frames: p.frames ?? [],
    excerpt: Boolean(p.excerpt),
  };
}

/**
 * The transport, owning its own play state.
 *
 * Split out and keyed by clip so a new moment gets a fresh component rather
 * than an effect resetting the old one. Syncing that flag in a `useEffect` is
 * a cascading render, and React's linter is right to reject it: remounting
 * says the same thing without the extra pass.
 */
function Tape({
  src,
  stopAt,
  frames,
  excerpt,
}: {
  src: string;
  stopAt?: number;
  frames: Frame[];
  excerpt: boolean;
}) {
  const [playing, setPlaying] = useState(true);
  return (
    <TapePlayer
      src={src}
      // Every box is a player the tracker found in that frame. This used to
      // be an empty array, which is why an added game played its footage bare
      // while the example drew boxes over the same component.
      frames={frames}
      stopAt={stopAt}
      stopLabel={excerpt ? "from your footage" : "the moment"}
      // Chalk is computed from the boxes in the tracker's own frame space, so
      // it holds for any footage that tracked — no camera calibration in it.
      // Where a shot is too tight to read a shape the overlay draws nothing,
      // which is the same rule the boxes follow.
      chalk
      playing={playing}
      onPlayingChange={setPlaying}
    />
  );
}

export function GameReport({
  roster,
  selected,
  onSelect,
}: {
  roster: string[];
  selected: Moment | null;
  onSelect: (m: Moment) => void;
}) {
  const game = useGame();
  const moments = game.moments;
  // Only your own players. "Who to have a word with" listing the opposition's
  // number ten is nonsense from this bench — you cannot coach him. Older
  // snapshots carry no `side`, so an untagged moment is treated as yours,
  // which is how this read before the split existed.
  const players = byPlayerIn(moments.filter((m) => m.side !== "defending"));
  const named = new Set(roster.map((r) => surname(r).toLowerCase()));
  const theirs = moments.filter((m) => m.side === "defending").length;
  const ours = moments.length - theirs;

  // The chat, same components the session uses. Questions are answered from
  // the graph, so an unreachable one says so rather than inventing a reply.
  const [asked, setAsked] = useState<string[]>([]);
  const [memory, setMemory] = useState(true);
  const graphUp = useGraphUp();
  const measured = useMemo(
    () => ({
      match: game.label,
      date: game.date,
      competition: game.competition,
      moments_found: game.momentsFound,
      passes_with_an_option: game.passesWithAnOption,
      yours: ours,
      theirs,
    }),
    [game, ours, theirs],
  );

  // Land on something rather than an empty panel.
  const shown = selected ?? moments[0] ?? null;
  const clip = clipOf(shown);

  if (game.loading) {
    return (
      <p className="py-24 text-center text-[15px] text-muted">
        Opening your report&hellip;
      </p>
    );
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col gap-4 lg:flex-row">
      <ChalkFilters />

      {/* ── The tape. Pinned, exactly as the session pins it. ─────────── */}
      <div className="flex shrink-0 flex-col gap-2 lg:w-[58%] lg:min-w-0">
        {clip ? (
          <Tape
            key={clip.src}
            src={clip.src}
            stopAt={clip.stopAt}
            frames={clip.frames}
            excerpt={clip.excerpt}
          />
        ) : shown ? (
          // No footage for this moment, so the freeze frame carries it. It is
          // still the evidence: it shows where all twenty-two players stood.
          <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-surface p-3 ring-1 ring-white/[0.06]">
            <div className="flex items-baseline justify-between gap-3 pb-2">
              <span className="font-mono text-[9px] tracking-[0.12em] text-muted-2 uppercase">
                the freeze frame
              </span>
              <span className="font-mono text-[10px] text-muted-2">
                {shown.freeze?.length ?? 0} players tracked
              </span>
            </div>
            {shown.freeze?.length ? (
              <MomentFrame
                moment={shown}
                className="mx-auto h-full min-h-0 w-auto"
              />
            ) : (
              <MomentPitch moment={shown} />
            )}
          </div>
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-surface ring-1 ring-white/[0.06]">
            <span className="font-mono text-[11px] text-muted-2">
              nothing crossed the bar
            </span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-1">
          <span className="font-mono text-[10px] text-muted-2">
            {moments.length} moments &middot; {game.competition} &middot;{" "}
            {game.date}
          </span>
          {shown && (
            <span className="font-mono text-[10px] tabular-nums text-muted-2">
              {shown.minute}&rsquo; {surname(shown.player)}
            </span>
          )}
        </div>
      </div>

      {/* ── The thread. ──────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-surface/40 ring-1 ring-white/[0.05]">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          <span className="flex items-center gap-2">
            <PepTalkMark size={18} className="text-chalk" />
            <span className="font-display text-[13px] text-chalk">Pep</span>
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-2">
            {game.error ? "the example match" : "your game"}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <p className="text-[15px] leading-relaxed text-warm">
            {moments.length === 0
              ? "I watched all of it. Nothing crossed the bar worth stopping the tape for, which is a result rather than an error."
              : `I watched all of it. The short version: you kept turning back when the box was open. ${moments.length} times worth showing the group.`}
          </p>

          {game.error && (
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Showing the example match: {game.error}
            </p>
          )}

          {shown && (
            <AnimatePresence mode="wait">
              <motion.div
                key={shown.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: EASE }}
                className="mt-5 rounded-xl bg-surface p-3.5 ring-1 ring-white/[0.06]"
              >
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] tabular-nums text-accent">
                    {shown.minute}&rsquo;
                  </span>
                  <span className="text-[13px] font-medium text-chalk">
                    {surname(shown.player)}
                  </span>
                </span>
                <p className="mt-2 text-[15px] leading-relaxed text-warm">
                  {shown.line}
                </p>
              </motion.div>
            </AnimatePresence>
          )}

          {/* Every moment, as the thread's spine. Picking one swaps the tape,
              which is the same coupling the session uses. */}
          {moments.length > 0 && (
            <>
              <p className="mt-6 font-mono text-[9px] tracking-[0.12em] text-muted-2 uppercase">
                the moments
              </p>
              {/* Said plainly, because a report weighted to the opponent looks
                  broken otherwise. In the World Cup final only two of the eight
                  are Argentina's — that is the match, not a bug. */}
              {theirs > 0 && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-2">
                  {ours} yours, {theirs} theirs &mdash; the chances that were
                  there against you.
                </p>
              )}
              <ul className="mt-2.5 flex flex-col gap-1.5">
                {moments.map((m) => {
                  const on = m.id === shown?.id;
                  return (
                    <li key={m.id}>
                      <button
                        onClick={() => onSelect(m)}
                        className={`flex w-full items-baseline gap-2.5 rounded-lg px-3 py-2.5 text-left ring-1 transition-colors ${
                          on
                            ? "bg-surface-2 ring-white/[0.10]"
                            : "bg-surface/60 ring-white/[0.05] hover:bg-surface-2"
                        }`}
                      >
                        <span
                          className={`font-mono text-[11px] tabular-nums ${
                            on ? "text-accent" : "text-muted-2"
                          }`}
                        >
                          {m.minute}&rsquo;
                        </span>
                        <span
                          className={`text-[13px] ${
                            m.side === "defending" ? "text-warm-2" : "text-chalk"
                          }`}
                        >
                          {surname(m.player)}
                        </span>
                        {/* Whose moment this is. Half of them belong to the
                            other side and read completely differently: yours
                            are chances missed, theirs are chances survived. */}
                        {m.side === "defending" && (
                          <span className="font-mono text-[9px] tracking-[0.1em] text-muted-2 uppercase">
                            theirs
                          </span>
                        )}
                        {(m as { clip?: string }).clip && (
                          <span className="ml-auto font-mono text-[9px] tracking-[0.1em] text-muted-2 uppercase">
                            tape
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {/* ── Who to have a word with ─────────────────────────────── */}
          {players.length > 0 && (
            <>
              <p className="mt-7 font-mono text-[9px] tracking-[0.12em] text-muted-2 uppercase">
                who to have a word with
              </p>
              <ul className="mt-2.5 flex flex-col gap-2">
                {players.map((p) => {
                  const inSquad =
                    named.size === 0 ||
                    named.has(surname(p.player).toLowerCase());
                  return (
                    <li
                      key={p.player}
                      className="rounded-lg bg-surface p-3.5 ring-1 ring-white/[0.06]"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[14px] font-medium text-chalk">
                          {surname(p.player)}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-muted-2">
                          {p.moments.length}
                        </span>
                      </div>
                      <p className="mt-2 text-[13px] leading-relaxed text-warm-2">
                        {p.moments.length > 1
                          ? `${p.moments.length} times you had a forward ball on and took the safer one.`
                          : p.moments[0].no_riskier
                            ? "Once, with a better ball available that was no harder to play."
                            : "Once, though the better ball was a genuinely hard ask."}
                      </p>
                      <button
                        onClick={() => onSelect(p.moments[0])}
                        className="mt-3 rounded bg-white/[0.05] px-2.5 py-1.5 font-mono text-[10px] tabular-nums text-warm transition-colors hover:bg-accent/20 hover:text-chalk"
                      >
                        show me {p.moments[0].minute}&rsquo;
                      </button>
                      {!inSquad && (
                        <span className="mt-2.5 block text-[11px] text-muted-2">
                          came off the bench
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {/* ── Provenance ──────────────────────────────────────────── */}
          <p className="mt-7 border-t border-white/[0.07] pt-4 text-[12px] leading-relaxed text-muted-2">
            Every moment here was computed, not written. How dangerous a pass is
            comes from a model trained on 3,961 matches of elite football; how
            likely it was to arrive comes from a model fitted on this
            match&rsquo;s own passing. Pep only raises a moment when a better
            ball existed <em className="not-italic text-muted">after</em>{" "}
            accounting for the chance it got cut out.
          </p>
          {game.writtenBy === "numbers" && (
            <p className="mt-2.5 text-[12px] leading-relaxed text-muted-2">
              The wording of these lines was computed from the same figures
              rather than written by the model, because no API key was set when
              this ran. The moments and the numbers are unaffected.
            </p>
          )}

          {/* ── Anything the coach asks ─────────────────────────────── */}
          {asked.map((q) => (
            <div key={q} className="mt-4 flex flex-col gap-2">
              <p className="self-end rounded-2xl rounded-br-md bg-surface-raised px-3.5 py-2.5 text-[14px] text-chalk">
                {q}
              </p>
              <Turn showWho={false}>
                <Answer
                  key={`${q}::${memory}`}
                  question={q}
                  memory={memory}
                  match={measured}
                />
              </Turn>
            </div>
          ))}
        </div>

        {/* ── The prompt, same bar as the session ───────────────────── */}
        <div className="border-t border-white/[0.06] px-4 py-3">
          <PromptBar
            connected={graphUp !== false}
            suggestions={asked.length ? [] : SUGGESTIONS}
            onSend={(q) => setAsked((a) => (a.includes(q) ? a : [...a, q]))}
            mentions={moments.map((m) => ({
              key: String(m.id),
              label: surname(m.player),
              hint: `${m.minute}'`,
            }))}
            memory={memory}
            onMemory={setMemory}
            memoryOn="dated facts, with when each one held"
            memoryOff="this game only, with nothing to hold it against"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * What the interface measured off the game on screen.
 *
 * Handed to `Answer` so the model is looking at the same numbers the coach is.
 * Retrieval resolves the rest on the server; this is only the match in front
 * of them.
 */
const SUGGESTIONS = [
  "Who should I work with this week?",
  "What did we do differently here?",
  "Show me the chances they had.",
];

/**
 * Whether the graph is reachable.
 *
 * The bar says so rather than letting a coach type into something that cannot
 * answer: nothing here is scripted, so with the graph down there is no reply
 * to give.
 */
function useGraphUp(): boolean | null {
  const [up, setUp] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((b) => live && setUp(Boolean(b.ok)))
      .catch(() => live && setUp(false));
    return () => {
      live = false;
    };
  }, []);
  return up;
}
