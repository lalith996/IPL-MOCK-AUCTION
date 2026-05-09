"use client";

/**
 * Home page — Auction Session Picker.
 *
 * Polls /api/auctions every 10 s and displays all sessions.
 * Active / paused sessions show a "Watch Live" link to /auction/[id].
 * Operators create sessions via the Admin Console at :3001.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AuctionSummary } from "./api/auctions/route";

const STATUS_BADGE: Record<
  AuctionSummary["status"],
  { label: string; className: string }
> = {
  prep:   { label: "Starting soon",  className: "bg-yellow-100 text-yellow-800" },
  active: { label: "Live",           className: "bg-green-100  text-green-800" },
  paused: { label: "Paused",         className: "bg-orange-100 text-orange-800" },
  ended:  { label: "Ended",          className: "bg-gray-100   text-gray-500" },
};

function StatusBadge({ status }: { status: AuctionSummary["status"] }) {
  const { label, className } = STATUS_BADGE[status] ?? STATUS_BADGE.ended;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

function SessionCard({ session }: { session: AuctionSummary }) {
  const isWatchable = session.status === "active" || session.status === "paused";
  const created = new Date(session.createdAt).toLocaleString();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-sm text-gray-400">#{session.id.slice(0, 8)}</p>
          <p className="mt-1 truncate text-sm text-gray-500">
            Seed:{" "}
            <span className="font-medium text-gray-700">{session.seed}</span>
          </p>
          <p className="mt-0.5 text-xs text-gray-400">{created}</p>
        </div>
        <StatusBadge status={session.status} />
      </div>

      <div className="mt-4 flex gap-2">
        {isWatchable ? (
          <Link
            href={`/auction/${session.id}`}
            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            ▶&nbsp;Watch Live
          </Link>
        ) : session.status === "prep" ? (
          <span className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-400">
            Starting soon…
          </span>
        ) : (
          <Link
            href={`/auction/${session.id}`}
            className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-700"
          >
            View Replay
          </Link>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [sessions, setSessions] = useState<AuctionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const resp = await fetch("/api/auctions");
        if (!resp.ok) {
          setError("Auction Manager is unavailable. Run `make dev` to start services.");
          return;
        }
        const data = (await resp.json()) as AuctionSummary[];
        setSessions(data);
        setError(null);
      } catch {
        setError("Could not connect to the Auction Manager.");
      } finally {
        setLoading(false);
      }
    }

    void fetchSessions();
    const t = setInterval(() => { void fetchSessions(); }, 10_000);
    return () => clearInterval(t);
  }, []);

  const live = sessions.filter(
    (s) => s.status === "active" || s.status === "paused",
  );
  const other = sessions.filter(
    (s) => s.status !== "active" && s.status !== "paused",
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              🏏 IPL 2026 Auction
            </h1>
            <p className="text-sm text-gray-500">Multi-agent live auction viewer</p>
          </div>
          <a
            href="http://localhost:3001"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:border-gray-300 hover:text-gray-900"
          >
            Admin Console ↗
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {/* Loading skeleton */}
        {loading && (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <svg
              className="mr-3 h-5 w-5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            Connecting to Auction Manager…
          </div>
        )}

        {/* Error banner */}
        {error !== null && !loading && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            <p className="font-semibold">Connection error</p>
            <p className="mt-1">{error}</p>
          </div>
        )}

        {/* Session lists */}
        {!loading && error === null && (
          <>
            {live.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-3 text-lg font-semibold text-gray-900">
                  Live Now
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {live.map((s) => (
                    <SessionCard key={s.id} session={s} />
                  ))}
                </div>
              </section>
            )}

            {other.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-3 text-lg font-semibold text-gray-700">
                  {live.length > 0 ? "Other Sessions" : "Sessions"}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {other.map((s) => (
                    <SessionCard key={s.id} session={s} />
                  ))}
                </div>
              </section>
            )}

            {sessions.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
                <p className="text-4xl">🏟️</p>
                <p className="mt-4 text-lg font-semibold text-gray-700">
                  No active auctions
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  Create a session from the{" "}
                  <a
                    href="http://localhost:3001"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    Admin Console
                  </a>
                  , then start it to go live.
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
