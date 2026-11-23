"use client";

import { StartSlot } from "@/components/setup/start-slot";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import regionsData from "@/data/assembly-regions-2024.json";
import constituenciesData from "@/data/assembly-constituencies-2024.json";
import partiesData from "@/data/parties.json";
import {
  createAssemblySeatAllocation,
  toggleConstituencySelection,
  validateAssemblySeatAllocation,
  type AssemblyRegionState,
  type RegionalSeatShare,
} from "@/engine/assembly-seat-allocation-engine";
import type { AssemblyConstituency } from "@/types/constituency";
import { createAssemblyGame, saveAssemblyGame, generateAssemblyField, planAssemblyAiSeats, type AssemblyField } from "@/engine/assembly-game-engine";

type Setup = {
  state: string;
  playerPartyId: string;
  allianceType: "alliance" | "independent";
  allianceName: string;
  partyIds: string[];
  allianceColor?: string;
};

const regions = regionsData as { states: AssemblyRegionState[] };
const constituencies = (constituenciesData as { constituencies: AssemblyConstituency[] }).constituencies;
const parties = partiesData.parties as { id: string; name: string }[];

/**
 * Redistribute a region's fixed seat pool when one party's slider moves.
 * The edited party keeps the requested value; all other parties share the
 * remaining seats proportionally (largest-remainder rounding).
 */
function getLinkedPartyShares(
  partyIds: string[],
  current: Record<string, number>,
  changedPartyId: string,
  requestedSeats: number,
  totalSeats: number
): Record<string, number> {
  const changedSeats = Math.max(0, Math.min(totalSeats, Math.round(requestedSeats)));
  const otherIds = partyIds.filter((id) => id !== changedPartyId);
  const remaining = totalSeats - changedSeats;
  const weights = otherIds.map((id) => Math.max(0, current[id] ?? 0));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const effectiveWeights = weightTotal > 0
    ? weights
    : otherIds.map(() => 1);
  const effectiveTotal = effectiveWeights.reduce((sum, weight) => sum + weight, 0);

  const result: Record<string, number> = { [changedPartyId]: changedSeats };
  if (otherIds.length === 0) return result;

  const exact = effectiveWeights.map((weight) => effectiveTotal > 0 ? remaining * weight / effectiveTotal : 0);
  const base = exact.map((value) => Math.floor(value));
  const seatsLeft = remaining - base.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - base[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < seatsLeft; i += 1) base[order[i % order.length].index] += 1;

  otherIds.forEach((id, index) => { result[id] = base[index]; });
  return result;
}

/** Fisher-Yates shuffle. Only called from event handlers, never during render. */
function shuffleIds(ids: string[]) {
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function AssemblySeatStep() {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [activeRegion, setActiveRegion] = useState("");
  const [activeParty, setActiveParty] = useState("");
  const [shares, setShares] = useState<Record<string, Record<string, number>>>({});
  const [allocation, setAllocation] = useState<ReturnType<typeof createAssemblySeatAllocation> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [aiField, setAiField] = useState<AssemblyField | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("assemblyGameSetup");
      if (!saved) return;
      const parsed = JSON.parse(saved) as Setup;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initialises the allocation once the saved setup is available
      setSetup(parsed);
      setActiveParty(parsed.playerPartyId);
    } catch { setNotice("Could not read the game setup. Please return and configure the game again."); }
  }, []);

  const stateData = useMemo(
    () => setup ? regions.states.find((item) => item.state === setup.state) : undefined,
    [setup]
  );

  useEffect(() => {
    if (!stateData || !setup || allocation) return;
    const initial: Record<string, Record<string, number>> = {};
    const sharePlans: RegionalSeatShare[] = stateData.regions.map((region) => {
      const partiesInGame = setup.partyIds;
      const each = Math.floor(region.constituencyIds.length / partiesInGame.length);
      const remainder = region.constituencyIds.length % partiesInGame.length;
      initial[region.id] = Object.fromEntries(partiesInGame.map((id, index) => [id, each + (index < remainder ? 1 : 0)]));
      return {
        regionId: region.id,
        regionName: region.name,
        totalSeats: region.constituencyIds.length,
        partyShares: partiesInGame.map((partyId) => ({ partyId, seats: initial[region.id][partyId] })),
      };
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initialises the allocation once the saved setup is available
    setShares(initial);
    // The rival alliances are drawn once here, so what is shown below is exactly the field the game will use.
    setAiField(generateAssemblyField(
      { state: setup.state, playerPartyId: setup.playerPartyId, allianceName: setup.allianceName, partyIds: setup.partyIds },
      stateData.regions.reduce((n, r) => n + r.constituencyIds.length, 0),
    ));
    setActiveRegion(stateData.regions[0]?.id ?? "");
    setAllocation(createAssemblySeatAllocation(stateData, setup.partyIds, sharePlans));
  }, [stateData, setup, allocation]);

  useEffect(() => {
    if (!activeRegion || !setup) return;
    const activeQuota = shares[activeRegion]?.[activeParty] ?? 0;
    if (activeQuota > 0) return;
    const nextParty = setup.partyIds.find((id) => (shares[activeRegion]?.[id] ?? 0) > 0);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keeps the active party valid when seat quotas change
    if (nextParty && nextParty !== activeParty) setActiveParty(nextParty);
  }, [activeRegion, activeParty, shares, setup]);

  const aiPlans = useMemo(
    () => aiField && stateData
      ? planAssemblyAiSeats(aiField, stateData.state, stateData.regions.map((r) => ({ id: r.id, name: r.name, seatCount: r.constituencyIds.length })))
      : [],
    [aiField, stateData],
  );
  const currentRegion = stateData?.regions.find((item) => item.id === activeRegion);
  const regionSeats = currentRegion
    ? currentRegion.constituencyIds.map((id) => constituencies.find((item) => item.id === id)).filter(Boolean) as AssemblyConstituency[]
    : [];
  const currentSelection = allocation?.regionalAllocations.find((item) => item.regionId === activeRegion);
  const selectedForParty = currentSelection?.selections.find((item) => item.partyId === activeParty)?.constituencyIds ?? [];
  const partyQuota = shares[activeRegion]?.[activeParty] ?? 0;

  function updateShare(regionId: string, partyId: string, value: number) {
    if (!stateData || !setup || !allocation) return;
    const region = stateData.regions.find((item) => item.id === regionId);
    if (!region) return;

    const total = region.constituencyIds.length;
    const old = shares[regionId] ?? {};
    const nextRegionShares = getLinkedPartyShares(setup.partyIds, old, partyId, value, total);

    const nextShares = { ...shares, [regionId]: nextRegionShares };
    setShares(nextShares);

    // If a quota shrinks, keep only the earliest existing manual selections up to
    // the new quota. The remaining seats can be filled randomly afterward.
    const currentRegionAllocation = allocation.regionalAllocations.find((item) => item.regionId === regionId);
    let nextAllocation = allocation;
    if (currentRegionAllocation) {
      const retained = currentRegionAllocation.selections.map((selection) => ({
        ...selection,
        constituencyIds: selection.constituencyIds.slice(0, nextRegionShares[selection.partyId] ?? 0),
      }));
      nextAllocation = {
        ...allocation,
        regionalAllocations: allocation.regionalAllocations.map((item) =>
          item.regionId === regionId ? { ...item, selections: retained } : item
        ),
      };
    }
    nextAllocation = {
      ...nextAllocation,
      regionalShares: nextAllocation.regionalShares.map((item) => item.regionId !== regionId ? item : ({
        ...item,
        partyShares: setup.partyIds.map((id) => ({ partyId: id, seats: nextRegionShares[id] ?? 0 })),
      })),
    };
    setAllocation(nextAllocation);
    setConfirmed(false);
  }

  function toggleSeat(id: string) {
    if (!allocation || !currentRegion || partyQuota <= 0) return;
    if (!selectedForParty.includes(id) && selectedForParty.length >= partyQuota) return;
    setAllocation(toggleConstituencySelection(allocation, activeRegion, activeParty, id));
    setConfirmed(false);
  }

  function fillRegionRandomly(regionId: string, source: NonNullable<typeof allocation>, clearFirst = false): NonNullable<typeof allocation> {
    if (!stateData || !setup) return source;
    const region = stateData.regions.find((item) => item.id === regionId);
    if (!region) return source;

    let next = source;
    if (clearFirst) {
      const regionAllocation = next.regionalAllocations.find((item) => item.regionId === regionId);
      if (regionAllocation) {
        next = {
          ...next,
          regionalAllocations: next.regionalAllocations.map((item) =>
            item.regionId === regionId
              ? { ...item, selections: item.selections.map((selection) => ({ ...selection, constituencyIds: [] })) }
              : item
          ),
        };
      }
    }

    const regionAllocation = next.regionalAllocations.find((item) => item.regionId === regionId);
    const assigned = new Set(
      regionAllocation?.selections.flatMap((selection) => selection.constituencyIds) ?? []
    );
    for (const partyId of setup.partyIds) {
      const quota = shares[regionId]?.[partyId] ?? 0;
      if (quota <= 0) continue;
      const already = next.regionalAllocations.find((r) => r.regionId === regionId)
        ?.selections.find((selection) => selection.partyId === partyId)?.constituencyIds ?? [];
      const needed = Math.max(0, quota - already.length);
      const candidates = shuffleIds(region.constituencyIds.filter((id) => !assigned.has(id)));
      for (const id of candidates.slice(0, needed)) {
        next = toggleConstituencySelection(next, regionId, partyId, id);
        assigned.add(id);
      }
    }
    return next;
  }

  function distributeSelections() {
    if (!stateData || !allocation) return;
    let next = allocation;
    for (const region of stateData.regions) {
      next = fillRegionRandomly(region.id, next);
    }
    setAllocation(next);
    setConfirmed(false);
    setNotice("Randomly filled all remaining constituency selections. You can still make manual changes.");
  }

  function rerandomizeCurrentRegion() {
    if (!currentRegion || !allocation) return;
    const next = fillRegionRandomly(currentRegion.id, allocation, true);
    setAllocation(next);
    setConfirmed(false);
    setNotice(`Randomized constituency assignments again for ${currentRegion.name}.`);
  }

  const validation = stateData && allocation
    ? validateAssemblySeatAllocation({ stateData, allocation, requireComplete: true })
    : null;
  const totalStateSeats = stateData?.regions.reduce((sum, item) => sum + item.constituencyIds.length, 0) ?? 0;
  const partyName = (id: string) => parties.find((p) => p.id === id)?.name ?? id;

  if (!setup) return <p className="text-muted-foreground">{notice || "Loading game setup..."}</p>;
  if (!stateData || !allocation) return <p className="text-muted-foreground">Regional constituency data not found for {setup.state}.</p>;

  const startCampaign = () => {
            try {
              const game = createAssemblyGame({
                setup: {
                  state: setup.state,
                  playerPartyId: setup.playerPartyId,
                  allianceName: setup.allianceName,
                  partyIds: setup.partyIds,
                  allianceColor: setup.allianceColor,
                },
                allocation,
                stateData,
                constituencies,
                field: aiField ?? undefined,
              });
              saveAssemblyGame(game);
              sessionStorage.setItem("assemblySeatAllocation", JSON.stringify({ setup, allocation }));
              setConfirmed(true);
              setNotice("Election created and saved. Opening your full-state Assembly game...");
              router.push("/elections/assembly/campaign");
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Unable to start the Assembly election.");
            }
          };

  return (
    <div>
      <StartSlot><button type="button" disabled={!validation?.valid} onClick={startCampaign} className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 size={16}/> Start campaign</button></StartSlot>
      <section>
        <h2 className="font-heading text-2xl font-semibold">Regional seat allocation</h2>
        <p className="mt-2 text-muted-foreground">{setup.state} · {setup.allianceName} · One complete Assembly election</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Total Assembly seats</p><b className="text-2xl">{totalStateSeats}</b></div>
          <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Regions</p><b className="text-2xl">{stateData.regions.length}</b></div>
          <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Participating parties</p><b className="text-2xl">{setup.partyIds.length}</b></div>
        </div>

        <section className="mt-7 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-xl font-bold">1. Regional seat-sharing</h2>
          <p className="mt-1 text-sm text-muted-foreground">Adjust any party&apos;s slider. The other parties automatically share the remaining seats proportionally, keeping each region&apos;s total fixed.</p>
          <div className="mt-5 space-y-4">
            {stateData.regions.map((region) => {
              const total = region.constituencyIds.length;
              const allocated = setup.partyIds.reduce((sum, id) => sum + (shares[region.id]?.[id] ?? 0), 0);
              return (
                <div key={region.id} className="rounded-xl border border-border bg-background p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <b>{region.name}</b>
                    <span className="text-sm text-muted-foreground">{allocated} / {total} seats shared</span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {setup.partyIds.map((id) => (
                      <div key={id} className="min-w-0">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <label htmlFor={`share-${region.id}-${id}`} className="text-sm font-semibold">{partyName(id)}</label>
                          <span className="text-lg font-bold tabular-nums">{shares[region.id]?.[id] ?? 0} <span className="text-xs font-normal text-muted-foreground">seats</span></span>
                        </div>
                        <input
                          id={`share-${region.id}-${id}`}
                          type="range"
                          disabled={setup.partyIds.length === 1}
                          min="0"
                          max={total}
                          step="1"
                          value={shares[region.id]?.[id] ?? 0}
                          onChange={(event) => updateShare(region.id, id, Number(event.target.value))}
                          className="h-2 w-full cursor-pointer accent-[var(--brand)]"
                          aria-label={`${partyName(id)} seat quota in ${region.name}`}
                        />
                        <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>0 seats</span><span>{total} available seats</span></div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">{stateData.regions.map((r) => {
            const sum = setup.partyIds.reduce((n,id) => n + (shares[r.id]?.[id] ?? 0),0);
            const good = sum === r.constituencyIds.length;
            return <button key={r.id} onClick={() => setActiveRegion(r.id)} className={`rounded-lg border px-3 py-2 text-sm ${activeRegion===r.id ? "border-brand bg-brand/10" : "border-border"}`}>{r.name} · {sum}/{r.constituencyIds.length} {good ? "✓" : "!"}</button>;
          })}</div>
        </section>

        {currentRegion && (
          <section className="mt-7 rounded-2xl border border-border bg-card p-5">
            <h2 className="text-lg font-bold">Other alliances in {currentRegion.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Every other alliance contests all {currentRegion.constituencyIds.length} seats of this region and shares them among its parties by regional strength. Pick a region above to see its split; the state total is shown beside each party.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {aiPlans.map(({ group, regions: planRegions, stateShares, isFallback }) => {
                const here = planRegions.find((r) => r.regionId === currentRegion.id);
                return (
                  <article key={group.id} className="rounded-lg border border-border bg-background p-4">
                    <h3 className="font-semibold">{group.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{group.type === "INDEPENDENT" ? "Independent" : "AI-formed / configured alliance"}{isFallback ? " · includes fallback strength" : ""}</p>
                    <div className="mt-3 space-y-2">
                      {Object.entries(here?.shares ?? {}).map(([partyId, count]) => (
                        <div key={partyId} className="flex justify-between gap-2 text-sm">
                          <span>{partyName(partyId)}</span>
                          <span><b className="tabular-nums">{count} seats</b> <span className="text-xs text-muted-foreground">· state {stateShares[partyId] ?? 0}</span></span>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
            {aiField && aiPlans.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No other alliance contests this state.</p>}
          </section>
        )}

        <section className="mt-7 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">2. Select constituencies</h2><p className="mt-1 text-sm text-muted-foreground">{currentRegion?.name}: choose exactly each party&apos;s seat quota.</p></div><div className="flex flex-wrap gap-2">
            <button onClick={distributeSelections} className="rounded-lg border border-brand/50 px-3 py-2 text-sm text-brand">Auto-fill remaining selections</button>
            <button onClick={rerandomizeCurrentRegion} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground/80">Re-randomize this region</button>
          </div></div>
          <div className="mt-4 flex flex-wrap gap-2">{setup.partyIds.map((id) => {
            const quota = shares[activeRegion]?.[id] ?? 0;
            const selectedCount = currentSelection?.selections.find((selection) => selection.partyId === id)?.constituencyIds.length ?? 0;
            const disabled = quota === 0;
            return <button
              key={id}
              type="button"
              onClick={() => setActiveParty(id)}
              disabled={disabled}
              title={disabled ? `${partyName(id)} has no seats allocated in ${currentRegion?.name ?? "this region"}` : undefined}
              className={`rounded-lg px-4 py-2 text-sm transition ${disabled ? "cursor-not-allowed bg-muted text-muted-foreground/60 opacity-50" : activeParty===id ? "bg-brand text-brand-foreground font-semibold" : "bg-muted hover:bg-accent"}`}
            >
              {partyName(id)} · {selectedCount} / {quota}
            </button>;
          })}</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{regionSeats.map((seat) => {
            const owner = currentSelection?.selections.find((s) => s.constituencyIds.includes(seat.id))?.partyId;
            const selected = selectedForParty.includes(seat.id);
            return <button key={seat.id} onClick={() => toggleSeat(seat.id)} disabled={partyQuota === 0 || Boolean(owner && owner!==activeParty) || (!selected && selectedForParty.length>=partyQuota)} className={`rounded-lg border p-3 text-left text-sm ${selected ? "border-brand bg-brand/10" : owner ? "border-border/50 bg-background opacity-50" : "border-border bg-background hover:border-brand/50"}`}><span className="block font-semibold">{seat.name}</span><span className="text-xs text-muted-foreground">{selected ? "Selected for this party" : owner ? `Allocated to ${partyName(owner)}` : "Available"}</span></button>;
          })}</div>
        </section>

        <section className="mt-7 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-xl font-bold">3. Review and confirm</h2>
          <p className="mt-1 text-sm text-muted-foreground">The allocation is for one election across all {totalStateSeats} constituencies, not separate regional elections.</p>
          <div className="mt-4 space-y-2">{stateData.regions.map((region) => <div key={region.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-background p-3 text-sm"><b>{region.name}</b><span>{region.constituencyIds.length} seats · {allocation.regionalAllocations.find((r) => r.regionId===region.id)?.selections.reduce((sum,s)=>sum+s.constituencyIds.length,0) ?? 0} assigned</span></div>)}</div>
          {validation && <div className={`mt-4 rounded-lg p-3 text-sm ${validation.valid ? "bg-success/10 text-success" : "bg-amber-500/10 text-amber-700 dark:text-amber-200"}`}>{validation.valid ? `All ${totalStateSeats} seats are assigned exactly once.` : `${validation.issues.length} allocation issue(s) remain. Complete every regional quota without assigning a constituency twice.`}</div>}
          {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
          <button disabled={!validation?.valid} onClick={startCampaign} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground px-5 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 size={18}/> Start Campaign</button>
          {confirmed && <p className="mt-3 text-sm text-success">The full-state election has been created.</p>}
        </section>
      </section>
    </div>
  );
}
