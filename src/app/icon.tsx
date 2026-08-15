import { ImageResponse } from "next/og";

/**
 * Favicon, generated from the compact mark.
 *
 * Drawn here rather than shipped as a .ico so it stays in step with
 * <PepTalkMark>: same geometry, same accent, one place to change. Next
 * renders this at build time and serves it as /icon.
 *
 * The compact tier is the only one that survives 32px, and the accent is
 * hard-coded rather than read from the CSS token because this renders
 * outside the document and has no stylesheet.
 */

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const ACCENT = "#ff571a";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000000",
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path
            d="M2.5 4.5h19v11h-19z"
            stroke="#ffffff"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path
            d="M6.5 15.5v4l3.5-4"
            stroke="#ffffff"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path d="M15 1.5v21" stroke={ACCENT} strokeWidth={2} />
        </svg>
      </div>
    ),
    size,
  );
}
