/**
 * The Pep Talk mark, as a three-tier responsive system.
 *
 * A mark cannot carry five ideas at 16px, so it carries them at 96px and
 * sheds them on the way down. One component, three detail levels, so the
 * page can never end up showing a different mark than the one that was
 * signed off; only a different amount of it.
 *
 * What the full mark encodes, outermost first:
 *
 *   Corner brackets  A computer-vision detection box. The same shape
 *                    HydraDB brackets its stat cards with, so it reads as
 *                    tracking to one audience and as their house style to
 *                    the other.
 *   Scan line        A single accent vertical crossing the whole mark: the
 *                    press trigger from the hero board, and the sweep line
 *                    of a tracker.
 *   Graph nodes      Two vertices on that line. The lower is the current
 *                    belief and is solid; the upper one it superseded is
 *                    hollow. The SUPERSEDED_BY chain in two circles.
 *   Lane dividers    Guardiola's juego de posición grid. The scan line sits
 *                    on the third divider, the half-space boundary the
 *                    whole positional system exists to attack.
 *   Speech bubble    The team talk. The name.
 *
 * Tiers, and what each drops:
 *
 *   full     everything. 64px and up.
 *   medium   drops the lane dividers, which are the first thing to turn
 *            into a smudge. 22 to 48px.
 *   compact  bubble and scan line only. 16 to 22px, and the favicon.
 *
 * Rejected alternatives, recorded so they don't get re-proposed:
 *   - Bubble sitting on stacked faded baselines. Read as a computer
 *     monitor on a stand once the tail met the bottom edge.
 *   - Three horizontal lines with a vertical tick, no bubble. Read as a
 *     hamburger menu with a plus sign.
 *   - Anything containing a drawn pitch with penalty boxes and a centre
 *     circle. Illegible below about 48px, clip-art above it.
 */

export type MarkDetail = "compact" | "medium" | "full";

type MarkProps = {
  className?: string;
  /** Rendered size in px. */
  size?: number;
  /**
   * How much of the mark to draw. Defaults to picking automatically from
   * `size`, which is almost always what you want.
   */
  detail?: MarkDetail;
  /**
   * Lock-on: on hover the detection brackets pull outward the way a camera
   * acquires focus, the scan line steps across and the nodes swell.
   * Requires a `group` class on an ancestor.
   */
  interactive?: boolean;
  /**
   * Assembles the mark on mount: brackets snap in, bubble draws itself,
   * scan line drops, nodes pop. For the hero, title cards and the 404,
   * where the mark gets to be an event rather than furniture.
   */
  draw?: boolean;
  /**
   * Draws the accent elements in currentColor instead.
   *
   * Required on accent-coloured surfaces, where orange on orange is
   * invisible. Also the correct choice for single-colour reproduction.
   */
  monochrome?: boolean;
  /**
   * Runs the scan sweep on a loop: the in-product "retrieving" state, where
   * the line travels the lanes the way a point-in-time query walks the
   * chain. For loading states and title cards, never the nav.
   */
  scanning?: boolean;
};

/** Where each tier stops being legible, measured in the logo lab. */
function detailForSize(size: number): MarkDetail {
  if (size >= 64) return "full";
  if (size >= 22) return "medium";
  return "compact";
}

export function PepTalkMark({
  className,
  size = 24,
  detail,
  interactive = false,
  monochrome = false,
  scanning = false,
  draw = false,
}: MarkProps) {
  const tier = detail ?? detailForSize(size);
  const accent = monochrome ? "currentColor" : "var(--color-accent)";

  // The bubble spans x 6.5 to 25.5. Guardiola's grid divides a pitch into
  // five vertical lanes, which is four dividers at even intervals. Uneven
  // spacing made them read as bars rather than a grid.
  const laneStep = 19 / 5;
  const lanes = [1, 2, 3, 4].map((n) => 6.5 + laneStep * n);
  const scanX = lanes[2];

  const scanClass = [
    "mark-line",
    scanning ? "animate-mark-scan" : "",
    // transition-[translate], not transition-transform: Tailwind v4 emits
    // the standalone `translate` property for translate utilities, so
    // transitioning `transform` left this snapping instantly.
    interactive
      ? "transition-[translate] duration-500 ease-[var(--ease-ui)] group-hover:-translate-x-[4px]"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  // State classes live on the <svg> so the CSS can target descendants and
  // stagger them, which a per-element class cannot express.
  const rootClass = [
    className ?? "",
    draw ? "mark-drawing" : "",
    scanning ? "mark-scanning" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // The compact tier is drawn on its own tighter grid: at 16px the full
  // layout's margins are wasted pixels the bubble needs.
  if (tier === "compact") {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        className={rootClass}
        aria-hidden="true"
      >
        <path
          d="M2.5 4.5h19v11h-19z"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <path
          d="M6.5 15.5v4l3.5-4"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <path d="M15 1.5v21" stroke={accent} strokeWidth={2} className={scanClass} />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={rootClass}
      aria-hidden="true"
    >
      {/* ── Detection brackets ─────────────────────────────────────── */}
      <g stroke={accent} strokeWidth={1.6} strokeLinecap="square">
        <path d="M1 6V1h5" className="mark-part mark-bracket mark-bracket-tl" />
        <path d="M26 1h5v5" className="mark-part mark-bracket mark-bracket-tr" />
        <path d="M31 26v5h-5" className="mark-part mark-bracket mark-bracket-br" />
        <path d="M6 31H1v-5" className="mark-part mark-bracket mark-bracket-bl" />
      </g>

      {/* ── Positional lanes, full tier only ───────────────────────── */}
      {/* Inset from the bubble edges and kept very light. At full height and
          heavier weight the four dividers filled the bubble and read as a
          barcode instead of a grid. */}
      {tier === "full" && (
        <g stroke="currentColor" strokeWidth={0.75} opacity={0.2}>
          {lanes.map((x) => (
            <path key={x} d={`M${x} 12v8`} />
          ))}
        </g>
      )}

      {/* ── Speech bubble ──────────────────────────────────────────── */}
      <path
        d="M6.5 9.5h19v13h-19z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        className="mark-bubble"
        pathLength={1}
        strokeDasharray={draw ? 1 : undefined}
      />
      <path
        d="M11 22.5v4.5l4-4.5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        className="mark-bubble"
        pathLength={1}
        strokeDasharray={draw ? 1 : undefined}
      />

      {/* ── Scan line and graph nodes ──────────────────────────────── */}
      <g className={scanClass}>
        <path d={`M${scanX} 0.5v31`} stroke={accent} strokeWidth={2} />
        {/* Spacing is deliberately generous: at a tighter gap the two
            circles merged into a single blob. */}
        <circle
          cx={scanX}
          cy={11}
          r={2.1}
          fill="var(--color-canvas)"
          stroke={accent}
          strokeWidth={1.6}
          className="mark-part mark-node mark-node-a"
        />
        <circle
          cx={scanX}
          cy={21}
          r={2.6}
          fill={accent}
          className="mark-part mark-node mark-node-b"
        />
      </g>
    </svg>
  );
}

/**
 * Convenience alias for the largest tier, for hero and title-card use where
 * the intent is "the whole mark" rather than a particular size.
 */
export function PepTalkMarkFull(props: MarkProps) {
  return <PepTalkMark size={96} {...props} detail="full" />;
}
