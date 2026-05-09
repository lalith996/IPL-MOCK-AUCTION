/**
 * Admin API: Auction List & Create Endpoints
 *
 * Endpoints:
 * - GET /api/auctions - List all auctions (paginated, filterable)
 * - POST /api/auctions - Create new auction session
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

interface CreateAuctionRequest {
  seed?: number;
}

interface AuctionSummary {
  id: string;
  status: string;
  seed: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface ListAuctionsQuery {
  page?: number;
  limit?: number;
  status?: string;
}

// ============================================================================
// Utilities (Shared)
// ============================================================================

function generateRequestId(): string {
  return crypto.randomBytes(12).toString('hex');
}

function verifyToken(authHeader: string | null): { operatorId: string } | null {
  if (!authHeader?.startsWith('Bearer ')) return null;

  // In production: Verify JWT signature
  const token = authHeader.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const decoded = JSON.parse(Buffer.from(parts[1] as string, 'base64').toString());
    if (decoded.exp && decoded.exp < Date.now() / 1000) return null;
    
    return { operatorId: decoded.operatorId };
  } catch {
    return null;
  }
}

function createLog(
  requestId: string,
  operatorId: string,
  action: string,
  level: 'info' | 'warn' | 'error',
  details?: Record<string, unknown>,
) {
  return {
    timestamp: new Date().toISOString(),
    requestId,
    operatorId,
    action,
    level,
    ...details,
  };
}

// ============================================================================
// Endpoint: GET /api/auctions
// ============================================================================

/**
 * List auctions with pagination and filtering
 *
 * Query Parameters:
 * - page: number (default: 1)
 * - limit: number (default: 20, max: 100)
 * - status: string (filter by phase: prep, running, paused, completed)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId();

  try {
    // Validate auth
    const authHeader = request.headers.get('authorization');
    const auth = verifyToken(authHeader);

    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401, headers: { 'X-Request-ID': requestId } },
      );
    }

    // Parse query parameters
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
    const statusFilter = url.searchParams.get('status');

    console.log(createLog(requestId, auth.operatorId, 'list_auctions', 'info', {
      page,
      limit,
      statusFilter,
    }));

    // In production: Query Postgres with proper pagination
    // SELECT * FROM auctions 
    // WHERE (status = ? OR ? IS NULL)
    // ORDER BY created_at DESC
    // LIMIT ? OFFSET ?

    // Sample auctions for demo
    const allAuctions: AuctionSummary[] = [
      {
        id: 'auction_001',
        status: 'prep',
        seed: 42,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'auction_002',
        status: 'running',
        seed: 100,
        createdAt: new Date(Date.now() - 7200000).toISOString(),
        startedAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'auction_003',
        status: 'completed',
        seed: 200,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        startedAt: new Date(Date.now() - 82800000).toISOString(),
        completedAt: new Date(Date.now() - 7200000).toISOString(),
      },
    ];

    // Filter by status if provided
    const filtered = statusFilter
      ? allAuctions.filter((a) => a.status === statusFilter)
      : allAuctions;

    // Apply pagination
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit);

    return NextResponse.json(
      {
        data: paginated,
        pagination: {
          page,
          limit,
          total: filtered.length,
          pages: Math.ceil(filtered.length / limit),
        },
      },
      { status: 200, headers: { 'X-Request-ID': requestId } },
    );
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);

    console.error(createLog(requestId, 'unknown', 'list_auctions_error', 'error', {
      error: err,
    }));

    return NextResponse.json(
      { error: 'Failed to list auctions', code: 'INTERNAL_ERROR' },
      { status: 500, headers: { 'X-Request-ID': requestId } },
    );
  }
}

// ============================================================================
// Endpoint: POST /api/auctions
// ============================================================================

/**
 * Create new auction session
 *
 * Request Body:
 * {
 *   "seed": number (optional, default: random)
 * }
 *
 * Response:
 * {
 *   "id": string (auction_id),
 *   "status": "prep",
 *   "seed": number,
 *   "createdAt": ISO string
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId();

  try {
    // Validate auth
    const authHeader = request.headers.get('authorization');
    const auth = verifyToken(authHeader);

    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401, headers: { 'X-Request-ID': requestId } },
      );
    }

    // Parse and validate request body
    let body: CreateAuctionRequest = {};
    try {
      const contentType = request.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        body = await request.json() as CreateAuctionRequest;
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body', code: 'VALIDATION_ERROR' },
        { status: 400, headers: { 'X-Request-ID': requestId } },
      );
    }

    // Validate seed parameter
    const seed = body.seed ?? Math.floor(Math.random() * 1000000);
    if (typeof seed !== 'number' || seed < 0 || !Number.isInteger(seed)) {
      return NextResponse.json(
        {
          error: 'Invalid seed parameter. Must be a non-negative integer.',
          code: 'VALIDATION_ERROR',
        },
        { status: 400, headers: { 'X-Request-ID': requestId } },
      );
    }

    // Generate auction ID
    const auctionId = `auction_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    console.log(createLog(requestId, auth.operatorId, 'create_auction', 'info', {
      auctionId,
      seed,
    }));

    // In production: Insert into Postgres
    // INSERT INTO auctions (id, seed, phase, status, created_at, created_by)
    // VALUES (?, ?, 'prep', 'prep', NOW(), ?)

    const auction: AuctionSummary = {
      id: auctionId,
      status: 'prep',
      seed,
      createdAt: new Date().toISOString(),
    };

    console.log(createLog(requestId, auth.operatorId, 'auction_created', 'info', {
      auctionId,
      seed,
    }));

    return NextResponse.json(auction, {
      status: 201,
      headers: { 'X-Request-ID': requestId },
    });
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);

    console.error(createLog(requestId, 'unknown', 'create_auction_error', 'error', {
      error: err,
    }));

    return NextResponse.json(
      { error: 'Failed to create auction', code: 'INTERNAL_ERROR' },
      { status: 500, headers: { 'X-Request-ID': requestId } },
    );
  }
}
