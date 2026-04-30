"use client";

/**
 * Auction room error boundary — catches errors within /auction/[id] route.
 */

import { useEffect } from "react";
import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AuctionError({ error, reset }: ErrorProps) {
  useEffect(() => {
    if (process.env["NODE_ENV"] === "production") {
      console.error("[auction-error]", error.message, error.digest);
    }
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
      <p className="text-5xl">📡</p>
      <h1 className="mt-4 text-xl font-bold text-gray-900">Auction connection lost</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-500">
        {process.env["NODE_ENV"] === "production"
          ? "Could not connect to the live auction. Check your connection or try again."
          : error.message}
      </p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Reconnect
        </button>
        <Link
          href="/"
          className="rounded-lg border border-gray-200 px-5 py-2 text-sm font-semibold text-gray-700 hover:border-gray-300"
        >
          All sessions
        </Link>
      </div>
    </div>
  );
}
