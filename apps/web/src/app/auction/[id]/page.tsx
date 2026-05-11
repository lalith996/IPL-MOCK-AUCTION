/**
 * Auction Room page — real-time spectator/player view.
 *
 * Route: /auction/[id]
 * Layout: layout.tsx injects per-session metadata (server component).
 *
 * If the user selected a team (stored in sessionStorage as humanTeam:<id>),
 * a HumanBidPanel appears whenever the nomination loop opens their bid window.
 */

"use client";
import React, { use, useEffect } from "react";

import Link from "next/link";
import { useAuctionSocket } from "../../../hooks/useAuctionSocket";
import { useAuctionStore } from "../../../store/auctionStore";
import { PlayerCard } from "../../../components/PlayerCard";
import { BidTicker } from "../../../components/BidTicker";
import { RationalePanel } from "../../../components/RationalePanel";
import { RosterPanel } from "../../../components/RosterPanel";
import { PhaseIndicator } from "../../../components/PhaseIndicator";
import { HumanBidPanel } from "../../../components/HumanBidPanel";
import type { AgentId } from "../../../store/auctionStore";

interface Props {
  params: Promise<{ id: string }>;
}

const AGENT_IDS = [
  "MI", "CSK", "RCB", "DC", "KKR",
  "RR", "PBKS", "SRH", "LSG", "GT",
] as const;

const TEAM_COLORS: Record<AgentId, string> = {
  MI: "#1D4ED8", CSK: "#CA8A04", RCB: "#DC2626", DC: "#1E3A5F",
  KKR: "#7E22CE", RR: "#DB2777", PBKS: "#B91C1C",
  SRH: "#EA580C", LSG: "#0891B2", GT: "#3730A3",
};

// ---------------------------------------------------------------------------
// Connection toast
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
      role="status" aria-live="polite"
      className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
    >
      <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
      {labels[state as "disconnected" | "connecting" | "reconnecting"]}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Human player banner (shown in header when user controls a team)
// ---------------------------------------------------------------------------

function HumanPlayerBanner() {
  const humanTeam = useAuctionStore((s) => s.humanTeam);
  if (!humanTeam) return null;
  const color = TEAM_COLORS[humanTeam];
  return (
    <div
      className="flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      🏏 Playing as {humanTeam}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen reader live region
// ---------------------------------------------------------------------------

function ScreenReaderAnnouncer() {
  const currentBidLakhs = useAuctionStore((s) => s.currentBidLakhs);
  const currentBidder   = useAuctionStore((s) => s.currentBidder);
  return (
    <div aria-live="assertive" aria-atomic="true" className="sr-only">
      {currentBidder && currentBidLakhs > 0 ? `${currentBidder} bids ₹${currentBidLakhs} lakhs` : ""}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player area
// ---------------------------------------------------------------------------

function PlayerArea() {
  const nominatedPlayer = useAuctionStore((s) => s.nominatedPlayer);
  return nominatedPlayer ? (
    <PlayerCard player={nominatedPlayer} />
  ) : (
    <div
      className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white text-gray-400"
      role="status" aria-label="Waiting for nomination"
    >
      <span className="animate-pulse">Waiting for nomination…</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AuctionRoomPage({ params }: Props): React.JSX.Element {
  const { id: auctionId } = use(params);
  const setHumanTeam = useAuctionStore((s) => s.setHumanTeam);

  // Load human team from sessionStorage (set when user selected a team on the home page)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = sessionStorage.getItem(`humanTeam:${auctionId}`) as AgentId | null;
    setHumanTeam(stored);
  }, [auctionId, setHumanTeam]);

  // Connect WebSocket
  useAuctionSocket({ auctionId });

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded p-1 text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Back to all sessions"
          >
            ←
          </Link>
          <h1 className="text-base font-bold text-gray-900 sm:text-lg">IPL 2026 Auction</h1>
        </div>
        <div className="flex items-center gap-3">
          <HumanPlayerBanner />
          <PhaseIndicator />
        </div>
      </header>

      <ScreenReaderAnnouncer />

      {/* Main grid */}
      <div className="mx-auto max-w-screen-2xl p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr_300px] xl:grid-cols-[320px_1fr_320px]">

          {/* Left — Player card + bid ticker */}
          <div className="space-y-4">
            <PlayerArea />
            <BidTicker />
          </div>

          {/* Centre — 10 agent rationale panels */}
          <section aria-label="Agent bid rationale">
            <div className="grid grid-cols-2 gap-3">
              {AGENT_IDS.map((id) => (
                <RationalePanel key={id} agentId={id} />
              ))}
            </div>
          </section>

          {/* Right — Team rosters */}
          <aside aria-label="Team rosters and budgets" className="space-y-3 lg:overflow-y-auto lg:max-h-[calc(100vh-72px)]">
            {AGENT_IDS.map((id) => (
              <RosterPanel key={id} agentId={id} />
            ))}
          </aside>
        </div>
      </div>

      {/* Human player bid panel — floats above everything when bid window opens */}
      <HumanBidPanel auctionId={auctionId} />

      <ConnectionToast />
    </main>
  );
}
