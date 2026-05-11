/**
 * POST /api/auctions/[id]/human-bid
 * Proxy the human player's bid or drop to the Auction Manager.
 * No auth required — the session's humanTeam is enforced by the AM.
 */

import { type NextRequest, NextResponse } from "next/server";

const AUCTION_MANAGER_URL =
  process.env["AUCTION_MANAGER_URL"] ?? "http://localhost:3004";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = (await req.json()) as { action: "bid" | "drop"; bidLakhs?: number };

  try {
    const resp = await fetch(`${AUCTION_MANAGER_URL}/auctions/${id}/human-bid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await resp.json()) as unknown;
    return NextResponse.json(data, { status: resp.ok ? 200 : resp.status });
  } catch (err) {
    console.error("[web api] human-bid proxy failed:", err);
    return NextResponse.json({ error: "Could not reach Auction Manager" }, { status: 503 });
  }
}
