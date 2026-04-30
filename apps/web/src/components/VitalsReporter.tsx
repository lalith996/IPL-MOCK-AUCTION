/**
 * VitalsReporter — thin client component that registers Web Vitals once.
 *
 * Renders nothing. Placed in the root layout so it covers every page.
 * Uses useEffect to avoid running during SSR.
 */

"use client";

import { useEffect } from "react";

export function VitalsReporter(): null {
  useEffect(() => {
    import("../lib/vitals.js")
      .then(({ registerVitals }) => registerVitals())
      .catch(() => {
        // Non-fatal — never let analytics break the app
      });
  }, []);

  return null;
}
