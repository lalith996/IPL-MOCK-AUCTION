
"use client";

/**
 * Admin Console — Step 12
 *
 * Provides:
 *  - JWT login form (operator credentials)
 *  - Session lifecycle controls (create, start, pause, resume)
 *  - Operator approval gate (missing_players / headshot reports)
 *  - NDJSON replay viewer with event log streamed line-by-line
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuctionSummary {
  id: string;
  status: string;
  seed: number;
  createdAt: string;
}

interface ReplayEvent {
  seq: number;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function apiFetch(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(token),
      ...(init?.headers ?? {}),
    },
  });
}

// ---------------------------------------------------------------------------
// LoginForm
// ---------------------------------------------------------------------------

interface LoginFormProps {
  onSuccess: (token: string, operatorId: string) => void;
}

function LoginForm({ onSuccess }: LoginFormProps): React.JSX.Element {
  const [operatorId, setOperatorId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resp = await fetch("/api/auth/operator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorId, password }),
      });
      if (!resp.ok) {
        const data = (await resp.json()) as { error?: string };
        setError(data.error ?? "Authentication failed");
        return;
      }
      const data = (await resp.json()) as { token: string };
      onSuccess(data.token, operatorId);
    } catch {
      setError("Network error. Check that the admin server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <form
        onSubmit={(e) => { void handleSubmit(e); }}
        className="bg-gray-900 border border-gray-700 rounded-xl p-8 w-full max-w-sm space-y-5 shadow-2xl"
      >
        <h1 className="text-2xl font-bold text-white text-center">
          🏏 IPL 2026 Admin
        </h1>
        <p className="text-gray-400 text-sm text-center">Operator login</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Operator ID</label>
            <input
              type="text"
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
              required
              autoComplete="username"
              placeholder="operator-1"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded px-3 py-2 text-red-300 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white font-medium rounded px-4 py-2 text-sm transition-colors"
        >
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApprovalGate
// ---------------------------------------------------------------------------

interface ApprovalGateProps {
  onApproved: () => void;
}

function ApprovalGate({ onApproved }: ApprovalGateProps): React.JSX.Element {
  const [missingPlayersApproved, setMissingPlayersApproved] = useState(false);
  const [headshotApproved, setHeadshotApproved] = useState(false);

  return (
    <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-5 space-y-4">
      <h2 className="text-yellow-300 font-semibold text-sm uppercase tracking-wide">
        ⚠️ Operator Approval Required
      </h2>
      <p className="text-gray-300 text-sm">
        Review the following reports before starting any auction session.
      </p>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={missingPlayersApproved}
          onChange={(e) => setMissingPlayersApproved(e.target.checked)}
          className="mt-0.5 accent-yellow-500"
        />
        <span className="text-sm text-gray-200">
          I have reviewed{" "}
          <code className="text-yellow-300 bg-gray-800 px-1 rounded">
            missing_players_report.json
          </code>{" "}
          and approve its contents.
        </span>
      </label>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={headshotApproved}
          onChange={(e) => setHeadshotApproved(e.target.checked)}
          className="mt-0.5 accent-yellow-500"
        />
        <span className="text-sm text-gray-200">
          I have reviewed{" "}
          <code className="text-yellow-300 bg-gray-800 px-1 rounded">
            headshot_ingestion_report.json
          </code>{" "}
          and approve its contents.
        </span>
      </label>

      <button
        disabled={!missingPlayersApproved || !headshotApproved}
        onClick={onApproved}
        className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded px-4 py-2 text-sm transition-colors"
      >
        Confirm Approvals &amp; Proceed
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReplayViewer
// ---------------------------------------------------------------------------

interface ReplayViewerProps {
  auctionId: string;
  token: string;
  onClose: () => void;
}

function ReplayViewer({ auctionId, token, onClose }: ReplayViewerProps): React.JSX.Element {
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [status, setStatus] = useState<"loading" | "streaming" | "done" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let abortController: AbortController | null = new AbortController();

    async function stream() {
      setEvents([]);
      setStatus("loading");
      setErrorMsg(null);

      try {
        const resp = await fetch(`/api/auctions/${auctionId}/replay`, {
          headers: authHeader(token),
          signal: abortController?.signal,
        });

        if (!resp.ok || !resp.body) {
          setErrorMsg(`Server returned ${resp.status}`);
          setStatus("error");
          return;
        }

        setStatus("streaming");
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const evt = JSON.parse(trimmed) as ReplayEvent;
              setEvents((prev) => [...prev, evt]);
            } catch {
              // skip malformed NDJSON line
            }
          }
        }

        setStatus("done");
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setErrorMsg(String(err));
        setStatus("error");
      }
    }

    void stream();

    return () => {
      abortController?.abort();
      abortController = null;
    };
  }, [auctionId, token]);

  // Auto-scroll to bottom while streaming
  useEffect(() => {
    if (status === "streaming") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events.length, status]);

  const selectedEvent = events.find((e) => e.seq === selectedSeq);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-gray-700">
        <div>
          <h2 className="text-white font-semibold">Replay: {auctionId}</h2>
          <p className="text-gray-400 text-xs mt-0.5">
            {status === "loading" && "Connecting…"}
            {status === "streaming" && `Streaming… ${events.length} events`}
            {status === "done" && `Complete — ${events.length} events`}
            {status === "error" && `Error: ${errorMsg}`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-xl px-2"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Event list */}
        <div className="w-1/2 overflow-y-auto bg-gray-950 border-r border-gray-800">
          {events.map((evt) => (
            <button
              key={evt.seq}
              onClick={() => setSelectedSeq(evt.seq === selectedSeq ? null : evt.seq)}
              className={`w-full text-left px-4 py-2 border-b border-gray-800 hover:bg-gray-800 transition-colors ${
                evt.seq === selectedSeq ? "bg-gray-800" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-xs font-mono w-10 shrink-0">
                  #{evt.seq}
                </span>
                <span className="text-blue-400 text-xs font-mono truncate">
                  {evt.type}
                </span>
                <span className="text-gray-600 text-xs ml-auto shrink-0">
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </button>
          ))}
          <div ref={bottomRef} />
          {status === "done" && events.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-8">
              No events found for this session.
            </p>
          )}
        </div>

        {/* Event detail */}
        <div className="w-1/2 overflow-y-auto bg-gray-950 p-4">
          {selectedEvent ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-blue-400 font-mono text-sm">{selectedEvent.type}</span>
                <span className="text-gray-500 text-xs">seq #{selectedEvent.seq}</span>
              </div>
              <p className="text-gray-500 text-xs">{selectedEvent.timestamp}</p>
              <pre className="text-green-300 text-xs bg-gray-900 rounded p-3 overflow-x-auto whitespace-pre-wrap font-mono">
                {JSON.stringify(selectedEvent.payload, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-gray-600 text-sm text-center mt-16">
              Select an event to inspect its payload.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionCard
// ---------------------------------------------------------------------------

interface SessionCardProps {
  auction: AuctionSummary;
  token: string;
  onAction: (id: string, action: "start" | "pause" | "resume") => Promise<void>;
  onReplay: (id: string) => void;
  approvalsGranted: boolean;
}

function SessionCard({
  auction,
  token,
  onAction,
  onReplay,
  approvalsGranted,
}: SessionCardProps): React.JSX.Element {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(action: "start" | "pause" | "resume") {
    setError(null);
    setLoading(action);
    try {
      await onAction(auction.id, action);
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(null);
    }
  }

  const statusColors: Record<string, string> = {
    prep: "text-gray-400",
    nominating: "text-yellow-400",
    open_bidding: "text-blue-400",
    closing: "text-orange-400",
    sold: "text-green-400",
    unsold: "text-red-400",
    paused: "text-purple-400",
    complete: "text-gray-500",
  };

  const statusColor = statusColors[auction.status] ?? "text-gray-300";

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-white font-mono text-sm truncate">{auction.id}</p>
          <p className="text-gray-500 text-xs mt-0.5">
            seed: <span className="text-gray-300">{auction.seed}</span>
            {" · "}
            created {new Date(auction.createdAt).toLocaleString()}
          </p>
        </div>
        <span className={`text-xs font-semibold uppercase tracking-wide ${statusColor}`}>
          {auction.status}
        </span>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded px-2 py-1 text-red-300 text-xs">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {auction.status === "prep" && (
          <button
            disabled={loading === "start" || !approvalsGranted}
            onClick={() => { void handleAction("start"); }}
            title={!approvalsGranted ? "Approve reports first" : undefined}
            className="px-3 py-1 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs rounded transition-colors"
          >
            {loading === "start" ? "Starting…" : "▶ Start"}
          </button>
        )}
        {(auction.status === "nominating" ||
          auction.status === "open_bidding" ||
          auction.status === "closing") && (
          <button
            disabled={loading === "pause"}
            onClick={() => { void handleAction("pause"); }}
            className="px-3 py-1 bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-700 text-white text-xs rounded transition-colors"
          >
            {loading === "pause" ? "Pausing…" : "⏸ Pause"}
          </button>
        )}
        {auction.status === "paused" && (
          <button
            disabled={loading === "resume"}
            onClick={() => { void handleAction("resume"); }}
            className="px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 text-white text-xs rounded transition-colors"
          >
            {loading === "resume" ? "Resuming…" : "▶ Resume"}
          </button>
        )}
        <button
          onClick={() => onReplay(auction.id)}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition-colors"
        >
          🎬 Replay
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateSessionForm
// ---------------------------------------------------------------------------

interface CreateSessionFormProps {
  token: string;
  onCreated: (auction: AuctionSummary) => void;
}

function CreateSessionForm({ token, onCreated }: CreateSessionFormProps): React.JSX.Element {
  const [seed, setSeed] = useState("42");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resp = await apiFetch("/api/auctions", token, {
        method: "POST",
        body: JSON.stringify({ seed: parseInt(seed, 10) }),
      });
      if (!resp.ok) {
        const data = (await resp.json()) as { error?: string };
        setError(data.error ?? `Server error ${resp.status}`);
        return;
      }
      const auction = (await resp.json()) as AuctionSummary;
      onCreated(auction);
      setSeed("42");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={(e) => { void handleCreate(e); }}
      className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3"
    >
      <h3 className="text-white font-semibold text-sm">Create New Session</h3>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1">RNG Seed</label>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            min={0}
            required
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white text-sm font-medium rounded transition-colors"
        >
          {loading ? "Creating…" : "+ Create"}
        </button>
      </div>
      {error && (
        <div className="text-red-400 text-xs">{error}</div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

interface DashboardProps {
  token: string;
  operatorId: string;
  onSignOut: () => void;
}

function Dashboard({ token, operatorId, onSignOut }: DashboardProps): React.JSX.Element {
  const [auctions, setAuctions] = useState<AuctionSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [approvalsGranted, setApprovalsGranted] = useState(false);
  const [replayId, setReplayId] = useState<string | null>(null);

  const fetchAuctions = useCallback(async () => {
    setListError(null);
    try {
      const resp = await apiFetch("/api/auctions", token);
      if (!resp.ok) {
        setListError(`Failed to load sessions (${resp.status})`);
        return;
      }
      const data = (await resp.json()) as AuctionSummary[];
      setAuctions(data);
    } catch {
      setListError("Network error loading sessions");
    } finally {
      setLoadingList(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchAuctions();
    // Poll every 10 s
    const interval = setInterval(() => { void fetchAuctions(); }, 10_000);
    return () => clearInterval(interval);
  }, [fetchAuctions]);

  /** Persist approvals to DB for a specific auction. */
  async function persistApproval(auctionId: string): Promise<void> {
    await apiFetch(`/api/auctions/${auctionId}/approve`, token, {
      method: "POST",
      body: JSON.stringify({ missingPlayers: true, headshots: true }),
    });
  }

  async function handleAction(
    id: string,
    action: "start" | "pause" | "resume",
  ): Promise<void> {
    // Persist approval to DB before starting (BFF checks DB)
    if (action === "start") {
      await persistApproval(id);
    }
    const resp = await apiFetch(`/api/auctions/${id}?action=${action}`, token, {
      method: "POST",
    });
    if (!resp.ok) {
      const data = (await resp.json()) as { error?: string };
      throw new Error(data.error ?? `Server error ${resp.status}`);
    }
    await fetchAuctions();
  }

  function handleCreated(auction: AuctionSummary) {
    setAuctions((prev) => [auction, ...prev]);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navbar */}
      <nav className="bg-gray-900 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">🏏</span>
          <span className="font-bold">IPL 2026 Admin Console</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm">
            Operator: <span className="text-white">{operatorId}</span>
          </span>
          <button
            onClick={onSignOut}
            className="text-gray-400 hover:text-white text-sm transition-colors"
          >
            Sign out
          </button>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Approval Gate */}
        {!approvalsGranted && (
          <ApprovalGate onApproved={() => setApprovalsGranted(true)} />
        )}
        {approvalsGranted && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg px-4 py-2 text-green-300 text-sm flex items-center gap-2">
            ✓ Operator approvals confirmed — auction sessions can be started.
          </div>
        )}

        {/* Create session */}
        <CreateSessionForm token={token} onCreated={handleCreated} />

        {/* Session list */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Auction Sessions</h2>

          {loadingList && (
            <p className="text-gray-500 text-sm">Loading sessions…</p>
          )}
          {!loadingList && listError && (
            <div className="bg-red-900/30 border border-red-700 rounded px-3 py-2 text-red-300 text-sm">
              {listError}
            </div>
          )}
          {!loadingList && !listError && auctions.length === 0 && (
            <p className="text-gray-500 text-sm">
              No sessions found. Create one above.
            </p>
          )}

          {auctions.map((auction) => (
            <SessionCard
              key={auction.id}
              auction={auction}
              token={token}
              onAction={handleAction}
              onReplay={(id) => setReplayId(id)}
              approvalsGranted={approvalsGranted}
            />
          ))}
        </div>
      </div>

      {/* Replay viewer overlay */}
      {replayId && (
        <ReplayViewer
          auctionId={replayId}
          token={token}
          onClose={() => setReplayId(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root Page
// ---------------------------------------------------------------------------

export default function AdminPage(): React.JSX.Element {
  const [token, setToken] = useState<string | null>(null);
  const [operatorId, setOperatorId] = useState<string>("");

  function handleLogin(t: string, id: string) {
    setToken(t);
    setOperatorId(id);
  }

  function handleSignOut() {
    setToken(null);
    setOperatorId("");
  }

  if (!token) {
    return <LoginForm onSuccess={handleLogin} />;
  }

  return (
    <Dashboard token={token} operatorId={operatorId} onSignOut={handleSignOut} />
  );
}
