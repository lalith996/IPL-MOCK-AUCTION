/**
 * Web BFF — proxy auction session list to the Auction Manager.
 *
 * The browser cannot call AUCTION_MANAGER_URL directly (CORS, server-side env
 * vars).  This thin Next.js Route Handler proxies GET /api/auctions →
 * GET http://localhost:3004/auctions so the home page can list active sessions.
 */

import { NextResponse } from "next/server";

const AUCTION_MANAGER_URL =
  process.env["AUCTION_MANAGER_URL"] ?? "http://localhost:3004";

export interface AuctionSummary {
  id: string;
  seed: number;
  status: "prep" | "active" | "paused" | "ended";
  createdAt: string;
  updatedAt: string;
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
