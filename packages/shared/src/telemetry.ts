
/**
 * OpenTelemetry SDK initialiser — shared across all TypeScript services.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import * as opentelemetryResources from "@opentelemetry/resources";
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
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

  const resource = new opentelemetryResources.Resource({
    [SEMRESATTRS_SERVICE_NAME]: opts.serviceName,
    [SEMRESATTRS_SERVICE_VERSION]: version,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: env,
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  });

  // Note: we disabled metric exporters and only use trace
  _sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: []
  });

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
