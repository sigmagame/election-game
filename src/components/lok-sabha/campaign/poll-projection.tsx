"use client";

import { useMemo } from "react";
import { PartyMark } from "@/components/party-mark";
import { AllianceName } from "@/components/alliance-name";
import { allianceShort, partyColor } from "@/lib/party-style";
import { CLOSE_MARGIN, clubRanges, projectNational, projectPartyRanges, rangeText } from "@/lib/seat-projection";
import type { LokSabhaGameSave } from "@/types/lok-sabha-game";
import type { FinalCampaignReport, LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";

const pct = (v: number) => `${v.toFixed(1)}%`;

/** The same seat figure with no range: the low and high ends are both the projected seats. */
function exactRange<T extends { seats: number; lo: number; hi: number }>(r: T): T {
  return { ...r, lo: r.seats, hi: r.seats };
}

/**
 * Seat projection for the opinion poll. The final poll (after week 12) shows ranges; the polls during the
 * campaign show the exact projected seats in the same layout (exact = true).
 */
export function useSeatProjection(game: LokSabhaGameSave, campaign: LokSabhaCampaignSave, report: FinalCampaignReport | null, chosenState: string, exact: boolean) {
  const winnerBySeat = useMemo(() => new Map((report?.projectedConstituencyWinners ?? []).map((w) => [w.constituencyId, w.partyId])), [report]);
  const national = useMemo(() => {
    const n = projectNational(campaign.constituencySupport, winnerBySeat, game.stateAllianceGroups ?? {}, game.alliance.name);
    return exact ? { ...n, blocs: n.blocs.map(exactRange), lone: n.lone.map(exactRange), parties: Object.fromEntries(Object.entries(n.parties).map(([k, v]) => [k, exactRange(v)])) } : n;
  }, [campaign.constituencySupport, winnerBySeat, game, exact]);
  const blocs = useMemo(() => national.blocs.filter((b) => b.hi >= 1).sort((a, b) => b.seats - a.seats || b.hi - a.hi), [national]);
  const loneParties = useMemo(() => national.lone.filter((p) => p.hi >= 1).sort((a, b) => b.seats - a.seats || b.hi - a.hi), [national]);
  const ranked = useMemo(
    () =>
      [
        ...blocs.map((b) => ({ id: b.id, name: b.name, seats: b.seats, lo: b.lo, hi: b.hi, color: partyColor(b.members[0] ?? b.name) })),
        ...loneParties.map((p) => ({ id: p.partyId, name: p.partyId, seats: p.seats, lo: p.lo, hi: p.hi, color: partyColor(p.partyId) })),
      ].sort((a, b) => b.seats - a.seats || b.hi - a.hi),
    [blocs, loneParties],
  );

  // State projection: parties first, then added up for alliances.
  const stateRanges = useMemo(() => {
    const r = projectPartyRanges(campaign.constituencySupport.filter((row) => row.state === chosenState), winnerBySeat);
    return exact ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, exactRange(v)])) : r;
  }, [campaign.constituencySupport, chosenState, winnerBySeat, exact]);
  const stateParties = useMemo(() => Object.values(stateRanges).filter((r) => r.hi >= 1).sort((a, b) => b.seats - a.seats || b.hi - a.hi), [stateRanges]);
  const stateBlocs = useMemo(
    () =>
      (game.stateAllianceGroups?.[chosenState] ?? [])
        .filter((g) => g.type !== "INDEPENDENT")
        .map((g) => ({ name: g.isPlayerAlliance ? game.alliance.name : g.name, members: g.memberPartyIds, ...clubRanges(g.memberPartyIds, stateRanges) }))
        .filter((g) => g.hi >= 1)
        .sort((x, y) => y.hi - x.hi),
    [game, chosenState, stateRanges],
  );
  // Who leads the state is decided between alliances and lone parties, not between members of one alliance.
  const stateUnits = useMemo(() => {
    const groups = (game.stateAllianceGroups?.[chosenState] ?? []).filter((g) => g.type !== "INDEPENDENT");
    const inGroup = new Set(groups.flatMap((g) => g.memberPartyIds));
    const units = [
      ...groups.map((g) => {
        const members = g.memberPartyIds.filter((id) => (stateRanges[id]?.contested ?? 0) > 0);
        return { name: g.isPlayerAlliance ? game.alliance.name : g.name, members, alliance: true, seats: members.reduce((n, id) => n + (stateRanges[id]?.seats ?? 0), 0), ...clubRanges(members, stateRanges) };
      }),
      ...Object.values(stateRanges)
        .filter((r) => !inGroup.has(r.partyId))
        .map((r) => ({ name: r.partyId, members: [r.partyId], alliance: false, seats: r.seats, lo: r.lo, hi: r.hi })),
    ];
    return units.filter((u) => u.seats >= 1 || u.hi >= 1).sort((a, b) => b.seats - a.seats || b.hi - a.hi);
  }, [game, chosenState, stateRanges]);
  const leaderUnit = stateUnits[0];
  const leaderClear = Boolean(leaderUnit) && (stateUnits.length === 1 || leaderUnit.lo > stateUnits[1].hi);
  // Two sides each hold the same fixed number of seats, with nothing that could flip: a split, not a toss-up.
  const splitVerdict = !leaderClear && stateUnits.length >= 2 && stateUnits[0].lo === stateUnits[0].hi && stateUnits[1].lo === stateUnits[1].hi && stateUnits[0].seats === stateUnits[1].seats;
  const stateTotal = campaign.constituencySupport.filter((r) => r.state === chosenState).length;
  return { national, blocs, loneParties, ranked, stateRanges, stateParties, stateBlocs, stateUnits, leaderUnit, leaderClear, splitVerdict, stateTotal };
}

export type SeatProjection = ReturnType<typeof useSeatProjection>;

/** A seat bar: solid up to the low end of the range, faded up to the high end (no faded part for exact seats). */
export function RangeBar({ lo, hi, max, color, thick = false }: { lo: number; hi: number; max: number; color: string; thick?: boolean }) {
  const m = max || 1;
  return (
    <div className={`flex overflow-hidden rounded-full bg-muted ${thick ? "h-3" : "h-2"}`}>
      <div className="h-full" style={{ width: `${(lo / m) * 100}%`, background: color }} />
      <div className="h-full opacity-45" style={{ width: `${((hi - lo) / m) * 100}%`, background: color }} />
    </div>
  );
}

export function PollStateSelect({ value, states, onChange }: { value: string; states: string[]; onChange: (s: string) => void }) {
  return (
    <label className="block text-xs text-muted-foreground">State / union territory
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
        {states.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </label>
  );
}

export function PollShareList({ rows }: { rows: Array<[string, number]> }) {
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

/** Alliance cards with seat bars, then parties contesting alone. */
export function AlliancesPollTab({ proj, report, total, seatsLabel = "seats" }: { proj: SeatProjection; report: FinalCampaignReport | null; total: number; seatsLabel?: string }) {
  const { blocs, loneParties } = proj;
  return (
    <ul className="space-y-3">
      {blocs.map((a, i) => {
        const row = report?.allianceRankings.find((x) => x.id === a.id);
        return (
          <li key={a.id} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-2"><span className="font-semibold">{i + 1}. <AllianceName name={a.name} className="inline-block align-top" /></span><span className="text-sm tabular-nums">{rangeText(a)} {seatsLabel}</span></div>
            <div className="mt-2"><RangeBar lo={a.lo} hi={a.hi} max={total} color={partyColor(a.members[0] ?? a.name)} thick /></div>
            {row ? <p className="mt-1.5 text-xs text-muted-foreground">Vote share {pct(row.voteShare)}</p> : null}
            <div className="mt-1.5 flex flex-wrap gap-1.5">{a.members.map((m) => <span key={m} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"><PartyMark id={m} size={14} />{m}</span>)}</div>
          </li>
        );
      })}
      {loneParties.length ? <li className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contesting alone</li> : null}
      {loneParties.slice(0, 12).map((p) => {
        const row = report?.nonAlliedPartyRankings.find((x) => x.partyId === p.partyId);
        return (
          <li key={p.partyId} className="flex items-center gap-2 text-sm"><PartyMark id={p.partyId} size={20} /><span className="flex-1">{p.partyId}</span><span className="tabular-nums">{rangeText(p)} {seatsLabel}{row ? ` · ${pct(row.voteShare)}` : ""}</span></li>
        );
      })}
    </ul>
  );
}

/** One state: the lead card (an alliance with its parties), alliance seats, party seats and vote share. */
export function StatePollTab({ proj, states, chosenState, onChangeState, stateShare, exact }: { proj: SeatProjection; states: string[]; chosenState: string; onChangeState: (s: string) => void; stateShare: Array<[string, number]>; exact: boolean }) {
  const { leaderUnit, leaderClear, splitVerdict, stateUnits, stateBlocs, stateParties, stateTotal } = proj;
  return (
    <div>
      <PollStateSelect value={chosenState} states={states} onChange={onChangeState} />
      <div className="mt-4 rounded-lg border border-border p-3">
        <p className="text-xs text-muted-foreground">Projected to lead</p>
        {leaderClear ? (
          <>
            {leaderUnit.alliance ? (
              <>
                <AllianceName name={leaderUnit.name} className="mt-1 block text-lg font-bold" />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {leaderUnit.members.map((m) => <span key={m} className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-sm font-semibold"><PartyMark id={m} size={18} />{m}</span>)}
                </div>
              </>
            ) : (
              <div className="mt-1 flex items-center gap-2 text-lg font-bold"><PartyMark id={leaderUnit.members[0]} size={26} />{leaderUnit.name}</div>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">{rangeText(leaderUnit)} of {stateTotal} seats</p>
          </>
        ) : splitVerdict ? (
          <>
            <p className="mt-1 text-lg font-bold">Split verdict</p>
            <p className="mt-1 text-xs text-muted-foreground">{allianceShort(stateUnits[0].name)} and {allianceShort(stateUnits[1].name)} hold {stateUnits[0].seats} seat{stateUnits[0].seats === 1 ? "" : "s"} each.</p>
          </>
        ) : (
          <p className="mt-1 text-lg font-bold">{leaderUnit ? "Too close to call" : "No seats projected"}</p>
        )}
      </div>
      {stateBlocs.length ? (
        <>
          <h4 className="mt-4 text-sm font-semibold">Alliance seats</h4>
          <ul className="mt-2 space-y-1 text-sm">{stateBlocs.map((g) => <li key={g.name} className="flex justify-between"><span>{allianceShort(g.name)}</span><span className="tabular-nums">{rangeText(g)}</span></li>)}</ul>
        </>
      ) : null}
      <h4 className="mt-4 text-sm font-semibold">Projected seats</h4>
      <p className="text-xs text-muted-foreground">{exact ? "Parties projected to win at least one seat." : `Parties that could win at least one seat. Seats decided by ${CLOSE_MARGIN} points or less can go either way.`}</p>
      <ul className="mt-2 space-y-2">
        {stateParties.map((r) => (
          <li key={r.partyId}>
            <div className="flex items-center gap-2 text-sm"><PartyMark id={r.partyId} size={18} /><span className="flex-1">{r.partyId}</span><span className="tabular-nums">{rangeText(r)}</span></div>
            <div className="mt-1"><RangeBar lo={r.lo} hi={r.hi} max={stateTotal} color={partyColor(r.partyId)} /></div>
          </li>
        ))}
      </ul>
      <h4 className="mt-5 text-sm font-semibold">Vote share</h4>
      <p className="text-xs text-muted-foreground">All parties contesting in this state.</p>
      <PollShareList rows={stateShare} />
    </div>
  );
}
