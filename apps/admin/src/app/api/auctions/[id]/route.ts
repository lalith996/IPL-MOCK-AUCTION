/**
 * POST /api/auctions/[id]?action=start|pause|resume
 * Proxy to Auction Manager. Requires operator JWT.
 * On 'start': enforces approval gate (missing_players & headshots approved).
 */

import { type NextRequest, NextResponse } from "next/server";
import { verifyOperatorToken, extractBearer } from "../../../../lib/auth.js";
import postgres from "postgres";

const AUCTION_MANAGER_URL =
  process.env["AUCTION_MANAGER_URL"] ?? "http://localhost:3004";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/ipl_auction";

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

  // ✅ BUG FIX #1: Enforce approval gate server-side for 'start' action
  if (action === "start") {
    const sql = postgres(DATABASE_URL);
    try {
      const approvalRows = await sql<
        Array<{ missing_players_approved: boolean; headshots_approved: boolean }>
      >`
        SELECT missing_players_approved, headshots_approved
        FROM auction_approvals
        WHERE auction_id = ${id}
      `;

      const approval = approvalRows[0];
      if (!approval || !approval.missing_players_approved || !approval.headshots_approved) {
        await sql.end();
        return NextResponse.json(
          {
            error: "Operator approvals not granted",
            detail: "Review missing_players_report.json and headshot_ingestion_report.json first",
          },
          { status: 403 },
        );
      }
      await sql.end();
    } catch (err) {
      console.error("[admin api] Approval check failed:", err);
      return NextResponse.json(
        { error: "Database error during approval check" },
        { status: 500 },
      );
    }
  }

  const resp = await fetch(`${AUCTION_MANAGER_URL}/auctions/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
