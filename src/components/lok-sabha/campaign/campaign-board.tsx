"use client";

import { useMemo, useState } from "react";
import { Check, Newspaper, X } from "lucide-react";
import { CampaignMap, type CampaignMapView } from "@/components/campaign/campaign-map";
import { PartyMark } from "@/components/party-mark";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { partyColor } from "@/lib/party-style";
import { AlliancesPollTab, StatePollTab, useSeatProjection } from "./poll-projection";
import { CAMPAIGN_ACTIONS, buildFinalCampaignReport, getLastWeeklySummary, summarizeSupport } from "@/engine/lok-sabha-campaign-engine";
import type { LokSabhaGameSave } from "@/types/lok-sabha-game";
import type { CampaignActionType, FinalCampaignReport, LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";

type PollTab = "national" | "alliances" | "state" | "summary" | "natsupport" | "statesupport";

const pct = (v: number) => `${v.toFixed(1)}%`;

export function CampaignBoard({
  game,
  campaign,
  states,
  eligibleActionStates,
  actionState,
  setActionState,
  selectedState,
  setSelectedState,
  seatNames,
  weekCompleted,
  currentWeekActions,
  onRunAction,
  onRemoveAction,
  onAcknowledge,
  onCompleteWeek,
  onNextWeek,
  onProceedEarly,
}: {
  game: LokSabhaGameSave;
  campaign: LokSabhaCampaignSave;
  states: string[];
  eligibleActionStates: string[];
  actionState: string;
  setActionState: (state: string) => void;
  selectedState: string;
  setSelectedState: (state: string) => void;
  seatNames: Record<string, string>;
  weekCompleted: boolean;
  currentWeekActions: LokSabhaCampaignSave["playerActions"];
  onRunAction: (type: CampaignActionType) => void;
  onRemoveAction: (id: string) => void;
  onAcknowledge: (id: string) => void;
  onCompleteWeek: () => void;
  onNextWeek: () => void;
  onProceedEarly: () => void;
}) {
  const [pollOpen, setPollOpen] = useState(false);
  const [pollTab, setPollTab] = useState<PollTab>("national");
  const [pollState, setPollState] = useState("");
  const [mapView, setMapView] = useState<CampaignMapView>("leader");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const week = campaign.currentWeek;
  const skipped = 12 - week;
  const activeEvents = (campaign.activeEvents ?? []).filter((e) => week >= e.week && week < e.week + e.durationWeeks);
  const alerts = activeEvents.filter((e) => e.priority === "CRITICAL");
  const pending = alerts.filter((e) => !e.acknowledged);
  const others = activeEvents.filter((e) => e.priority !== "CRITICAL");
  const summary = useMemo(() => summarizeSupport(campaign.constituencySupport), [campaign.constituencySupport]);
  const lastSummary = getLastWeeklySummary(campaign);
  const deltas = useMemo(() => Object.fromEntries((lastSummary?.nationalChanges ?? []).map((c) => [c.partyId, c.change])), [lastSummary]);

  const report: FinalCampaignReport | null = useMemo(() => {
    if (!pollOpen) return null;
    try {
      return buildFinalCampaignReport(campaign, game);
    } catch {
      return null;
    }
  }, [pollOpen, campaign, game]);

  const nationalRows = Object.entries(summary.nationalSupport).sort((a, b) => b[1] - a[1]);
  const topNational = nationalRows[0]?.[1] || 1;
  const chosenPollState = pollState || (selectedState !== "ALL" ? selectedState : states[0] ?? "");
  const proj = useSeatProjection(game, campaign, report, chosenPollState, true);
  const stateShare = Object.entries(report?.stateRows.find((r) => r.state === chosenPollState)?.partySupport ?? {}).sort((a, b) => b[1] - a[1]);
  const [summaryState, setSummaryState] = useState("");
  const chosenSummaryState = summaryState || (selectedState !== "ALL" ? selectedState : states[0] ?? "");

  const target = actionState || (selectedState !== "ALL" && eligibleActionStates.includes(selectedState) ? selectedState : eligibleActionStates[0] ?? "");
  const canAct = campaign.actionsRemaining > 0 && !weekCompleted && Boolean(target);

  function pickState(state: string) {
    setSelectedState(state);
    if (eligibleActionStates.includes(state)) setActionState(state);
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-bold">Campaign</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Week {week} of 12 · Lok Sabha {game.electionYear ?? ""} · 543 constituencies</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setPollOpen(true)} className="bg-brand text-brand-foreground hover:bg-brand/90">Opinion poll</Button>
          <Button variant="outline" onClick={() => setConfirmOpen(true)}>Proceed to voting →</Button>
        </div>
      </div>
      <div className="mt-4 flex gap-1.5" aria-label={`Week ${week} of 12`}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
          <div key={n} title={`Week ${n}`} className={`h-1.5 flex-1 rounded-full ${campaign.completedWeeks.includes(n) ? "bg-brand" : n === week ? "bg-brand/40" : "bg-muted"}`} />
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:h-[780px] lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)]">
        <CampaignMap
          kind="lok-sabha"
          title="Who leads where"
          subtitle="Latest simulated opinion poll, constituency by constituency."
          support={campaign.constituencySupport}
          names={seatNames}
          playerPartyId={game.playerPartyId}
          highlightState={selectedState}
          view={mapView}
          zoomable
          fillHeight
          onSelectState={pickState}
          toolbar={
            <div className="flex overflow-hidden rounded-lg border border-border text-xs font-semibold">
              {([["leader", "Leading party"], ["mine", "My support"]] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setMapView(v)} className={`px-3 py-1.5 ${mapView === v ? "bg-brand text-brand-foreground" : "bg-background hover:bg-muted"}`}>{label}</button>
              ))}
            </div>
          }
          belowHeader={
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" onClick={() => setSelectedState("ALL")} className={`rounded-full border px-3 py-1 font-semibold ${selectedState === "ALL" ? "border-brand bg-brand/10 text-brand" : "border-border hover:bg-muted"}`}>All India</button>
              {selectedState !== "ALL" ? (
                <button type="button" onClick={() => setSelectedState("ALL")} className="flex items-center gap-1 rounded-full border border-brand bg-brand/10 px-3 py-1 font-semibold text-brand">{selectedState} <X className="size-3" /></button>
              ) : null}
              <span className="text-muted-foreground">Click the map to pick a state</span>
            </div>
          }
          overlay={
            pollOpen ? (
              <div className="absolute inset-0 z-20 flex justify-end bg-black/40" onClick={() => setPollOpen(false)}>
                <aside className="flex h-full w-full max-w-[600px] flex-col overflow-hidden border-l border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-start justify-between gap-3 border-b border-border p-4">
                    <div>
                      <h3 className="font-heading text-lg font-bold">Opinion poll</h3>
                      <p className="text-xs text-muted-foreground">After week {lastSummary?.week ?? Math.max(0, week - 1)} · exact projected seats</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setPollOpen(false)}><X /> Close</Button>
                  </div>
                  <div className="flex gap-0.5 overflow-x-auto border-b border-border px-3 pt-2">
                    {([["national", "Vote Share"], ["alliances", "Alliances"], ["state", "State projection"], ["summary", "Weekly summary"], ["natsupport", "National Vote Share"], ["statesupport", "State Vote Share"]] as const).map(([k, label]) => (
                      <button key={k} type="button" onClick={() => setPollTab(k)} className={`whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-semibold ${pollTab === k ? "border-brand text-brand" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {pollTab === "national" ? (
                      <ul className="space-y-3">
                        {nationalRows.map(([id, v]) => {
                          const d = deltas[id];
                          return (
                            <li key={id}>
                              <div className="flex items-center gap-2 text-sm">
                                <PartyMark id={id} size={22} />
                                <span className="flex-1 font-semibold">{id}{id === game.playerPartyId ? <span className="ml-2 text-xs font-normal text-brand">You</span> : null}</span>
                                <span className="tabular-nums">{pct(v)}</span>
                                {d !== undefined ? <span className={`w-16 text-right text-xs font-semibold tabular-nums ${d > 0 ? "text-success" : d < 0 ? "text-destructive" : "text-muted-foreground"}`}>{d > 0 ? "+" : ""}{d.toFixed(2)}</span> : null}
                              </div>
                              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(v / topNational) * 100}%`, background: partyColor(id) }} /></div>
                            </li>
                          );
                        })}
                        <li className="pt-1 text-xs text-muted-foreground">Average support across constituencies; change is versus last week.</li>
                      </ul>
                    ) : pollTab === "alliances" ? (
                      report ? <AlliancesPollTab proj={proj} report={report} total={report.totalSeats} seatsLabel="seats" /> : <p className="text-sm text-muted-foreground">Calculating projection…</p>
                    ) : pollTab === "natsupport" ? (
                      lastSummary ? <div><p className="text-xs font-bold uppercase tracking-wider text-success">After week {lastSummary.week}</p><ChangeTable rows={lastSummary.nationalChanges} /></div> : <p className="text-sm text-muted-foreground">Complete a week to see national support changes here.</p>
                    ) : pollTab === "statesupport" ? (
                      lastSummary ? (
                        <div>
                          <label className="block text-xs text-muted-foreground">State / union territory
                            <select value={chosenSummaryState} onChange={(e) => setSummaryState(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                              {states.map((st) => <option key={st} value={st}>{st}</option>)}
                            </select>
                          </label>
                          {lastSummary.stateChanges[chosenSummaryState] ? <ChangeTable rows={lastSummary.stateChanges[chosenSummaryState]} /> : <p className="mt-3 text-sm text-muted-foreground">No change data for this state.</p>}
                        </div>
                      ) : <p className="text-sm text-muted-foreground">Complete a week to see state support changes here.</p>
                    ) : pollTab === "summary" ? (
                      lastSummary ? (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-success">Week {lastSummary.week} completed</p>
                          <p className="mt-1 text-sm text-muted-foreground">Processed {lastSummary.constituenciesProcessed} constituencies. AI parties: {lastSummary.aiActivity?.partiesActive ?? 0} active, {lastSummary.aiActivity?.actionsPerformed ?? 0} hidden actions.</p>
                          {lastSummary.events?.map((e) => (
                            <div key={e.id} className="mt-3 rounded-lg border border-brand/20 bg-brand/5 p-3">
                              <p className="text-sm font-semibold text-brand">Event: {e.name}</p>
                              <p className="mt-1 text-xs text-foreground/80">{e.description}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{e.scope} · {e.location} · {e.sentiment}</p>
                            </div>
                          ))}
                          {others.length ? <p className="mt-3 text-xs text-muted-foreground">Ongoing: {others.map((e) => e.name).join(" · ")}</p> : null}
                        </div>
                      ) : <p className="text-sm text-muted-foreground">Complete a week to see its summary here.</p>
                    ) : report ? (
                      <StatePollTab proj={proj} states={states} chosenState={chosenPollState} onChangeState={setPollState} stateShare={stateShare} exact />
                    ) : (
                      <p className="mt-4 text-sm text-muted-foreground">Calculating projection…</p>
                    )}
                  </div>
                </aside>
              </div>
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
                <p className="mt-1 text-sm text-muted-foreground">{week >= 12 ? "The 12-week campaign is complete." : "Review the weekly summary, then move on."}</p>
                <Button variant="outline" className="mt-3 w-full bg-background" onClick={() => { setPollTab("summary"); setPollOpen(true); }}>View weekly summary</Button>
                <Button className="mt-2 w-full bg-brand text-brand-foreground hover:bg-brand/90" disabled={week >= 12 || pending.length > 0} onClick={onNextWeek}>{week >= 12 ? "Campaign completed" : "Continue to next week"}</Button>
              </>
            ) : (
              <>
                <h3 className="font-heading text-base font-semibold">Ready to complete Week {week}?</h3>
                <Button className="mt-3 w-full bg-brand text-brand-foreground hover:bg-brand/90 disabled:bg-muted disabled:text-muted-foreground" disabled={pending.length > 0} onClick={onCompleteWeek}>Complete Week</Button>
                <p className="mt-2 text-xs text-muted-foreground">You can complete the week with any number of actions, including zero.</p>
              </>
            )}
          </section>

          <section className="flex min-h-[280px] min-w-0 flex-1 flex-col rounded-xl border border-border bg-card p-4">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <h3 className="font-heading text-base font-semibold">Your campaign actions</h3>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{campaign.actionsRemaining} left
                <span className="flex gap-0.5">{Array.from({ length: 6 }, (_, i) => <span key={i} className={`size-2 rounded-full ${i < campaign.actionsRemaining ? "bg-brand" : "bg-muted"}`} />)}</span>
              </span>
            </div>
            <label className="mt-3 block shrink-0 text-xs text-muted-foreground">Target state / union territory
              <select value={target} onChange={(e) => setActionState(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                {eligibleActionStates.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <ul className="space-y-2">
              {CAMPAIGN_ACTIONS.map((a) => (
                <li key={a.id} className="flex items-center gap-3 rounded-lg border border-border bg-background p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{a.name}</p>
                    <p className="text-xs text-muted-foreground">+{a.baseImpact} impact · lasts {a.lastingDuration} week{a.lastingDuration === 1 ? "" : "s"}</p>
                  </div>
                  <Button size="sm" disabled={!canAct} onClick={() => onRunAction(a.id)} className="bg-brand text-brand-foreground hover:bg-brand/90">Run</Button>
                </li>
              ))}
            </ul>
            <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">This week ({currentWeekActions.length}/6)</h4>
            {currentWeekActions.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No actions queued yet.</p> : (
              <ul className="mt-2 space-y-1.5">
                {currentWeekActions.map((action, i) => (
                  <li key={action.id} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span className="grid size-5 place-items-center rounded-full bg-brand/10 text-xs font-bold text-brand">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{CAMPAIGN_ACTIONS.find((d) => d.id === action.actionType)?.name ?? action.actionType} · {action.state}</span>
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
              {skipped > 0 ? `You are in week ${week} of 12. The remaining ${skipped} week${skipped === 1 ? "" : "s"} will be skipped and ` : "The campaign will end and "}
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

function ChangeTable({ rows }: { rows: Array<{ partyId: string; previousSupport: number; currentSupport: number; change: number }> }) {
  return (
    <table className="mt-2 w-full text-sm">
      <thead className="text-xs text-muted-foreground"><tr><th className="pb-1 text-left">Party</th><th className="pb-1 text-right">Previous</th><th className="pb-1 text-right">Current</th><th className="pb-1 text-right">Change</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.partyId} className="border-t border-border/50">
            <td className="py-1.5"><span className="flex items-center gap-1.5 font-semibold"><PartyMark id={r.partyId} size={16} />{r.partyId}</span></td>
            <td className="py-1.5 text-right tabular-nums">{r.previousSupport.toFixed(2)}%</td>
            <td className="py-1.5 text-right tabular-nums">{r.currentSupport.toFixed(2)}%</td>
            <td className={`py-1.5 text-right font-semibold tabular-nums ${r.change > 0 ? "text-success" : r.change < 0 ? "text-destructive" : "text-muted-foreground"}`}>{r.change > 0 ? "+" : ""}{r.change.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
