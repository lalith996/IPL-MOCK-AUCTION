/**
 * Web Vitals reporter — sends CLS, FID, FCP, LCP, TTFB, INP to the
 * OTEL-collector or a custom `/api/vitals` endpoint.
 *
 * Called from layout.tsx via a "use client" wrapper.
 * Only runs in the browser (Next.js RSC safe — imported lazily).
 */

import type { Metric } from "web-vitals";

const REPORT_ENDPOINT = "/api/vitals";

/** Report a single metric to the analytics endpoint (fire-and-forget). */
function reportMetric(metric: Metric): void {
  // In production, send to /api/vitals (see below).
  // In development, log to console.
  if (process.env["NODE_ENV"] !== "production") {
    console.debug(`[vitals] ${metric.name}:`, metric.value.toFixed(2), `(${metric.rating})`);
    return;
  }

  // Use `sendBeacon` when available for non-blocking delivery on page unload.
  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    navigationType: metric.navigationType,
    url: window.location.href,
    timestamp: Date.now(),
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon(REPORT_ENDPOINT, body);
  } else {
    // Fallback: fetch with keepalive
    void fetch(REPORT_ENDPOINT, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {
      // Swallow — vitals reporting must never break the app
    });
  }
}

/** Register all Web Vitals. Called once from a client component in layout. */
export async function registerVitals(): Promise<void> {
  if (typeof window === "undefined") return;

  // Lazy import to avoid bundling web-vitals into the server chunk
  const { onCLS, onFCP, onFID, onLCP, onTTFB, onINP } = await import("web-vitals");

  onCLS(reportMetric);
  onFCP(reportMetric);
  onFID(reportMetric);
  onLCP(reportMetric);
  onTTFB(reportMetric);
  onINP(reportMetric);
}
