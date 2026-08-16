"use client";

import { motion } from "motion/react";
import { PepTalkMark } from "@/components/logo-marks";

/**
 * One turn in the thread.
 *
 * The brief used to be a single tall block, which meant a coach scrolled
 * looking for where one thought ended and the next began. Turns give it a
 * rhythm: Pep says a thing, the coach answers, Pep says the next thing. It is
 * the shape of being talked through something.
 *
 * Consecutive turns from the same speaker drop the label, so a run of Pep
 * turns reads as one voice continuing rather than five introductions.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

export function Turn({
  who = "pep",
  showWho = true,
  children,
  className = "",
}: {
  who?: "pep" | "coach";
  showWho?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  if (who === "coach") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        className="flex justify-end"
      >
        <span className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-raised px-3.5 py-2.5 text-[14px] leading-relaxed text-chalk">
          {children}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className={`flex gap-3 ${className}`}
    >
      <span className="w-7 shrink-0 pt-0.5">
        {showWho && (
          <span className="flex size-7 items-center justify-center rounded-full bg-accent/12 text-accent">
            <PepTalkMark size={16} />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </motion.div>
  );
}
