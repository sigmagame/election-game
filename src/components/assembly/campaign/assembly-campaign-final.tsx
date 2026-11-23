"use client";

import { useMemo, useState } from "react";
import { CampaignMap } from "@/components/campaign/campaign-map";
import { PartyMark } from "@/components/party-mark";
import { Button } from "@/components/ui/button";
import { RangeBar } from "@/components/lok-sabha/campaign/poll-projection";
import type { AssemblyGameSave } from "@/engine/assembly-game-engine";
import { rangeText } from "@/lib/seat-projection";
import type { FinalCampaignReport, LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";
import { RegionChips } from "./assembly-campaign-board";
import { AssemblyPollDrawer, UnitName, pct, signed, tone, unitLabel, useAssemblyProjection, type PollTab } from "./assembly-poll";

export function AssemblyCampaignFinal({
  game,
  campaign,
  report,
  seatNames,
  majority,
  weeks,
  weeksPlayed,
  onProceed,
}: {
  game: AssemblyGameSave;
  campaign: LokSabhaCampaignSave;
  report: FinalCampaignReport;
  seatNames: Record<string, string>;
  majority: number;
  weeks: number;
  weeksPlayed: number;
  onProceed: () => void;
}) {
  const [pollOpen, setPollOpen] = useState(false);
  const [tab, setTab] = useState<PollTab>("statevote");
  const [region, setRegion] = useState("ALL");

  const proj = useAssemblyProjection(game, campaign, report, false);
  const total = game.totalConstituencies;
  const lead = proj.units[0];
  const me = proj.player;
  const rivals = proj.units.filter((u) => !u.isPlayer && u.hi >= 1).slice(0, 4);

  // The leader's range decides the label: if the top of the range reaches the majority mark, it is too close to call.
  const leadLo = lead?.lo ?? 0;
  const leadHi = lead?.hi ?? 0;
  const leadText = lead ? rangeText(lead) : "0";
  const status = leadLo >= majority ? "MAJORITY" : leadHi >= majority ? "CLOSE" : "HUNG";
  const badge = status === "MAJORITY" ? ["Majority projected", "bg-success/10 text-success"] : status === "CLOSE" ? ["Too close to call", "bg-amber-500/15 text-amber-700 dark:text-amber-300"] : ["Hung assembly", "bg-amber-500/15 text-amber-700 dark:text-amber-300"];
  const leadName = lead ? unitLabel(lead) : "";
  const headline = status === "HUNG" ? `No one reaches ${majority}` : status === "MAJORITY" ? `${leadName} is projected to win` : `${leadName} is close to a majority`;
  const subline =
    status === "MAJORITY"
      ? `Projected at ${leadText} seats, above the ${majority} majority mark even at the low end.`
      : status === "CLOSE"
        ? `Projected at ${leadText} seats. The ${majority} majority mark sits inside that range, so it could go either way.`
        : `${leadName} is projected at ${leadText} seats, below the ${majority} majority mark. Talks decide the government after voting.`;

  const changeOf = (id: string) => report.nationalSupportComparison.find((r) => r.partyId === id)?.change ?? 0;
  const myChange = (me?.members ?? []).reduce((n, id) => n + changeOf(id), 0);
  const movers = [...report.nationalSupportComparison].sort((a, b) => b.change - a.change);
  const gainers = movers.filter((m) => m.change > 0).slice(0, 3);
  const losers = movers.filter((m) => m.change < 0).slice(-3).reverse();

  const highlightIds = useMemo(() => {
    if (region === "ALL") return undefined;
    const r = proj.regions.find((x) => x.id === region);
    return r ? new Set(r.constituencyIds) : undefined;
  }, [proj.regions, region]);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-2xl font-bold">Campaign complete</h2>
            <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">{weeksPlayed >= weeks ? `All ${weeks} weeks played` : `Week ${weeksPlayed} of ${weeks} · ended early`}</span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{game.state} Assembly {game.electionYear} · {total} constituencies · majority {majority}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setPollOpen(true)} className="border-brand text-brand hover:text-brand">Final opinion poll</Button>
          <Button onClick={onProceed} className="bg-brand text-brand-foreground hover:bg-brand/90">Proceed to voting →</Button>
        </div>
      </div>
      <div className="mt-4 flex gap-1.5" aria-label={`${weeksPlayed} of ${weeks} weeks played`}>
        {Array.from({ length: weeks }, (_, i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${i < weeksPlayed ? "bg-success" : "bg-muted"}`} />)}
      </div>

      <div className="mt-5 grid gap-4 lg:h-[780px] lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)]">
        <CampaignMap
          kind="assembly"
          state={game.state}
          title="Constituency map"
          subtitle="Seat leads are hidden now so voting day stays a surprise. Pick a region to highlight it."
          support={campaign.constituencySupport}
          names={seatNames}
          playerPartyId={game.playerPartyId}
          masked
          zoomable
          fillHeight
          highlightIds={highlightIds}
          onSelectSeat={(id) => { const r = proj.regions.find((x) => x.constituencyIds.includes(id)); if (r) setRegion(r.id); }}
          belowHeader={<RegionChips regions={proj.regions} total={total} value={region} onChange={setRegion} />}
          overlay={
            pollOpen ? (
              <AssemblyPollDrawer game={game} campaign={campaign} report={report} proj={proj} exact={false} tab={tab} setTab={setTab} regionId={region} onPickRegion={setRegion} lastSummary={null} week={weeksPlayed} onClose={() => setPollOpen(false)} />
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
              {status === "HUNG" ? (
                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="font-heading text-xl font-black tracking-wide text-amber-700 dark:text-amber-200">HUNG ASSEMBLY</p>
                  <p className="mt-1 text-sm text-foreground/80">No alliance is projected to reach {majority} seats. {leadName} is projected at {leadText}. Talks decide the government after voting.</p>
                </div>
              ) : (
                <>
                  <p className="mt-3 font-heading text-2xl font-semibold leading-tight">{headline}</p>
                  <p className="mt-1.5 text-sm text-foreground/80">{subline}</p>
                </>
              )}
              <div className="relative mt-4">
                <RangeBar lo={leadLo} hi={leadHi} max={total} color={lead?.color ?? "var(--muted)"} thick />
                <div className="absolute -top-1 h-6 w-0.5 bg-foreground" style={{ left: `${(majority / total) * 100}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>0</span><span>{majority} majority</span><span>{total}</span></div>
              <p className="mt-2 text-xs text-muted-foreground">Seat figures are estimates. Solid is the low end, faded is the possible extra where a race is within 4 points.</p>
            </section>

            {me ? (
              <section className="shrink-0 rounded-xl border border-border bg-card p-4">
                <h3 className="font-heading text-base font-semibold">Your alliance</h3>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">{me.name}</p>
                    <p className="text-xs text-muted-foreground">You play {game.playerPartyId}</p>
                  </div>
                  <span className="shrink-0 text-lg font-bold tabular-nums">{rangeText(me)} seats</span>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {me.members.map((m) => {
                    const r = proj.ranges[m];
                    const c = changeOf(m);
                    return (
                      <li key={m} className="flex items-center gap-2 text-sm">
                        <PartyMark id={m} size={20} />
                        <span className="flex-1 font-semibold">{m}</span>
                        <span className="tabular-nums">{r ? rangeText(r) : "0"} seats</span>
                        <span className={`w-12 text-right text-xs font-semibold tabular-nums ${tone(c)}`}>{signed(c)}</span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Stat label="Vote share" value={pct(me.voteShare)} />
                  <Stat label="Since week 1" value={signed(myChange)} valueClass={tone(myChange)} />
                </div>
              </section>
            ) : null}

            <section className="shrink-0 rounded-xl border border-border bg-card p-4">
              <h3 className="font-heading text-base font-semibold">Rival alliances</h3>
              {rivals.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No rival is projected to win seats.</p> : (
                <ul className="mt-3 space-y-3">
                  {rivals.map((b) => (
                    <li key={b.key}>
                      <div className="flex items-start justify-between gap-2 text-sm"><UnitName unit={b} className="font-bold" /><span className="tabular-nums text-foreground/80">{rangeText(b)} seats</span></div>
                      <div className="mt-1.5"><RangeBar lo={b.lo} hi={b.hi} max={total} color={b.color} /></div>
                    </li>
                  ))}
                </ul>
              )}
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
            <p className="mt-2 text-center text-xs text-muted-foreground">Campaign actions lock once you proceed.</p>
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
