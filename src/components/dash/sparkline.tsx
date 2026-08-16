"use client";

/**
 * A trend, small enough to sit inside a number.
 *
 * Deliberately unlabelled and unaxed. Its job is not to be read precisely —
 * the figure beside it does that — but to answer "is this going up or down"
 * in peripheral vision, which is the only question a coach asks of a season.
 */

type Props = {
  values: number[];
  /** Drawn in accent when the last point is the notable one. */
  live?: boolean;
  className?: string;
};

const W = 100;
const H = 28;
const PAD = 2;

export function Sparkline({ values, live = false, className = "" }: Props) {
  if (values.length < 2) return null;

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;

  const pt = (v: number, i: number): [number, number] => [
    (i / (values.length - 1)) * W,
    H - PAD - ((v - lo) / span) * (H - PAD * 2),
  ];

  const pts = values.map(pt);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  const [lx, ly] = pts[pts.length - 1];
  const stroke = live ? "var(--color-accent)" : "rgba(216,210,204,0.55)";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`h-7 w-full ${className}`}
      aria-hidden
    >
      <defs>
        <linearGradient id={`sparkfill-${live}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sparkfill-${live})`} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lx} cy={ly} r={1.8} fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
