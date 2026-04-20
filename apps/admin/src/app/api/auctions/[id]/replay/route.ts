/**
 * GET /api/auctions/[id]/replay
 * Streams the full event log as NDJSON for the replay viewer.
 * Requires operator JWT.
 */

import { type NextRequest, NextResponse } from "next/server";
import { verifyOperatorToken, extractBearer } from "../../../../../lib/auth.js";

const AUCTION_MANAGER_URL =
  process.env["AUCTION_MANAGER_URL"] ?? "http://localhost:3004";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = extractBearer(req.headers.get("authorization"));
  if (!token || !(await verifyOperatorToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const resp = await fetch(`${AUCTION_MANAGER_URL}/auctions/${id}/replay`);

  if (!resp.ok || !resp.body) {
    return NextResponse.json({ error: "Replay not available" }, { status: resp.status });
  }

  // Stream NDJSON from Auction Manager to client
  return new NextResponse(resp.body, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
