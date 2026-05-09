/**
 * Admin API: Authentication Endpoint
 *
 * Provides JWT token generation for operator access
 *
 * In production:
 * - Use bcrypt for password hashing
 * - Store credentials in Vault/KMS
 * - Implement OAuth 2.0 with OIDC
 * - Add MFA (TOTP)
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

interface LoginRequest {
  operatorId: string;
  password: string;
}

interface AuthResponse {
  token: string;
  expiresIn: number;
}

// ============================================================================
// Configuration
// ============================================================================

// In production: Load from environment
const _envSecret = process.env.JWT_SECRET;
if (!_envSecret && process.env.NODE_ENV === "production") {
  throw new Error("CRITICAL: JWT_SECRET must be set in production");
}
const JWT_SECRET = _envSecret || 'dev-secret-key';
const TOKEN_EXPIRY_MINUTES = 480; // 8 hours

// In production: Use a proper credential store
const VALID_OPERATORS: Record<string, string> = {
  'operator-1': 'password123', // Hashed in production
  'operator-2': 'password456',
};

// ============================================================================
// Utilities
// ============================================================================

function generateRequestId(): string {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * Generate JWT token (simplified)
 *
 * In production: Use jose library
 * import * as jose from 'jose';
 * const jwt = await new SignJWT({ operatorId })
 *   .setProtectedHeader({ alg: 'HS256' })
 *   .setIssuedAt()
 *   .setExpirationTime('8h')
 *   .sign(secret);
 */
function generateToken(operatorId: string, expiryMinutes: number): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiryMinutes * 60;

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64').replace(/=/g, '');
  const payload = Buffer.from(JSON.stringify({
    operatorId,
    iat: now,
    exp,
  })).toString('base64').replace(/=/g, '');

  // In production: Properly sign with HMAC
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/=/g, '');

  return `${header}.${payload}.${signature}`;
}

/**
 * Constant-time password comparison (timing attack resistant)
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

// ============================================================================
// Endpoint: POST /api/auth/operator
// ============================================================================

/**
 * Authenticate operator and return JWT
 *
 * Request Body:
 * {
 *   "operatorId": string,
 *   "password": string
 * }
 *
 * Response (200):
 * {
 *   "token": "eyJh...",
 *   "expiresIn": 28800 (seconds)
 * }
 *
 * Error Responses:
 * - 400: Missing/invalid fields
 * - 401: Invalid credentials
 * - 429: Too many failed attempts
 * - 500: Server error
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId();
  const clientIp = request.headers.get('x-forwarded-for') || request.ip || 'unknown';

  try {
    // Validate request content type
    const contentType = request.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json', code: 'VALIDATION_ERROR' },
        { status: 400, headers: { 'X-Request-ID': requestId } },
      );
    }

    // Parse request body
    let body: LoginRequest;
    try {
      body = await request.json() as LoginRequest;
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body', code: 'VALIDATION_ERROR' },
        { status: 400, headers: { 'X-Request-ID': requestId } },
      );
    }

    // Validate required fields
    if (typeof body.operatorId !== 'string' || !body.operatorId.trim()) {
      return NextResponse.json(
        { error: 'operatorId is required', code: 'VALIDATION_ERROR' },
        { status: 400, headers: { 'X-Request-ID': requestId } },
      );
    }

    if (typeof body.password !== 'string' || !body.password) {
      return NextResponse.json(
        { error: 'password is required', code: 'VALIDATION_ERROR' },
        { status: 400, headers: { 'X-Request-ID': requestId } },
      );
    }

    const operatorId = body.operatorId.trim();

    console.log({
      timestamp: new Date().toISOString(),
      requestId,
      action: 'login_attempt',
      operatorId,
      clientIp,
    });

    // In production: Check rate limit (brute force protection)
    // Use Redis with pattern: auth:attempt:{clientIp}:{operatorId}
    // Increment and check if > 5 in last 15 minutes
    // Return 429 with Retry-After header

    // Look up operator
    const storedPassword = VALID_OPERATORS[operatorId];
    if (!storedPassword) {
      console.log({
        timestamp: new Date().toISOString(),
        requestId,
        action: 'login_failed',
        reason: 'unknown_operator',
        operatorId,
        clientIp,
      });

      return NextResponse.json(
        { error: 'Invalid operator ID or password', code: 'UNAUTHORIZED' },
        { status: 401, headers: { 'X-Request-ID': requestId } },
      );
    }

    // Verify password (timing-safe comparison)
    const passwordMatch = safeCompare(body.password, storedPassword);
    if (!passwordMatch) {
      console.log({
        timestamp: new Date().toISOString(),
        requestId,
        action: 'login_failed',
        reason: 'invalid_password',
        operatorId,
        clientIp,
      });

      return NextResponse.json(
        { error: 'Invalid operator ID or password', code: 'UNAUTHORIZED' },
        { status: 401, headers: { 'X-Request-ID': requestId } },
      );
    }

    // Generate token
    const token = generateToken(operatorId, TOKEN_EXPIRY_MINUTES);
    const expiresIn = TOKEN_EXPIRY_MINUTES * 60; // Convert to seconds

    console.log({
      timestamp: new Date().toISOString(),
      requestId,
      action: 'login_success',
      operatorId,
      clientIp,
      tokenExpiry: TOKEN_EXPIRY_MINUTES,
    });

    return NextResponse.json(
      {
        token,
        expiresIn,
      },
      {
        status: 200,
        headers: {
          'X-Request-ID': requestId,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      },
    );
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);

    console.error({
      timestamp: new Date().toISOString(),
      requestId,
      action: 'login_error',
      error: err,
      clientIp,
    });

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      {
        status: 500,
        headers: {
          'X-Request-ID': requestId,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      },
    );
  }
}
