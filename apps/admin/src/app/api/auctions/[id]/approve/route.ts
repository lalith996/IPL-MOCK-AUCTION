/**
 * POST /api/auctions/[id]/approve
 * Grant operator approval for missing-players and/or headshots reports.
 *
 * Body: { missingPlayers?: boolean; headshots?: boolean }
 * Sets the corresponding flags in auction_approvals.
 * Requires operator JWT.
 */

import { type NextRequest, NextResponse } from "next/server";
import { verifyOperatorToken, extractBearer } from "../../../../../lib/auth.js";
import postgres from "postgres";

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
  const body = (await req.json()) as {
    missingPlayers?: boolean;
    headshots?: boolean;
    approvedBy?: string;
  };

  const sql = postgres(DATABASE_URL);
  try {
    const now = new Date().toISOString();
    await sql`
      INSERT INTO auction_approvals (auction_id, missing_players_approved, headshots_approved, approved_by, approved_at)
      VALUES (
        ${id},
        ${body.missingPlayers ?? false},
        ${body.headshots ?? false},
        ${body.approvedBy ?? "operator"},
        ${now}
      )
      ON CONFLICT (auction_id) DO UPDATE SET
        missing_players_approved = COALESCE(EXCLUDED.missing_players_approved, auction_approvals.missing_players_approved),
        headshots_approved       = COALESCE(EXCLUDED.headshots_approved,       auction_approvals.headshots_approved),
        approved_by              = EXCLUDED.approved_by,
        approved_at              = EXCLUDED.approved_at
    `;

    const rows = await sql<
      Array<{ missing_players_approved: boolean; headshots_approved: boolean }>
    >`
      SELECT missing_players_approved, headshots_approved
      FROM auction_approvals WHERE auction_id = ${id}
    `;

    return NextResponse.json({ ok: true, approvals: rows[0] });
  } catch (err) {
    console.error("[admin approve] DB error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  } finally {
    await sql.end();
  }
}
