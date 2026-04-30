/**
 * POST /api/vitals — receive Web Vitals from the browser and forward to
 * the OTEL collector as a structured log.
 *
 * In production this runs server-side; in dev the vitals are logged to
 * the browser console by the reporter (no server POST made).
 */

import { type NextRequest, NextResponse } from "next/server";

interface VitalPayload {
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  id: string;
  navigationType?: string;
  url?: string;
  timestamp?: number;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const payload = (await req.json()) as VitalPayload;

    // Structured log picked up by Loki via stdout
    console.log(
      JSON.stringify({
        level: "info",
        service: "web-vitals",
        metric: payload.name,
        value: payload.value,
        rating: payload.rating,
        url: payload.url,
        timestamp: payload.timestamp ?? Date.now(),
      }),
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
}
