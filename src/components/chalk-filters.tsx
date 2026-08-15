/**
 * SVG filter definitions shared by every chalk drawing on the page.
 *
 * Rendered once, hidden, near the top of the document. Components reference
 * these by id (`filter="url(#chalk-texture)"`).
 *
 * The effect is two-part:
 *   1. fractalNoise + displacement pushes the path off its true geometry by a
 *      pixel or two, so straight lines wobble the way a hand-drawn line does.
 *   2. A second, coarser noise layer punches holes in the stroke via a
 *      composite, mimicking the way chalk skips over the tooth of a board.
 */
export function ChalkFilters() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="absolute h-0 w-0 overflow-hidden"
    >
      <defs>
        <filter id="chalk-texture" x="-20%" y="-20%" width="140%" height="140%">
          {/* Hand wobble. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.045"
            numOctaves="3"
            seed="7"
            result="wobble"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="wobble"
            scale="2.6"
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />

          {/* Chalk skip: coarse noise used as a stencil that eats into the
              stroke, so coverage is uneven along its length. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed="3"
            result="grain"
          />
          <feColorMatrix
            in="grain"
            type="matrix"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 -1.4 1.05"
            result="stencil"
          />
          <feComposite
            in="displaced"
            in2="stencil"
            operator="in"
            result="chalked"
          />

          {/* Dust bloom, a soft copy underneath catches the light the way
              loose chalk powder does. */}
          <feGaussianBlur in="chalked" stdDeviation="0.7" result="dust" />
          <feMerge>
            <feMergeNode in="dust" />
            <feMergeNode in="chalked" />
          </feMerge>
        </filter>

        {/* Cheaper variant for the small player marks, which are too small to
            show displacement and only need the skip. */}
        <filter id="chalk-mark" x="-50%" y="-50%" width="200%" height="200%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="1.1"
            numOctaves="2"
            seed="11"
            result="grain"
          />
          <feColorMatrix
            in="grain"
            type="matrix"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 -1.2 1.02"
            result="stencil"
          />
          <feComposite in="SourceGraphic" in2="stencil" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}
