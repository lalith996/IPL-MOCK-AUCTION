/**
 * Auction Room page — real-time spectator view.
 *
 * Route: /auction/[id]
 */

"use client";
import React from "react";

import { use } from "react";
import { useAuctionSocket } from "../../../hooks/useAuctionSocket.js";
import { useAuctionStore } from "../../../store/auctionStore.js";
import { PlayerCard } from "../../../components/PlayerCard.js";
import { BidTicker } from "../../../components/BidTicker.js";
import { RationalePanel } from "../../../components/RationalePanel.js";
import { RosterPanel } from "../../../components/RosterPanel.js";
import { PhaseIndicator } from "../../../components/PhaseIndicator.js";
import { ALL_AGENT_IDS } from "./constants.js";

interface Props {
  params: Promise<{ id: string }>;
}

const AGENT_IDS = [
  "MI", "CSK", "RCB", "DC", "KKR",
  "RR", "PBKS", "SRH", "LSG", "GT",
] as const;

export default function AuctionRoomPage({ params }: Props): React.JSX.Element {
  const { id: auctionId } = use(params);

  // Connect to live event stream
  useAuctionSocket({ auctionId });

  const nominatedPlayer = useAuctionStore((s) => s.nominatedPlayer);

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
        <h1 className="text-lg font-bold text-gray-900">IPL 2026 Auction</h1>
        <PhaseIndicator />
      </header>

      <div className="mx-auto max-w-screen-2xl p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_320px]">
          {/* Left — Current player + bid ticker */}
          <div className="space-y-4">
            {nominatedPlayer ? (
              <PlayerCard player={nominatedPlayer} />
            ) : (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-gray-300 text-gray-400">
                Waiting for nomination…
              </div>
            )}
            <BidTicker />
          </div>

          {/* Centre — Rationale panels (2×5 grid) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-2">
            {AGENT_IDS.map((id) => (
              <RationalePanel key={id} agentId={id} />
            ))}
          </div>

          {/* Right — Team roster panels (scrollable) */}
          <div className="space-y-3 overflow-y-auto max-h-[calc(100vh-80px)]">
            {AGENT_IDS.map((id) => (
              <RosterPanel key={id} agentId={id} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
