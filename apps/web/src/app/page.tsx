"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AuctionSummary } from "./api/auctions/route";

const TEAMS = [
  { id: "MI",   name: "Mumbai Indians",         color: "#1D4ED8" },
  { id: "CSK",  name: "Chennai Super Kings",    color: "#CA8A04" },
  { id: "RCB",  name: "Royal Challengers",      color: "#DC2626" },
  { id: "DC",   name: "Delhi Capitals",         color: "#1E3A5F" },
  { id: "KKR",  name: "Kolkata Knight Riders",  color: "#7E22CE" },
  { id: "RR",   name: "Rajasthan Royals",       color: "#DB2777" },
  { id: "PBKS", name: "Punjab Kings",           color: "#B91C1C" },
  { id: "SRH",  name: "Sunrisers Hyderabad",    color: "#EA580C" },
  { id: "LSG",  name: "Lucknow Super Giants",   color: "#0891B2" },
  { id: "GT",   name: "Gujarat Titans",         color: "#3730A3" },
] as const;

type TeamId = typeof TEAMS[number]["id"];

const STATUS_BADGE: Record<AuctionSummary["status"], { label: string; cls: string }> = {
  prep:   { label: "Starting soon", cls: "bg-yellow-100 text-yellow-800" },
  active: { label: "Live",          cls: "bg-green-100  text-green-800"  },
  paused: { label: "Paused",        cls: "bg-orange-100 text-orange-800" },
  ended:  { label: "Ended",         cls: "bg-gray-100   text-gray-500"   },
};

function TeamPickerModal({ onSelect, onCancel, loading }: {
  onSelect: (team: TeamId | null) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="mb-1 text-xl font-bold text-gray-900">Choose Your Team</h2>
        <p className="mb-5 text-sm text-gray-500">
          You control one franchise. The other 9 are played by AI agents with real LLM reasoning.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TEAMS.map((t) => (
            <button
              key={t.id}
              disabled={loading}
              onClick={() => onSelect(t.id)}
              className="flex flex-col items-center rounded-xl border-2 border-gray-100 p-3 text-center transition hover:border-indigo-400 hover:shadow-sm disabled:opacity-50"
            >
              <span
                className="mb-2 flex h-10 w-10 items-center justify-center rounded-full text-xs font-extrabold text-white"
                style={{ backgroundColor: t.color }}
              >
                {t.id}
              </span>
              <span className="text-xs font-medium text-gray-700 leading-tight">{t.name}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 flex gap-3">
          <button
            disabled={loading}
            onClick={() => onSelect(null)}
            className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            👁 Watch only (no team)
          </button>
          <button onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionCard({ session, onJoin }: { session: AuctionSummary; onJoin: (id: string) => void }) {
  const badge = STATUS_BADGE[session.status] ?? STATUS_BADGE.ended;
  const isLive = session.status === "active" || session.status === "paused";
  const humanTeam = TEAMS.find((t) => t.id === session.humanTeam);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm text-gray-400">#{session.id.slice(0, 8)}</p>
          <p className="mt-0.5 text-xs text-gray-400">{new Date(session.createdAt).toLocaleString()}</p>
          {humanTeam && (
            <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold" style={{ color: humanTeam.color }}>
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full text-white" style={{ backgroundColor: humanTeam.color, fontSize: "8px" }}>
                {humanTeam.id.slice(0, 2)}
              </span>
              Human: {humanTeam.name}
            </p>
          )}
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {isLive ? (
          <>
            <Link href={`/auction/${session.id}`} className="inline-flex items-center rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-200">
              👁 Watch
            </Link>
            <button
              onClick={() => onJoin(session.id)}
              className="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-700"
            >
              🏏 Play as Team
            </button>
          </>
        ) : session.status === "prep" ? (
          <span className="text-xs text-gray-400">Starting soon…</span>
        ) : (
          <Link href={`/auction/${session.id}`} className="text-xs text-gray-500 hover:underline">View Replay</Link>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [sessions, setSessions] = useState<AuctionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newSeed, setNewSeed] = useState(42);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [pickerFor, setPickerFor] = useState<"new" | "join">("new");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    async function fetchSessions() {
      try {
        const resp = await fetch("/api/auctions");
        if (!resp.ok) { setError("Auction Manager is unavailable. Run: bash scripts/start-local-app.sh"); return; }
        setSessions((await resp.json()) as AuctionSummary[]);
        setError(null);
      } catch { setError("Could not connect to Auction Manager."); }
      finally { setLoading(false); }
    }
    void fetchSessions();
    const t = setInterval(() => { void fetchSessions(); }, 8_000);
    return () => clearInterval(t);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleTeamSelectedForNew(team: TeamId | null) {
    setCreating(true);
    setShowTeamPicker(false);
    try {
      const resp = await fetch("/api/auctions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: newSeed, humanTeam: team ?? null }),
      });
      if (resp.ok) {
        const s = (await resp.json()) as AuctionSummary;
        setSessions((prev) => [s, ...prev]);
        setShowNewForm(false);
        if (team) {
          sessionStorage.setItem(`humanTeam:${s.id}`, team);
          window.location.href = `/auction/${s.id}`;
        }
      }
    } catch { /* ignore */ }
    finally { setCreating(false); }
  }

  function handleTeamSelectedForJoin(team: TeamId | null) {
    if (!joiningId) return;
    setShowTeamPicker(false);
    if (team) sessionStorage.setItem(`humanTeam:${joiningId}`, team);
    window.location.href = `/auction/${joiningId}`;
  }

  function openTeamPickerFor(type: "new" | "join", id?: string) {
    setPickerFor(type);
    if (type === "join" && id) setJoiningId(id);
    setShowTeamPicker(true);
  }

  const live  = sessions.filter((s) => s.status === "active" || s.status === "paused");
  const other = sessions.filter((s) => s.status !== "active" && s.status !== "paused");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">🏏 IPL 2026 Auction</h1>
            <p className="text-sm text-gray-500">Play as a franchise or watch AI agents bid live</p>
          </div>
          <a href="http://localhost:3001" target="_blank" rel="noreferrer" className="text-sm text-gray-500 hover:text-gray-800">Admin ↗</a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
        {/* Create new session */}
        {!showNewForm ? (
          <button onClick={() => setShowNewForm(true)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            + New Session
          </button>
        ) : (
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">RNG Seed</label>
              <input type="number" value={newSeed} onChange={(e) => setNewSeed(parseInt(e.target.value, 10) || 42)} className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <button disabled={creating} onClick={() => openTeamPickerFor("new")} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {creating ? "Creating…" : "🏏 Play as Team"}
            </button>
            <button disabled={creating} onClick={() => handleTeamSelectedForNew(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
              Automated only
            </button>
            <button onClick={() => setShowNewForm(false)} className="text-gray-400 hover:text-gray-600 text-xl px-1">×</button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <svg className="mr-2 h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
            Connecting…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-semibold">Connection error</p><p className="mt-1">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {live.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-gray-900">Live Now</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {live.map((s) => <SessionCard key={s.id} session={s} onJoin={(id) => openTeamPickerFor("join", id)} />)}
                </div>
              </section>
            )}
            {other.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-gray-700">{live.length > 0 ? "Other Sessions" : "Sessions"}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {other.map((s) => <SessionCard key={s.id} session={s} onJoin={(id) => openTeamPickerFor("join", id)} />)}
                </div>
              </section>
            )}
            {sessions.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
                <p className="text-4xl">🏟️</p>
                <p className="mt-4 text-lg font-semibold text-gray-700">No sessions yet</p>
                <p className="mt-2 text-sm text-gray-500">Click <strong>+ New Session</strong> to start an auction and play as your favourite franchise.</p>
              </div>
            )}
          </>
        )}
      </main>

      {showTeamPicker && (
        <TeamPickerModal
          onSelect={pickerFor === "new" ? handleTeamSelectedForNew : handleTeamSelectedForJoin}
          onCancel={() => { setShowTeamPicker(false); setJoiningId(null); }}
          loading={creating}
        />
      )}
    </div>
  );
}
