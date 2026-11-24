"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadLokSabhaCampaign } from "@/engine/lok-sabha-campaign-engine";
import { loadLokSabhaGame } from "@/engine/lok-sabha-game-engine";
import { createVotingSave, getVotingSchedule, LOK_SABHA_VOTING_SAVE_KEY, runVotingPhase } from "@/engine/lok-sabha-voting-engine";
import { Button } from "@/components/ui/button";
import { ElectionMap } from "@/components/map/election-map";
import { ExitPollDrawer } from "@/components/voting/exit-poll-drawer";
import { buildExitPoll } from "@/lib/exit-poll";
import { majorityMark } from "@/types/campaign-profile";
import { POLL_MS, useReveal, type Speed } from "@/components/voting/use-reveal";
import { Notice, SpeedControl, PhaseStrip, ProgressPanel, UpdatesFeed, VotingHeader, type PhaseCard } from "@/components/voting/voting-parts";
import type { LokSabhaVotingSave } from "@/types/lok-sabha-voting";

const schedule = getVotingSchedule();

export default function LokSabhaVotingPage() {
  const [ready, setReady] = useState(false);
  const [game, setGame] = useState<ReturnType<typeof loadLokSabhaGame>>(null);
  const [campaign, setCampaign] = useState<ReturnType<typeof loadLokSabhaCampaign>>(null);
  const [voting, setVoting] = useState<LokSabhaVotingSave | null>(null);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  const [speed, setSpeed] = useState<Speed>("normal");
  const [exitOpen, setExitOpen] = useState(false);
  const { revealed, revealingPhase, reveal, setAll } = useReveal(speed);

  useEffect(() => {
    const activeGame = loadLokSabhaGame();
    const activeCampaign = activeGame ? loadLokSabhaCampaign(activeGame.gameId) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates client-only saved state after mount (localStorage is unavailable during SSR)
    setGame(activeGame);
    setCampaign(activeCampaign);
    if (activeGame && activeCampaign) {
      try {
        const raw = localStorage.getItem(LOK_SABHA_VOTING_SAVE_KEY);
        const saved = raw ? JSON.parse(raw) as LokSabhaVotingSave : null;
        const valid = saved?.schemaVersion === 1 && saved.gameId === activeGame.gameId && saved.scheduleId === schedule.scheduleId;
        const initial = valid ? saved : createVotingSave(activeGame);
        setVoting(initial);
        setAll(initial.phaseResults.flatMap(p => p.constituencyResults.map(r => r.constituencyId)));
        localStorage.setItem(LOK_SABHA_VOTING_SAVE_KEY, JSON.stringify(initial));
      } catch { setError("Unable to load the voting save. Please refresh and try again."); }
    }
    setReady(true);
  }, []);

  const total = schedule.totalConstituencies;
  const currentPhase = schedule.phases.find(p => p.phase === voting?.currentPhase);
  const phaseDone = voting?.status === "COMPLETED";
  const phaseStateRows = useMemo(() => currentPhase?.regions.map(region => ({
    name: region.name,
    count: region.constituencyIds.length,
  })) ?? [], [currentPhase]);

  // Built only once every phase is done. Same game, same exit poll, so reopening it never changes the numbers.
  const exitPoll = useMemo(() => {
    if (!game || voting?.status !== "COMPLETED") return null;
    return buildExitPoll({
      gameId: game.gameId,
      results: voting.phaseResults.flatMap((p) => p.constituencyResults),
      groupsByState: game.stateAllianceGroups ?? {},
      playerAllianceName: game.alliance.name,
      majority: majorityMark(schedule.totalConstituencies),
    });
  }, [game, voting]);
  const pollStates = useMemo(() => Object.keys(exitPoll?.states ?? {}).sort(), [exitPoll]);

  function completeCurrentPhase() {
    if (!game || !campaign || !voting) return;
    try {
      setError("");
      const phaseNo = voting.currentPhase;
      const next = runVotingPhase(game, campaign, voting);
      localStorage.setItem(LOK_SABHA_VOTING_SAVE_KEY, JSON.stringify(next));
      setVoting(next);
      reveal(schedule.phases.find(p => p.phase === phaseNo)?.regions.flatMap(r => r.constituencyIds) ?? [], phaseNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voting phase could not be completed.");
    }
  }

  // After the single Start button, each phase shows as "polling", then its seats light up on the map one after another.
  // The effect only reads voting.currentPhase, so it re-arms once per completed phase.
  useEffect(() => {
    if (!started || !game || !campaign || !voting || voting.status === "COMPLETED" || error || revealingPhase !== null) return;
    const timer = window.setTimeout(completeCurrentPhase, POLL_MS[speed]);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- completeCurrentPhase is recreated every render; the timer must follow the phase only
  }, [started, voting?.currentPhase, voting?.status, error, game, campaign, revealingPhase, speed]);

  const wrap = "mx-auto max-w-[1280px] px-6 py-8";
  const gate = (title: string, text: string, href: string, label: string) => (
    <main className={wrap}><section className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
      <h1 className="font-heading text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{text}</p>
      <Button asChild className="mt-5"><Link href={href}>{label}</Link></Button>
    </section></main>
  );
  if (!ready) return <main className={wrap}><p className="text-sm text-muted-foreground">Loading voting session…</p></main>;
  if (!game || !campaign) return gate("Voting is not ready", "Load an active Lok Sabha game and complete the campaign stage before entering voting.", "/elections/lok-sabha/campaign", "Open campaign");
  if (campaign.status !== "LOCKED") return gate("Campaign must be locked first", "Finish the final campaign report before starting voting.", "/elections/lok-sabha/campaign", "Return to campaign");

  const hasProgress = (voting?.completedPhases.length ?? 0) > 0;
  const revealingNow = revealingPhase !== null;
  const finished = phaseDone && !revealingNow;
  const shown = (voting?.phaseResults.flatMap(p => p.constituencyResults) ?? []).filter(r => revealed.has(r.constituencyId));
  const electors = shown.reduce((n, r) => n + r.registeredElectors, 0);
  const turnout = electors ? shown.reduce((n, r) => n + r.registeredElectors * r.turnoutRate, 0) / electors * 100 : null;
  const isPolling = (phase: number) => revealingPhase === phase || (!revealingNow && started && !phaseDone && phase === voting?.currentPhase);
  const cards: PhaseCard[] = schedule.phases.map(p => ({
    id: p.phase,
    name: `Phase ${p.phase}`,
    seats: p.constituencyCount,
    status: isPolling(p.phase) ? "polling" : voting?.completedPhases.includes(p.phase) ? "done" : "pending",
    detail: `Day ${p.day} · ${p.regions.map(r => r.name).join(", ")}`,
  }));
  const updates = [...(voting?.completedPhases ?? [])].filter(n => n !== revealingPhase).reverse().map(n => {
    const ph = schedule.phases.find(p => p.phase === n);
    return `Phase ${n} polling completed${ph ? ` · ${ph.constituencyCount} seats` : ""}.`;
  });
  const activePhase = revealingPhase ?? (started && !phaseDone ? voting?.currentPhase : undefined);
  const activeInfo = schedule.phases.find(p => p.phase === activePhase);
  if (activeInfo) updates.unshift(`Polling is under way in Phase ${activeInfo.phase}: ${activeInfo.regions.map(r => r.name).join(", ")}.`);

  const nameById = new Map(game.constituencies.map(c => [c.constituencyId, c.name]));
  const phaseById = new Map(schedule.phases.flatMap(p => p.regions.flatMap(r => r.constituencyIds.map(id => [id, p.phase] as const))));
  const turnoutById = new Map(shown.map(r => [r.constituencyId, r.turnoutRate]));
  const mapFill = (id: string) => {
    if (revealed.has(id)) return "var(--success)";
    if (isPolling(phaseById.get(id) ?? -1)) return "var(--brand)";
    return "var(--muted)";
  };
  const mapLabel = (id: string) => {
    const t = turnoutById.get(id);
    return `${nameById.get(id) ?? id} · Phase ${phaseById.get(id) ?? "?"}${typeof t !== "number" ? " · pending" : ` · turnout ${(t * 100).toFixed(1)}%`}`;
  };

  return <main className={`${wrap} space-y-5`}>
    <VotingHeader
      title="Voting"
      subtitle={finished
        ? "Polling is over in all phases. Counting comes next."
        : `Polling runs in ${schedule.phaseCount} phases across all ${total} constituencies. Results stay sealed until the last phase finishes.`}
      action={finished
        ? <>
            <Button size="lg" onClick={() => setExitOpen(true)} className="bg-brand text-brand-foreground hover:bg-brand/90">Exit poll</Button>
            <Button size="lg" variant="outline" asChild><Link href="/elections/lok-sabha/counting">Start counting →</Link></Button>
          </>
        : <><SpeedControl speed={speed} onChange={setSpeed} /><Button disabled={started} onClick={() => setStarted(true)}>{started ? "Polling…" : hasProgress ? "Resume voting" : "Start voting"}</Button></>}
    />
    {error && <Notice tone="error">{error}</Notice>}
    <PhaseStrip phases={cards} />
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <ElectionMap
        kind="lok-sabha"
        title="Polling map"
        fill={mapFill}
        label={mapLabel}
        legend={[{ color: "var(--success)", label: "Polled" }, { color: "var(--brand)", label: "Polling now" }, { color: "var(--muted)", label: "Pending" }]}
        overlay={exitOpen && exitPoll ? <ExitPollDrawer poll={exitPoll} states={pollStates} onClose={() => setExitOpen(false)} /> : null}
      />
      <div className="space-y-5">
        <ProgressPanel polled={revealed.size} total={total} turnout={turnout} />
        <UpdatesFeed items={updates} />
      </div>
    </div>
    {finished && <Notice tone="info">Voting is complete. All {total} constituencies have voted. Open the exit poll to see the projected seats, or start counting.</Notice>}
    <p className="text-xs text-muted-foreground">Voting data is saved locally for this game. <Link href="/elections/lok-sabha/campaign" className="underline underline-offset-4">Campaign report</Link></p>
  </main>;
}
