/**
 * Structured logging setup with OpenTelemetry integration
 * Provides consistent JSON logging across all services
 */

import pino from "pino";
import { trace } from "@opentelemetry/api";

const pinoLogger = pino({
  level: process.env["LOG_LEVEL"] || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: process.env["NODE_ENV"] !== "production",
      singleLine: false,
      translateTime: "SYS:standard",
    },
  },
});

export interface LogContext {
  auctionId?: string;
  agentId?: string;
  traceId?: string;
  userId?: string;
  service?: string;
  span?: string;
}

export function getLogger(context?: LogContext) {
  const span = trace.getActiveSpan();
  const ctx = span?.spanContext();

  const enriched = {
    service: process.env["SERVICE_NAME"] || "unknown",
    environment: process.env["NODE_ENV"] || "development",
    version: process.env["APP_VERSION"] || "0.0.0",
    timestamp: new Date().toISOString(),
    ...(ctx && {
      traceId: ctx.traceId,
      spanId: ctx.spanId,
    }),
    ...context,
  };

  return pinoLogger.child(enriched);
}

export function createRequestLogger(traceId: string, auctionId?: string) {
  return getLogger({ traceId, auctionId, service: "request-logger" } as LogContext);
}

export interface HealthCheckResult {
  status: "healthy" | "unhealthy" | "degraded";
  checks: Record<string, HealthCheck>;
  timestamp: string;
}

export interface HealthCheck {
  status: "pass" | "fail" | "warn";
  responseTime: number;
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * Health check registry for services
 */
export class HealthChecker {
  private checks: Map<string, () => Promise<HealthCheck>> = new Map();

  register(name: string, check: () => Promise<HealthCheck>): void {
    this.checks.set(name, check);
  }

  async check(): Promise<HealthCheckResult> {
    const results: Record<string, HealthCheck> = {};
    let overallStatus: "healthy" | "unhealthy" | "degraded" = "healthy";

    for (const [name, check] of this.checks.entries()) {
      try {
        results[name] = await Promise.race([
          check(),
          new Promise<HealthCheck>((_, reject) => {
            setTimeout(() => { reject(new Error("Health check timeout")); }, 5000);
          }),
        ]);

        if (results[name].status === "fail") {
          overallStatus = "unhealthy";
        } else if (results[name].status === "warn" && overallStatus !== "unhealthy") {
          overallStatus = "degraded";
        }
      } catch (err) {
        results[name] = {
          status: "fail",
          responseTime: 5000,
          error: err instanceof Error ? err.message : String(err),
        };
        overallStatus = "unhealthy";
      }
    }

    return {
      status: overallStatus,
      checks: results,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Readiness probe — used by Kubernetes to determine if service is ready for traffic
 * Checks: DB connection, Redis connection, external services
 */
export class ReadinessProbe {
  private healthy = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private dbPool: any, private redisClient: any) {}

  async check(): Promise<boolean> {
    try {
      // Test DB connection
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      const dbResult = await this.dbPool.query("SELECT 1");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (!dbResult.rows || dbResult.rows.length === 0) {
        console.error("DB readiness check failed");
        return false;
      }

      // Test Redis connection
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      await this.redisClient.ping();

      this.healthy = true;
      return true;
    } catch (err) {
      console.error("Readiness check failed:", err);
      this.healthy = false;
      return false;
    }
  }

  isReady(): boolean {
    return this.healthy;
  }
}

/**
 * Liveness probe — used by Kubernetes to restart unhealthy pods
 * Lightweight check: process is alive and event loop responsive
 */
export class LivenessProbe {
  private lastAlive = Date.now();

  constructor(private intervalMs = 1000) {
    // Periodically update to detect event loop hangs
    setInterval(() => {
      this.lastAlive = Date.now();
    }, this.intervalMs);
  }

  isAlive(): boolean {
    // Consider process dead if not updated in 3× interval
    return Date.now() - this.lastAlive < this.intervalMs * 3;
  }
}

/**
 * Metrics collection for observability
 */
export interface ServiceMetrics {
  requestsTotal: number;
  requestsSucceeded: number;
  requestsFailed: number;
  requestsDuration: number[];
  errors: Record<string, number>;
  uptime: number;
}

export class MetricsCollector {
  private startTime = Date.now();
  private requestsTotal = 0;
  private requestsSucceeded = 0;
  private requestsFailed = 0;
  private requestsDuration: number[] = [];
  private errors: Record<string, number> = {};

  recordRequest(duration: number, success: boolean, errorType?: string): void {
    this.requestsTotal += 1;
    if (success) {
      this.requestsSucceeded += 1;
    } else {
      this.requestsFailed += 1;
      if (errorType) {
        this.errors[errorType] = (this.errors[errorType] || 0) + 1;
      }
    }
    this.requestsDuration.push(duration);

    // Keep only last 1000 durations to avoid memory bloat
    if (this.requestsDuration.length > 1000) {
      this.requestsDuration = this.requestsDuration.slice(-1000);
    }
  }

  getMetrics(): ServiceMetrics {
    return {
      requestsTotal: this.requestsTotal,
      requestsSucceeded: this.requestsSucceeded,
      requestsFailed: this.requestsFailed,
      requestsDuration: this.requestsDuration,
      errors: this.errors,
      uptime: Date.now() - this.startTime,
    };
  }

  reset(): void {
    this.startTime = Date.now();
    this.requestsTotal = 0;
    this.requestsSucceeded = 0;
    this.requestsFailed = 0;
    this.requestsDuration = [];
    this.errors = {};
  }
}

// Export singleton instances
export const healthChecker = new HealthChecker();
export const metricsCollector = new MetricsCollector();
