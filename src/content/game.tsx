//created by kinjal
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  COMPLETION_MODEL,
  MATCH,
  MOMENTS,
  MOMENTS_FOUND,
  PASSES_WITH_AN_OPTION,
  THEMES,
  type Moment,
  type Snapshot,
  type Theme,
  surname,
} from "@/content/pep";
import type { TrackedFrame } from "@/components/report/moment-clip";
import { snapshot } from "@/lib/games";

/**
 * Which game the report is showing.
 *
 * Everything used to be a module constant read from one committed snapshot,
 * which was right while there was one match and wrong the moment a coach could
 * add their own. This holds whichever game is being read, and falls back to the
 * committed one so a fresh clone still renders with no service running.
 *
 * The fallback is the whole point: the interface is a set of snapshots that
 * happen to be refreshable, not a client that breaks without a backend.
 */

/**
 * A moment, plus the footage it was cut from when there is any.
 *
 * `excerpt` marks a clip that comes from this match but not from this pass —
 * what a highlights reel can honestly offer, since it jumps and cannot be
 * aligned to a match clock.
 */
export type PlayableMoment = Moment & {
  clip?: string;
  pass_at?: number;
  excerpt?: boolean;
  /** The tracker's reading of this clip, frame by frame. */
  frames?: TrackedFrame[];
  detections?: number;
  excluded_non_team?: number;
};

export type Game = {
  /** Workspace key, or null for the built-in example. */
  key: string | null;
  label: string;
  competition: string;
  date: string;
  moments: PlayableMoment[];
  themes: Theme[];
  momentsFound: number;
  passesWithAnOption: number;
  completionModel: Snapshot["completion_model"];
  /** Whether Pep's prose came from the model or was computed from the numbers. */
  writtenBy: "model" | "numbers";
  loading: boolean;
  error: string | null;
};

/** The committed example, which is what a fresh clone shows. */
const BUILT_IN: Game = {
  key: null,
  label: MATCH.label,
  competition: MATCH.competition,
  date: MATCH.date,
  moments: MOMENTS,
  themes: THEMES,
  momentsFound: MOMENTS_FOUND,
  passesWithAnOption: PASSES_WITH_AN_OPTION,
  completionModel: COMPLETION_MODEL,
  writtenBy: "model",
  loading: false,
  error: null,
};

const Ctx = createContext<Game>(BUILT_IN);

export const useGame = () => useContext(Ctx);

type Meta = {
  label: string;
  date: string;
  competition: string;
  season: string;
  written_by: "model" | "numbers";
};

export function GameProvider({
  gameKey,
  children,
}: {
  gameKey: string | null;
  children: React.ReactNode;
}) {
  // Carries the key it was loaded for, so switching games shows "opening…"
  // rather than the previous game's moments under the new one's name. Keying
  // it this way also means the effect never has to reset it.
  const [loaded, setLoaded] = useState<Game | null>(null);

  useEffect(() => {
    if (!gameKey) return;
    let live = true;

    Promise.all([
      snapshot<Snapshot & { written_by?: "model" | "numbers" }>(gameKey, "pep"),
      snapshot<Meta>(gameKey, "meta"),
      // The footage lives here rather than in pep.json, because a moment and
      // the clip it was cut from are joined after the analysis, not during it.
      snapshot<{ moments: PlayableMoment[] }>(gameKey, "clip-moments").catch(
        () => ({ moments: [] as PlayableMoment[] }),
      ),
    ])
      .then(([pep, meta, clips]) => {
        if (!live) return;
        const footage = new Map(
          (clips.moments ?? [])
            .filter((m) => m.clip)
            .map((m) => [
              m.id,
              {
                clip: m.clip,
                pass_at: m.pass_at,
                excerpt: m.excerpt,
                frames: m.frames,
                detections: m.detections,
                excluded_non_team: m.excluded_non_team,
              },
            ]),
        );
        setLoaded({
          key: gameKey,
          label: meta.label,
          competition: [meta.competition, meta.season].filter(Boolean).join(" "),
          date: meta.date,
          moments: [...(pep.moments ?? [])]
            .map((m) => ({ ...m, ...(footage.get(m.id) ?? {}) }))
            .sort((a, b) => a.minute - b.minute),
          themes: pep.themes ?? [],
          momentsFound: pep.moments_found ?? 0,
          passesWithAnOption: pep.passes_with_an_option ?? 0,
          completionModel: pep.completion_model ?? COMPLETION_MODEL,
          writtenBy: meta.written_by ?? pep.written_by ?? "numbers",
          loading: false,
          error: null,
        });
      })
      .catch((e: Error) => {
        if (!live) return;
        // Fall back to the example rather than showing an empty report: a
        // blank page reads as broken, where the example is honest and works.
        setLoaded({ ...BUILT_IN, key: gameKey, error: e.message });
      });

    return () => {
      live = false;
    };
  }, [gameKey]);

  const game: Game =
    !gameKey
      ? BUILT_IN
      : loaded?.key === gameKey
        ? loaded
        : { ...BUILT_IN, key: gameKey, loading: true };

  return <Ctx.Provider value={game}>{children}</Ctx.Provider>;
}

/** Moments grouped by player, for whichever game is showing. */
export function byPlayerIn(
  moments: Moment[],
): { player: string; team: string; moments: Moment[] }[] {
  const map = new Map<string, { player: string; team: string; moments: Moment[] }>();
  for (const m of moments) {
    if (!map.has(m.player)) {
      map.set(m.player, { player: m.player, team: m.team, moments: [] });
    }
    map.get(m.player)!.moments.push(m);
  }
  return [...map.values()].sort(
    (a, b) =>
      b.moments.reduce((s, m) => s + m.missed, 0) -
      a.moments.reduce((s, m) => s + m.missed, 0),
  );
}

export { surname };
