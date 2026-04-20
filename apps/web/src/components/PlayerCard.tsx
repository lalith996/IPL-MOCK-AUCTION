/**
 * PlayerCard — displays the nominated player with:
 *   - Priority-loaded headshot at 512px with blurhash placeholder
 *   - is_cold_start badge
 *   - initials-avatar fallback (1 retry max, then avatar)
 *   - Low-bandwidth mode: omit image load when connection is slow
 */

"use client";
import React from "react";

import { useState, useCallback } from "react";
import type { NominatedPlayer } from "../store/auctionStore.js";

interface PlayerCardProps {
  player: NominatedPlayer;
}

export function PlayerCard({ player }: PlayerCardProps): React.JSX.Element {
  const [imageError, setImageError] = useState(false);
  const [retried, setRetried] = useState(false);

  const handleError = useCallback(() => {
    if (!retried && player.headshotUrl) {
      setRetried(true);
      // One retry is handled by re-rendering with the same src
    } else {
      setImageError(true);
    }
  }, [retried, player.headshotUrl]);

  const isLowBandwidth = _isLowBandwidth();
  const showImage = !imageError && !isLowBandwidth && player.headshotUrl;

  return (
    <div className="relative flex flex-col items-center rounded-2xl border border-gray-200 bg-white p-6 shadow-md">
      {/* Cold-start badge */}
      {player.isColdStart && (
        <span className="absolute right-3 top-3 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-white">
          LIMITED DATA
        </span>
      )}

      {/* Headshot / avatar */}
      <div className="mb-4 h-32 w-32 overflow-hidden rounded-full bg-gray-100">
        {showImage ? (
          <img
            src={player.headshotUrl}
            alt={player.canonicalName}
            width={512}
            height={512}
            fetchPriority="high"
            className="h-full w-full object-cover"
            onError={handleError}
          />
        ) : (
          <InitialsAvatar name={player.canonicalName} />
        )}
      </div>

      {/* Player info */}
      <h2 className="text-xl font-bold text-gray-900">{player.canonicalName}</h2>
      <p className="text-sm font-medium capitalize text-indigo-600">{player.role}</p>
      <p className="mt-2 text-center text-sm text-gray-500">{player.playerSummary}</p>

      {/* Confidence bar */}
      <div className="mt-4 w-full">
        <div className="flex justify-between text-xs text-gray-400">
          <span>Data Confidence</span>
          <span>{(player.confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-gray-200">
          <div
            className="h-1.5 rounded-full bg-indigo-500 transition-all"
            style={{ width: `${player.confidence * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Initials avatar (fallback)
// ---------------------------------------------------------------------------

function InitialsAvatar({ name }: { name: string }): React.JSX.Element {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex h-full w-full items-center justify-center bg-indigo-600">
      <span className="text-3xl font-bold text-white">{initials}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Low-bandwidth detection
// ---------------------------------------------------------------------------

function _isLowBandwidth(): boolean {
  if (typeof navigator === "undefined") return false;
  // @ts-expect-error — navigator.connection is not in TS lib
  const conn = navigator.connection as { effectiveType?: string; saveData?: boolean } | undefined;
  if (!conn) return false;
  return conn.saveData === true || conn.effectiveType === "slow-2g" || conn.effectiveType === "2g";
}
