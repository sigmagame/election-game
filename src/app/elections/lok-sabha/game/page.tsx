"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadLokSabhaGame,
  deleteLokSabhaGame,
} from "@/engine/lok-sabha-game-engine";
import type { LokSabhaGameSave } from "@/types/lok-sabha-game";
import { ArrowLeft, Search, Users, Landmark, Flag, Trash2, ListChecks } from "lucide-react";
import { allianceShort } from "@/lib/party-style";

export default function LokSabhaGamePage() {
  const router = useRouter();
  const [game, setGame] = useState<LokSabhaGameSave | null>(null);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("ALL");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const saved = loadLokSabhaGame();
    if (!saved) {
      router.replace("/elections/lok-sabha/new-game");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates client-only saved state after mount (localStorage is unavailable during SSR)
    setGame(saved);
  }, [router]);

  const states = useMemo(
    () => game ? Array.from(new Set(game.constituencies.map((item) => item.state))).sort() : [],
    [game],
  );

  const filtered = useMemo(() => {
    if (!game) return [];
    const normalized = query.trim().toLowerCase();
    return game.constituencies.filter((item) => {
      const matchesState = stateFilter === "ALL" || item.state === stateFilter;
      const matchesQuery =
        !normalized ||
        item.name.toLowerCase().includes(normalized) ||
        item.state.toLowerCase().includes(normalized);
      return matchesState && matchesQuery;
    });
  }, [game, query, stateFilter]);

  if (!game) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#071525] text-white">
        Loading Lok Sabha game...
      </main>
    );
  }

  const pcOnlyCount = game.constituencies.filter(
    (item) => item.parentAssemblySegments.length === 0,
  ).length;

  return (
    <main className="min-h-screen bg-[#071525] text-white">
      <header className="border-b border-white/10 bg-[#091a2c]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 lg:px-10">
          <Link href="/elections/lok-sabha" className="flex items-center gap-3">
            <Landmark className="h-8 w-8 text-orange-400" />
            <span className="font-bold">Indian Election Simulator</span>
          </Link>
          <Link href="/elections/lok-sabha" className="flex items-center gap-2 text-sm text-slate-300 hover:text-orange-400">
            <ArrowLeft size={17} /> Lok Sabha Menu
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-[1440px] px-5 py-8 lg:px-10">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-orange-400">
              National Parliamentary Election · {game.electionYear}
            </p>
            <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Lok Sabha Game</h1>
            <p className="mt-2 text-slate-400">
              Your election has been initialized and saved in this browser.
            </p>
          </div>
          <button
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-400/30 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10"
          >
            <Trash2 size={16} /> Delete Save
          </button>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon={<Landmark size={20} />} label="Parliamentary Constituencies" value={game.totalConstituencies.toLocaleString("en-IN")} />
          <Stat icon={<Users size={20} />} label="Registered Electors" value={game.totalVoters.toLocaleString("en-IN")} />
          <Stat icon={<Flag size={20} />} label="Your Party" value={game.playerPartyId} />
          <Stat icon={<Users size={20} />} label="Alliance" value={allianceShort(game.alliance.name)} />
        </div>

        <section className="mt-7 rounded-2xl border border-white/10 bg-[#0b1e31] p-5">
          <div className="flex items-center gap-2"><Users size={19} className="text-orange-400"/><h2 className="text-xl font-bold">State-wise alliance formation</h2></div>
          <p className="mt-1 text-sm text-slate-400">The AI evaluated party compatibility separately in each state. One RIVAL or STRONG_RIVAL relationship prevents a party from joining that state-level alliance; neutral parties may join when the existing members accept them.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Object.entries(game.stateAllianceGroups ?? {}).filter(([, groups]) => groups.length > 0).sort(([a], [b]) => a.localeCompare(b)).map(([state, groups]) => (
              <details key={state} className="rounded-lg border border-white/10 bg-[#071525] p-3">
                <summary className="cursor-pointer font-semibold">{state} <span className="ml-1 text-xs font-normal text-slate-500">{groups.length} electoral groups</span></summary>
                <div className="mt-3 space-y-3">
                  {groups.map((group) => (
                    <div key={group.id} className="border-l-2 border-orange-400/50 pl-3">
                      <p className="text-sm font-semibold">{group.name}{group.isPlayerAlliance ? <span className="ml-2 text-[10px] uppercase text-orange-400">Your alliance</span> : ""}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{group.memberPartyIds.join(", ")}</p>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/elections/lok-sabha/seat-allocation" className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-600"><ListChecks size={17} /> Open Seat Allocation</Link>
        </div>

        <section className="mt-8 rounded-2xl border border-white/10 bg-[#0b1e31] p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold">Constituency data loaded</h2>
              <p className="mt-1 text-sm text-slate-400">
                {pcOnlyCount} Parliamentary Constituencies have no Assembly segments in the supplied workbook. They remain valid Lok Sabha seats.
              </p>
            </div>
            <span className="rounded-full bg-green-500/10 px-3 py-1 text-sm font-semibold text-green-300">
              Game saved
            </span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <MiniStat label="Seats allocated" value={`${game.allocatedConstituencies} / ${game.totalConstituencies}`} />
            <MiniStat label="Seats awaiting allocation" value={(game.totalConstituencies - game.allocatedConstituencies).toLocaleString("en-IN")} />
            <MiniStat label="State-level electoral blocs" value={Object.values(game.stateAllianceGroups ?? {}).reduce((sum, groups) => sum + groups.length, 0).toString()} />
          </div>
        </section>

        <section className="mt-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-bold">Parliamentary Constituencies</h2>
              <p className="mt-1 text-sm text-slate-400">
                Search and inspect the 543 seats and their registered elector counts.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_220px]">
              <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b1e31] px-3">
                <Search size={17} className="text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search constituency or state"
                  className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-slate-500"
                />
              </label>
              <select
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
                className="rounded-lg border border-white/10 bg-[#0b1e31] px-3 py-2.5 text-sm outline-none"
              >
                <option value="ALL">All States / UTs</option>
                {states.map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(100px,150px)_minmax(110px,170px)] gap-3 bg-[#10263c] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-300">
              <span>Parliamentary Constituency</span><span>State / UT</span><span className="text-right">Registered Electors</span>
            </div>
            <div className="max-h-[560px] overflow-y-auto">
              {filtered.map((item) => (
                <div key={item.constituencyId} className="grid grid-cols-[minmax(0,1fr)_minmax(100px,150px)_minmax(110px,170px)] gap-3 border-t border-white/5 px-4 py-3 text-sm hover:bg-white/[0.03]">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-slate-400">{item.state}</span>
                  <span className="text-right tabular-nums">{item.totalVoters.toLocaleString("en-IN")}</span>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-400">No constituencies match your search.</p>
              )}
            </div>
            <div className="border-t border-white/10 bg-[#0b1e31] px-4 py-3 text-xs text-slate-400">
              Showing {filtered.length.toLocaleString("en-IN")} of {game.totalConstituencies.toLocaleString("en-IN")} constituencies
            </div>
          </div>
        </section>
      </section>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#10263c] p-6">
            <h3 className="text-xl font-bold">Delete Lok Sabha save?</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              This removes the saved Lok Sabha game from this browser. You will need to create a new game to continue.
            </p>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-lg border border-white/20 px-4 py-3 font-semibold">Cancel</button>
              <button
                onClick={() => {
                  deleteLokSabhaGame();
                  router.replace("/elections/lok-sabha/new-game");
                }}
                className="flex-1 rounded-lg bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700"
              >
                Delete Save
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0b1e31] p-4">
      <div className="flex items-center gap-2 text-orange-400">{icon}<span className="text-xs text-slate-400">{label}</span></div>
      <p className="mt-3 break-words text-xl font-bold">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}
