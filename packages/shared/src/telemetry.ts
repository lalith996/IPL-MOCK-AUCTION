
/**
 * OpenTelemetry SDK initialiser — shared across all TypeScript services.
 *
 * Usage (call BEFORE importing anything else in main.ts):
 *
 *   import { initTelemetry } from "@ipl/shared/telemetry.js";
 *   initTelemetry({ serviceName: "auction-manager" });
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  (default: http://localhost:4318)
 *   OTEL_SERVICE_VERSION         (default: "dev")
 *   NODE_ENV
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { trace, metrics, context, propagation } from "@opentelemetry/api";
import {
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
  CompositePropagator,
} from "@opentelemetry/core";

let _sdk: NodeSDK | null = null;

interface TelemetryOptions {
  serviceName: string;
  serviceVersion?: string;
}

export function initTelemetry(opts: TelemetryOptions): void {
  if (_sdk) return; // idempotent

  const endpoint =
    process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://localhost:4318";
  const version = opts.serviceVersion ?? process.env["OTEL_SERVICE_VERSION"] ?? "dev";
  const env = process.env["NODE_ENV"] ?? "development";

  const resource: InstanceType<typeof Resource> = new Resource({
    [SEMRESATTRS_SERVICE_NAME]: opts.serviceName,
    [SEMRESATTRS_SERVICE_VERSION]: version,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: env,
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${endpoint}/v1/metrics`,
  });

  _sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 15_000,
      }),
    ],
  });

  // W3C trace context + baggage for cross-service propagation
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );

  _sdk.start();

  process.on("SIGTERM", () => {
    void _sdk?.shutdown();
  });
}

// ---------------------------------------------------------------------------
// Convenience helpers — add standard attributes to spans
// ---------------------------------------------------------------------------

export function withAuctionContext<T>(
  auctionId: string,
  fn: () => T,
): T {
  const baggage = propagation.createBaggage({
    "auction.id": { value: auctionId },
  });
  const ctx = propagation.setBaggage(context.active(), baggage);
  return context.with(ctx, fn);
}

export function getTracer(name: string) {
  return trace.getTracer(name);
}

export function getMeter(name: string) {
  return metrics.getMeter(name);
}
