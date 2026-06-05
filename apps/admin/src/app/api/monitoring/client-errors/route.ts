import { NextRequest, NextResponse } from "next/server";

interface ClientErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;
  source: string;
  url: string;
  userAgent: string;
  timestamp: string;
  errorId: string;
}

function isClientErrorReport(value: unknown): value is ClientErrorReport {
  if (typeof value !== "object" || value === null) return false;

  const record = value as Record<string, unknown>;
  return (
    typeof record["message"] === "string" &&
    typeof record["source"] === "string" &&
    typeof record["url"] === "string" &&
    typeof record["userAgent"] === "string" &&
    typeof record["timestamp"] === "string" &&
    typeof record["errorId"] === "string"
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = (await request.json()) as unknown;

    if (!isClientErrorReport(payload)) {
      return NextResponse.json(
        { error: "Invalid client error payload", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }

    console.error("[admin-monitoring] client error report", {
      errorId: payload.errorId,
      source: payload.source,
      message: payload.message,
      url: payload.url,
      userAgent: payload.userAgent,
      timestamp: payload.timestamp,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[admin-monitoring] failed to ingest client error", error);

    return NextResponse.json(
      { error: "Failed to ingest client error", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
