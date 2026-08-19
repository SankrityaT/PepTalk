import { NextResponse } from "next/server";

/**
 * One conversation, with the facts each answer cited.
 *
 * The citations are the reason this is worth opening rather than just listing.
 * They are `CITES` edges to `Fact` nodes, so a line Pep wrote last Tuesday
 * still reaches the dated fact behind it, and reaches the fact *as it was
 * then* rather than whatever has since superseded it.
 */

const API = process.env.PEPTALK_API ?? "http://127.0.0.1:8000";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Only ever a session id. Passing an arbitrary string through to the service
  // would let this route address anything shaped like its URL space.
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "not a session id" }, { status: 400 });
  }

  try {
    const res = await fetch(`${API}/api/sessions/${id}`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ turns: [] }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json(
      { error: "no graph service is reachable", turns: [] },
      { status: 503 },
    );
  }
}
