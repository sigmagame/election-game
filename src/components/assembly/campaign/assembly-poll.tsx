"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { AllianceName } from "@/components/alliance-name";
import { PartyMark } from "@/components/party-mark";
import { Button } from "@/components/ui/button";
import { PollShareList, RangeBar } from "@/components/lok-sabha/campaign/poll-projection";
import { toCampaignGame, type AssemblyGameSave } from "@/engine/assembly-game-engine";
import type { getLastWeeklySummary } from "@/engine/assembly-campaign-engine";
import { allianceShort, partyColor } from "@/lib/party-style";
import { clubRanges, projectPartyRanges, rangeText, type PartyRange } from "@/lib/seat-projection";
import type { CampaignRegion } from "@/types/campaign-profile";
import type { ConstituencyPartySupport, FinalCampaignReport, LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";

export const pct = (v: number) => `${v.toFixed(1)}%`;
export const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
export const tone = (v: number) => (v > 0 ? "text-success" : v < 0 ? "text-destructive" : "text-muted-foreground");

/** One side in the state: an alliance (the player's or a rival) or a party contesting alone. */
export interface PollUnit {
  key: string;
  /** The name as stored. The player's own alliance is shown exactly as typed. */
  name: string;
  isPlayer: boolean;
  alliance: boolean;
  members: string[];
  seats: number;
  lo: number;
  hi: number;
  color: string;
  voteShare: number;
}

interface LocalGroup {
  key: string;
  name: string;
  isPlayer: boolean;
  members: string[];
}

function exactRange<T extends { seats: number; lo: number; hi: number }>(r: T): T {
  return { ...r, lo: r.seats, hi: r.seats };
}

function unitsFor(
  rows: ConstituencyPartySupport[],
  winnerBySeat: Map<string, string>,
  groups: LocalGroup[],
  shareOf: Record<string, number>,
  playerPartyId: string,
  exact: boolean,
) {
  const raw = projectPartyRanges(rows, winnerBySeat);
  const ranges: Record<string, PartyRange> = exact ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, exactRange(v)])) : raw;
  const inGroup = new Set(groups.flatMap((g) => g.members));
  const units: PollUnit[] = [
    ...groups.map((g) => {
      const members = g.members.filter((id) => (ranges[id]?.contested ?? 0) > 0);
      const club = clubRanges(members, ranges);
      return {
        key: g.key,
        name: g.name,
        isPlayer: g.isPlayer,
        alliance: true,
        members,
        seats: members.reduce((n, id) => n + (ranges[id]?.seats ?? 0), 0),
        lo: club.lo,
        hi: club.hi,
        color: partyColor(g.isPlayer ? playerPartyId : members[0] ?? g.name),
        voteShare: members.reduce((n, id) => n + (shareOf[id] ?? 0), 0),
      };
    }),
    ...Object.values(ranges)
      .filter((r) => !inGroup.has(r.partyId))
      .map((r) => ({ key: r.partyId, name: r.partyId, isPlayer: r.partyId === playerPartyId && !groups.some((g) => g.isPlayer), alliance: false, members: [r.partyId], seats: r.seats, lo: r.lo, hi: r.hi, color: partyColor(r.partyId), voteShare: shareOf[r.partyId] ?? 0 })),
  ];
  return { ranges, units: units.filter((u) => u.seats >= 1 || u.hi >= 1).sort((a, b) => b.seats - a.seats || b.hi - a.hi) };
}

/** Who leads a set of seats: alliances and lone parties are compared, not members of one alliance. */
export function leaderOf(units: PollUnit[], exact: boolean) {
  const leader = units[0];
  const clear = Boolean(leader) && (units.length === 1 || (exact ? leader.seats > units[1].seats : leader.lo > units[1].hi));
  const split = !clear && units.length >= 2 && units[0].seats === units[1].seats && (exact || (units[0].lo === units[0].hi && units[1].lo === units[1].hi));
  return { leader, clear, split };
}

export function useAssemblyProjection(game: AssemblyGameSave, campaign: LokSabhaCampaignSave, report: FinalCampaignReport | null, exact: boolean) {
  const regions: CampaignRegion[] = useMemo(() => toCampaignGame(game).regions?.[game.state] ?? [], [game]);
  const winnerBySeat = useMemo(() => new Map((report?.projectedConstituencyWinners ?? []).map((w) => [w.constituencyId, w.partyId])), [report]);
  const shareOf = useMemo(() => Object.fromEntries((report?.partyRows ?? []).map((r) => [r.partyId, r.voteShare])), [report]);
  const groups: LocalGroup[] = useMemo(() => {
    const list = (game.stateAllianceGroups?.[game.state] ?? [])
      .filter((g) => g.type !== "INDEPENDENT" && g.name.trim().toLowerCase() !== "independent")
      .map((g) => ({ key: g.id, name: g.isPlayerAlliance ? game.allianceName : g.name, isPlayer: g.isPlayerAlliance, members: g.memberPartyIds }));
    // A party contesting alone is not an alliance: it shows as a lone party, never as a group called "Independent".
    const soloPlayer = game.allianceType === "independent" || game.alliance?.type === "INDEPENDENT" || game.allianceName.trim().toLowerCase() === "independent";
    if (!soloPlayer && !list.some((g) => g.isPlayer)) {
      list.unshift({ key: "player", name: game.allianceName, isPlayer: true, members: game.alliance.memberPartyIds.length ? game.alliance.memberPartyIds : game.partyIds });
    }
    return list;
  }, [game]);

  const state = useMemo(
    () => unitsFor(campaign.constituencySupport, winnerBySeat, groups, shareOf, game.playerPartyId, exact),
    [campaign.constituencySupport, winnerBySeat, groups, shareOf, game.playerPartyId, exact],
  );
  const regionRows = useMemo(
    () =>
      regions.map((region) => {
        const ids = new Set(region.constituencyIds);
        const rows = campaign.constituencySupport.filter((r) => ids.has(r.constituencyId));
        const { units, ranges } = unitsFor(rows, winnerBySeat, groups, shareOf, game.playerPartyId, exact);
        return { region, total: region.constituencyIds.length, units, ranges, ...leaderOf(units, exact) };
      }),
    [regions, campaign.constituencySupport, winnerBySeat, groups, shareOf, game.playerPartyId, exact],
  );
  const player = state.units.find((u) => u.isPlayer);
  return { regions, regionRows, units: state.units, ranges: state.ranges, player, ...leaderOf(state.units, exact), total: game.totalConstituencies };
}

export type AssemblyProjection = ReturnType<typeof useAssemblyProjection>;

/** The player's own alliance shows exactly as typed; rivals use the short form with the full form below. */
export function UnitName({ unit, className = "", block = true }: { unit: Pick<PollUnit, "name" | "isPlayer" | "alliance">; className?: string; block?: boolean }) {
  if (unit.isPlayer || !unit.alliance) return <span className={className}>{unit.name}</span>;
  return <AllianceName name={unit.name} className={className} block={block} />;
}

export const unitLabel = (u: Pick<PollUnit, "name" | "isPlayer">) => (u.isPlayer ? u.name : allianceShort(u.name));

function MemberChips({ members }: { members: string[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {members.map((m) => <span key={m} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"><PartyMark id={m} size={14} />{m}</span>)}
    </div>
  );
}

export function AlliancesTab({ proj, exact }: { proj: AssemblyProjection; exact: boolean }) {
  const alliances = proj.units.filter((u) => u.alliance && u.hi >= 1);
  const lone = proj.units.filter((u) => !u.alliance && u.hi >= 1);
  return (
    <ul className="space-y-3">
      {alliances.map((a, i) => (
        <li key={a.key} className="rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">{i + 1}. <UnitName unit={a} className="inline-block align-top" />{a.isPlayer ? <span className="ml-2 text-xs font-normal text-brand">You</span> : null}</span>
            <span className="text-sm tabular-nums">{rangeText(a)} seats</span>
          </div>
          <div className="mt-2"><RangeBar lo={a.lo} hi={a.hi} max={proj.total} color={a.color} thick /></div>
          <p className="mt-1.5 text-xs text-muted-foreground">Vote share {pct(a.voteShare)}</p>
          <MemberChips members={a.members} />
        </li>
      ))}
      {lone.length ? <li className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contesting alone</li> : null}
      {lone.slice(0, 12).map((p) => (
        <li key={p.key} className="flex items-center gap-2 text-sm"><PartyMark id={p.name} size={20} /><span className="flex-1">{p.name}</span><span className="tabular-nums">{rangeText(p)} seats · {pct(p.voteShare)}</span></li>
      ))}
      <li className="pt-1 text-xs text-muted-foreground">{exact ? "Exact projected seats from the latest poll." : "Seat figures are ranges: seats decided by 4 points or less can go either way."}</li>
    </ul>
  );
}

function RegionPicker({ regions, value, onChange }: { regions: CampaignRegion[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="block text-xs text-muted-foreground">Region
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
        {regions.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.constituencyIds.length} seats)</option>)}
      </select>
    </label>
  );
}

/** The lead card, alliance seats and party seats for the whole state or one region. */
function ProjectionView({ units, ranges, total, leader, clear, split, label, exact }: { units: PollUnit[]; ranges: Record<string, PartyRange>; total: number; leader: PollUnit | undefined; clear: boolean; split: boolean; label: string; exact: boolean }) {
  const alliances = units.filter((u) => u.alliance && u.hi >= 1);
  const parties = Object.values(ranges).filter((r) => r.hi >= 1).sort((a, b) => b.seats - a.seats || b.hi - a.hi);
  return (
    <div>
      <div className="rounded-lg border border-border p-3">
        <p className="text-xs text-muted-foreground">Projected to lead · {label}</p>
        {clear && leader ? (
          <>
            <UnitName unit={leader} className="mt-1 block text-lg font-bold" />
            <MemberChips members={leader.members} />
            <p className="mt-1.5 text-xs text-muted-foreground">{rangeText(leader)} of {total} seats</p>
          </>
        ) : split ? (
          <>
            <p className="mt-1 text-lg font-bold">Split verdict</p>
            <p className="mt-1 text-xs text-muted-foreground">{unitLabel(units[0])} and {unitLabel(units[1])} hold {units[0].seats} seat{units[0].seats === 1 ? "" : "s"} each.</p>
          </>
        ) : (
          <p className="mt-1 text-lg font-bold">{leader ? "Too close to call" : "No seats projected"}</p>
        )}
      </div>
      {alliances.length ? (
        <>
          <h4 className="mt-4 text-sm font-semibold">Alliance seats</h4>
          <ul className="mt-2 space-y-1 text-sm">{alliances.map((u) => <li key={u.key} className="flex justify-between gap-2"><UnitName unit={u} block={false} /><span className="tabular-nums">{rangeText(u)}</span></li>)}</ul>
        </>
      ) : null}
      <h4 className="mt-4 text-sm font-semibold">Projected seats</h4>
      <p className="text-xs text-muted-foreground">{exact ? "Parties projected to win at least one seat." : "Parties that could win at least one seat. Seats decided by 4 points or less can go either way."}</p>
      <ul className="mt-2 space-y-2">
        {parties.map((r) => (
          <li key={r.partyId}>
            <div className="flex items-center gap-2 text-sm"><PartyMark id={r.partyId} size={18} /><span className="flex-1">{r.partyId}</span><span className="tabular-nums">{rangeText(r)}</span></div>
            <div className="mt-1"><RangeBar lo={r.lo} hi={r.hi} max={total} color={partyColor(r.partyId)} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StateProjectionTab({ proj, exact }: { proj: AssemblyProjection; exact: boolean }) {
  return <ProjectionView units={proj.units} ranges={proj.ranges} total={proj.total} leader={proj.leader} clear={proj.clear} split={proj.split} label="Whole state" exact={exact} />;
}

export function RegionProjectionTab({ proj, exact, regionId, onPick }: { proj: AssemblyProjection; exact: boolean; regionId: string; onPick: (id: string) => void }) {
  const current = proj.regionRows.find((r) => r.region.id === regionId) ?? proj.regionRows[0];
  if (!current) return <p className="text-sm text-muted-foreground">No regions.</p>;
  return (
    <div>
      <RegionPicker regions={proj.regions} value={current.region.id} onChange={onPick} />
      <div className="mt-4">
        <ProjectionView units={current.units} ranges={current.ranges} total={current.total} leader={current.leader} clear={current.clear} split={current.split} label={current.region.name} exact={exact} />
      </div>
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
            <td className={`py-1.5 text-right font-semibold tabular-nums ${tone(r.change)}`}>{r.change > 0 ? "+" : ""}{r.change.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type PollTab = "statevote" | "regionvote" | "alliances" | "stateproj" | "regionproj" | "summary";

/** The opinion poll panel drawn over the map. Mid-campaign it shows exact seats; the final poll shows ranges. */
export function AssemblyPollDrawer({
  game,
  campaign,
  report,
  proj,
  exact,
  tab,
  setTab,
  regionId,
  onPickRegion,
  lastSummary,
  week,
  ongoing = [],
  onClose,
}: {
  game: AssemblyGameSave;
  campaign: LokSabhaCampaignSave;
  report: FinalCampaignReport | null;
  proj: AssemblyProjection;
  exact: boolean;
  tab: PollTab;
  setTab: (t: PollTab) => void;
  regionId: string;
  onPickRegion: (id: string) => void;
  lastSummary: ReturnType<typeof getLastWeeklySummary>;
  week: number;
  ongoing?: string[];
  onClose: () => void;
}) {
  const tabs: Array<[PollTab, string]> = [["statevote", "State Vote Share"], ["regionvote", "Regional Vote Share"], ["alliances", "Alliances"], ["stateproj", "State Projection"], ["regionproj", "Regional Projection"], ["summary", exact ? "Weekly Summary" : `Week 1 vs ${week}`]];
  const voteRegion = proj.regions.find((r) => r.id === regionId) ?? proj.regions[0];
  const regionShare = (() => {
    if (!voteRegion) return [] as Array<[string, number]>;
    const ids = new Set(voteRegion.constituencyIds);
    const totals: Record<string, number> = {};
    for (const row of campaign.constituencySupport) {
      if (!ids.has(row.constituencyId)) continue;
      for (const [id, v] of Object.entries(row.partySupport)) totals[id] = (totals[id] ?? 0) + v;
    }
    const n = Math.max(1, voteRegion.constituencyIds.length);
    return Object.entries(totals).map(([id, v]) => [id, v / n] as [string, number]).sort((a, b) => b[1] - a[1]);
  })();
  const shareRows = Object.entries(report?.stateRows.find((r) => r.state === game.state)?.partySupport ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-black/40" onClick={onClose}>
      <aside className="flex h-full w-full max-w-[600px] flex-col overflow-hidden border-l border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <h3 className="font-heading text-lg font-bold">Opinion poll</h3>
            <p className="text-xs text-muted-foreground">{exact ? `After week ${lastSummary?.week ?? Math.max(0, week - 1)} · exact projected seats` : `Final poll · after week ${week} · seat figures are ranges`}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}><X /> Close</Button>
        </div>
        <div className="flex gap-0.5 overflow-x-auto border-b border-border px-3 pt-2">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-semibold ${tab === k ? "border-brand text-brand" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!report ? (
            <p className="text-sm text-muted-foreground">Calculating projection…</p>
          ) : tab === "alliances" ? (
            <AlliancesTab proj={proj} exact={exact} />
          ) : tab === "stateproj" ? (
            <StateProjectionTab proj={proj} exact={exact} />
          ) : tab === "regionproj" ? (
            <RegionProjectionTab proj={proj} exact={exact} regionId={regionId} onPick={onPickRegion} />
          ) : tab === "statevote" ? (
            <div>
              <p className="text-xs text-muted-foreground">Average support across all {game.totalConstituencies} constituencies.</p>
              <PollShareList rows={shareRows} />
            </div>
          ) : tab === "regionvote" ? (
            <div>
              <RegionPicker regions={proj.regions} value={voteRegion?.id ?? ""} onChange={onPickRegion} />
              <p className="mt-3 text-xs text-muted-foreground">Average support across the {voteRegion?.constituencyIds.length ?? 0} constituencies of {voteRegion?.name}.</p>
              <PollShareList rows={regionShare} />
            </div>
          ) : exact ? (
            lastSummary ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-success">Week {lastSummary.week} completed</p>
                <p className="mt-1 text-sm text-muted-foreground">Processed {lastSummary.constituenciesProcessed} constituencies. Rivals: {lastSummary.aiActivity?.partiesActive ?? 0} parties active, {lastSummary.aiActivity?.actionsPerformed ?? 0} actions.</p>
                {lastSummary.stateChanges[game.state] ? <ChangeTable rows={lastSummary.stateChanges[game.state]} /> : null}
                {lastSummary.events?.map((e) => (
                  <div key={e.id} className="mt-3 rounded-lg border border-brand/20 bg-brand/5 p-3">
                    <p className="text-sm font-semibold text-brand">Event: {e.name}</p>
                    <p className="mt-1 text-xs text-foreground/80">{e.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{e.scope} · {e.location} · {e.sentiment}</p>
                  </div>
                ))}
                {ongoing.length ? <p className="mt-3 text-xs text-muted-foreground">Ongoing: {ongoing.join(" · ")}</p> : null}
              </div>
            ) : <p className="text-sm text-muted-foreground">Complete a week to see its summary here.</p>
          ) : (
            <div>
              <p className="text-xs text-muted-foreground">Statewide vote share, week 1 against week {week} (percentage points).</p>
              <table className="mt-2 w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr><th className="pb-1 text-left">Party</th><th className="pb-1 text-right">Week 1</th><th className="pb-1 text-right">Week {week}</th><th className="pb-1 text-right">Change</th></tr></thead>
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
          )}
        </div>
      </aside>
    </div>
  );
}
