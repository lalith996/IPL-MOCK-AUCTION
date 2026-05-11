/**
 * GET /api/auctions/[id]/human-team
 * Returns which team the human player controls in this session.
 */

import { type NextRequest, NextResponse } from "next/server";

const AUCTION_MANAGER_URL =
  process.env["AUCTION_MANAGER_URL"] ?? "http://localhost:3004";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const resp = await fetch(`${AUCTION_MANAGER_URL}/auctions/${id}/human-team`);
    const data = (await resp.json()) as unknown;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ humanTeam: null });
  }
}
