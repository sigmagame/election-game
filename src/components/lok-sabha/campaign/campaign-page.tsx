"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CampaignHeader } from "@/components/campaign/campaign-header";
import { CampaignBoard } from "./campaign-board";
import { CampaignFinal } from "./campaign-final";
import { Button } from "@/components/ui/button";
import { Play, RefreshCw } from "lucide-react";
import { getEligiblePartyIdsForState, loadLokSabhaGame } from "@/engine/lok-sabha-game-engine";
import { CAMPAIGN_ACTIONS, acknowledgeCampaignEvent, completeCampaignWeek, continueToNextCampaignWeek, createLokSabhaCampaignSave, loadLokSabhaCampaign, queuePlayerCampaignAction, removePlayerCampaignAction, saveLokSabhaCampaign, lockCampaignForVoting, skipToVoting } from "@/engine/lok-sabha-campaign-engine";
import type { LokSabhaGameSave } from "@/types/lok-sabha-game";
import type { CampaignActionType, LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";
import { allianceShort } from "@/lib/party-style";

export default function LokSabhaCampaignPage() {
  const router = useRouter();
  const [game, setGame] = useState<LokSabhaGameSave | null>(null);
  const [campaign, setCampaign] = useState<LokSabhaCampaignSave | null>(null);
  const [selectedState, setSelectedState] = useState("ALL");
  const [actionState, setActionState] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    const savedGame = loadLokSabhaGame();
    if (!savedGame) { router.replace("/elections/lok-sabha/new-game"); return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates client-only saved state after mount (localStorage is unavailable during SSR)
    setGame(savedGame);
    setCampaign(loadLokSabhaCampaign(savedGame.gameId));
  }, [router]);
  const states = useMemo(() => game ? [...new Set(game.constituencies.map((item) => item.state))].sort((a,b)=>a.localeCompare(b)) : [], [game]);
  const seatNames = useMemo(() => Object.fromEntries((game?.constituencies ?? []).map((item) => [item.constituencyId, `${item.name} (${item.state})`])), [game]);
  const eligibleActionStates = useMemo(() => game ? states.filter((state) => getEligiblePartyIdsForState(state).includes(game.playerPartyId)) : [], [game, states]);
  const currentWeekActions = campaign?.playerActions.filter((action) => action.week === campaign.currentWeek) ?? [];
  const weekCompleted = Boolean(campaign?.completedWeeks.includes(campaign.currentWeek));
  function runAction(type: CampaignActionType) {
    if (!campaign || !game) return;
    const targetState = actionState || (selectedState !== "ALL" && eligibleActionStates.includes(selectedState) ? selectedState : eligibleActionStates[0]);
    if (!targetState) return;
    setError("");
    try {
      const updated = queuePlayerCampaignAction(campaign, game, type, targetState);
      saveLokSabhaCampaign(updated);
      setCampaign(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add campaign action.");
    }
  }
  function deleteAction(actionId: string) {
    if (!campaign) return;
    setError("");
    try {
      const updated = removePlayerCampaignAction(campaign, actionId);
      saveLokSabhaCampaign(updated);
      setCampaign(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove campaign action.");
    }
  }

  function finishWeek() {
    if (!campaign) return;
    setError("");
    try { const updated = completeCampaignWeek(campaign, game!); saveLokSabhaCampaign(updated); setCampaign(updated); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to complete this campaign week."); }
  }
  function acknowledgeEvent(eventId: string) {
    if (!campaign) return;
    try { const updated = acknowledgeCampaignEvent(campaign, eventId); saveLokSabhaCampaign(updated); setCampaign(updated); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to acknowledge the event."); }
  }
  function nextWeek() {
    if (!campaign) return;
    setError("");
    try { const updated = continueToNextCampaignWeek(campaign); saveLokSabhaCampaign(updated); setCampaign(updated); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to continue the campaign."); }
  }
  function proceedToVoting() {
    if (!campaign) return;
    setError("");
    try {
      const locked = lockCampaignForVoting(campaign);
      saveLokSabhaCampaign(locked);
      setCampaign(locked);
      router.push("/elections/lok-sabha/voting");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to proceed to Voting.");
    }
  }
  function proceedEarly() {
    if (!campaign || !game) return;
    setError("");
    try {
      const locked = skipToVoting(campaign, game);
      saveLokSabhaCampaign(locked);
      setCampaign(locked);
      router.push("/elections/lok-sabha/voting");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to proceed to Voting.");
    }
  }
  function startCampaign() {
    if (!game) return;
    setStarting(true); setError("");
    try { const created=createLokSabhaCampaignSave(game); saveLokSabhaCampaign(created); setCampaign(created); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Campaign initialization failed."); }
    finally { setStarting(false); }
  }
  if (!game) return <p className="p-8 text-muted-foreground">Loading Lok Sabha game…</p>;
  return <main className="mx-auto max-w-[1280px] px-6 py-8">
    <section>
      <CampaignHeader
        title="Lok Sabha campaign"
        subtitle="Twelve weeks across all 543 constituencies. Spend your weekly actions where they matter; the week ends when you complete it."
        facts={[["Seats", "543"], ["Majority", "272"], ["Party", `${game.playerPartyId} · ${allianceShort(game.alliance.name)}`]]}
        currentWeek={campaign?.currentWeek}
        totalWeeks={12}
        completedWeeks={campaign?.completedWeeks ?? []}
        actionsLeft={campaign?.actionsRemaining}
        actionsMax={6}
        locked={campaign?.status === "LOCKED"}
        action={!campaign ? <Button size="lg" onClick={startCampaign} disabled={starting}><Play />{starting ? "Initializing…" : "Start campaign"}</Button> : null}
      />
      {error && <div role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
      {campaign?.status === "LOCKED" ? <section className="mt-7 rounded-2xl border border-border bg-card p-6"><h2 className="text-2xl font-black">Campaign locked</h2><p className="mt-2 text-sm text-foreground/80">You have already proceeded to Voting. Campaign actions and the final report can no longer be changed.</p><button onClick={()=>router.push("/elections/lok-sabha/voting")} className="mt-5 rounded-xl bg-brand text-brand-foreground px-5 py-3 text-sm font-bold">Continue to Voting</button></section> : campaign?.status === "FINAL_REPORT" && campaign.finalReport ? <CampaignFinal game={game} campaign={campaign} report={campaign.finalReport} states={states} seatNames={seatNames} onProceed={proceedToVoting} /> : campaign ? <>
        <CampaignBoard game={game} campaign={campaign} states={states} eligibleActionStates={eligibleActionStates} actionState={actionState} setActionState={setActionState} selectedState={selectedState} setSelectedState={setSelectedState} seatNames={seatNames} weekCompleted={weekCompleted} currentWeekActions={currentWeekActions} onRunAction={runAction} onRemoveAction={deleteAction} onAcknowledge={acknowledgeEvent} onCompleteWeek={finishWeek} onNextWeek={nextWeek} onProceedEarly={proceedEarly} />
      </> : <section className="mt-7 rounded-2xl border border-dashed border-border bg-card p-6"><h2 className="text-lg font-bold">Campaign overview</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Starting the campaign generates initial support for eligible parties in every constituency and saves it in this browser. Your election setup, party participation and seat allocation remain unchanged.</p><div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw size={14}/> The same support distribution will be restored when you return.</div></section>}
    </section>
  </main>;
}
