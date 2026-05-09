/**
 * PhaseIndicator — shows the current FSM phase.
 */

"use client";
import React from "react";

import { useAuctionStore, type AuctionPhase } from "../store/auctionStore.js";

const PHASE_LABELS: Record<AuctionPhase, string> = {
  prep:         "Preparing",
  nominating:   "Nominating Player",
  opening_bid:  "Opening Bid",
  open_bidding: "Live Bidding",
  closing:      "Closing…",
  sold:         "SOLD!",
  unsold:       "Unsold",
  complete:     "Auction Complete",
};

const PHASE_COLORS: Record<AuctionPhase, string> = {
  prep:         "bg-gray-200 text-gray-600",
  nominating:   "bg-blue-100 text-blue-700",
  opening_bid:  "bg-indigo-100 text-indigo-700",
  open_bidding: "bg-green-100 text-green-700",
  closing:      "bg-yellow-100 text-yellow-700",
  sold:         "bg-emerald-500 text-white",
  unsold:       "bg-gray-400 text-white",
  complete:     "bg-indigo-700 text-white",
};

export const PhaseIndicator = React.memo(function PhaseIndicator(): React.JSX.Element {
  const phase = useAuctionStore((s) => s.phase);
  const connectionState = useAuctionStore((s) => s.connectionState);

  return (
    <div className="flex items-center gap-3">
      <span className={`rounded-full px-3 py-1 text-sm font-semibold ${PHASE_COLORS[phase]}`}>
        {PHASE_LABELS[phase]}
      </span>
      <ConnectionDot state={connectionState} />
    </div>
  );
});

function ConnectionDot({
  state,
}: {
  state: "disconnected" | "connecting" | "connected" | "reconnecting";
}): React.JSX.Element {
  const colors = {
    connected:    "bg-green-400",
    connecting:   "bg-yellow-400 animate-pulse",
    reconnecting: "bg-yellow-400 animate-pulse",
    disconnected: "bg-red-400",
  };
  const labels = {
    connected:    "Live",
    connecting:   "Connecting",
    reconnecting: "Reconnecting",
    disconnected: "Offline",
  };
  return (
    <span className="flex items-center gap-1 text-xs text-gray-500">
      <span className={`inline-block h-2 w-2 rounded-full ${colors[state]}`} />
      {labels[state]}
    </span>
  );
}
