"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Play } from "lucide-react";
import { CampaignHeader } from "@/components/campaign/campaign-header";
import {
  ASSEMBLY_CAMPAIGN_ACTIONS_PER_WEEK,
  ASSEMBLY_CAMPAIGN_WEEKS,
  acknowledgeCampaignEvent,
  completeAssemblyCampaignWeek,
  continueAssemblyCampaignWeek,
  createAssemblyCampaign,
  getAssemblyMajority,
  loadAssemblyCampaign,
  lockCampaignForVoting,
  queueAssemblyCampaignAction,
  removeAssemblyCampaignAction,
  saveAssemblyCampaign,
  skipAssemblyToVoting,
} from "@/engine/assembly-campaign-engine";
import { loadAssemblyGame, toCampaignGame, type AssemblyGameSave } from "@/engine/assembly-game-engine";
import type { CampaignActionType, LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";
import { AssemblyCampaignBoard } from "./assembly-campaign-board";
import { AssemblyCampaignFinal } from "./assembly-campaign-final";

export default function AssemblyCampaignPage() {
  const router = useRouter();
  const [game, setGame] = useState<AssemblyGameSave | null>(null);
  const [campaign, setCampaign] = useState<LokSabhaCampaignSave | null>(null);
  const [selectedRegion, setSelectedRegion] = useState("ALL");
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = loadAssemblyGame();
    if (!saved) {
      router.replace("/elections/assembly/new-game");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates client-only saved state after mount (localStorage is unavailable during SSR)
    setGame(saved);
    setCampaign(loadAssemblyCampaign(saved.gameId));
  }, [router]);

  const regions = useMemo(() => (game ? toCampaignGame(game).regions?.[game.state] ?? [] : []), [game]);
  const seatNames = useMemo(() => Object.fromEntries((game?.constituencies ?? []).map((seat) => [seat.id, seat.name])), [game]);

  if (!game) {
    return <p className="p-8 text-muted-foreground">Loading Assembly game…</p>;
  }

  const majority = getAssemblyMajority(game);
  const weekDone = Boolean(campaign?.completedWeeks.includes(campaign.currentWeek));
  const thisWeek = campaign?.playerActions.filter((action) => action.week === campaign.currentWeek) ?? [];

  function update(change: (current: LokSabhaCampaignSave) => LokSabhaCampaignSave) {
    if (!campaign) return;
    setError("");
    try {
      const next = change(campaign);
      saveAssemblyCampaign(next);
      setCampaign(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
  }

  /** Locks the finished campaign (once) and moves on to polling day. */
  function goToVoting() {
    if (!campaign) return;
    setError("");
    try {
      if (campaign.status !== "LOCKED") {
        const locked = lockCampaignForVoting(campaign);
        saveAssemblyCampaign(locked);
        setCampaign(locked);
      }
      router.push("/elections/assembly/voting");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to proceed to Voting.");
    }
  }

  /** Ends the campaign before the last week: the report is built from today's support. */
  function proceedEarly() {
    if (!campaign || !game) return;
    setError("");
    try {
      const locked = skipAssemblyToVoting(campaign, game);
      saveAssemblyCampaign(locked);
      setCampaign(locked);
      router.push("/elections/assembly/voting");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to proceed to Voting.");
    }
  }

  function startCampaign() {
    setError("");
    try {
      const created = createAssemblyCampaign(game!);
      saveAssemblyCampaign(created);
      setCampaign(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Campaign initialisation failed.");
    }
  }

  const finished = Boolean(campaign?.finalReport && campaign.status !== "IN_PROGRESS");

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-8">
      <section>
        {!campaign && (
          <>
            <CampaignHeader
              title={`${game.state} Assembly campaign`}
              subtitle={`${ASSEMBLY_CAMPAIGN_WEEKS} weeks. Each week you may take up to ${ASSEMBLY_CAMPAIGN_ACTIONS_PER_WEEK} actions, and every action targets one region of the state. Rival alliances campaign too, and repeating the same action in the same region has diminishing returns.`}
              facts={[["Seats", String(game.totalConstituencies)], ["Majority", String(majority)], ["Alliance", `${game.allianceName} · ${game.playerPartyId}`]]}
              totalWeeks={ASSEMBLY_CAMPAIGN_WEEKS}
              completedWeeks={[]}
              actionsMax={ASSEMBLY_CAMPAIGN_ACTIONS_PER_WEEK}
            />
            <section className="mt-7 rounded-2xl border border-dashed border-border bg-card p-6">
              <h2 className="text-lg font-bold">Ready to campaign?</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Starting the campaign generates each party&apos;s opening support in every constituency from its strength in
                {" "}{game.state}, regional strongholds and local contests. Your alliance contests every seat with the candidates you
                allocated; rival alliances and independents fill the rest.
              </p>
              <button onClick={startCampaign} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-bold text-brand-foreground hover:opacity-90">
                <Play size={17} /> Start Campaign
              </button>
            </section>
          </>
        )}
        {error && (
          <div role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {campaign && finished && campaign.finalReport ? (
          <AssemblyCampaignFinal
            game={game}
            campaign={campaign}
            report={campaign.finalReport}
            seatNames={seatNames}
            majority={majority}
            weeks={ASSEMBLY_CAMPAIGN_WEEKS}
            weeksPlayed={campaign.completedWeeks.length}
            onProceed={goToVoting}
          />
        ) : campaign ? (
          <AssemblyCampaignBoard
            game={game}
            campaign={campaign}
            regions={regions}
            selectedRegion={selectedRegion}
            setSelectedRegion={setSelectedRegion}
            seatNames={seatNames}
            weekCompleted={weekDone}
            currentWeekActions={thisWeek}
            weeks={ASSEMBLY_CAMPAIGN_WEEKS}
            actionsPerWeek={ASSEMBLY_CAMPAIGN_ACTIONS_PER_WEEK}
            onRunAction={(type: CampaignActionType, regionId: string) => update((current) => queueAssemblyCampaignAction(current, game, type, regionId))}
            onRemoveAction={(id) => update((current) => removeAssemblyCampaignAction(current, id))}
            onAcknowledge={(id) => update((current) => acknowledgeCampaignEvent(current, id))}
            onCompleteWeek={() => update((current) => completeAssemblyCampaignWeek(current, game))}
            onNextWeek={() => update((current) => continueAssemblyCampaignWeek(current))}
            onProceedEarly={proceedEarly}
          />
        ) : null}
      </section>
    </main>
  );
}
