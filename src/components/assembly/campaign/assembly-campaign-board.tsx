"use client";

import { useMemo, useState } from "react";
import { Check, Newspaper } from "lucide-react";
import { CampaignMap, type CampaignMapView } from "@/components/campaign/campaign-map";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CAMPAIGN_ACTIONS, buildAssemblyReport, getLastWeeklySummary } from "@/engine/assembly-campaign-engine";
import type { AssemblyGameSave } from "@/engine/assembly-game-engine";
import type { CampaignRegion } from "@/types/campaign-profile";
import type { CampaignActionType, FinalCampaignReport, LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";
import { AssemblyPollDrawer, useAssemblyProjection, type PollTab } from "./assembly-poll";

/** "Whole state" plus one chip per region, each with its seat count. */
export function RegionChips({ regions, total, value, onChange, hint }: { regions: CampaignRegion[]; total: number; value: string; onChange: (id: string) => void; hint?: string }) {
  const chip = (id: string, label: string, seats: number) => (
    <button key={id} type="button" onClick={() => onChange(id)} className={`rounded-full border px-3 py-1 font-semibold ${value === id ? "border-brand bg-brand/10 text-brand" : "border-border hover:bg-muted"}`}>
      {label} <span className="font-normal text-muted-foreground">· {seats}</span>
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {chip("ALL", "Whole state", total)}
      {regions.map((r) => chip(r.id, r.name, r.constituencyIds.length))}
      {hint ? <span className="text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export function AssemblyCampaignBoard({
  game,
  campaign,
  regions,
  selectedRegion,
  setSelectedRegion,
  seatNames,
  weekCompleted,
  currentWeekActions,
  onRunAction,
  onRemoveAction,
  onAcknowledge,
  onCompleteWeek,
  onNextWeek,
  onProceedEarly,
  weeks,
  actionsPerWeek,
}: {
  game: AssemblyGameSave;
  campaign: LokSabhaCampaignSave;
  regions: CampaignRegion[];
  selectedRegion: string;
  setSelectedRegion: (id: string) => void;
  seatNames: Record<string, string>;
  weekCompleted: boolean;
  currentWeekActions: LokSabhaCampaignSave["playerActions"];
  onRunAction: (type: CampaignActionType, regionId: string) => void;
  onRemoveAction: (id: string) => void;
  onAcknowledge: (id: string) => void;
  onCompleteWeek: () => void;
  onNextWeek: () => void;
  onProceedEarly: () => void;
  weeks: number;
  actionsPerWeek: number;
}) {
  const [pollOpen, setPollOpen] = useState(false);
  const [pollTab, setPollTab] = useState<PollTab>("statevote");
  const [mapView, setMapView] = useState<CampaignMapView>("leader");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionRegion, setActionRegion] = useState("");

  const week = campaign.currentWeek;
  const skipped = weeks - week;
  const activeEvents = (campaign.activeEvents ?? []).filter((e) => week >= e.week && week < e.week + e.durationWeeks);
  const alerts = activeEvents.filter((e) => e.priority === "CRITICAL");
  const pending = alerts.filter((e) => !e.acknowledged);
  const others = activeEvents.filter((e) => e.priority !== "CRITICAL");
  const lastSummary = getLastWeeklySummary(campaign);

  const report: FinalCampaignReport | null = useMemo(() => {
    if (!pollOpen) return null;
    try {
      return buildAssemblyReport(campaign, game);
    } catch {
      return null;
    }
  }, [pollOpen, campaign, game]);
  const proj = useAssemblyProjection(game, campaign, report, true);

  const highlightIds = useMemo(() => {
    if (selectedRegion === "ALL") return undefined;
    const region = regions.find((r) => r.id === selectedRegion);
    return region ? new Set(region.constituencyIds) : undefined;
  }, [regions, selectedRegion]);

  const target = selectedRegion !== "ALL" ? selectedRegion : actionRegion || regions[0]?.id || "";
  const targetName = regions.find((r) => r.id === target)?.name ?? "";
  const canAct = campaign.actionsRemaining > 0 && !weekCompleted && Boolean(target);
  const regionName = (id?: string) => regions.find((r) => r.id === id)?.name ?? "Whole state";

  function pickSeat(id: string) {
    const region = regions.find((r) => r.constituencyIds.includes(id));
    if (region) {
      setSelectedRegion(region.id);
      setActionRegion(region.id);
    }
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-bold">Campaign</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Week {week} of {weeks} · {game.state} Assembly {game.electionYear} · {game.totalConstituencies} constituencies</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            Actions left {campaign.actionsRemaining} / {actionsPerWeek}
            <span className="flex gap-0.5">{Array.from({ length: actionsPerWeek }, (_, i) => <span key={i} className={`size-2 rounded-full ${i < campaign.actionsRemaining ? "bg-brand" : "bg-muted"}`} />)}</span>
          </span>
          <Button onClick={() => setPollOpen(true)} className="bg-brand text-brand-foreground hover:bg-brand/90">Opinion poll</Button>
          <Button variant="outline" onClick={() => setConfirmOpen(true)}>Proceed to voting →</Button>
        </div>
      </div>
      <div className="mt-4 flex gap-1.5" aria-label={`Week ${week} of ${weeks}`}>
        {Array.from({ length: weeks }, (_, i) => i + 1).map((n) => (
          <div key={n} title={`Week ${n}`} className={`h-1.5 flex-1 rounded-full ${campaign.completedWeeks.includes(n) ? "bg-brand" : n === week ? "bg-brand/40" : "bg-muted"}`} />
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:h-[780px] lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)]">
        <CampaignMap
          kind="assembly"
          state={game.state}
          title="Who leads where"
          subtitle="Latest simulated opinion poll, constituency by constituency."
          support={campaign.constituencySupport}
          names={seatNames}
          playerPartyId={game.playerPartyId}
          view={mapView}
          zoomable
          fillHeight
          highlightIds={highlightIds}
          onSelectSeat={pickSeat}
          toolbar={
            <div className="flex overflow-hidden rounded-lg border border-border text-xs font-semibold">
              {([["leader", "Leading party"], ["mine", "My support"]] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setMapView(v)} className={`px-3 py-1.5 ${mapView === v ? "bg-brand text-brand-foreground" : "bg-background hover:bg-muted"}`}>{label}</button>
              ))}
            </div>
          }
          belowHeader={<RegionChips regions={regions} total={game.totalConstituencies} value={selectedRegion} onChange={(id) => { setSelectedRegion(id); if (id !== "ALL") setActionRegion(id); }} hint="Pick a region to campaign there" />}
          overlay={
            pollOpen ? (
              <AssemblyPollDrawer
                game={game}
                campaign={campaign}
                report={report}
                proj={proj}
                exact
                tab={pollTab}
                setTab={setPollTab}
                regionId={selectedRegion}
                onPickRegion={(id) => { setSelectedRegion(id); setActionRegion(id); }}
                lastSummary={lastSummary}
                week={week}
                ongoing={others.map((e) => e.name)}
                onClose={() => setPollOpen(false)}
              />
            ) : null
          }
        />

        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <section className="shrink-0 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-heading text-base font-semibold"><Newspaper className="size-4 text-brand" /> News alerts</h3>
                {alerts.length ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pending.length ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>{pending.length ? `${pending.length} to acknowledge` : "All acknowledged"}</span> : null}
              </div>
              {alerts.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No alert this week.</p> : (
                <div className="mt-3 space-y-2">
                  {alerts.map((e) =>
                    e.acknowledged ? (
                      <div key={e.id} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-success text-white"><Check className="size-3" /></span><span className="min-w-0 flex-1 truncate font-medium">{e.name}</span><span className="text-xs text-muted-foreground">Acknowledged</span></div>
                    ) : (
                      <div key={e.id} className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                        <p className="font-semibold">{e.name}</p>
                        <p className="mt-1 text-sm text-foreground/80">{e.description}</p>
                        <Button size="sm" variant="outline" className="mt-2 bg-background" onClick={() => onAcknowledge(e.id)}>Acknowledge</Button>
                      </div>
                    ),
                  )}
                </div>
              )}
            </section>

            <section className="shrink-0 rounded-xl border border-brand/25 bg-brand/5 p-4">
              {weekCompleted ? (
                <>
                  <h3 className="font-heading text-base font-semibold">Week {week} completed</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{week >= weeks ? `The ${weeks}-week campaign is complete.` : "Review the weekly summary, then move on."}</p>
                  <Button variant="outline" className="mt-3 w-full bg-background" onClick={() => { setPollTab("summary"); setPollOpen(true); }}>View weekly summary</Button>
                  <Button className="mt-2 w-full bg-brand text-brand-foreground hover:bg-brand/90" disabled={week >= weeks || pending.length > 0} onClick={onNextWeek}>{week >= weeks ? "Campaign completed" : "Continue to next week"}</Button>
                </>
              ) : (
                <>
                  <h3 className="font-heading text-base font-semibold">Ready to complete Week {week}?</h3>
                  <Button className="mt-3 w-full bg-brand text-brand-foreground hover:bg-brand/90 disabled:bg-muted disabled:text-muted-foreground" disabled={pending.length > 0} onClick={onCompleteWeek}>Complete Week {week}</Button>
                  <p className="mt-2 text-xs text-muted-foreground">You can complete the week with any number of actions, including zero.</p>
                </>
              )}
            </section>

            <section className="flex min-h-[280px] min-w-0 flex-1 flex-col rounded-xl border border-border bg-card p-4">
              <div className="flex shrink-0 items-center justify-between gap-2">
                <h3 className="font-heading text-base font-semibold">Your campaign actions</h3>
                <span className="text-xs text-muted-foreground">{campaign.actionsRemaining} left</span>
              </div>
              <label className="mt-3 block shrink-0 text-xs text-muted-foreground">Target region
                <select value={target} onChange={(e) => { setActionRegion(e.target.value); setSelectedRegion(e.target.value); }} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                  {regions.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.constituencyIds.length} seats)</option>)}
                </select>
              </label>
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
                <ul className="space-y-2">
                  {CAMPAIGN_ACTIONS.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 rounded-lg border border-border bg-background p-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{a.name}</p>
                        <p className="text-xs text-muted-foreground">+{a.baseImpact} impact · lasts {a.lastingDuration} week{a.lastingDuration === 1 ? "" : "s"}{targetName ? ` · ${targetName}` : ""}</p>
                      </div>
                      <Button size="sm" disabled={!canAct} onClick={() => onRunAction(a.id, target)} className="bg-brand text-brand-foreground hover:bg-brand/90">Run</Button>
                    </li>
                  ))}
                </ul>
                <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">This week&apos;s queue ({currentWeekActions.length}/{actionsPerWeek})</h4>
                {currentWeekActions.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No actions queued yet.</p> : (
                  <ul className="mt-2 space-y-1.5">
                    {currentWeekActions.map((action, i) => (
                      <li key={action.id} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                        <span className="grid size-5 place-items-center rounded-full bg-brand/10 text-xs font-bold text-brand">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{CAMPAIGN_ACTIONS.find((d) => d.id === action.actionType)?.name ?? action.actionType} · {regionName(action.targetRegionId)}</span>
                        <button type="button" disabled={weekCompleted} onClick={() => onRemoveAction(action.id)} className="text-xs font-semibold text-muted-foreground hover:text-destructive disabled:opacity-40">Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          <section className="shrink-0 rounded-xl border border-border bg-card p-4">
            <Button variant="outline" className="w-full" onClick={() => setConfirmOpen(true)}>Proceed to voting →</Button>
            <p className="mt-2 text-xs text-muted-foreground">Ends the campaign now. Weeks you have not played are skipped.</p>
          </section>
        </div>
      </div>

      <Dialog open={pending.length > 0} onOpenChange={() => {}}>
        <DialogContent showCloseButton={false} className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          {pending[0] ? (
            <>
              <DialogHeader>
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-destructive"><Newspaper className="size-3.5" /> News alert · {pending[0].category.replaceAll("_", " ")} · {pending[0].location}</p>
                <DialogTitle>{pending[0].name}</DialogTitle>
                <DialogDescription>{pending[0].description}</DialogDescription>
              </DialogHeader>
              <p className="text-xs text-muted-foreground">{pending[0].sentiment} · {Math.max(0, pending[0].week + pending[0].durationWeeks - week)} week(s) remaining{pending.length > 1 ? ` · ${pending.length - 1} more alert(s) after this` : ""}</p>
              <div className="flex justify-end"><Button className="bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => onAcknowledge(pending[0].id)}>Acknowledge</Button></div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Proceed to voting?</DialogTitle>
            <DialogDescription>
              {skipped > 0 ? `You are in week ${week} of ${weeks}. The remaining ${skipped} week${skipped === 1 ? "" : "s"} will be skipped and ` : "The campaign will end and "}
              support stays as it is now. You cannot return to the campaign once voting starts.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Keep campaigning</Button>
            <Button className="bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => { setConfirmOpen(false); onProceedEarly(); }}>Proceed to voting</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
