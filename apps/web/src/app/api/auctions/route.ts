/**
 * POST /api/auctions  — create a new session (with optional humanTeam)
 * GET  /api/auctions  — list all sessions
 */

import { NextResponse } from "next/server";

const AUCTION_MANAGER_URL =
  process.env["AUCTION_MANAGER_URL"] ?? "http://localhost:3004";

export interface AuctionSummary {
  id: string;
  seed: number;
  humanTeam: string | null;
  status: "prep" | "active" | "paused" | "ended";
  createdAt: string;
  updatedAt: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as { seed?: number; humanTeam?: string | null } | undefined ?? {};

  try {
    const resp = await fetch(`${AUCTION_MANAGER_URL}/auctions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: text }, { status: resp.status });
    }

    const data = (await resp.json()) as AuctionSummary;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Auction Manager unavailable", detail: message },
      { status: 503 },
    );
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const resp = await fetch(`${AUCTION_MANAGER_URL}/auctions`, {
      next: { revalidate: 5 },
    });
    if (!resp.ok) {
      return NextResponse.json(
        { error: "Failed to fetch auctions", detail: resp.statusText },
        { status: resp.status },
      );
    }
    const data = (await resp.json()) as AuctionSummary[];
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Auction Manager unavailable", detail: message },
      { status: 503 },
    );
  }
}
