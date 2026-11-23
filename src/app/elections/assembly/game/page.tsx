"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Flag, Landmark, MapPin, Search, Trash2, Users } from "lucide-react";
import { deleteAssemblyGame, loadAssemblyGame, type AssemblyGameSave } from "@/engine/assembly-game-engine";
import partiesData from "@/data/parties.json";

const parties = partiesData.parties as { id: string; name: string }[];

export default function AssemblyGamePage() {
  const router = useRouter();
  const [game, setGame] = useState<AssemblyGameSave | null>(null);
  const [query, setQuery] = useState("");
  const [regionFilter, setRegionFilter] = useState("ALL");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const saved = loadAssemblyGame();
    if (!saved) {
      router.replace("/elections/assembly/new-game");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates client-only saved state after mount (localStorage is unavailable during SSR)
    setGame(saved);
  }, [router]);

  const regions = useMemo(() => game
    ? Array.from(new Set(game.constituencies.map((seat) => seat.regionId)))
    : [], [game]);
  const filtered = useMemo(() => {
    if (!game) return [];
    const q = query.trim().toLowerCase();
    return game.constituencies.filter((seat) =>
      (regionFilter === "ALL" || seat.regionId === regionFilter) &&
      (!q || seat.name.toLowerCase().includes(q) || seat.parentParliamentaryConstituency.toLowerCase().includes(q))
    );
  }, [game, query, regionFilter]);

  if (!game) return <main className="grid min-h-screen place-items-center bg-[#071525] text-white">Loading Assembly election...</main>;
  const partyName = (id: string) => parties.find((party) => party.id === id)?.name ?? id;
  const partyCounts = game.partyIds.map((id) => ({
    id,
    count: game.constituencies.filter((seat) => seat.allocatedPartyId === id).length,
  }));

  return (
    <main className="min-h-screen bg-[#071525] text-white">
      <header className="border-b border-white/10 bg-[#091a2c]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link href="/elections/assembly" className="flex items-center gap-3"><Landmark className="text-orange-400"/><b>Indian Election Simulator</b></Link>
          <Link href="/elections/assembly" className="flex items-center gap-2 text-sm text-slate-300"><ArrowLeft size={17}/> Assembly menu</Link>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-5 py-8">
        <p className="text-xs font-bold uppercase tracking-widest text-orange-400">State Legislative Election · {game.electionYear}</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div><h1 className="text-3xl font-bold">{game.state} Assembly Election</h1><p className="mt-2 text-slate-400">One complete election covering every Assembly Constituency in {game.state}.</p></div>
          <button onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-2 rounded-lg border border-red-400/30 px-4 py-2 text-sm text-red-300"><Trash2 size={16}/> Delete game</button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Assembly seats" value={game.totalConstituencies.toLocaleString("en-IN")} icon={<Landmark/>}/>
          <Stat label="Registered electors" value={game.totalVoters.toLocaleString("en-IN")} icon={<Users/>}/>
          <Stat label="Player party" value={partyName(game.playerPartyId)} icon={<Flag/>}/>
          <Stat label="Alliance" value={game.allianceName} icon={<MapPin/>}/>
        </div>
        <section className="mt-7 rounded-2xl border border-white/10 bg-[#0b1e31] p-5">
          <h2 className="text-xl font-bold">Confirmed party seat allocation</h2>
          <p className="mt-1 text-sm text-slate-400">These are the constituencies assigned to each party for this single statewide election.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{partyCounts.map((item) => <div key={item.id} className="rounded-lg bg-[#071525] p-4"><p className="font-semibold">{partyName(item.id)}</p><p className="mt-1 text-2xl font-bold">{item.count} <span className="text-sm font-normal text-slate-400">seats to contest</span></p></div>)}</div>
        </section>
        <section className="mt-7">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold">All constituencies</h2><p className="mt-1 text-sm text-slate-400">Regional grouping is for navigation and reporting; gameplay is statewide.</p></div><div className="flex flex-wrap gap-2">
            <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="rounded-lg border border-white/10 bg-[#0b1e31] px-3 py-2 text-sm"><option value="ALL">All regions</option>{regions.map((id) => <option key={id} value={id}>{game.allocation.regionalShares.find((r) => r.regionId===id)?.regionName ?? id}</option>)}</select>
            <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b1e31] px-3"><Search size={15}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search AC" className="w-40 bg-transparent py-2 text-sm outline-none"/></label>
          </div></div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">{filtered.map((seat) => <article key={seat.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0b1e31] p-3"><div><p className="font-semibold">{seat.name}</p><p className="text-xs text-slate-400">{game.allocation.regionalShares.find((r) => r.regionId===seat.regionId)?.regionName} · {seat.registeredElectors.toLocaleString("en-IN")} electors</p></div><span className="rounded-md bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-300">{partyName(seat.allocatedPartyId)}</span></article>)}</div>
          <p className="mt-3 text-xs text-slate-500">Showing {filtered.length} of {game.totalConstituencies} constituencies.</p>
        </section>
        {confirmDelete && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5"><div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#10263c] p-6"><h3 className="text-lg font-bold">Delete this Assembly game?</h3><p className="mt-2 text-sm text-slate-400">The saved election and allocation will be removed from this browser.</p><div className="mt-5 flex justify-end gap-2"><button onClick={() => setConfirmDelete(false)} className="rounded-lg border border-white/20 px-4 py-2">Cancel</button><button onClick={() => { deleteAssemblyGame(); router.replace("/elections/assembly/new-game"); }} className="rounded-lg bg-red-600 px-4 py-2">Delete</button></div></div></div>}
      </section>
    </main>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-[#0b1e31] p-4"><div className="flex items-center gap-2 text-orange-400">{icon}<span className="text-xs text-slate-400">{label}</span></div><p className="mt-2 text-xl font-bold">{value}</p></div>;
}
