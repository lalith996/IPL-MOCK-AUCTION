/**
 * RosterPanel — one team's squad list (64px thumbnails), budget bar.
 */

"use client";
import React from "react";

import { useAuctionStore, type AgentId } from "../store/auctionStore.js";

interface RosterPanelProps {
  agentId: AgentId;
}

const INITIAL_BUDGET_CR = 100;

const TEAM_DISPLAY: Record<AgentId, { name: string; color: string }> = {
  MI:   { name: "Mumbai Indians",         color: "#1D4ED8" },
  CSK:  { name: "Chennai Super Kings",    color: "#CA8A04" },
  RCB:  { name: "Royal Challengers",      color: "#DC2626" },
  DC:   { name: "Delhi Capitals",         color: "#1E3A5F" },
  KKR:  { name: "Kolkata Knight Riders",  color: "#7E22CE" },
  RR:   { name: "Rajasthan Royals",       color: "#DB2777" },
  PBKS: { name: "Punjab Kings",           color: "#B91C1C" },
  SRH:  { name: "Sunrisers Hyderabad",    color: "#EA580C" },
  LSG:  { name: "Lucknow Super Giants",   color: "#0891B2" },
  GT:   { name: "Gujarat Titans",         color: "#3730A3" },
};

export const RosterPanel = React.memo(function RosterPanel({ agentId }: RosterPanelProps): React.JSX.Element {
  const team = useAuctionStore((s) => s.teams[agentId]);
  const info = TEAM_DISPLAY[agentId];

  const budget = team?.budgetRemainingCr ?? INITIAL_BUDGET_CR;
  const budgetPct = Math.min(100, (budget / INITIAL_BUDGET_CR) * 100);
  const squad = team?.squad ?? [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      {/* Team name + budget bar */}
      <div className="mb-2 flex items-center justify-between">
        <span
          className="text-xs font-bold"
          style={{ color: info.color }}
        >
          {agentId}
        </span>
        <span className="text-xs text-gray-500">₹{budget.toFixed(0)}Cr</span>
      </div>
      <div className="mb-3 h-1.5 w-full rounded-full bg-gray-100">
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${budgetPct}%`, backgroundColor: info.color }}
        />
      </div>

      {/* Squad list */}
      {squad.length === 0 ? (
        <p className="text-center text-xs text-gray-300">No players yet</p>
      ) : (
        <div className="space-y-1">
          {squad.map((player) => (
            <div key={player.playerId} className="flex items-center gap-2">
              {/* 64px thumbnail placeholder */}
              <div
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: info.color }}
              >
                {player.playerId.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs font-medium text-gray-800">
                  {player.playerId}
                </p>
                <p className="text-xs capitalize text-gray-400">{player.role}</p>
              </div>
              <span className="text-xs text-gray-400">₹{player.priceLakhs}L</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
