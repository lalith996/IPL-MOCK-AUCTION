/**
 * JWT operator authentication helpers.
 *
 * Short-lived operator tokens are issued by /api/auth/operator.
 * Anonymous spectators have no auth — the admin app is separate from the web app.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const SECRET_RAW = process.env["JWT_SECRET"];
if (!SECRET_RAW) {
  throw new Error("CRITICAL SECURITY ERROR: JWT_SECRET environment variable is missing.");
}

const JWT_EXPIRY = "2h"; // short-lived operator session

// Encode the secret as Uint8Array once
const _secret = new TextEncoder().encode(SECRET_RAW);

export interface OperatorPayload extends JWTPayload {
  role: "operator";
  operatorId: string;
}

export async function signOperatorToken(operatorId: string): Promise<string> {
  return new SignJWT({ role: "operator", operatorId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(_secret);
}

export async function verifyOperatorToken(
  token: string,
): Promise<OperatorPayload | null> {
  try {
    const { payload } = await jwtVerify(token, _secret);
    if ((payload as OperatorPayload).role !== "operator") return null;
    return payload as OperatorPayload;
  } catch {
    return null;
  }
}

/** Extract the bearer token from an Authorization header. */
export function extractBearer(header: string | null): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}
