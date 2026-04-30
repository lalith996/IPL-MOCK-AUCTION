/**
 * Auction Room page — real-time spectator view.
 *
 * Route: /auction/[id]
 * Layout: layout.tsx injects per-session metadata (server component).
 */

"use client";
import React from "react";

import { use } from "react";
import Link from "next/link";
import { useAuctionSocket } from "../../../hooks/useAuctionSocket.js";
import { useAuctionStore } from "../../../store/auctionStore.js";
import { PlayerCard } from "../../../components/PlayerCard.js";
import { BidTicker } from "../../../components/BidTicker.js";
import { RationalePanel } from "../../../components/RationalePanel.js";
import { RosterPanel } from "../../../components/RosterPanel.js";
import { PhaseIndicator } from "../../../components/PhaseIndicator.js";

interface Props {
  params: Promise<{ id: string }>;
}

const AGENT_IDS = [
  "MI", "CSK", "RCB", "DC", "KKR",
  "RR", "PBKS", "SRH", "LSG", "GT",
] as const;

// ---------------------------------------------------------------------------
// Connection state toast
// ---------------------------------------------------------------------------

function ConnectionToast() {
  const state = useAuctionStore((s) => s.connectionState);

  if (state === "connected") return null;

  const labels: Record<"disconnected" | "connecting" | "reconnecting", string> = {
    disconnected: "Disconnected — reconnecting…",
    connecting:   "Connecting to live feed…",
    reconnecting: "Reconnecting…",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
    >
      <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
      {labels[state as "disconnected" | "connecting" | "reconnecting"]}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AuctionRoomPage({ params }: Props): React.JSX.Element {
  const { id: auctionId } = use(params);

  // Connect to live event stream
  useAuctionSocket({ auctionId });

  const nominatedPlayer = useAuctionStore((s) => s.nominatedPlayer);
  const currentBidLakhs = useAuctionStore((s) => s.currentBidLakhs);
  const currentBidder = useAuctionStore((s) => s.currentBidder);

  return (
    <main className="min-h-screen bg-gray-50">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded p-1 text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Back to all sessions"
          >
            ←
          </Link>
          <h1 className="text-base font-bold text-gray-900 sm:text-lg">
            IPL 2026 Auction
          </h1>
        </div>
        <PhaseIndicator />
      </header>

      {/* ── Screen reader live region for bids ──────────────────────────── */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {currentBidder && currentBidLakhs > 0
          ? `${currentBidder} bids ₹${currentBidLakhs} lakhs`
          : ""}
      </div>

      {/* ── Main grid ───────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-screen-2xl p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr_300px] xl:grid-cols-[320px_1fr_320px]">

          {/* Left — Current player + bid ticker */}
          <div className="space-y-4">
            {nominatedPlayer ? (
              <PlayerCard player={nominatedPlayer} />
            ) : (
              <div
                className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white text-gray-400"
                role="status"
                aria-label="Waiting for nomination"
              >
                <span className="animate-pulse">Waiting for nomination…</span>
              </div>
            )}
            <BidTicker />
          </div>

          {/* Centre — Agent rationale panels (2-column grid) */}
          <section aria-label="Agent bid rationale">
            <div className="grid grid-cols-2 gap-3">
              {AGENT_IDS.map((id) => (
                <RationalePanel key={id} agentId={id} />
              ))}
            </div>
          </section>

          {/* Right — Team rosters (scrollable) */}
          <aside
            aria-label="Team rosters and budgets"
            className="space-y-3 lg:overflow-y-auto lg:max-h-[calc(100vh-72px)]"
          >
            {AGENT_IDS.map((id) => (
              <RosterPanel key={id} agentId={id} />
            ))}
          </aside>

        </div>
      </div>

      {/* Connection state toast */}
      <ConnectionToast />
    </main>
  );
}
