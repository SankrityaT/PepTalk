import { NextResponse } from "next/server";

/**
 * Is the graph there?
 *
 * The composer says whether questions can be answered, and it has to know
 * before anyone types one. Cheap enough to call on mount and honest either way.
 */
const API = process.env.PEPTALK_API ?? "http://127.0.0.1:8000";

export async function GET() {
  try {
    const res = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return NextResponse.json({ ok: false }, { status: 200 });
    const body = await res.json();
    return NextResponse.json({ ok: true, facts: body.facts });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
