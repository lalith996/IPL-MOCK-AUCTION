/**
 * useAuctionSocket — WebSocket client hook.
 *
 * Manages connection lifecycle, reconnect with exponential backoff,
 * event deduplication (by event_id), snapshot handling, and heartbeat.
 */

"use client";

import { useEffect, useRef, useCallback } from "react";
import { useAuctionStore } from "../store/auctionStore.js";

const BROADCASTER_URL =
  process.env["NEXT_PUBLIC_BROADCASTER_URL"] ?? "ws://localhost:3003";

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;

interface UseAuctionSocketOptions {
  auctionId: string;
  enabled?: boolean;
}

export function useAuctionSocket({
  auctionId,
  enabled = true,
}: UseAuctionSocketOptions): void {
  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setConnectionState = useAuctionStore((s) => s.setConnectionState);
  const setLastStreamId = useAuctionStore((s) => s.setLastStreamId);
  const applyEvent = useAuctionStore((s) => s.applyEvent);
  const setSnapshot = useAuctionStore((s) => s.setSnapshot);
  const lastStreamId = useAuctionStore((s) => s.lastStreamId);
  const seenEventIds = useAuctionStore((s) => s.seenEventIds);

  // Forward ref so _scheduleReconnect can be referenced before connect is defined
  const scheduleReconnectRef = useRef<() => void>(() => { /* no-op until wired */ });

  const connect = useCallback(() => {
    if (!enabled || !auctionId) return;

    const url = `${BROADCASTER_URL}/?auctionId=${auctionId}&offset=${lastStreamId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    setConnectionState(attemptsRef.current > 0 ? "reconnecting" : "connecting");

    ws.onopen = () => {
      attemptsRef.current = 0;
      setConnectionState("connected");
    };

    ws.onmessage = (evt) => {
      let msg: unknown;
      try {
        msg = JSON.parse(evt.data as string);
      } catch {
        return;
      }

      const m = msg as Record<string, unknown>;
      switch (m["type"]) {
        case "snapshot":
          if (m["data"]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setSnapshot(m["data"] as any);
          }
          break;

        case "event": {
          const streamId = m["streamId"] as string;
          const data = m["data"] as Record<string, unknown>;
          const eventId = data["eventId"] as string;

          if (eventId && !seenEventIds.has(eventId)) {
            applyEvent(eventId, data);
          }
          if (streamId) setLastStreamId(streamId);
          break;
        }

        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;

        case "error":
          console.warn("[auction-socket] Server error:", m["message"]);
          break;
      }
    };

    ws.onclose = () => {
      setConnectionState("reconnecting");
      wsRef.current = null;
      scheduleReconnectRef.current();
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [auctionId, enabled, lastStreamId, seenEventIds, applyEvent, setConnectionState, setLastStreamId, setSnapshot]);

  // Wire up the forward ref after connect is defined
  const _scheduleReconnect = useCallback(() => {
    const delay = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * Math.pow(2, attemptsRef.current),
    );
    attemptsRef.current += 1;
    reconnectTimerRef.current = setTimeout(connect, delay);
  }, [connect]);

  // Sync forward ref — runs after every render, not during render
  useEffect(() => { scheduleReconnectRef.current = _scheduleReconnect; });

  useEffect(() => {
    if (!enabled) return;
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [auctionId, enabled]);
}
