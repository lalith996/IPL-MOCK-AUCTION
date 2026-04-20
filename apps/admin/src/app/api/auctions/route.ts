/**
 * POST /api/auctions — create a new auction session
 * Proxies to the Auction Manager service. Requires operator JWT.
 */

import { type NextRequest, NextResponse } from "next/server";
import { verifyOperatorToken, extractBearer } from "../../../lib/auth.js";

const AUCTION_MANAGER_URL =
  process.env["AUCTION_MANAGER_URL"] ?? "http://localhost:3004";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = extractBearer(req.headers.get("authorization"));
  if (!token || !(await verifyOperatorToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const resp = await fetch(`${AUCTION_MANAGER_URL}/auctions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = extractBearer(req.headers.get("authorization"));
  if (!token || !(await verifyOperatorToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resp = await fetch(`${AUCTION_MANAGER_URL}/auctions`);
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
