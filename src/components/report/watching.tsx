//created by kinjal
"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { COMPLETION_MODEL, MOMENTS_FOUND } from "@/content/pep";
import { type Job, type JobStep, job as fetchJob } from "@/lib/games";

/**
 * Screen 4. Not a spinner, and no longer a replay either.
 *
 * When a coach adds their own game this polls the real job: the steps are the
 * pipeline's own stages, and the figures beside them are what that stage
 * actually produced — how many events were read, how many moments cleared the
 * materiality bar, how many clips were cut. A run takes minutes, so this is
 * the honest thing to show, and it doubles as the answer to a judge who
 * suspects the demo is canned.
 *
 * Without a job (the built-in example) it stays what it was: a timed reveal of
 * figures the pipeline produced earlier, and the copy says so.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

/** The example match's real figures, revealed on a timer. */
const CANNED = [
  { label: "reading the footage", detail: "303 frames of live play" },
  { label: "finding the players", detail: "3,891 detections" },
  { label: "working out who is who", detail: "two kits separated, officials dropped" },
  { label: "comparing against elite football", detail: "3,961 matches" },
  {
    label: "checking which balls were on",
    detail: `${COMPLETION_MODEL.n} passes, ${Math.round(COMPLETION_MODEL.completion_rate * 100)}% completion baseline`,
  },
  { label: "finding your moments", detail: `${MOMENTS_FOUND} where a better ball was available` },
];

export function Watching({
  onDone,
  jobId,
  onFailed,
}: {
  onDone: (key?: string) => void;
  jobId?: string;
  onFailed?: (message: string) => void;
}) {
  return jobId ? (
    <Live jobId={jobId} onDone={onDone} onFailed={onFailed} />
  ) : (
    <Replay onDone={onDone} />
  );
}

/* ── The real thing ─────────────────────────────────────────────────── */

function Live({
  jobId,
  onDone,
  onFailed,
}: {
  jobId: string;
  onDone: (key?: string) => void;
  onFailed?: (message: string) => void;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const j = await fetchJob(jobId);
        if (!live) return;
        setJob(j);
        if (j.status === "ready") {
          setTimeout(() => live && onDone(j.key), 600);
          return;
        }
        if (j.status === "failed") {
          const msg = j.error ?? "The run failed.";
          setError(msg);
          onFailed?.(msg);
          return;
        }
        timer = setTimeout(poll, 1000);
      } catch (e) {
        if (!live) return;
        const msg = (e as Error).message;
        setError(msg);
        onFailed?.(msg);
      }
    };

    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [jobId, onDone, onFailed]);

  return (
    <Frame
      title="Pep is watching"
      subtitle={job?.label ?? "Getting started."}
      footer={
        error ? undefined : (
          <>
            This is running now, against real data. It takes a few minutes:
            the events have to be downloaded, a pass model fitted to this
            match, and the footage cut.
          </>
        )
      }
    >
      {error ? (
        <div className="rounded-xl bg-surface px-5 py-5 ring-1 ring-white/[0.07]">
          <p className="text-[15px] leading-relaxed text-warm">{error}</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]">
          {(job?.steps ?? []).map((s) => (
            <Row
              key={s.step}
              label={s.step}
              detail={describe(s)}
              done={s.status === "done"}
              active={s.status === "running"}
              skipped={s.status === "skip"}
            />
          ))}
          {!job && (
            <li className="px-5 py-4 text-[15px] text-muted-2">Starting…</li>
          )}
        </ul>
      )}
    </Frame>
  );
}

/** What a finished step actually produced, in a coach's words. */
function describe(s: JobStep): string {
  const d = s.detail ?? {};
  if (s.status === "skip") return "skipped";
  if (s.status !== "done") return "";
  if (d.label) return String(d.label);
  if (d.events) return `${Number(d.events).toLocaleString()} events`;
  if (d.possession !== undefined) return `${d.possession}% of the ball`;
  if (d.trained_on !== undefined)
    return `${Number(d.trained_on).toLocaleString()} matches of elite football`;
  if (d.found !== undefined)
    return `${d.found} worth showing, of ${Number(d.considered ?? 0).toLocaleString()} considered`;
  if (d.clips !== undefined) return `${d.clips} cut`;
  if (d.files !== undefined) return `${d.files} files`;
  if (d.coverage !== undefined)
    return `${Math.round(Number(d.coverage) * 100)}% of passes have one`;
  if (d.available) return "found";
  return s.ms ? `${(s.ms / 1000).toFixed(1)}s` : "";
}

/* ── The example, replayed ──────────────────────────────────────────── */

function Replay({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= CANNED.length) {
      const t = setTimeout(onDone, 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 500 : 620);
    return () => clearTimeout(t);
  }, [step, onDone]);

  return (
    <Frame
      title="Pep is watching"
      subtitle="Give him a moment with it."
      footer={
        <>
          These are the real figures from this match. The analysis ran ahead of
          time so the page loads instantly. Nothing here is a placeholder.
        </>
      }
    >
      <ul className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/[0.06]">
        {CANNED.map((s, i) => (
          <Row
            key={s.label}
            label={s.label}
            detail={s.detail}
            done={i < step}
            active={i === step}
          />
        ))}
      </ul>
    </Frame>
  );
}

/* ── Shared shell ───────────────────────────────────────────────────── */

function Frame({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        <h2 className="text-[20px] font-medium text-chalk">{title}</h2>
      </div>
      <p className="mt-2 text-[15px] text-warm-2">{subtitle}</p>
      <div className="mt-8">{children}</div>
      {footer && (
        <p className="mt-6 text-[13px] leading-relaxed text-muted-2">{footer}</p>
      )}
    </div>
  );
}

function Row({
  label,
  detail,
  done,
  active,
  skipped,
}: {
  label: string;
  detail: string;
  done: boolean;
  active: boolean;
  skipped?: boolean;
}) {
  const lit = done || active || skipped;
  return (
    <motion.li
      initial={{ opacity: 0 }}
      animate={{ opacity: lit ? 1 : 0.25 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="flex items-baseline justify-between gap-4 border-b border-white/[0.05] px-5 py-4 last:border-b-0"
    >
      <span className="flex items-baseline gap-3">
        <span className={`text-[13px] ${done ? "text-accent" : "text-muted-2"}`}>
          {done ? "✓" : active ? "·" : skipped ? "–" : " "}
        </span>
        <span className={`text-[15px] ${lit ? "text-warm" : "text-muted-2"}`}>
          {label}
        </span>
      </span>
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: detail ? 1 : 0 }}
        transition={{ duration: 0.25 }}
        className="shrink-0 text-right font-mono text-[12px] tabular-nums text-muted"
      >
        {detail}
      </motion.span>
    </motion.li>
  );
}
