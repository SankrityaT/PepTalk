"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Choice } from "@/components/brief/atoms/choice";
import { ContextCards } from "@/components/brief/atoms/context-card";
import { PromptBar } from "@/components/brief/atoms/prompt-bar";
import { SourceChip } from "@/components/brief/atoms/source-chip";
import { StreamText } from "@/components/brief/atoms/stream-text";
import { Trace } from "@/components/brief/atoms/trace";
import { ClipCard } from "@/components/brief/clip-card";
import { Conceded } from "@/components/brief/conceded";
import { Walkthrough } from "@/components/brief/walkthrough";
import { MomentFrame } from "@/components/report/moment-frame";
import { TapeRoom } from "@/components/report/tape-room";
import { CLIPS, DETECTIONS } from "@/lib/tape";
import {
  CHUNKS,
  DEVIATIONS,
  MATCH,
  MODEL_SOURCE,
  STEPS,
  SUGGESTIONS,
  TRACE_FOOTER,
  labelFor,
  sourceFor,
  unitFor,
} from "@/content/brief";
import {
  MOMENTS,
  MOMENTS_FOUND,
  Moment,
  PASSES_WITH_AN_OPTION,
  THEMES,
} from "@/content/pep";
import { TOTALS } from "@/content/dashboard";

/**
 * The brief.
 *
 * A coach walks in and gets told what happened, the way a good number two
 * does. They never have to think of a question to get value — that is the
 * whole design. The prompt bar at the bottom is the escape hatch for the coach
 * who has one anyway, and it stays live while the brief is still streaming, so
 * interrupting is always allowed.
 *
 * The stream advances stage by stage, each block reporting in when it finishes
 * so the next can start. It stops once, at the point where a decision is
 * genuinely the coach's — how much of it they want to go through — and never
 * blocks the page while it waits.
 *
 * Three interfaces were rejected before this one, and the reason was the same
 * each time: they described things instead of showing them. So the findings
 * here carry the frozen moment itself, not a paragraph about it.
 */

type Stage = "trace" | "context" | "findings" | "ask" | "open";

const EASE = [0.4, 0, 0.2, 1] as const;

/** Set at build time; the prompt bar says so rather than faking an answer. */
const MODEL_CONNECTED = false;

export function Brief({ onOpenMoment }: { onOpenMoment: (m: Moment) => void }) {
  const [stage, setStage] = useState<Stage>("trace");
  const [picked, setPicked] = useState<string | null>(null);
  const [asked, setAsked] = useState<string[]>([]);
  const [openClip, setOpenClip] = useState<number | null>(null);
  const [showConceded, setShowConceded] = useState(false);

  const at = (s: Stage): boolean =>
    (["trace", "context", "findings", "ask", "open"] as Stage[]).indexOf(stage) >=
    (["trace", "context", "findings", "ask", "open"] as Stage[]).indexOf(s);

  const lead = DEVIATIONS[0];
  const leadSource = lead ? sourceFor(lead) : null;

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-6 pb-40 transition-[max-width] duration-500 ${
        picked === "yes" ? "max-w-6xl" : "max-w-3xl"
      }`}
    >
      {/* ── Greeting ──────────────────────────────────────────────────── */}
      <header className="pt-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-2">
          {MATCH?.competition} &middot; {MATCH?.date}
        </p>
        <h1 className="mt-2.5 text-[28px] leading-tight font-medium text-chalk sm:text-[34px]">
          <StreamText text="Morning, coach." />
        </h1>
        <p className="mt-3 text-[16px] leading-relaxed text-warm-2">
          <StreamText
            startDelay={700}
            text={`I went through ${MATCH?.label ?? "your last game"} and held it against the ${TOTALS.in_graph} of yours I already have.`}
          />
        </p>
      </header>

      {/* ── What Pep did ──────────────────────────────────────────────── */}
      <Trace
        steps={STEPS}
        title="Working through it"
        doneTitle="Worked through it"
        footer={TRACE_FOOTER}
        onDone={() => setStage("context")}
      />

      {/* ── The footage ───────────────────────────────────────────────── */}
      {/* Leads, because a coach recognises their game from the picture of it.
          An earlier version of this brief opened with pitch diagrams and the
          actual tape was three clicks away, which is exactly backwards. */}
      <AnimatePresence>
        {at("context") && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="flex flex-col gap-2.5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-2">
                Highlights I went through
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-2">
                {DETECTIONS.toLocaleString()} detections
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {CLIPS.map((c) => (
                <ClipCard
                  key={c.id}
                  from={c.from}
                  to={c.to}
                  label={c.label}
                  active={openClip === c.id}
                  onOpen={() => setOpenClip(openClip === c.id ? null : c.id)}
                />
              ))}
            </div>

            <AnimatePresence initial={false}>
              {openClip !== null && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="pt-1">
                    <TapeRoom startAt={CLIPS[openClip].from} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ── What it pulled in ─────────────────────────────────────────── */}
      <AnimatePresence>
        {at("context") && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15, ease: EASE }}
          >
            <ContextCards chunks={CHUNKS} label="Pulled from your memory" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── The headline ──────────────────────────────────────────────── */}
      {at("context") && lead && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          className="text-[16px] leading-relaxed text-warm"
        >
          <StreamText
            startDelay={500}
            text={`You won it playing unlike yourselves. Your ${labelFor(lead.dimension)} was ${Math.abs(lead.delta ?? 0).toFixed(1)}${unitFor(lead.dimension)}${lead.delta && lead.delta > 0 ? " higher" : " lower"} than your norm, which had held across ${lead.era_matches} games.`}
            onDone={() => setStage("ask")}
          />
          {leadSource && <SourceChip source={leadSource} />}
        </motion.p>
      )}

      {/* The three training themes used to sit here as pitch diagrams. They
          are a later thing: a coach wants to see the game before being handed
          a session plan, so the brief goes straight from what happened to
          watching it. The themes live on after the walkthrough. */}

      {/* ── The one question ──────────────────────────────────────────── */}
      <AnimatePresence>
        {at("ask") && !picked && (
          <Choice
            question="Want to go through them one by one?"
            picked={picked}
            onPick={setPicked}
            options={[
              { key: "yes", label: "Yes, take me through", primary: true },
              { key: "later", label: "Not now" },
            ]}
          />
        )}
      </AnimatePresence>

      {/* ── Going through them, without leaving the page ──────────────── */}
      {/* This used to navigate to a separate report, which threw away the
          thread and made the coach find their place again. The walkthrough
          appends to the stream instead. */}
      {(picked === "yes" || picked === "top") && (
        <Walkthrough onDone={() => setShowConceded(true)} />
      )}

      {/* The other half of the game. Everything above asks what the side
          failed to do with the ball; this asks what happened in front of
          them, which is the half a coach loses sleep over. */}
      {showConceded && (
        <section className="mt-2">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] tracking-[0.14em] text-muted-2 uppercase">
              How the goals went in
            </span>
          </div>
          <Conceded />
        </section>
      )}

      {picked === "later" && (
        <p className="text-[15px] leading-relaxed text-warm-2">
          <StreamText text="Fine. They are on the Tape tab whenever you want them, and you can ask me about any of it below." />
        </p>
      )}

      {/* ── Anything the coach asked ──────────────────────────────────── */}
      {asked.map((q) => (
        <div key={q} className="flex flex-col gap-2">
          <p className="self-end rounded-2xl rounded-br-sm bg-surface-raised px-3.5 py-2.5 text-[14px] text-chalk">
            {q}
          </p>
          <p className="text-[14px] leading-relaxed text-warm-2">
            <StreamText text="The model is not connected in this build, so I would rather say nothing than guess. Everything above came from the snapshot, and the same answer with the graph behind it needs the service running." />
          </p>
        </div>
      ))}

      {/* ── Always live ───────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.07] bg-canvas/95 px-5 pb-20 pt-4 backdrop-blur-sm lg:left-56 lg:pb-4">
        <div className="mx-auto w-full max-w-3xl">
          <PromptBar
            connected={MODEL_CONNECTED}
            suggestions={asked.length ? [] : SUGGESTIONS}
            onSend={(q) => setAsked((a) => [...a, q])}
            mentions={MOMENTS.map((m) => ({
              key: String(m.id),
              label: m.player.split(" ").slice(-1)[0],
              hint: `${m.minute}'`,
            }))}
            commands={[
              { key: "tape", label: "tape", hint: "open the footage" },
              { key: "training", label: "training", hint: "this week's session" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
