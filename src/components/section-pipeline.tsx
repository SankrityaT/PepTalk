"use client";

import { useRef } from "react";
import { motion, useInView, useScroll, useTransform } from "motion/react";

/**
 * Section 05: how the pieces join.
 *
 * The temptation with an architecture section is four labelled boxes and three
 * arrows, which tells a judge the names of the parts and nothing about whether
 * they actually meet. The interesting claim here is not that the project has
 * computer vision and a graph and a model in it. It is that three systems that
 * know nothing about each other can be made to agree about one instant of one
 * football match, and that the agreement is what makes the answer trustworthy.
 *
 * So this follows a single pass through all of them. De Paul, eight minutes and
 * twenty five seconds into the World Cup final, a ball rolled to the byline
 * when there was one into the box. The event feed knows where it went, the
 * threat model knows what it was worth, the broadcast clock knows which second
 * of video to cut, the tracker knows who was in frame, the graph knows whether
 * this is normal for him, and the model gets all of it and is not allowed to
 * add anything.
 *
 * Every figure below is read off that moment or off the running system. The
 * one time this page would be unforgivable for inventing a number is the
 * section explaining why it does not.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

type Stage = {
  n: string;
  kicker: string;
  title: string;
  body: string;
  /** The actual data at this point in the pass, as the system holds it. */
  readout: { k: string; v: string }[];
};

const STAGES: Stage[] = [
  {
    n: "01",
    kicker: "the feed",
    title: "Where the ball went",
    body: "StatsBomb records every touch of 3,961 matches with coordinates. On its own that is a log: it says what happened and nothing about whether it was the right thing to do.",
    readout: [
      { k: "event", v: "pass · Rodrigo De Paul · 08:25" },
      { k: "from", v: "[95.2, 65.6]" },
      { k: "to", v: "[107.9, 72.9]  right, by the byline" },
    ],
  },
  {
    n: "02",
    kicker: "the measurement",
    title: "What else was on",
    body: "A threat model fitted on 6,082,779 actions grades every square of the pitch, and a completion model grades every option he had against the defenders standing in the lane. The ball into the box was worth six and a half times the one he played and was no less likely to arrive.",
    readout: [
      { k: "played", v: "0.023 xT   ·   83% likely" },
      { k: "best available", v: "0.150 xT   ·   85% likely   into the box" },
      { k: "flagged", v: "803 passes had a better option, 8 were material" },
    ],
  },
  {
    n: "03",
    kicker: "the footage",
    title: "The same instant, on video",
    body: "A broadcast clock does not agree with a match clock: there are adverts, replays and a half time. One offset per period, read off the overlay, turns 08:25 into a second of video, and the clip is cut to land on the pass rather than near it. YOLO11m finds the players in the frames and their kit colours are clustered per frame, because a stadium changes colour as the light goes.",
    readout: [
      { k: "clip", v: "008_25.mp4   ·   pass at 6.0s" },
      { k: "alignment", v: "one offset per period, four periods" },
      { k: "tracking", v: "YOLO11m boxes · per-frame kit clustering" },
    ],
  },
  {
    n: "04",
    kicker: "the memory",
    title: "Whether this is normal for him",
    body: "One pass is an anecdote. HydraDB holds what he and 352 other sides have done, and every fact carries the dates it was true and an edge to whatever replaced it. That is the difference between a store that can answer about 2011 and one that averages 2011 with 2021 and describes neither.",
    readout: [
      { k: "facts", v: "2,096 · each with a validity interval" },
      { k: "supersessions", v: "651 edges to the claim that replaced it" },
      { k: "citations", v: "17,533 back to the matches observed" },
    ],
  },
  {
    n: "05",
    kicker: "the sentence",
    title: "What to do about it",
    body: "Claude gets the facts and their ids and writes the read. It is an assistant coach, so the judgement is its job: why this keeps happening, what it costs, what to work on. The numbers are not its job, and it may not produce one that is not in front of it.",
    readout: [
      { k: "contract", v: "facts cited · judgement its own" },
      { k: "checked by", v: "grounded · cited · supported · resolution · abstention" },
      { k: "result", v: "48 of 48" },
    ],
  },
];

function Row({ s, i }: { s: Stage; i: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-18% 0px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 22 }}
      animate={seen ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.65, ease: EASE }}
      className="relative grid gap-6 pb-16 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:pb-24"
    >
      {/* The marker sits on the spine. */}
      <span
        aria-hidden
        className="absolute -left-[33px] top-1.5 hidden size-[9px] rounded-full bg-accent ring-4 ring-canvas lg:block"
      />

      <div>
        <p className="font-mono text-[10px] tracking-[0.16em] text-muted-2 uppercase">
          {s.n} · {s.kicker}
        </p>
        <h3 className="mt-3 text-[22px] leading-tight font-medium text-chalk sm:text-[25px]">
          {s.title}
        </h3>
        <p className="mt-3 max-w-md text-[14px] leading-relaxed text-muted">{s.body}</p>
      </div>

      {/* The data itself, in the shape the system holds it. Monospaced because
          it is a readout and not a caption. */}
      <div className="rounded-xl bg-surface/70 p-4 ring-1 ring-white/[0.06] lg:mt-7">
        <dl className="space-y-2.5">
          {s.readout.map((r) => (
            <div key={r.k} className="grid grid-cols-[104px_1fr] gap-3">
              <dt className="font-mono text-[10px] leading-[1.6] tracking-[0.06em] text-muted-2 uppercase">
                {r.k}
              </dt>
              <dd
                className={`font-mono text-[11.5px] leading-[1.6] ${
                  i === 4 ? "text-accent/90" : "text-warm-2"
                }`}
              >
                {r.v}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </motion.div>
  );
}

export function SectionPipeline() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-15% 0px" });

  // The spine draws as the section passes, so the eye is pulled down it rather
  // than to five separate cards.
  const track = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: track,
    offset: ["start 0.8", "end 0.65"],
  });
  const height = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <section className="relative bg-canvas px-5 py-28 sm:px-8 lg:py-36">
      <div className="mx-auto w-full max-w-6xl">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 20 }}
          animate={seen ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <p className="font-mono text-[11px] tracking-[0.16em] text-accent uppercase">
            05 — how it holds together
          </p>
          <h2 className="mt-4 max-w-3xl text-[34px] leading-[1.08] font-medium tracking-[-0.02em] text-chalk sm:text-[46px]">
            One pass, through every part of it.
          </h2>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-warm-2">
            Eight minutes into the final, De Paul rolled it to the byline with a
            ball into the box available. Four systems that know nothing about
            each other have to agree about that one second before Pep is allowed
            to say a word about it.
          </p>
        </motion.div>

        <div ref={track} className="relative mt-14 lg:mt-20 lg:pl-10">
          {/* The spine. Static rail, accent fill that follows the scroll. */}
          <span
            aria-hidden
            className="absolute top-2 bottom-16 left-0 hidden w-px bg-white/[0.09] lg:block"
          />
          <motion.span
            aria-hidden
            style={{ height }}
            className="absolute top-2 left-0 hidden w-px bg-accent/70 lg:block"
          />

          {STAGES.map((s, i) => (
            <Row key={s.n} s={s} i={i} />
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: EASE }}
          className="max-w-3xl border-t border-white/[0.07] pt-8 text-[14px] leading-relaxed text-muted lg:ml-10"
        >
          The joins are the work. An event feed with no video cannot show a coach
          what it means, footage with no measurement cannot say which ten seconds
          matter, and a model with neither will write something fluent and
          wrong. What makes the answer worth reading is that the clip, the
          number and the sentence are all describing the same instant, and every
          one of them can be traced back to where it came from.
        </motion.p>
      </div>
    </section>
  );
}
