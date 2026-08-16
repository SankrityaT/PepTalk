"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Choice } from "@/components/brief/atoms/choice";
import { PromptBar } from "@/components/brief/atoms/prompt-bar";
import { StreamText } from "@/components/brief/atoms/stream-text";
import { Trace } from "@/components/brief/atoms/trace";
import { Turn } from "@/components/brief/atoms/turn";
import { ChalkFilters } from "@/components/chalk-filters";
import { PepTalkMark } from "@/components/logo-marks";
import { MomentFrame } from "@/components/report/moment-frame";
import { Evidence } from "@/components/session/evidence";
import { TapePlayer } from "@/components/tape/tape-player";
import { BEATS, Beat, COMMANDS, SCALE, SOURCES, SUGGESTIONS, clipFor } from "@/content/session";
import { CLIP_MOMENTS } from "@/content/clip";
import { MOMENTS } from "@/content/pep";
import knowledge from "@/content/snapshots/knowledge.json";

/** What this match measured on its own, with no graph involved. */
const THIS_MATCH: Record<string, number | undefined> = {
  "possession share": 53.8,
  "pressing height": 51.67,
  "attacking width": 23.44,
  directness: 0.631,
};

const UNITS: Record<string, string> = {
  "possession share": "%",
  "pressing height": "m",
  "defensive line height": "m",
  "attacking width": "m",
  directness: "",
};

const KNOW = knowledge as unknown as {
  scale: { teams: number; matches: number; facts: number };
  dimensions: {
    label: string;
    value: number;
    band: string;
    obs: number;
    percentile: number;
    peers: number;
  }[];
};

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

function BeatBody({
  beat,
  live,
  memory,
}: {
  beat: Beat;
  live: boolean;
  memory: boolean;
}) {
  if (beat.kind === "say") {
    // Some lines only hold because the graph has dates on it. With memory off
    // they say the smaller, true thing instead of quietly staying the same.
    const text = !memory && beat.withoutMemory ? beat.withoutMemory : beat.text;
    return (
      <p
        className={`text-[15px] leading-relaxed ${
          !memory && beat.withoutMemory ? "text-muted" : "text-warm"
        }`}
      >
        {live ? <StreamText text={text} /> : text}
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
          {memory ? m.numbers : "threat and completion come from models fitted across the graph"}
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

/**
 * What a question gets answered with.
 *
 * The switch does not turn Pep off. Everything measured from the match in
 * front of him still works without a graph: the tracking, the models, what
 * happened on the day. An earlier version had him answer "I cannot tell you"
 * to everything, which was both useless and untrue.
 *
 * What the graph adds is the second layer, and it is the layer a coach cannot
 * get from watching their own game again: whether this is normal for them,
 * when it changed, and where it sits among everyone else. So the answer is
 * built in two parts, and only the second one disappears.
 */
function Answer({ question, memory }: { question: string; memory: boolean }) {
  const q = question.toLowerCase();
  const dim =
    KNOW.dimensions.find((d) => q.includes(d.label.split(" ")[0])) ??
    (q.includes("press") ? KNOW.dimensions.find((d) => d.label.includes("pressing")) : null) ??
    null;

  const here = dim ? THIS_MATCH[dim.label] : null;

  const observed = dim
    ? here !== undefined && here !== null
      ? `In this game your ${dim.label} was ${here}${UNITS[dim.label] ?? ""}.`
      : `I measured your ${dim.label} in this game.`
    : `From this game I have ${MOMENTS.length} moments where a better ball was on and 3 goals against, all tracked off the footage.`;

  const recalled = dim
    ? `That is ${Math.abs(dim.value - (here ?? dim.value)).toFixed(1)}${UNITS[dim.label] ?? ""} ${
        (here ?? dim.value) < dim.value ? "below" : "above"
      } your norm of ${dim.value}, which held across ${dim.obs} games, and puts you ${dim.percentile}th of ${dim.peers} sides.`
    : `Against ${KNOW.scale.matches.toLocaleString()} matches and ${KNOW.scale.teams} sides in the graph, the thing that stands out is how patiently you play.`;

  return (
    <div className="rounded-xl bg-surface px-3.5 py-3 ring-1 ring-white/[0.06]">
      <p className="text-[14px] leading-relaxed text-warm">
        <StreamText text={observed} />
      </p>

      {memory ? (
        <p className="mt-2 text-[14px] leading-relaxed text-warm">
          <StreamText text={recalled} startDelay={500} />
        </p>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          That is as far as this game takes me. Whether it is normal for you,
          when it changed, or how it compares to anyone else all need the
          memory.
        </p>
      )}

      <p className="mt-2.5 font-mono text-[10px] text-muted-2">
        {memory
          ? `read off this match · ${KNOW.scale.facts.toLocaleString()} dated facts across ${KNOW.scale.teams} sides`
          : "read off this match · 0 dated facts"}
      </p>
    </div>
  );
}

export function Session() {
  const [at, setAt] = useState(0);
  const [memory, setMemory] = useState(true);
  const [asked, setAsked] = useState<string[]>([]);
  const [attached, setAttached] = useState<string[]>([]);
  const [playing, setPlaying] = useState(true);
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

  // The board holds the same way the tape does. Clearing it on a beat that
  // has no diagram left the column half empty, and an empty panel beside a
  // playing video is the shape this rebuild set out to remove.
  const board = (() => {
    for (let i = at; i >= 0; i--) {
      const b = BEATS[i];
      if (b.kind === "moment") return b.moment;
      // A goal is footage, not a pass diagram; stop looking rather than pair
      // it with an unrelated board.
      if (b.kind === "goal") return null;
    }
    return null;
  })();

  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [at, asked.length]);

  const advance = () => setAt((i) => Math.min(BEATS.length - 1, i + 1));

  // Beats with footage move on when the clip reaches its moment and the coach
  // has had a beat to read the line. Everything else is on a short timer.
  // Tying the rhythm to the passage rather than a stopwatch is what stops the
  // tape being swapped out from under someone mid-play.
  useEffect(() => {
    if (!playing || atEnd || current.kind === "ask") return;
    if (current.kind === "moment" || current.kind === "goal") return;
    const dwell =
      current.kind === "evidence" ? 7000 : current.kind === "trace" ? 5200 : 3400;
    const t = setTimeout(advance, dwell);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, current, atEnd, playing]);

  /**
   * The clip reaching its moment is reported as a bump rather than handled in
   * a callback. A callback closes over the render that created it, and the
   * first version read a stale `playing` and never advanced.
   */
  const [reached, setReached] = useState(0);

  useEffect(() => {
    if (!reached || !playing || atEnd) return;
    const t = setTimeout(advance, 4200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reached, playing, atEnd]);

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
            // Only the clip belonging to the current beat drives the
            // transport. The one shown during the greeting is a preview: left
            // to run, it reached its stop point and paused the whole session
            // before the coach had read a line.
            autoPlay={clip.primed && playing}
            playing={clip.primed ? playing : false}
            onPlayingChange={clip.primed ? setPlaying : undefined}
            onReachedStop={clip.primed ? () => setReached((n) => n + 1) : undefined}
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
            <PepTalkMark size={18} className="text-chalk" />
            <span className="font-display text-[13px] text-chalk">Pep</span>
            {/* Live only while the session is actually running. */}
            {playing && !atEnd && (
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-70" />
                <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
              </span>
            )}
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
                        if (k === "yes") advance();
                        else setPlaying(false);
                      }}
                    />
                  </Turn>
                );
              }
              return (
                <Turn key={b.id} showWho={i === 0}>
                  <BeatBody beat={b} live={live} memory={memory} />
                </Turn>
              );
            })}

            {/* Attaching footage is a real path and a partly manual one. Say
                which half runs where rather than showing a spinner that is
                not attached to anything. */}
            {attached.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="self-end rounded-2xl rounded-br-md bg-surface-raised px-3.5 py-2.5 text-[14px] text-chalk">
                  {attached.join(", ")}
                </p>
                <Turn showWho={false}>
                  <p className="text-[14px] leading-relaxed text-warm">
                    {attached.length === 1 ? "That file goes" : "Those files go"} through the same
                    pipeline this session came out of: detection and kit clustering per frame, the
                    broadcast clock read off the overlay to line video time up with match time, then
                    the moments and the chalk. It runs as a command in this build, not an upload, so
                    it is <span className="font-mono text-[12.5px] text-chalk">peptalk analyse</span>{" "}
                    on your machine and the next session opens on it.
                  </p>
                </Turn>
              </div>
            )}

            {asked.map((q) => (
              <div key={q} className="flex flex-col gap-2">
                <p className="self-end rounded-2xl rounded-br-md bg-surface-raised px-3.5 py-2.5 text-[14px] text-chalk">
                  {q}
                </p>
                <Turn showWho={false}>
                  <Answer question={q} memory={memory} />
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
              onClick={advance}
              disabled={atEnd}
              className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-canvas transition-all enabled:hover:brightness-110 disabled:bg-white/[0.06] disabled:text-muted-2"
            >
              {atEnd ? "That is the session" : "Next"}
            </button>
            <button
              onClick={() => {
                setAt(0);
                setPlaying(true);
              }}
              className="rounded-lg bg-white/[0.06] px-3 py-1.5 font-mono text-[11px] text-warm transition-colors hover:bg-white/[0.12] hover:text-chalk"
            >
              start again
            </button>
            <span className="ml-auto font-mono text-[10px] text-muted-2">
              {playing ? "playing" : "paused"}
            </span>
          </div>

          <PromptBar
            connected={MODEL_CONNECTED}
            suggestions={asked.length ? [] : SUGGESTIONS}
            onSend={(q) => {
              // A command is a jump, not a question. Anything Pep would have
              // to answer in prose about a beat that exists is better served
              // by putting the coach on that beat.
              const cmd = COMMANDS.find((c) => q.toLowerCase().startsWith(`/${c.label}`));
              if (cmd) {
                const to = BEATS.findIndex((b) => b.id === cmd.to);
                if (to >= 0) {
                  setAt(to);
                  setPlaying(true);
                  return;
                }
              }
              setAsked((a) => [...a, q]);
              setPlaying(false);
            }}
            sources={SOURCES}
            mentions={CLIP_MOMENTS.map((m) => ({
              key: m.key,
              label: m.surname,
              hint: m.match_clock,
            }))}
            commands={COMMANDS}
            memory={memory}
            onMemory={setMemory}
            memoryOn={`${SCALE.facts.toLocaleString()} dated facts across ${SCALE.teams} sides, with when each one held`}
            memoryOff="this game only, with nothing to hold it against"
            onAttach={(files) => {
              setAttached((a) => [...a, ...files.map((f) => f.name)]);
              setPlaying(false);
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Kept for the shell's animation key. */
export const SESSION_BEATS = BEATS.length;
