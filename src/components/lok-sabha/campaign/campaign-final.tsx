"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { CampaignMap } from "@/components/campaign/campaign-map";
import { PartyMark } from "@/components/party-mark";
import { Button } from "@/components/ui/button";
import { allianceShort, partyColor } from "@/lib/party-style";
import { rangeText } from "@/lib/seat-projection";
import { AllianceName } from "@/components/alliance-name";
import { AlliancesPollTab, RangeBar, StatePollTab, useSeatProjection } from "./poll-projection";
import type { LokSabhaGameSave } from "@/types/lok-sabha-game";
import type { FinalCampaignReport, LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";

type Tab = "share" | "alliances" | "state" | "compare" | "statevote";
const TABS: Array<[Tab, string]> = [["share", "Vote share"], ["alliances", "Alliances"], ["state", "State projection"], ["compare", "Week 1 vs 12"], ["statevote", "State vote share"]];
const pct = (v: number) => `${v.toFixed(1)}%`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
const tone = (v: number) => (v > 0 ? "text-success" : v < 0 ? "text-destructive" : "text-muted-foreground");

export function CampaignFinal({
  game,
  campaign,
  report,
  states,
  seatNames,
  onProceed,
}: {
  game: LokSabhaGameSave;
  campaign: LokSabhaCampaignSave;
  report: FinalCampaignReport;
  states: string[];
  seatNames: Record<string, string>;
  onProceed: () => void;
}) {
  const [pollOpen, setPollOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("share");
  const [pollState, setPollState] = useState("");
  const [selectedState, setSelectedState] = useState("ALL");

  const total = report.totalSeats;
  const majority = report.majorityMark;
  const chosenState = pollState || (selectedState !== "ALL" ? selectedState : states[0] ?? "");

  // Ranges are built from the states up: party by party, then added up for alliances.
  const proj = useSeatProjection(game, campaign, report, chosenState, false);
  const { national, blocs, loneParties, ranked, stateTotal } = proj;
  const lead = ranked[0];
  const leadRange = { lo: lead?.lo ?? 0, hi: lead?.hi ?? 0, text: lead ? rangeText(lead) : "0" };
  // The leader's range decides the label, not the exact number: if the top of the range
  // reaches the majority mark, the result is too close to call rather than hung.
  const status = leadRange.lo >= majority ? "MAJORITY" : leadRange.hi >= majority ? "CLOSE" : "HUNG";
  const badge = status === "MAJORITY" ? ["Majority projected", "bg-success/10 text-success"] : status === "CLOSE" ? ["Too close to call", "bg-amber-500/15 text-amber-700 dark:text-amber-300"] : ["Hung parliament", "bg-amber-500/15 text-amber-700 dark:text-amber-300"];
  const headline = status === "HUNG" ? `No one reaches ${majority}` : status === "MAJORITY" ? `${allianceShort(lead?.name ?? "")} is projected to win` : `${allianceShort(lead?.name ?? "")} is close to a majority`;
  const subline =
    status === "MAJORITY"
      ? `Projected at ${leadRange.text} seats, above the ${majority} majority mark even at the low end.`
      : status === "CLOSE"
        ? `Projected at ${leadRange.text} seats. The ${majority} majority mark sits inside that range, so it could go either way.`
        : `${allianceShort(lead?.name ?? "")} is projected at ${leadRange.text} seats, below the ${majority} majority mark. Talks decide the government after voting.`;

  const me = report.partyRows.find((p) => p.partyId === game.playerPartyId);
  const myRange = { text: rangeText(national.parties[game.playerPartyId] ?? { lo: 0, hi: 0 }) };
  const myChange = report.nationalSupportComparison.find((r) => r.partyId === game.playerPartyId)?.change ?? 0;
  const movers = [...report.nationalSupportComparison].sort((a, b) => b.change - a.change);
  const gainers = movers.filter((m) => m.change > 0).slice(0, 3);
  const losers = movers.filter((m) => m.change < 0).slice(-3).reverse();
  const shareRows = [...report.nationalSupportComparison].sort((a, b) => b.week12Support - a.week12Support).slice(0, 12);

  const stateShare = Object.entries(report.stateRows.find((r) => r.state === chosenState)?.partySupport ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-2xl font-bold">Campaign complete</h2>
            <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">Week 12 of 12 done</span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">Lok Sabha {game.electionYear ?? ""} · {total} constituencies · final projection before voting day</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setPollOpen(true)} className="border-brand text-brand hover:text-brand">Opinion poll</Button>
          <Button onClick={onProceed} className="bg-brand text-brand-foreground hover:bg-brand/90">Proceed to voting →</Button>
        </div>
      </div>
      <div className="mt-4 flex gap-1.5" aria-label="All 12 weeks complete">
        {Array.from({ length: 12 }, (_, i) => <div key={i} className="h-1.5 flex-1 rounded-full bg-success" />)}
      </div>

      <div className="mt-5 grid gap-4 lg:h-[780px] lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)]">
        <CampaignMap
          kind="lok-sabha"
          title="Constituency map"
          subtitle="Seat leads are hidden now so voting day stays a surprise. Pick a state to highlight it."
          support={campaign.constituencySupport}
          names={seatNames}
          playerPartyId={game.playerPartyId}
          highlightState={selectedState}
          masked
          zoomable
          fillHeight
          onSelectState={setSelectedState}
          belowHeader={
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" onClick={() => setSelectedState("ALL")} className={`rounded-full border px-3 py-1 font-semibold ${selectedState === "ALL" ? "border-brand bg-brand/10 text-brand" : "border-border hover:bg-muted"}`}>All India</button>
              {selectedState !== "ALL" ? <button type="button" onClick={() => setSelectedState("ALL")} className="flex items-center gap-1 rounded-full border border-brand bg-brand/10 px-3 py-1 font-semibold text-brand">{selectedState} <X className="size-3" /></button> : null}
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
                      <p className="text-xs text-muted-foreground">Final poll · after week 12 · seat figures are ±10% ranges</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setPollOpen(false)}><X /> Close</Button>
                  </div>
                  <div className="flex gap-0.5 overflow-x-auto border-b border-border px-3 pt-2">
                    {TABS.map(([k, label]) => (
                      <button key={k} type="button" onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-semibold ${tab === k ? "border-brand text-brand" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {tab === "share" ? (
                      <ul className="space-y-3">
                        {shareRows.map((r) => (
                          <li key={r.partyId}>
                            <div className="flex items-center gap-2 text-sm"><PartyMark id={r.partyId} size={22} /><span className="flex-1 font-semibold">{r.partyId}{r.partyId === game.playerPartyId ? <span className="ml-2 text-xs font-normal text-brand">You</span> : null}</span><span className="tabular-nums">{pct(r.week12Support)}</span></div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(r.week12Support / (shareRows[0]?.week12Support || 1)) * 100}%`, background: partyColor(r.partyId) }} /></div>
                          </li>
                        ))}
                      </ul>
                    ) : tab === "alliances" ? (
                      <AlliancesPollTab proj={proj} report={report} total={total} />
                    ) : tab === "state" ? (
                      <StatePollTab proj={proj} states={states} chosenState={chosenState} onChangeState={setPollState} stateShare={stateShare} exact={false} />
                    ) : tab === "compare" ? (
                      <div>
                        <p className="text-xs text-muted-foreground">National vote share, week 1 against week 12 (percentage points).</p>
                        <table className="mt-2 w-full text-sm">
                          <thead className="text-xs text-muted-foreground"><tr><th className="pb-1 text-left">Party</th><th className="pb-1 text-right">Week 1</th><th className="pb-1 text-right">Week 12</th><th className="pb-1 text-right">Change</th></tr></thead>
                          <tbody>
                            {report.nationalSupportComparison.map((r) => (
                              <tr key={r.partyId} className="border-t border-border/50">
                                <td className="py-1.5"><span className="flex items-center gap-1.5 font-semibold"><PartyMark id={r.partyId} size={16} />{r.partyId}</span></td>
                                <td className="py-1.5 text-right tabular-nums">{pct(r.week1Support)}</td>
                                <td className="py-1.5 text-right tabular-nums">{pct(r.week12Support)}</td>
                                <td className={`py-1.5 text-right font-semibold tabular-nums ${tone(r.change)}`}>{signed(r.change)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div>
                        <StateSelect value={chosenState} states={states} onChange={setPollState} />
                        <ShareList rows={stateShare} />
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            ) : null
          }
        />

        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            <section className="shrink-0 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-heading text-base font-semibold">Final projection</h3>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge[1]}`}>{badge[0]}</span>
              </div>
              <p className="mt-3 font-heading text-2xl font-semibold leading-tight">{headline}</p>
              <p className="mt-1.5 text-sm text-foreground/80">{subline}</p>
              <div className="relative mt-4">
                <RangeBar lo={leadRange.lo} hi={leadRange.hi} max={total} color={lead?.color ?? "var(--muted)"} thick />
                <div className="absolute -top-1 h-6 w-0.5 bg-foreground" style={{ left: `${(majority / total) * 100}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>0</span><span>{majority} majority</span><span>{total}</span></div>
              <p className="mt-2 text-xs text-muted-foreground">Seat figures are estimates. Each range counts the seats a party could lose or win where the race is within 4 points. The bar shows the leading alliance: solid is the low end, faded is the possible extra.</p>
            </section>

            <section className="shrink-0 rounded-xl border border-border bg-card p-4">
              <h3 className="font-heading text-base font-semibold">Your party</h3>
              <div className="mt-3 flex items-center gap-3">
                <PartyMark id={game.playerPartyId} size={40} />
                <div><p className="font-bold">{game.playerPartyId}</p><p className="text-xs text-muted-foreground">Contesting with {allianceShort(game.alliance.name)}</p></div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Stat label="Seats (estimate)" value={myRange.text} />
                <Stat label="Vote share" value={pct(me?.voteShare ?? 0)} />
                <Stat label="Since week 1" value={signed(myChange)} valueClass={tone(myChange)} />
              </div>
            </section>

            <section className="shrink-0 rounded-xl border border-border bg-card p-4">
              <h3 className="font-heading text-base font-semibold">Alliances</h3>
              <ul className="mt-3 space-y-3">
                {ranked.slice(0, 4).map((b) => (
                  <li key={b.id}>
                    <div className="flex justify-between text-sm"><AllianceName name={b.name} className="font-bold" /><span className="tabular-nums text-foreground/80">{rangeText(b)} seats</span></div>
                    <div className="mt-1.5"><RangeBar lo={b.lo} hi={b.hi} max={total} color={b.color} /></div>
                  </li>
                ))}
              </ul>
              <Button variant="outline" className="mt-4 w-full border-brand text-brand hover:text-brand" onClick={() => setPollOpen(true)}>See the full opinion poll</Button>
            </section>

            <section className="shrink-0 rounded-xl border border-border bg-card p-4">
              <h3 className="font-heading text-base font-semibold">Biggest movers since week 1</h3>
              <div className="mt-3 flex gap-4">
                <Movers title="Gained" rows={gainers} cls="text-success" />
                <div className="w-px bg-border" />
                <Movers title="Lost" rows={losers} cls="text-destructive" />
              </div>
            </section>
          </div>

          <section className="shrink-0 rounded-xl border border-border bg-card p-4">
            <Button className="w-full bg-brand text-brand-foreground hover:bg-brand/90" onClick={onProceed}>Proceed to voting →</Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">All 12 weeks are played. Campaign actions lock once you proceed.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return <div className="rounded-lg border border-border bg-background px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-0.5 text-lg font-bold ${valueClass}`}>{value}</p></div>;
}

function Movers({ title, rows, cls }: { title: string; rows: Array<{ partyId: string; change: number }>; cls: string }) {
  return (
    <div className="flex-1">
      <p className="text-xs text-muted-foreground">{title}</p>
      {rows.length === 0 ? <p className="mt-1.5 text-sm text-muted-foreground">None</p> : rows.map((r) => <p key={r.partyId} className="mt-1.5 flex justify-between text-sm"><b>{r.partyId}</b><span className={`font-semibold ${cls}`}>{signed(r.change)}</span></p>)}
    </div>
  );
}

function StateSelect({ value, states, onChange }: { value: string; states: string[]; onChange: (s: string) => void }) {
  return (
    <label className="block text-xs text-muted-foreground">State / union territory
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
        {states.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </label>
  );
}

function ShareList({ rows }: { rows: Array<[string, number]> }) {
  const top = rows[0]?.[1] || 1;
  return (
    <ul className="mt-2 space-y-2">
      {rows.map(([id, v]) => (
        <li key={id}>
          <div className="flex items-center gap-2 text-sm"><PartyMark id={id} size={18} /><span className="flex-1">{id}</span><span className="tabular-nums">{pct(v)}</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(v / top) * 100}%`, background: partyColor(id) }} /></div>
        </li>
      ))}
    </ul>
  );
}
