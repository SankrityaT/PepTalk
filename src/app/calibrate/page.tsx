"use client";

import { useEffect, useRef, useState } from "react";
import clips from "@/content/snapshots/active/player-clips.json";
import moments from "@/content/snapshots/active/clip-moments.json";

/**
 * Calibrate a camera by clicking four landmarks.
 *
 * Four automatic attempts are recorded in the backend, and each failed in the
 * same place: nothing in a frame says which end of a symmetric pitch is in
 * view. A person can see the goal, so they do not have that problem, and this
 * takes about thirty seconds per angle.
 *
 * It is a real feature rather than a workaround. A coach calibrates their
 * camera once; a fixed camera at a training ground is then calibrated for
 * every game they ever upload.
 *
 * Nothing is trusted on the strength of the clicks. The fit is scored by how
 * much of the drawn pitch lands on painted line, and a misclick comes back as
 * a low number and a visibly crooked overlay rather than as a projection that
 * is quietly wrong.
 */

type Landmark = { key: string; label: string; hint: string; pitch: number[] };
type Result = { paint: number; coverage: number; flipped: boolean; good: boolean; check: string };

type Shot = { key: string; surname?: string; match_clock?: string };

const SHOTS: Shot[] = [
  ...(clips as unknown as { clips: Shot[] }).clips,
  ...(moments as unknown as { moments: Shot[] }).moments,
];

export default function Calibrate() {
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [done, setDone] = useState<Record<string, { paint: number }>>({});
  const [bar, setBar] = useState(0.45);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<Record<string, [number, number]>>({});
  const [active, setActive] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  const shot = SHOTS[at];

  useEffect(() => {
    fetch("/api/calibrate/landmarks")
      .then((r) => r.json())
      .then((d) => {
        setLandmarks(d.landmarks);
        setDone(d.done ?? {});
        setBar(d.good_enough ?? 0.45);
        setActive(d.landmarks[0]?.key ?? null);
      })
      .catch(() => {});
  }, []);

  // A click lands on a scaled <img>, so it has to be mapped back to the
  // frame's own pixels. Getting this wrong is invisible: every point is
  // consistently off and the fit merely comes back a little worse.
  const place = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!active || !img.current) return;
    const box = img.current.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * img.current.naturalWidth;
    const y = ((e.clientY - box.top) / box.height) * img.current.naturalHeight;
    const next = { ...picked, [active]: [x, y] as [number, number] };
    setPicked(next);
    const remaining = landmarks.filter((l) => !next[l.key]);
    setActive(remaining[0]?.key ?? null);
  };

  const solve = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/calibrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clip: shot.key, points: picked }),
      });
      const body = await r.json();
      setResult(body);
      if (body.good) setDone((d) => ({ ...d, [shot.key]: { paint: body.paint } }));
    } finally {
      setBusy(false);
    }
  };

  const move = (by: number) => {
    setAt((i) => Math.max(0, Math.min(SHOTS.length - 1, i + by)));
    setPicked({});
    setResult(null);
    setActive(landmarks[0]?.key ?? null);
  };

  const enough = Object.keys(picked).length >= 4;

  return (
    <main className="min-h-screen bg-canvas px-6 py-6 text-chalk">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-medium">Calibrate the camera</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
              Click four of these on the picture. You can see the goal, which is
              the thing the automatic fit cannot work out. Thirty seconds an
              angle, and it is then right for every arrow drawn on this camera.
            </p>
          </div>
          <span className="font-mono text-[11px] text-muted-2">
            {Object.keys(done).length}/{SHOTS.length} done
          </span>
        </header>

        <div className="flex items-center gap-2">
          <button onClick={() => move(-1)} className="rounded-lg bg-white/[0.06] px-3 py-1.5 font-mono text-[11px] hover:bg-white/[0.12]">prev</button>
          <span className="font-mono text-[12px] text-warm">
            {shot?.surname ?? shot?.key} {shot?.match_clock ? `· ${shot.match_clock}` : ""}
          </span>
          {done[shot?.key] && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] text-accent">
              calibrated · {Math.round(done[shot.key].paint * 100)}%
            </span>
          )}
          <button onClick={() => move(1)} className="ml-auto rounded-lg bg-white/[0.06] px-3 py-1.5 font-mono text-[11px] hover:bg-white/[0.12]">next</button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={img}
              src={result?.check ? `${result.check}?t=${Date.now()}` : `/calib/${shot?.key}.jpg`}
              alt=""
              onClick={place}
              className="w-full cursor-crosshair rounded-xl ring-1 ring-white/10"
            />
            {Object.entries(picked).map(([k, [x, y]]) => {
              const nat = img.current;
              if (!nat?.naturalWidth) return null;
              return (
                <span
                  key={k}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent px-1.5 font-mono text-[9px] text-canvas ring-2 ring-canvas"
                  style={{ left: `${(x / nat.naturalWidth) * 100}%`, top: `${(y / nat.naturalHeight) * 100}%` }}
                >
                  {k.replace(/_/g, " ").slice(0, 10)}
                </span>
              );
            })}
          </div>

          <div className="flex flex-col gap-2">
            {landmarks.map((l) => (
              <button
                key={l.key}
                onClick={() => setActive(l.key)}
                className={`rounded-lg px-3 py-2 text-left ring-1 transition-colors ${
                  active === l.key
                    ? "bg-accent/15 ring-accent/40"
                    : picked[l.key]
                      ? "bg-white/[0.05] ring-white/[0.12]"
                      : "bg-surface ring-white/[0.06] hover:bg-surface-2"
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] text-chalk">{l.label}</span>
                  {picked[l.key] && <span className="font-mono text-[10px] text-accent">set</span>}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted">{l.hint}</span>
              </button>
            ))}

            <button
              onClick={solve}
              disabled={!enough || busy}
              className="mt-1 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-canvas disabled:bg-white/[0.07] disabled:text-muted-2"
            >
              {busy ? "checking against the lines…" : `check the fit (${Object.keys(picked).length}/4)`}
            </button>
            <button
              onClick={() => { setPicked({}); setResult(null); setActive(landmarks[0]?.key ?? null); }}
              className="rounded-lg bg-white/[0.06] px-3 py-1.5 font-mono text-[11px] text-muted hover:text-chalk"
            >
              clear
            </button>

            {result && (
              <div className={`rounded-lg px-3 py-2.5 ring-1 ${result.good ? "bg-accent/10 ring-accent/30" : "bg-white/[0.04] ring-white/10"}`}>
                <p className="font-mono text-[12px] text-chalk">
                  {Math.round(result.paint * 100)}% of the pitch lines land on paint
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  {result.good
                    ? "Saved. The overlay is drawn on the picture; if it sits on the real lines, it is right."
                    : `Below the ${Math.round(bar * 100)}% bar, so not saved. Look at the overlay: if it is crooked, one of the points is on the wrong spot.`}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
