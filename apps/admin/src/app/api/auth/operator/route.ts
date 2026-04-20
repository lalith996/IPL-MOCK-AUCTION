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

const OPERATOR_PASSWORD = process.env["OPERATOR_PASSWORD"] ?? "dev-password";

export async function POST(req: NextRequest): Promise<NextResponse> {
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
