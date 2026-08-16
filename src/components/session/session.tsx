"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Choice } from "@/components/brief/atoms/choice";
import { PromptBar } from "@/components/brief/atoms/prompt-bar";
import { StreamText } from "@/components/brief/atoms/stream-text";
import { Trace } from "@/components/brief/atoms/trace";
import { Turn } from "@/components/brief/atoms/turn";
import { ChalkFilters } from "@/components/chalk-filters";
import { MomentFrame } from "@/components/report/moment-frame";
import { Evidence } from "@/components/session/evidence";
import { TapePlayer } from "@/components/tape/tape-player";
import { BEATS, Beat, SUGGESTIONS, clipFor } from "@/content/session";
import { CLIP_MOMENTS } from "@/content/clip";

/**
 * The session. One screen.
 *
 * A coach sits down and goes through the tape with an assistant. That is the
 * product, and it took a rebuild to get there: the previous version had seven
 * destinations and five of them contained no video, because adding a screen is
 * easier than making the one that matters work.
 *
 * The rule the whole thing hangs on is that **the tape is pinned and never
 * leaves**. Advancing the thread swaps the clip; a beat with no footage of its
 * own holds the last frame rather than replacing it with a blank panel. The
 * coupling is one function, `clipFor`.
 *
 * The memory switch sits beside the tape rather than buried in a settings
 * screen, because it is the argument for the whole system: turn it off and the
 * evidence collapses to undated bands that describe nobody.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

/** Set at build time; the prompt bar says so rather than faking an answer. */
const MODEL_CONNECTED = false;

function BeatBody({ beat, live }: { beat: Beat; live: boolean }) {
  if (beat.kind === "say") {
    return (
      <p className="text-[15px] leading-relaxed text-warm">
        {live ? <StreamText text={beat.text} /> : beat.text}
      </p>
    );
  }

  if (beat.kind === "moment") {
    const m = beat.moment;
    const them = m.side === "defending";
    return (
      <div className="rounded-xl bg-surface p-3.5 ring-1 ring-white/[0.06]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] tabular-nums text-accent">
              {m.match_clock}
            </span>
            <span className="text-[13px] font-medium text-chalk">{m.surname}</span>
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] uppercase ${
                them ? "bg-white/[0.09] text-chalk-3" : "bg-accent/15 text-accent"
              }`}
            >
              {them ? "you defended" : "you attacked"}
            </span>
          </span>
          {m.no_riskier && (
            <span className="rounded border border-accent/40 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-accent uppercase">
              no riskier
            </span>
          )}
        </div>

        <p className="mt-2 text-[14px] leading-relaxed text-warm">
          {live ? <StreamText text={m.line} /> : m.line}
        </p>

        <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-muted">
          {m.numbers}
        </p>
      </div>
    );
  }

  if (beat.kind === "goal") {
    const g = beat.goal;
    const d = g.defence;
    return (
      <div className="rounded-xl bg-surface p-3.5 ring-1 ring-white/[0.06]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] tabular-nums text-accent">
              {g.clock}
            </span>
            <span className="text-[13px] font-medium text-chalk">
              {g.scorer.split(" ").slice(-1)[0]}
            </span>
            <span className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-muted uppercase">
              {g.kind}
            </span>
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-2">
            {g.xg.toFixed(2)} xG
          </span>
        </div>

        <p className="mt-2 text-[14px] leading-relaxed text-warm">
          {live ? <StreamText text={g.line} /> : g.line}
        </p>

        {d.defenders_in_box !== undefined && (
          <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-muted">
            {d.defenders_in_box} of yours in the box &middot;{" "}
            {d.defenders_goal_side} goal side &middot; nearest{" "}
            {d.nearest_defender_yds} yds
          </p>
        )}

        {/* The chain that produced it, which is the coaching point on a goal:
            not where the ball ended up, but how it got there. */}
        {(() => {
          const moves = g.passage.filter(
            (p) => p.type === "Pass" || p.type === "Carry",
          );
          if (moves.length < 2) return null;
          return (
            <div className="mt-3 border-t border-white/[0.05] pt-2.5">
              <span className="font-mono text-[9px] tracking-[0.12em] text-muted-2 uppercase">
                how it arrived
              </span>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {moves.map((p, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && (
                      <span className="font-mono text-[10px] text-muted-2">&rarr;</span>
                    )}
                    <span className="rounded bg-accent/12 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                      {p.player ? p.player.split(" ").slice(-1)[0] : p.type}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  return null;
}

export function Session() {
  const [at, setAt] = useState(0);
  const [memory, setMemory] = useState(true);
  const [asked, setAsked] = useState<string[]>([]);
  const [stopped, setStopped] = useState(false);
  const tail = useRef<HTMLDivElement>(null);

  const shown = BEATS.slice(0, at + 1);
  const current = BEATS[at];
  const atEnd = at >= BEATS.length - 1;

  // The tape holds whatever the most recent beat with footage asked for, so it
  // never blanks out on a beat that has none. Before the first such beat it
  // reaches forward instead and sits paused on the opening clip, because the
  // greeting arriving over an empty panel is the exact thing this rebuild
  // exists to stop.
  const clip = (() => {
    for (let i = at; i >= 0; i--) {
      const c = clipFor(BEATS[i]);
      if (c) return { ...c, beat: BEATS[i], primed: true };
    }
    for (let i = at + 1; i < BEATS.length; i++) {
      const c = clipFor(BEATS[i]);
      if (c) return { ...c, beat: BEATS[i], primed: false };
    }
    return null;
  })();

  const frames =
    clip?.beat.kind === "moment"
      ? clip.beat.moment.frames
      : clip?.beat.kind === "goal"
        ? clip.beat.goal.frames
        : [];

  const chalkTeam =
    clip?.beat.kind === "moment" && clip.beat.moment.side === "defending" ? 0 : 1;

  // The board follows the current beat only, so it clears on a goal rather
  // than showing a pass diagram beside footage of something else.
  const board = current.kind === "moment" ? current.moment : null;

  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [at, asked.length]);

  // Advance automatically through anything that is not a question, so the
  // session plays rather than making a coach click through prose.
  useEffect(() => {
    if (stopped || atEnd || current.kind === "ask") return;
    const dwell =
      current.kind === "moment" || current.kind === "goal"
        ? 9000
        : current.kind === "evidence"
          ? 7000
          : current.kind === "trace"
            ? 5200
            : 3400;
    const t = setTimeout(() => setAt((i) => i + 1), dwell);
    return () => clearTimeout(t);
  }, [at, current, atEnd, stopped]);

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4 lg:h-[calc(100vh-2rem)] lg:flex-row">
      <ChalkFilters />

      {/* ── The tape. Pinned, and it never leaves. ────────────────────── */}
      <div className="flex shrink-0 flex-col gap-2 lg:w-[58%] lg:min-w-0">
        {clip ? (
          <TapePlayer
            key={clip.src}
            src={clip.src}
            frames={frames}
            stopAt={clip.stopAt}
            stopLabel={clip.label}
            chalkTeam={chalkTeam}
            seed={at * 17 + 5}
            autoPlay={clip.primed}
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-surface ring-1 ring-white/[0.06]">
            <span className="font-mono text-[11px] text-muted-2">
              loading the tape
            </span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-1">
          <span className="font-mono text-[10px] text-muted-2">
            {CLIP_MOMENTS.length} moments &middot; 3 goals &middot; cut on the
            broadcast clock
          </span>

          {/* The argument for the whole system, as a switch. */}
          <button
            onClick={() => setMemory((m) => !m)}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ring-1 transition-colors ${
              memory
                ? "bg-accent/10 text-accent ring-accent/30"
                : "bg-white/[0.05] text-muted ring-white/10"
            }`}
          >
            <span
              className={`relative h-3.5 w-6 rounded-full transition-colors ${
                memory ? "bg-accent" : "bg-white/20"
              }`}
            >
              <span
                className={`absolute top-0.5 size-2.5 rounded-full bg-canvas transition-all ${
                  memory ? "left-3" : "left-0.5"
                }`}
              />
            </span>
            <span className="font-mono text-[10px] tracking-[0.08em] uppercase">
              memory {memory ? "on" : "off"}
            </span>
          </button>
        </div>
        {/* What was on, under the tape rather than in the thread: it is a
            picture, and it was unreadable at the width of a chat column. */}
        <AnimatePresence mode="wait">
          {board && (
            <motion.div
              key={board.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="flex min-h-0 flex-1 flex-col rounded-xl bg-surface p-3 ring-1 ring-white/[0.06]"
            >
              <div className="flex items-baseline justify-between gap-3 pb-2">
                <span className="font-mono text-[9px] tracking-[0.12em] text-muted-2 uppercase">
                  what was on
                </span>
                <span className="font-mono text-[10px] text-muted-2">
                  {board.freeze?.length ?? 0} players, where they stood
                </span>
              </div>
              <MomentFrame moment={board} className="mx-auto h-full min-h-0 w-auto" />
            </motion.div>
          )}
        </AnimatePresence>

      </div>

      {/* ── Pep. A thread. ───────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-surface/40 ring-1 ring-white/[0.05]">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          <span className="flex items-center gap-2">
            <span className="relative flex size-1.5">
              {!stopped && !atEnd && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-70" />
              )}
              <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
            </span>
            <span className="text-[13px] font-medium text-chalk">Pep</span>
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-2">
            {Math.min(at + 1, BEATS.length)} / {BEATS.length}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="flex flex-col gap-3.5">
            {shown.map((b, i) => {
              const live = i === at;
              if (b.kind === "trace") {
                return (
                  <Turn key={b.id} showWho={i === 0}>
                    <Trace
                      steps={b.steps}
                      footer={b.footer}
                      title="Working through it"
                      doneTitle="Worked through it"
                    />
                  </Turn>
                );
              }
              if (b.kind === "evidence") {
                return (
                  <Turn key={b.id} showWho={false}>
                    <Evidence card={b.card} memory={memory} />
                  </Turn>
                );
              }
              if (b.kind === "ask") {
                return (
                  <Turn key={b.id} showWho={false}>
                    <Choice
                      question={b.question}
                      options={b.options}
                      onPick={(k) => {
                        if (k === "yes") setAt((x) => x + 1);
                        else setStopped(true);
                      }}
                    />
                  </Turn>
                );
              }
              return (
                <Turn key={b.id} showWho={i === 0}>
                  <BeatBody beat={b} live={live} />
                </Turn>
              );
            })}

            {stopped && (
              <Turn showWho={false}>
                <p className="text-[13px] leading-relaxed text-muted">
                  Stopped there. Ask me anything below, or press play to carry
                  on.
                </p>
              </Turn>
            )}

            {asked.map((q) => (
              <div key={q} className="flex flex-col gap-2">
                <p className="self-end rounded-2xl rounded-br-md bg-surface-raised px-3.5 py-2.5 text-[14px] text-chalk">
                  {q}
                </p>
                <Turn showWho={false}>
                  <p className="text-[13px] leading-relaxed text-warm-2">
                    <StreamText text="The model is not connected in this build, so I would rather say nothing than guess. Everything above came out of the graph." />
                  </p>
                </Turn>
              </div>
            ))}

            <div ref={tail} />
          </div>
        </div>

        {/* ── Controls for the session itself ──────────────────────────── */}
        <div className="border-t border-white/[0.06] px-4 py-3">
          <div className="mb-2.5 flex items-center gap-2">
            <button
              onClick={() => {
                setStopped(false);
                setAt((i) => Math.min(BEATS.length - 1, i + 1));
              }}
              disabled={atEnd}
              className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-canvas transition-all enabled:hover:brightness-110 disabled:bg-white/[0.06] disabled:text-muted-2"
            >
              {atEnd ? "That is the session" : "Next"}
            </button>
            <button
              onClick={() => setStopped((s) => !s)}
              className="rounded-lg bg-white/[0.06] px-3 py-1.5 font-mono text-[11px] text-warm transition-colors hover:bg-white/[0.12] hover:text-chalk"
            >
              {stopped ? "play" : "pause"}
            </button>
            <button
              onClick={() => {
                setAt(0);
                setStopped(false);
              }}
              className="rounded-lg bg-white/[0.06] px-3 py-1.5 font-mono text-[11px] text-warm transition-colors hover:bg-white/[0.12] hover:text-chalk"
            >
              start again
            </button>
          </div>

          <PromptBar
            connected={MODEL_CONNECTED}
            suggestions={asked.length ? [] : SUGGESTIONS}
            onSend={(q) => {
              setAsked((a) => [...a, q]);
              setStopped(true);
            }}
            mentions={CLIP_MOMENTS.map((m) => ({
              key: m.key,
              label: m.surname,
              hint: m.match_clock,
            }))}
            commands={[
              { key: "goals", label: "goals", hint: "the three conceded" },
              { key: "next", label: "next", hint: "who you play" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

/** Kept for the shell's animation key. */
export const SESSION_BEATS = BEATS.length;
