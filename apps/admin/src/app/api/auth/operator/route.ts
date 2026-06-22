/**
 * POST /api/auth/operator
 * Issues a short-lived JWT for an operator.
 *
 * Body: { operatorId: string; password: string }
 * Returns: { token: string }
 *
 * For MVP: password is compared against OPERATOR_PASSWORD env var.
 * In production: replace with proper identity provider.
 */

import { type NextRequest, NextResponse } from "next/server";
import { signOperatorToken } from "../../../../lib/auth.js";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const OPERATOR_PASSWORD = process.env["OPERATOR_PASSWORD"];

  if (!OPERATOR_PASSWORD) {
    console.error("CRITICAL SECURITY ERROR: OPERATOR_PASSWORD environment variable is missing.");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }

  const body = (await req.json()) as { operatorId?: string; password?: string };

  if (!body.operatorId || !body.password) {
    return NextResponse.json({ error: "operatorId and password required" }, { status: 400 });
  }

  if (body.password !== OPERATOR_PASSWORD) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await signOperatorToken(body.operatorId);
  return NextResponse.json({ token });
}
