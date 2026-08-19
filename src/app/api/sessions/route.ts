import { NextResponse } from "next/server";

/**
 * The coach's conversations.
 *
 * A thin proxy to the Python service for the same reason `/api/ask` is one:
 * the threads live in HydraDB, and reimplementing the query here would mean a
 * second definition of what a conversation is.
 *
 * An unreachable backend returns an empty list rather than an error. The
 * thread picker is a convenience sitting beside a session that still works
 * without it, so a missing graph should grey out the list, not break the
 * screen. Asking a question in that state still reports the failure honestly,
 * which is where it matters.
 */

const API = process.env.PEPTALK_API ?? "http://127.0.0.1:8000";

export async function GET() {
  try {
    const res = await fetch(`${API}/api/sessions`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ sessions: [] });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ sessions: [] });
  }
}
