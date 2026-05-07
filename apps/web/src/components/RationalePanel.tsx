/**
 * RationalePanel — score_breakdown bar chart + reasoning_summary text.
 * Shown per-agent when they place a bid.
 */

"use client";
import React from "react";

import { useAuctionStore, type AgentId } from "../store/auctionStore.js";

interface RationalePanelProps {
  agentId: AgentId;
}

const SCORE_FIELDS: Array<{ key: keyof import("../store/auctionStore.js").ScoreBreakdown; label: string }> = [
  { key: "formScore",        label: "Form" },
  { key: "valueScore",       label: "Value" },
  { key: "roleFit",          label: "Role Fit" },
  { key: "squadNeed",        label: "Squad Need" },
  { key: "dataConfidence",   label: "Data Confidence" },
  { key: "budgetPressure",   label: "Budget Pressure" },
  { key: "personalityBonus", label: "Personality Bonus" },
];

export function RationalePanel({ agentId }: RationalePanelProps): React.JSX.Element {
  const event = useAuctionStore((s) => s.latestBidEvents[agentId]);

  if (!event) {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center text-sm text-gray-400">
        No bid rationale yet
      </div>
    );
  }

  const breakdown = event.scoreBreakdown;
  const composite = breakdown.composite;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-bold text-gray-700">{agentId}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
          event.action === "bid" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        }`}>
          {event.action === "bid"
            ? `BID ₹${event.bidAmountLakhs}L`
            : "DROP"}
        </span>
      </div>

      {/* Composite score */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-gray-500">Composite</span>
        <div className="flex-1 rounded-full bg-gray-200 h-2">
          <div
            className="h-2 rounded-full bg-indigo-500"
            style={{ width: `${composite * 100}%` }}
          />
        </div>
        <span className="text-xs font-semibold text-indigo-600">{(composite * 100).toFixed(0)}</span>
      </div>

      {/* Score breakdown bars */}
      <div className="space-y-1.5">
        {SCORE_FIELDS.map(({ key, label }) => {
          const val = breakdown[key] as number;
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="w-28 text-xs text-gray-400 truncate">{label}</span>
              <div className="flex-1 rounded-full bg-gray-100 h-1.5">
                <div
                  className="h-1.5 rounded-full bg-indigo-400"
                  style={{ width: `${val * 100}%` }}
                />
              </div>
              <span className="w-8 text-right text-xs text-gray-500">{(val * 100).toFixed(0)}</span>
            </div>
          );
        })}
      </div>

      {/* Reasoning */}
      <p className="mt-3 text-xs leading-relaxed text-gray-600 italic">
        &ldquo;{event.reasoningSummary}&rdquo;
      </p>

      {/* Plan badge */}
      <div className="mt-2 flex gap-1">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
          Plan {event.chosenPlan}
        </span>
        {event.isColdStart && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
            Cold Start
          </span>
        )}
      </div>
    </div>
  );
}
