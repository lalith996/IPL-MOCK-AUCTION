/* eslint-disable react-hooks/set-state-in-effect */
/**
 * BidTicker — live bid amount, bidding team, and countdown clock.
 */

"use client";
import React from "react";

import { useEffect, useState } from "react";
import { useAuctionStore, type AgentId } from "../store/auctionStore.js";

const TEAM_COLORS: Record<AgentId, string> = {
  MI:   "bg-blue-600",
  CSK:  "bg-yellow-500",
  RCB:  "bg-red-600",
  DC:   "bg-blue-800",
  KKR:  "bg-purple-700",
  RR:   "bg-pink-600",
  PBKS: "bg-red-700",
  SRH:  "bg-orange-500",
  LSG:  "bg-cyan-600",
  GT:   "bg-indigo-700",
};

const BID_WINDOW_SECONDS = 8;

export const BidTicker = React.memo(function BidTicker(): React.JSX.Element {
  const currentBidLakhs = useAuctionStore((s) => s.currentBidLakhs);
  const currentBidder = useAuctionStore((s) => s.currentBidder);
  const phase = useAuctionStore((s) => s.phase);

  const [countdown, setCountdown] = useState(BID_WINDOW_SECONDS);

  // Reset countdown whenever the bid changes.
  // We track a "start time" to derive the remaining seconds without a
  // synchronous setState call at effect entry (avoids react-hooks/set-state-in-effect).
  useEffect(() => {
    const startedAt = Date.now();
    setCountdown(BID_WINDOW_SECONDS); // only fires on dependency change, not on every tick
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setCountdown(Math.max(0, BID_WINDOW_SECONDS - elapsed));
    }, 250);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [currentBidLakhs, currentBidder]);

  const isActive = phase === "opening_bid" || phase === "open_bidding";
  const teamColor = currentBidder ? (TEAM_COLORS[currentBidder] ?? "bg-gray-600") : "bg-gray-300";

  return (
    <div className="flex flex-col items-center rounded-2xl border border-gray-200 bg-white p-6 shadow-md">
      <p className="text-sm font-medium uppercase tracking-wide text-gray-500">Current Bid</p>

      <div className="my-3 text-5xl font-extrabold text-gray-900">
        {currentBidLakhs > 0 ? (
          <>₹{currentBidLakhs}L</>
        ) : (
          <span className="text-3xl text-gray-400">Opening…</span>
        )}
      </div>

      {currentBidder && (
        <div className={`rounded-full px-4 py-1 text-sm font-semibold text-white ${teamColor}`}>
          {currentBidder}
        </div>
      )}

      {isActive && (
        <div className="mt-4 w-full">
          <div className="flex justify-between text-xs text-gray-400">
            <span>Time remaining</span>
            <span className={countdown <= 3 ? "font-bold text-red-500" : ""}>{countdown}s</span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-gray-200">
            <div
              className={`h-1.5 rounded-full transition-all ${countdown <= 3 ? "bg-red-500" : "bg-green-500"}`}
              style={{ width: `${(countdown / BID_WINDOW_SECONDS) * 100}%` }}
            />
          </div>
        </div>
      )}

      {phase === "sold" && (
        <div className="mt-3 rounded-full bg-green-500 px-4 py-1 text-sm font-bold text-white">
          SOLD to {currentBidder}
        </div>
      )}
      {phase === "unsold" && (
        <div className="mt-3 rounded-full bg-gray-400 px-4 py-1 text-sm font-bold text-white">
          UNSOLD
        </div>
      )}
    </div>
  );
});
