/**
 * HumanBidPanel — shown to the human player when it's their bid window.
 *
 * Displays:
 *  - Current nominated player
 *  - Current highest bid
 *  - BID button (with suggested amount = current + minimum increment)
 *  - Custom amount input
 *  - DROP button
 *  - Countdown timer
 *
 * Calls POST /api/auctions/:id/human-bid on submit.
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuctionStore, type HumanBidWindow, type AgentId } from "../store/auctionStore";

const TEAM_COLORS: Record<AgentId, string> = {
  MI: "#1D4ED8", CSK: "#CA8A04", RCB: "#DC2626", DC: "#1E3A5F",
  KKR: "#7E22CE", RR: "#DB2777", PBKS: "#B91C1C",
  SRH: "#EA580C", LSG: "#0891B2", GT: "#3730A3",
};

const TEAM_NAMES: Record<AgentId, string> = {
  MI: "Mumbai Indians", CSK: "Chennai Super Kings", RCB: "Royal Challengers",
  DC: "Delhi Capitals", KKR: "Kolkata Knight Riders", RR: "Rajasthan Royals",
  PBKS: "Punjab Kings", SRH: "Sunrisers Hyderabad", LSG: "Lucknow Super Giants",
  GT: "Gujarat Titans",
};

/** Minimum bid increment per spec §7 */
function minIncrement(currentBidLakhs: number): number {
  if (currentBidLakhs < 100) return 5;
  if (currentBidLakhs < 200) return 10;
  if (currentBidLakhs < 500) return 20;
  return 25;
}

interface Props {
  auctionId: string;
}

export function HumanBidPanel({ auctionId }: Props) {
  const window_ = useAuctionStore((s) => s.humanBidWindow);
  const humanTeam = useAuctionStore((s) => s.humanTeam);
  const clearHumanBidWindow = useAuctionStore((s) => s.clearHumanBidWindow);
  const teamBudget = useAuctionStore((s) => s.teams[humanTeam ?? "MI"]?.budgetRemainingCr ?? 100);

  const [timeLeft, setTimeLeft] = useState(0);
  const [bidLakhs, setBidLakhs] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialise suggested bid when window opens
  useEffect(() => {
    if (!window_) { setSubmitted(false); setError(null); return; }
    const suggested = window_.currentBidLakhs + minIncrement(window_.currentBidLakhs);
    setBidLakhs(suggested);
    setSubmitted(false);
    setError(null);
  }, [window_?.openedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown timer
  useEffect(() => {
    if (!window_) return;
    const id = setInterval(() => {
      const elapsed = Date.now() - window_.openedAt;
      const remaining = Math.max(0, Math.ceil((window_.windowMs - elapsed) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) clearHumanBidWindow();
    }, 200);
    return () => clearInterval(id);
  }, [window_?.openedAt, window_?.windowMs, clearHumanBidWindow]);

  const submit = useCallback(async (action: "bid" | "drop") => {
    if (submitting || submitted) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = action === "bid"
        ? { action: "bid", bidLakhs }
        : { action: "drop" };

      const resp = await fetch(`/api/auctions/${auctionId}/human-bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (resp.ok) {
        setSubmitted(true);
        clearHumanBidWindow();
      } else {
        const data = (await resp.json()) as { error?: string };
        setError(data.error ?? "Bid failed — the window may have closed");
      }
    } catch {
      setError("Network error — could not submit bid");
    } finally {
      setSubmitting(false);
    }
  }, [auctionId, bidLakhs, submitting, submitted, clearHumanBidWindow]);

  if (!window_ || !humanTeam) return null;

  const teamColor = TEAM_COLORS[humanTeam];
  const teamName = TEAM_NAMES[humanTeam];
  const minBid = window_.currentBidLakhs + minIncrement(window_.currentBidLakhs);
  const maxBid = Math.floor(teamBudget * 100); // convert Cr → L
  const canBid = bidLakhs >= minBid && bidLakhs <= maxBid;
  const timerPct = (timeLeft / (window_.windowMs / 1000)) * 100;
  const isUrgent = timeLeft <= 8;

  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 w-full max-w-md px-4"
      role="dialog"
      aria-label="Your bid window"
    >
      <div
        className="rounded-2xl border-2 bg-white shadow-2xl overflow-hidden"
        style={{ borderColor: teamColor }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 text-white"
          style={{ backgroundColor: teamColor }}
        >
          <div>
            <p className="text-xs font-medium opacity-80">Your Turn</p>
            <p className="text-base font-bold">{teamName} ({humanTeam})</p>
          </div>
          <div className="text-right">
            <p className="text-xs opacity-80">Budget remaining</p>
            <p className="text-sm font-semibold">₹{teamBudget.toFixed(0)}Cr</p>
          </div>
        </div>

        {/* Countdown bar */}
        <div className="h-1.5 w-full bg-gray-200">
          <div
            className={`h-1.5 transition-all ${isUrgent ? "bg-red-500" : "bg-green-500"}`}
            style={{ width: `${timerPct}%` }}
          />
        </div>

        <div className="p-4 space-y-3">
          {/* Player + current bid */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">Bidding for</p>
              <p className="font-semibold text-gray-900">{window_.playerId}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Current bid</p>
              <p className="text-lg font-bold text-gray-900">
                {window_.currentBidLakhs > 0 ? `₹${window_.currentBidLakhs}L` : "Opening"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Time left</p>
              <p className={`text-xl font-bold ${isUrgent ? "text-red-600 animate-pulse" : "text-gray-900"}`}>
                {timeLeft}s
              </p>
            </div>
          </div>

          {/* Bid amount input */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              Bid amount (min ₹{minBid}L, max ₹{maxBid}L)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">₹</span>
              <input
                type="number"
                value={bidLakhs}
                min={minBid}
                max={maxBid}
                step={minIncrement(bidLakhs)}
                onChange={(e) => setBidLakhs(Number(e.target.value))}
                disabled={submitting || submitted}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold focus:border-indigo-500 focus:outline-none disabled:bg-gray-50"
              />
              <span className="text-sm text-gray-500">L</span>
            </div>
            {/* Quick-increment buttons */}
            <div className="mt-2 flex gap-1.5">
              {[minBid, minBid * 2, minBid * 4].filter((v) => v <= maxBid).map((v) => (
                <button
                  key={v}
                  disabled={submitting || submitted}
                  onClick={() => setBidLakhs(v)}
                  className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  ₹{v}L
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && <p className="text-xs text-red-600">{error}</p>}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              disabled={!canBid || submitting || submitted}
              onClick={() => { void submit("bid"); }}
              className="flex-1 rounded-xl py-3 text-sm font-bold text-white shadow transition disabled:opacity-40"
              style={{ backgroundColor: canBid && !submitted ? teamColor : undefined, background: canBid && !submitted ? undefined : "#9CA3AF" }}
            >
              {submitting ? "Submitting…" : submitted ? "✓ Submitted" : `BID ₹${bidLakhs}L`}
            </button>
            <button
              disabled={submitting || submitted}
              onClick={() => { void submit("drop"); }}
              className="rounded-xl border-2 border-gray-300 px-5 py-3 text-sm font-semibold text-gray-600 hover:border-gray-400 disabled:opacity-40"
            >
              DROP
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
