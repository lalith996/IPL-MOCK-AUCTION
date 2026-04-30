"use client";

/**
 * Root error boundary — shown when an unhandled error bubbles to the app root.
 * Next.js App Router requires this to be a Client Component.
 */

import { useEffect } from "react";
import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to server-side error tracking in production
    if (process.env["NODE_ENV"] === "production") {
      console.error("[global-error]", error.message, error.digest);
    }
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
      <p className="text-6xl">⚠️</p>
      <h1 className="mt-4 text-2xl font-bold text-gray-900">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-gray-500">
        {process.env["NODE_ENV"] === "production"
          ? "An unexpected error occurred. Refresh or return to sessions."
          : error.message}
      </p>
      {error.digest && (
        <p className="mt-1 font-mono text-xs text-gray-400">ID: {error.digest}</p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:border-gray-300 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
        >
          Back to sessions
        </Link>
      </div>
    </div>
  );
}
