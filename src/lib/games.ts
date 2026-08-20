//created by kinjal
/**
 * Talking to the analysis service.
 *
 * Everything else in the interface reads committed JSON, which is why a fresh
 * clone renders without a backend. Adding a game is the one path that cannot:
 * it downloads events, fits a completion model against this match's own
 * passing, writes to the graph and cuts footage. That takes minutes, so it is
 * a job the interface polls rather than a request it waits on.
 *
 * Proxied through `/api/py/*` (see next.config.ts) so this is same-origin.
 */

const API = "/api/py";

/**
 * Where the file itself goes.
 *
 * Everything else is proxied through Next so the browser sees one origin. The
 * upload is the exception: Next buffers a proxied body in memory, and past its
 * limit it truncates the body rather than failing — a silently corrupt video
 * with no error the coach can see. A match recording is gigabytes, so it goes
 * straight to the service, which streams it to disk in chunks. CORS is already
 * open there for exactly this.
 */
const UPLOAD_API =
  process.env.NEXT_PUBLIC_PEPTALK_API ?? "http://127.0.0.1:8000/api";

export type Fixture = {
  match_id: number;
  date: string;
  home: string;
  away: string;
  label: string;
  competition: string;
  season: string;
};

export type StepStatus = "waiting" | "running" | "done" | "skip" | "fail";

export type JobStep = {
  step: string;
  status: StepStatus;
  ms?: number;
  detail?: Record<string, string | number | boolean>;
};

export type Job = {
  id: string;
  status: "queued" | "running" | "ready" | "failed";
  key: string;
  label: string;
  team: string;
  steps: JobStep[];
  done: number;
  total: number;
  error: string | null;
  result?: {
    moments_found: number;
    clips: number;
    total_ms: number;
  };
};

export type AddedGame = {
  key: string;
  team: string;
  label: string;
  date: string;
  match_id: number;
  competition: string;
  season: string;
  moments_found: number;
  clips: number;
  written_by: "model" | "numbers";
  has_footage: boolean;
  /** True for the game the interface is currently showing. */
  active?: boolean;
};

/** The service is optional; a clear message beats a stack trace. */
export class ServiceDown extends Error {
  constructor() {
    super(
      "The analysis service is not running. Start it in another terminal with " +
        "`uv run uvicorn tacticbench.api:app --port 8000`, then try again.",
    );
    this.name = "ServiceDown";
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // FastAPI puts the readable reason in `detail`, and those messages are
    // written for a coach — "Argentina did not play in this match" — so they
    // are worth surfacing rather than replacing with a status code.
    let detail = "";
    try {
      detail = (await res.json())?.detail ?? "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, init);
  } catch {
    throw new ServiceDown();
  }
  return json<T>(res);
}

/** Fixtures that have 360 data, which is what makes moments showable. */
export async function fixtures(
  q: string,
  competition = "",
): Promise<{ fixtures: Fixture[]; competitions: string[]; total: number }> {
  const params = new URLSearchParams({ q, competition, limit: "40" });
  return call(`/fixtures?${params}`);
}

export type Upload = {
  video: string;
  bytes: number;
  /** Seconds of footage, or null if it could not be read. */
  duration: number | null;
  /** Long enough to hold a match clock worth reading. */
  alignable: boolean;
  /** Short: a highlights reel or a single passage. */
  reel: boolean;
};

/** Store the footage. Returns a handle the rest of the flow refers to. */
export async function upload(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<Upload> {
  const body = new FormData();
  body.append("video", file);

  // XHR rather than fetch, only because fetch cannot report upload progress
  // and a coach watching a 4GB file needs to see it moving.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${UPLOAD_API}/games/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let detail = "";
        try {
          detail = JSON.parse(xhr.responseText)?.detail ?? "";
        } catch {
          detail = "";
        }
        reject(new Error(detail || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new ServiceDown());
    xhr.send(body);
  });
}

/** A frame to read the match clock off. Returns an object URL. */
export async function frameAt(video: string, at: string): Promise<string> {
  const body = new FormData();
  body.append("at", at);
  let res: Response;
  try {
    res = await fetch(`${UPLOAD_API}/games/${video}/frame`, {
      method: "POST",
      body,
    });
  } catch {
    throw new ServiceDown();
  }
  if (!res.ok) throw new Error(`Could not read a frame at ${at}.`);
  return URL.createObjectURL(await res.blob());
}

/**
 * Two clock readings into two offsets.
 *
 * The warning is the point. The gap between the offsets is the half time
 * break, so it is the only check available on a number nobody can derive, and
 * a wrong offset shows the wrong passage with nothing on screen to reveal it.
 */
export async function offsets(readings: {
  firstAt: string;
  firstClock: string;
  secondAt: string;
  secondClock: string;
}): Promise<{
  period_offset: { "1": number; "2": number };
  break_s: number;
  warning: string | null;
}> {
  const body = new FormData();
  body.append("first_at", readings.firstAt);
  body.append("first_clock", readings.firstClock);
  body.append("second_at", readings.secondAt);
  body.append("second_clock", readings.secondClock);
  return call("/games/offsets", { method: "POST", body });
}

/** Start the run. */
export async function start(input: {
  matchId: number;
  team: string;
  video?: string;
  firstOffset?: number;
  secondOffset?: number;
}): Promise<{ job: string; key: string; label: string; steps: string[] }> {
  const body = new FormData();
  body.append("match_id", String(input.matchId));
  body.append("team", input.team);
  if (input.video) body.append("video", input.video);
  body.append("first_offset", String(input.firstOffset ?? 0));
  body.append("second_offset", String(input.secondOffset ?? 0));
  return call("/games", { method: "POST", body });
}

export async function job(id: string): Promise<Job> {
  return call(`/games/${id}`);
}

export async function added(): Promise<{ games: AddedGame[]; active: string }> {
  return call("/games");
}

/**
 * Point the interface at a different game.
 *
 * The caller reloads afterwards: imports are static, so the app reads one
 * directory and the server copies the chosen workspace into it.
 */
export async function activate(
  key: string,
): Promise<{ active: string; files: number }> {
  return call(`/games/${key}/activate`, { method: "POST" });
}

/** A finished game's snapshot, by name (`pep`, `clip-moments`, `dashboard`). */
export async function snapshot<T>(key: string, name: string): Promise<T> {
  return call(`/games/${key}/snapshot/${name}`);
}
