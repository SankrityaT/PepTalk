"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { StreamText } from "@/components/brief/atoms/stream-text";
import { Trace } from "@/components/brief/atoms/trace";
import type { Step } from "@/components/brief/atoms/trace";

/**
 * A real answer.
 *
 * The question goes to the graph service, which retrieves the dated facts that
 * bear on it and hands them to a model with instructions to use nothing else.
 * What comes back is genuinely generated, and every claim in it carries the id
 * of the fact it came from, so the chips underneath are not decoration: they
 * are the graph nodes the sentence was built out of.
 *
 * The memory switch travels with the question rather than being applied to the
 * result. With it off, retrieval skips the fact queries entirely and the model
 * gets only what this match measured. It still answers, because measuring a
 * match never needed a graph. It just cannot tell you whether any of it is
 * usual, and it says so in its own words rather than in a line written here.
 *
 * When no service is reachable this says so plainly. A canned reply that reads
 * like a real one would undermine every honest number on the page.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

export type Fact = {
  id: number;
  kind: string;
  text: string;
  node?: number;
  dimension?: string;
};

type Result = {
  answer: string;
  memory: boolean;
  retrieved: Fact[];
  cited: Fact[];
  player: string | null;
};

/** Fact kinds, in the order they should read, with how to badge them. */
const KIND_TONE: Record<string, string> = {
  "this match": "bg-white/[0.07] text-chalk-3",
  "player norm": "bg-accent/12 text-accent",
  "player change": "bg-accent/18 text-accent",
  "squad ranking": "bg-accent/12 text-accent",
  "team norm": "bg-white/[0.07] text-warm",
  player: "bg-white/[0.07] text-warm",
};

export function Answer({
  question,
  memory,
  match,
}: {
  question: string;
  memory: boolean;
  /** What the interface measured off the game on screen. */
  match: Record<string, string | number>;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<{ error: string; detail?: string } | null>(null);
  const [open, setOpen] = useState(false);

  // No reset here: the parent keys this component on question and memory, so
  // flipping the switch mounts a fresh one rather than clearing an old one.
  // Resetting in the effect instead means a synchronous setState on every run.
  useEffect(() => {
    let live = true;
    inflight(question, memory, match)
      .then((body) => live && setResult(body))
      .catch((e) => live && setError(asDetail(e)));

    return () => {
      live = false;
    };
  }, [question, memory, match]);

  if (error) {
    return (
      <div className="rounded-xl bg-surface px-3.5 py-3 ring-1 ring-white/[0.06]">
        <p className="text-[14px] leading-relaxed text-warm">{error.error}.</p>
        {error.detail && (
          <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted-2">
            {error.detail}
          </p>
        )}
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Nothing is answered from a script here, so when the graph is not
          there, there is no answer to give.
        </p>
      </div>
    );
  }

  // The trace is the same component the opening brief uses, driven off the
  // real request rather than a timer: the last stage keeps spinning until the
  // model replies. Every row is work that actually runs, in retrieval order.
  const steps = tracing(question, memory, result);

  if (!result) {
    return (
      <Trace
        steps={steps}
        live={false}
        collapseWhenDone={false}
        title={memory ? "Reading the graph" : "Reading this match"}
        doneTitle=""
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Trace
        steps={steps}
        live
        collapseWhenDone
        title={memory ? "Reading the graph" : "Reading this match"}
        doneTitle={
          memory
            ? `Read ${result.retrieved.length} facts from HydraDB`
            : `Read ${result.retrieved.length} measurements, no history`
        }
      />

      <div className="rounded-xl bg-surface px-3.5 py-3 ring-1 ring-white/[0.06]">
      <p className="text-[14px] leading-relaxed text-warm">
        <StreamText text={stripIds(result.answer)} />
      </p>

      {result.cited.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {result.cited.map((f) => (
            <span
              key={f.id}
              title={f.text}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                KIND_TONE[f.kind] ?? "bg-white/[0.07] text-warm"
              }`}
            >
              {f.kind}
              {f.node ? ` #${f.node}` : ""}
            </span>
          ))}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-2.5 font-mono text-[10px] text-muted-2 transition-colors hover:text-muted"
      >
        {memory
          ? `${result.retrieved.length} facts retrieved from HydraDB, ${result.cited.length} used`
          : `${result.retrieved.length} facts retrieved, 0 dated`}
        <span className="ml-1.5">{open ? "hide" : "show"}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="mt-2 overflow-hidden border-t border-white/[0.06] pt-2"
          >
            {result.retrieved.map((f) => {
              const used = result.cited.some((c) => c.id === f.id);
              return (
                <li
                  key={f.id}
                  className={`flex gap-2 py-0.5 font-mono text-[10px] leading-relaxed ${
                    used ? "text-warm" : "text-muted-2"
                  }`}
                >
                  <span className={used ? "text-accent" : "text-muted-2"}>
                    [{f.id}]
                  </span>
                  <span className="min-w-0 flex-1">{f.text}</span>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * The stages, in the order retrieval runs them.
 *
 * Details are blank until the answer lands, because a trace that reports a
 * figure it has not measured yet is the exact move that makes agent products
 * untrustworthy. They fill in when the real counts arrive.
 */
function tracing(question: string, memory: boolean, r: Result | null): Step[] {
  const named = r?.player ?? null;
  const facts = r?.retrieved ?? [];
  const count = (kind: string) => facts.filter((f) => f.kind === kind).length;

  if (!memory) {
    return [
      { label: "Reading what this match measured", detail: r ? `${facts.length}` : "" },
      { label: "Skipping the graph, memory is off", detail: r ? "0 facts" : "" },
      { label: "Asking the model", detail: r ? "answered" : "" },
    ];
  }

  return [
    {
      label: named ? `Resolving who you asked about` : "Looking for a player in the question",
      detail: r ? (named ?? "nobody named") : "",
    },
    {
      label: named ? `Reading ${named}'s dated facts` : "Ranking the squad on threat left",
      detail: r ? `${count("player norm") + count("squad ranking")}` : "",
    },
    {
      label: "Following what those facts replaced",
      detail: r ? `${count("player change")}` : "",
    },
    { label: "Reading the team norms", detail: r ? `${count("team norm")}` : "" },
    {
      label: "Asking the model, facts only",
      detail: r ? `${r.cited.length} cited` : "",
    },
  ];
}

/**
 * One request per (question, memory) pair, shared.
 *
 * React runs effects twice in development, and the model call behind this takes
 * ten seconds through a CLI subprocess. The first version guarded with a ref,
 * which skipped the second run while the first run's cleanup had already
 * marked its result stale, so the answer arrived and was thrown away and the
 * spinner ran forever. Caching the promise dedupes correctly and costs one
 * call rather than two.
 */
const CACHE = new Map<string, Promise<Result>>();

function inflight(
  question: string,
  memory: boolean,
  match: Record<string, string | number>,
): Promise<Result> {
  const key = `${question}::${memory}`;
  const hit = CACHE.get(key);
  if (hit) return hit;

  const p = fetch("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, memory, match }),
  })
    .then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw body;
      return body as Result;
    })
    .catch((e) => {
      // A failure must not be cached, or the retry after starting the graph
      // service would return the same error without asking again.
      CACHE.delete(key);
      throw e;
    });

  CACHE.set(key, p);
  return p;
}

function asDetail(e: unknown): { error: string; detail?: string } {
  if (e && typeof e === "object" && "error" in e) {
    return e as { error: string; detail?: string };
  }
  return { error: "the question could not be sent", detail: String(e) };
}

/**
 * Take the [3] markers out of the prose.
 *
 * They are how the model proves each claim came from a retrieved fact, and the
 * chips below carry the same information in a form a coach can read. Leaving
 * both in makes a sentence look like a bibliography.
 */
function stripIds(text: string): string {
  return text
    .replace(/\s*\[\d+\](\[\d+\])*/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}
