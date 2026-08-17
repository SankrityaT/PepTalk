import { NextRequest, NextResponse } from "next/server";

/** Proxy to the service that owns OpenCV and the paint mask. */
const API = process.env.PEPTALK_API ?? "http://127.0.0.1:8000";

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const res = await fetch(`${API}/api/calibrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "no graph service", detail: `expected it at ${API}` },
      { status: 503 },
    );
  }
}
