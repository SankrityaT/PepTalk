"use client";

import { useRef } from "react";
import { motion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { PITCH_H, PITCH_W } from "./chalk-pitch";
import { TACTICAL_STATES, type TacticalState } from "@/content/hero";

/**
 * The hero's central device: scrolling is time travel.
 *
 * As the hero scrolls, a normalised 0→1 progress value walks through the
 * tactical states. Players interpolate between eras, the press-height line
 * slides, and the readout re-dates itself. The product's entire thesis 
 * that a team's identity is a function of time, is demonstrated by the
 * interaction before anyone reads a word of copy.
 */

const STATE_COUNT = TACTICAL_STATES.length;

/**
 * How far in from the pitch edge annotations sit.
 *
 * The board is intentionally wider than the viewport, so its top and bottom
 * bands are cropped. Labels placed at the true edge get sliced in half.
 */
const LABEL_INSET = 150;

/** Interpolate a metric across all states at the given progress. */
function useMetricAcrossStates(
  progress: MotionValue<number>,
  pick: (state: TacticalState) => number,
) {
  const stops = TACTICAL_STATES.map((_, i) => i / (STATE_COUNT - 1));
  return useTransform(progress, stops, TACTICAL_STATES.map(pick));
}

function PlayerMark({
  index,
  progress,
}: {
  index: number;
  progress: MotionValue<number>;
}) {
  const stops = TACTICAL_STATES.map((_, i) => i / (STATE_COUNT - 1));

  // Player positions are stored as percentages so the same mark can be
  // followed across formations even when its role changes.
  const cx = useTransform(
    progress,
    stops,
    TACTICAL_STATES.map((s) => (s.players[index].x / 100) * PITCH_W),
  );
  const cy = useTransform(
    progress,
    stops,
    TACTICAL_STATES.map((s) => (s.players[index].y / 100) * PITCH_H),
  );

  const isKeeper = index === 0;

  return (
    <motion.g style={{ x: cx, y: cy }}>
      <circle
        r={isKeeper ? 13 : 16}
        fill="none"
        stroke="currentColor"
        strokeWidth={3.5}
        filter="url(#chalk-mark)"
        opacity={isKeeper ? 0.6 : 1}
      />
      {/* A dot inside outfield marks, so they read as players not holes. */}
      {!isKeeper && (
        <circle r={3.5} fill="currentColor" filter="url(#chalk-mark)" opacity={0.95} />
      )}
    </motion.g>
  );
}

/**
 * Where the ball sits, per era.
 *
 * Driven by each state's `buildUpSide` rather than placed for looks, so the
 * ball is carrying a real retrieved fact: Guardiola built centrally, Luis
 * Enrique down the right, Koeman down the left. It travels with the scrub
 * like everything else on the board.
 */
const BALL_POSITIONS: Record<TacticalState["buildUpSide"], { x: number; y: number }> = {
  central: { x: 30, y: 50 },
  right: { x: 26, y: 80 },
  left: { x: 22, y: 22 },
};

function Ball({ progress }: { progress: MotionValue<number> }) {
  const stops = TACTICAL_STATES.map((_, i) => i / (STATE_COUNT - 1));

  const cx = useTransform(
    progress,
    stops,
    TACTICAL_STATES.map((s) => (BALL_POSITIONS[s.buildUpSide].x / 100) * PITCH_W),
  );
  const cy = useTransform(
    progress,
    stops,
    TACTICAL_STATES.map((s) => (BALL_POSITIONS[s.buildUpSide].y / 100) * PITCH_H),
  );

  return (
    <motion.g style={{ x: cx, y: cy }}>
      {/* Solid, not hollow. Every player mark on the board is an outlined
          ring, so filling the ball is what separates it at a glance; a
          ringed ball just read as a twelfth player. */}
      <circle
        r={9}
        fill="currentColor"
        filter="url(#chalk-mark)"
        className="text-chalk"
      />
      {/* A slow pulse: the only thing on the board that moves when the page
          is still, so the drawing never looks frozen. */}
      <circle
        r={9}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="animate-ball-pulse text-chalk"
      />
    </motion.g>
  );
}

export function TimeTravelPitch({
  progress,
}: {
  progress: MotionValue<number>;
}) {
  // The press-height line is the only orange element on the pitch. It is
  // also the single clearest signal of the shift being argued: Guardiola's
  // trigger line sits 19 metres further upfield than Koeman's.
  const pressMetres = useMetricAcrossStates(progress, (s) => s.pressHeight);
  const pressX = useTransform(pressMetres, (m) => (m / 105) * PITCH_W);
  const pressLabel = useTransform(pressMetres, (m) => `${Math.round(m)}m`);

  const defenceX = useTransform(
    useMetricAcrossStates(progress, (s) => s.defensiveLine),
    (metres) => (metres / 105) * PITCH_W,
  );

  return (
    <svg
      viewBox={`0 0 ${PITCH_W} ${PITCH_H}`}
      className="h-full w-full"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Defensive line: white, dashed, quiet. */}
      <motion.line
        style={{ x: defenceX }}
        x1={0}
        y1={28}
        x2={0}
        y2={PITCH_H - 28}
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray="10 14"
        opacity={0.3}
      />

      {/* Back-line label, riding the dashed line.
          Set to the upper band and right-aligned so it sits on the opposite
          side of its line from the PRESS label. In 2011 the two lines are
          only four metres apart, and same-side labels overlapped. Keeping
          both out of the lower third also clears the headline, which is
          anchored to the bottom of the hero. */}
      <motion.g style={{ x: defenceX }}>
        <text
          x={-12}
          y={LABEL_INSET + 96}
          textAnchor="end"
          className="font-mono"
          fontSize={17}
          letterSpacing={2.4}
          fill="currentColor"
          opacity={0.45}
        >
          BACK LINE
        </text>
      </motion.g>

      {/* Press trigger line: the one orange element on the board.
          Deliberately unfiltered. The chalk-texture filter erodes thin
          strokes to the point of disappearing, and this line has to stay
          readable at every scrub position. */}
      <motion.g style={{ x: pressX }}>
        <line
          x1={0}
          y1={LABEL_INSET - 40}
          x2={0}
          y2={PITCH_H - LABEL_INSET + 40}
          stroke="var(--color-accent)"
          strokeWidth={4.5}
          strokeLinecap="round"
        />
        {/* Reading the value straight off the line is what makes the
            nineteen-metre drop between 2011 and 2021 legible. */}
        <text
          x={14}
          y={LABEL_INSET}
          className="font-mono"
          fontSize={19}
          letterSpacing={2.6}
          fill="var(--color-accent)"
        >
          PRESS
        </text>
        <motion.text
          x={14}
          y={LABEL_INSET + 26}
          className="font-mono tabular-nums"
          fontSize={19}
          letterSpacing={1.6}
          fill="var(--color-accent)"
          opacity={0.75}
        >
          {pressLabel}
        </motion.text>
      </motion.g>

      <g className="text-chalk">
        {TACTICAL_STATES[0].players.map((_, i) => (
          <PlayerMark key={i} index={i} progress={progress} />
        ))}
      </g>

      <Ball progress={progress} />
    </svg>
  );
}

/**
 * Derives the spring-smoothed scroll progress that drives the board.
 * Returns a ref to attach to the scroll container.
 */
export function useTimeTravelProgress() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  // Spring-smooth the raw scroll value so the marks glide rather than snap
  // when the wheel arrives in chunks.
  const progress = useSpring(scrollYProgress, {
    stiffness: 90,
    damping: 26,
    mass: 0.4,
  });

  return { ref, progress };
}
