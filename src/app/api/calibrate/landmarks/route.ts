import { NextResponse } from "next/server";

const API = process.env.PEPTALK_API ?? "http://127.0.0.1:8000";

export async function GET() {
  try {
    const res = await fetch(`${API}/api/calibrate/landmarks`, {
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ landmarks: [], done: {} }, { status: 200 });
  }
}
