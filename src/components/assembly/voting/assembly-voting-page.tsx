"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ElectionMap } from "@/components/map/election-map";
import { AssemblyExitPollDrawer } from "./assembly-exit-poll";
import { POLL_MS, useReveal, type Speed } from "@/components/voting/use-reveal";
import { Notice, SpeedControl, PhaseStrip, ProgressPanel, UpdatesFeed, VotingHeader, type PhaseCard } from "@/components/voting/voting-parts";
import { loadAssemblyCampaign } from "@/engine/assembly-campaign-engine";
import {
  loadAssemblyGame,
  saveAssemblyGame,
  type AssemblyGameSave,
} from "@/engine/assembly-game-engine";
import {
  loadAssemblyVoting,
  runAssemblyVoting,
  saveAssemblyVoting,
  type AssemblyVotingSave,
} from "@/engine/assembly-voting-engine";
import type { LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";

/** The regions of the state in polling order, each with its seats. */
function regionPlan(game: AssemblyGameSave) {
  const names = new Map(game.allocation.regionalShares.map((share) => [share.regionId, share.regionName]));
  const byRegion = new Map<string, string[]>();
  for (const seat of game.constituencies) byRegion.set(seat.regionId, [...(byRegion.get(seat.regionId) ?? []), seat.id]);
  return [...byRegion].map(([regionId, ids]) => ({ regionId, name: names.get(regionId) ?? regionId, ids }));
}

export default function AssemblyVotingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [game, setGame] = useState<AssemblyGameSave | null>(null);
  const [campaign, setCampaign] = useState<LokSabhaCampaignSave | null>(null);
  const [voting, setVoting] = useState<AssemblyVotingSave | null>(null);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState<Speed>("normal");
  const { revealed, revealingPhase, reveal, setAll } = useReveal(speed);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [exitOpen, setExitOpen] = useState(false);

  // Polling rolls across the state one region at a time: the region shows as polling, then its seats light up.
  useEffect(() => {
    if (!running || !game || revealingPhase !== null) return;
    const plan = regionPlan(game);
    if (step >= plan.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ends the animation once every region has lit up
      setRunning(false);
      return;
    }
    const timer = window.setTimeout(() => {
      reveal(plan[step].ids, step + 1);
      setStep(step + 1);
    }, POLL_MS[speed]);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reveal is recreated every render; the timer follows the step only
  }, [running, step, revealingPhase, speed, game]);

  useEffect(() => {
    const saved = loadAssemblyGame();
    if (!saved) {
      router.replace("/elections/assembly/new-game");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates client-only saved state after mount (localStorage is unavailable during SSR)
    setGame(saved);
    setCampaign(loadAssemblyCampaign(saved.gameId));
    const savedVoting = loadAssemblyVoting(saved.gameId);
    setVoting(savedVoting);
    setAll(savedVoting?.results.map((r) => r.constituencyId) ?? []);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setAll is only used to seed the map once
  }, [router]);

  const wrap = "mx-auto max-w-[1280px] px-6 py-8";
  if (!ready || !game) {
    return <main className={wrap}><p className="text-sm text-muted-foreground">Loading voting session…</p></main>;
  }

  if (!campaign || campaign.status !== "LOCKED") {
    return (
      <main className={wrap}>
        <section className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="font-heading text-xl font-semibold">Campaign must be finished first</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Complete all 8 campaign weeks and continue from the final campaign report before polling day.
          </p>
          <Button asChild className="mt-5"><Link href="/elections/assembly/campaign">Return to campaign</Link></Button>
        </section>
      </main>
    );
  }

  const done = voting?.status === "COMPLETED";
  const revealingNow = revealingPhase !== null;
  const animating = running || revealingNow;
  const finished = done && !animating;

  function castVotes() {
    setError("");
    try {
      const result = runAssemblyVoting(game!, campaign!);
      saveAssemblyVoting(result);
      saveAssemblyGame({ ...game!, status: "RESULTS" });
      setVoting(result);
      setStep(0);
      setRunning(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Voting could not be completed.");
    }
  }

  const total = game.totalConstituencies;
  const results = voting?.results ?? [];
  const shown = results.filter((r) => revealed.has(r.constituencyId));
  const electors = shown.reduce((n, r) => n + r.registeredElectors, 0);
  const turnout = electors ? (shown.reduce((n, r) => n + r.registeredElectors * r.turnoutRate, 0) / electors) * 100 : null;
  const nameById = new Map(game.constituencies.map((c) => [c.id, c.name]));
  const turnoutById = new Map(shown.map((r) => [r.constituencyId, r.turnoutRate]));
  const plan = regionPlan(game);
  const regionOf = new Map(plan.flatMap((r, i) => r.ids.map((id) => [id, i] as const)));
  const pollingIndex = revealingPhase !== null ? revealingPhase - 1 : running && step < plan.length ? step : -1;
  const cards: PhaseCard[] = plan.map((r, i) => ({
    id: i + 1,
    name: r.name,
    seats: r.ids.length,
    status: i === pollingIndex ? "polling" : r.ids.every((id) => revealed.has(id)) && r.ids.length > 0 ? "done" : "pending",
  }));
  const updates = plan
    .map((r, i) => (cards[i].status === "done" ? `${r.name}: polling completed · ${r.ids.length} seats.` : ""))
    .filter(Boolean)
    .reverse();
  if (pollingIndex >= 0) updates.unshift(`Polling is under way in ${plan[pollingIndex].name}.`);
  if (finished) updates.unshift(`Polling closed: all ${results.length} constituencies in ${game.state} have voted.`);

  return (
    <main className={`${wrap} space-y-5`}>
      <VotingHeader
        title="Voting"
        subtitle={finished
          ? `Polling is over in all ${plan.length} regions of ${game.state}. Results stay sealed until you open them.`
          : `${game.state}: voting takes place in a single day. Polling rolls across the state region by region. Vote totals and winners stay sealed until it closes.`}
        action={finished
          ? <>
              <Button size="lg" onClick={() => setExitOpen(true)} className="bg-brand text-brand-foreground hover:bg-brand/90">Exit poll</Button>
              <Button size="lg" variant="outline" asChild><Link href="/elections/assembly/results">View election results →</Link></Button>
            </>
          : <>{animating && <SpeedControl speed={speed} onChange={setSpeed} />}<Button disabled={animating || done} onClick={castVotes}>{animating ? "Polling…" : "Start voting"}</Button></>}
      />
      {error && <Notice tone="error">{error}</Notice>}
      <PhaseStrip phases={cards} />
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <ElectionMap
          kind="assembly"
          state={game.state}
          title="Polling map"
          fill={(id) => (revealed.has(id) ? "var(--success)" : regionOf.get(id) === pollingIndex ? "var(--brand)" : "var(--muted)")}
          label={(id) => {
            const t = turnoutById.get(id);
            return `${nameById.get(id) ?? id}${typeof t !== "number" ? " · pending" : ` · turnout ${(t * 100).toFixed(1)}%`}`;
          }}
          legend={[{ color: "var(--success)", label: "Polled" }, { color: "var(--brand)", label: "Polling now" }, { color: "var(--muted)", label: "Pending" }]}
          overlay={exitOpen && finished ? <AssemblyExitPollDrawer game={game} results={results} onClose={() => setExitOpen(false)} /> : null}
        />
        <div className="space-y-5">
          <ProgressPanel polled={revealed.size} total={total} turnout={turnout} />
          <UpdatesFeed items={updates} />
        </div>
      </div>
      {finished && <Notice tone="info">Voting is complete. All {total} constituencies have voted. Open the exit poll to see the projected seats, or go straight to the results.</Notice>}
      <p className="text-xs text-muted-foreground">Voting data is saved locally for this game. <Link href="/elections/assembly/campaign" className="underline underline-offset-4">Campaign report</Link></p>
    </main>
  );
}
