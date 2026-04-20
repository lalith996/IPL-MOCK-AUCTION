/**
 * POST /api/auctions/[id]?action=start|pause|resume
 * Proxy to Auction Manager. Requires operator JWT.
 */

import { type NextRequest, NextResponse } from "next/server";
import { verifyOperatorToken, extractBearer } from "../../../../lib/auth.js";

const AUCTION_MANAGER_URL =
  process.env["AUCTION_MANAGER_URL"] ?? "http://localhost:3004";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = extractBearer(req.headers.get("authorization"));
  if (!token || !(await verifyOperatorToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const action = req.nextUrl.searchParams.get("action");
  if (!action || !["start", "pause", "resume"].includes(action)) {
    return NextResponse.json({ error: "action must be start|pause|resume" }, { status: 400 });
  }

  const resp = await fetch(`${AUCTION_MANAGER_URL}/auctions/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
