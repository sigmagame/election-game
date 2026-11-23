"use client";

import { StartSlot } from "@/components/setup/start-slot";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Shuffle, Search, CheckCircle2, AlertCircle, Users, MapPin } from "lucide-react";
import {
  loadLokSabhaGame,
  saveLokSabhaGame,
  randomlyAllocateSeats,
  updatePlayerSeatShare,
  getPlayerSeatShareStatus,
  getSeatSharePreview,
  getPartyStrength,
  partyCanContestInState,
} from "@/engine/lok-sabha-game-engine";
import type { LokSabhaGameSave } from "@/types/lok-sabha-game";
import partiesData from "@/data/parties.json";

const parties = partiesData.parties as { id: string; name: string }[];

export function LokSabhaSeatStep() {
  const router = useRouter();
  const [game, setGame] = useState<LokSabhaGameSave | null>(null);
  const [activeState, setActiveState] = useState("");
  const [query, setQuery] = useState("");
  const [resultStateFilter, setResultStateFilter] = useState("ALL");
  const [message, setMessage] = useState("");
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    const saved = loadLokSabhaGame();
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates client-only saved state after mount (localStorage is unavailable during SSR)
    setGame(saved);
    const firstState = saved.constituencies.map((seat) => seat.state).find((state) => partyCanContestInState(saved.playerPartyId, state));
    if (firstState) setActiveState(firstState);
    setShowResults(saved.allocatedConstituencies > 0);
  }, []);

  const playerStates = useMemo(() => {
    if (!game) return [];
    return Array.from(new Set(game.constituencies.map((seat) => seat.state)))
      .filter((state) => partyCanContestInState(game.playerPartyId, state))
      .sort((a, b) => a.localeCompare(b));
  }, [game]);

  const activeStateSeats = useMemo(() => game ? game.constituencies.filter((seat) => seat.state === activeState) : [], [game, activeState]);
  const playerGroup = game?.stateAllianceGroups[activeState]?.find((group) => group.isPlayerAlliance);
  const shareStatus = game && activeState ? getPlayerSeatShareStatus(game, activeState) : null;
  const previews = game && activeState ? getSeatSharePreview(game, activeState) : [];
  const allPlayerSharesValid = Boolean(game) && playerStates.every((state) => getPlayerSeatShareStatus(game!, state).valid);
  const allocated = game?.constituencies.filter((seat) => seat.allocations.length > 0).length ?? 0;

  function commit(next: LokSabhaGameSave, note?: string) {
    setGame(next);
    saveLokSabhaGame(next);
    if (note) setMessage(note);
  }

  function changeShare(state: string, partyId: string, value: number) {
    if (!game) return;
    try {
      commit(updatePlayerSeatShare(game, state, partyId, value));
      setShowResults(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update the seat share.");
    }
  }

  function runAllocation() {
    if (!game) return;
    try {
      const next = randomlyAllocateSeats(game);
      commit(next, "Seat allocation completed. Each alliance now has its own party assignment in every eligible constituency.");
      setShowResults(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to allocate constituencies.");
    }
  }

  function startCampaign() {
  if (!game || !showResults || !allPlayerSharesValid ||
      allocated !== game.totalConstituencies) {
    setMessage("Complete seat sharing and constituency allocation before starting the campaign.");
    return;
  }

  const campaignGame: LokSabhaGameSave = {
    ...game,
    status: "CAMPAIGN",
  };

  saveLokSabhaGame(campaignGame);
  setGame(campaignGame);
  router.push("/elections/lok-sabha/campaign");
}

  const filteredSeats = useMemo(() => {
    if (!game) return [];
    const normalized = query.trim().toLowerCase();
    return game.constituencies.filter((seat) =>
      (!normalized || seat.name.toLowerCase().includes(normalized) || seat.state.toLowerCase().includes(normalized)) &&
      (resultStateFilter === "ALL" || seat.state === resultStateFilter)
    );
  }, [game, query, resultStateFilter]);

  if (!game) return <p className="text-muted-foreground">Loading seat-sharing setup...</p>;

  return (
    <div>
      <StartSlot><button type="button" onClick={startCampaign} disabled={!showResults || !allPlayerSharesValid || allocated !== game.totalConstituencies} className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 size={16} /> Start campaign</button></StartSlot>
      <section>
        <p className="text-sm font-medium text-brand">Lok Sabha · {game.electionYear}</p>
        <div className="mt-2 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h2 className="font-heading text-2xl font-semibold">State-wise seat sharing</h2>
            <p className="mt-2 max-w-4xl text-muted-foreground">Choose a state where {game.playerPartyId} has a foothold, distribute all constituencies among your eligible alliance partners, and let the AI allocate seats for other alliances independently.</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-5 py-3"><p className="text-xs text-muted-foreground">Constituencies with allocations</p><p className="mt-1 text-2xl font-bold">{allocated} / {game.totalConstituencies}</p></div>
        </div>

        {message && <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground/80">{message}<button onClick={() => setMessage("")} className="float-right">×</button></p>}

        <section className="mt-7">
          <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="text-xl font-bold">1. Your party&apos;s foothold states</h2><p className="mt-1 text-sm text-muted-foreground">Only states where your selected party is eligible are shown here.</p></div><span className="text-sm text-muted-foreground">{playerStates.length} regions</span></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {playerStates.map((state) => {
              const seatCount = game.constituencies.filter((seat) => seat.state === state).length;
              const status = getPlayerSeatShareStatus(game, state);
              const group = game.stateAllianceGroups[state]?.find((item) => item.isPlayerAlliance);
              return <button key={state} onClick={() => { setActiveState(state); setShowResults(false); }} className={`rounded-xl border p-4 text-left transition ${activeState === state ? "border-brand bg-brand/10" : "border-border bg-card hover:border-brand/50"}`}>
                <div className="flex items-center justify-between"><span className="font-bold">{state}</span><MapPin size={17} className="text-brand"/></div>
                <p className="mt-2 text-2xl font-bold tabular-nums">{seatCount} <span className="text-sm font-normal text-muted-foreground">seats</span></p>
                <p className="mt-2 text-xs text-muted-foreground">{group?.memberPartyIds.length ?? 0} eligible partners in your alliance</p>
                <p className={`mt-3 text-xs font-semibold ${status.valid ? "text-success" : "text-amber-600 dark:text-amber-300"}`}>{status.assigned}/{status.total} seats shared</p>
              </button>;
            })}
          </div>
        </section>

        {activeState && playerGroup && (
          <section className="mt-7 rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div><p className="text-xs font-semibold uppercase tracking-wider text-brand">Player alliance</p><h2 className="mt-1 text-2xl font-bold">{activeState} — {playerGroup.name}</h2><p className="mt-1 text-sm text-muted-foreground">Use the sliders to share all {activeStateSeats.length} constituencies among your alliance parties.</p></div>
              <div className="rounded-lg bg-background px-4 py-3"><p className="text-xs text-muted-foreground">Seat sharing total</p><p className="text-xl font-bold tabular-nums">{shareStatus?.assigned ?? 0} / {activeStateSeats.length}</p></div>
            </div>

            <div className="mt-6 space-y-5">
              {playerGroup.memberPartyIds.map((partyId) => {
                const party = parties.find((item) => item.id === partyId);
                const strength = getPartyStrength(partyId, activeState);
                const currentShares = game.playerSeatShares[activeState] ?? {};
                const value = currentShares[partyId] ?? 0;
                const seatsUsedByOthers = playerGroup.memberPartyIds
                  .filter((otherPartyId) => otherPartyId !== partyId)
                  .reduce((sum, otherPartyId) => sum + Math.max(0, currentShares[otherPartyId] ?? 0), 0);
                const maxForParty = Math.max(0, activeStateSeats.length - seatsUsedByOthers);
                return <div key={partyId} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">{party?.name ?? partyId}</h3><p className="text-xs text-muted-foreground">{partyId} · {strength === null ? "Strength fallback (not specified in KT file)" : `${Math.round(strength * 100)}% regional strength`}</p></div><div className="text-right"><span className="text-2xl font-bold tabular-nums">{value}</span><span className="ml-1 text-sm text-muted-foreground">seats</span></div></div>
                  <input type="range" min={0} max={maxForParty} step={1} value={Math.min(value, maxForParty)} onChange={(event) => changeShare(activeState, partyId, Number(event.target.value))} className="mt-4 w-full accent-[var(--brand)]" aria-label={`${partyId} seat share in ${activeState}`} />
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>0 seats</span><span>{maxForParty} available seats</span></div>
                </div>;
              })}
            </div>

            <div className={`mt-5 flex items-start gap-3 rounded-lg p-4 text-sm ${shareStatus?.valid ? "bg-success/10 text-success" : "bg-amber-500/10 text-amber-700 dark:text-amber-200"}`}>
              {shareStatus?.valid ? <CheckCircle2 size={18}/> : <AlertCircle size={18}/>}
              <div>{shareStatus?.valid ? "All constituencies are assigned within your alliance." : (shareStatus?.remaining ?? 0) < 0 ? `${Math.abs(shareStatus?.remaining ?? 0)} seats are over-allocated. Reduce a party's slider until the total equals ${activeStateSeats.length}.` : `${shareStatus?.remaining} seats remain to be shared. Adjust the sliders until the total equals ${activeStateSeats.length}.`}</div>
            </div>
          </section>
        )}

        {activeState && (
          <section className="mt-7 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2"><Users className="text-brand" size={19}/><h2 className="text-lg font-bold">AI seat-sharing preview — {activeState}</h2></div>
            <p className="mt-1 text-sm text-muted-foreground">Other alliances independently share all constituencies among their eligible members, weighted by regional strength.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {previews.filter((item) => !item.group.isPlayerAlliance).map(({ group, shares, isFallback }) => (
                <article key={group.id} className="rounded-lg border border-border bg-background p-4"><h3 className="font-semibold">{group.name}</h3><p className="mt-1 text-xs text-muted-foreground">{group.type === "INDEPENDENT" ? "Independent" : "AI-formed / configured alliance"}{isFallback ? " · includes fallback strength" : ""}</p><div className="mt-3 space-y-2">{Object.entries(shares).map(([partyId, count]) => <div key={partyId} className="flex justify-between gap-2 text-sm"><span>{partyId}</span><b className="tabular-nums">{count} seats</b></div>)}</div></article>
              ))}
            </div>
          </section>
        )}

        <div className="mt-7 flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center">
          <div><h2 className="font-bold">2. Randomly assign constituencies</h2><p className="mt-1 text-sm text-muted-foreground">Every alliance independently contests all seats in its eligible states. Different alliances can be assigned to the same constituency.</p></div>
          <button onClick={runAllocation} disabled={!allPlayerSharesValid} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand text-brand-foreground px-5 py-3 font-semibold hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"><Shuffle size={17}/> Randomly Allocate Constituencies</button>
        </div>
        {!allPlayerSharesValid && <p className="mt-2 text-sm text-amber-600 dark:text-amber-300">Complete seat sharing in every state where your party has a foothold before random allocation.</p>}

        {showResults && (
          <section className="mt-8">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-xl font-bold">3. Constituency allocation results</h2><p className="mt-1 text-sm text-muted-foreground">A constituency can have one contestant from each alliance. Search to inspect the random assignments.</p></div><div className="grid gap-2 sm:grid-cols-2"><select value={resultStateFilter} onChange={(event) => setResultStateFilter(event.target.value)} className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm"><option value="ALL">All states / UTs</option>{Array.from(new Set(game.constituencies.map((seat) => seat.state))).sort().map((state) => <option key={state} value={state}>{state}</option>)}</select><label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3"><Search size={16} className="text-muted-foreground"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search constituency" className="w-full bg-transparent py-2.5 text-sm outline-none"/></label></div></div>
            <div className="mt-4 space-y-3">{filteredSeats.map((seat) => <article key={seat.constituencyId} className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{seat.name}</h3><p className="text-xs text-muted-foreground">{seat.state} · {seat.registeredElectors.toLocaleString("en-IN")} registered electors</p></div><span className="text-xs text-muted-foreground">{seat.allocations.length} contestants</span></div><div className="mt-3 flex flex-wrap gap-2">{seat.allocations.map((allocation) => <span key={`${allocation.allianceId}:${allocation.partyId}`} className="rounded-lg border border-border bg-muted px-3 py-2 text-sm"><b>{allocation.partyId}</b><span className="ml-2 text-xs text-muted-foreground">{allocation.allianceName}</span></span>)}</div></article>)}</div>
          </section>
        )}
          <div className="mt-8 flex justify-end rounded-xl border border-border bg-card p-5">
          <button
            type="button"
            onClick={startCampaign}
            disabled={
              !showResults ||
              !allPlayerSharesValid ||
              allocated !== game.totalConstituencies
            }
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand text-brand-foreground px-6 py-3 font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCircle2 size={18} />
            Start Campaign
          </button>
        </div>
      </section>
    </div>
  );
}
