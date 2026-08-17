import { NextRequest, NextResponse } from "next/server";

/**
 * The question path.
 *
 * A thin proxy to the Python service that owns the graph. It is a proxy rather
 * than a reimplementation because retrieval has to run against HydraDB, and the
 * whole claim of this product is that the answer came out of the graph rather
 * than out of the model's memory of football.
 *
 * That has a consequence worth being straight about: a deployment with no
 * backend reachable cannot answer questions, and this returns a 503 saying so.
 * The alternative is shipping a canned reply that reads like a real one, which
 * would undermine every honest number on the rest of the page.
 */

const API = process.env.PEPTALK_API ?? "http://127.0.0.1:8000";

/** The model runs through a CLI subprocess, so ten seconds is normal. */
const TIMEOUT_MS = 90_000;

export async function POST(req: NextRequest) {
  const body = await req.json();

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: abort.signal,
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `the graph service answered ${res.status}`, detail: detail.slice(0, 400) },
        { status: 502 },
      );
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted
          ? "the graph service did not answer in time"
          : "no graph service is reachable",
        detail: `expected it at ${API}. Start it with: uv run uvicorn tacticbench.api:app --port 8000`,
      },
      { status: 503 },
    );
  } finally {
    clearTimeout(timer);
  }
}
