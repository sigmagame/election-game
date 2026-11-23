"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { PartyMark } from "@/components/party-mark";
import { Button } from "@/components/ui/button";
import { PollShareList, RangeBar } from "@/components/lok-sabha/campaign/poll-projection";
import { UnitName, pct, unitLabel } from "@/components/assembly/campaign/assembly-poll";
import { toCampaignGame, type AssemblyGameSave } from "@/engine/assembly-game-engine";
import { EXIT_POLL_MARGIN, buildExitPoll, type ExitStatePoll, type ExitUnit } from "@/lib/exit-poll";
import { partyColor } from "@/lib/party-style";
import { rangeText } from "@/lib/seat-projection";
import { majorityMark } from "@/types/campaign-profile";
import type { VotingConstituencyResult } from "@/types/lok-sabha-voting";

type Tab = "statevote" | "regionvote" | "alliances" | "stateproj" | "regionproj";
const TABS: Array<[Tab, string]> = [["statevote", "State Vote Share"], ["regionvote", "Regional Vote Share"], ["alliances", "Alliances"], ["stateproj", "State Projection"], ["regionproj", "Regional Projection"]];

function MemberChips({ members }: { members: string[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {members.map((m) => <span key={m} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"><PartyMark id={m} size={14} />{m}</span>)}
    </div>
  );
}

/** The lead card, alliance seats and party seats for the whole state or one region. */
function ProjectionView({ poll, label, game }: { poll: ExitStatePoll | undefined; label: string; game: AssemblyGameSave }) {
  if (!poll) return <p className="text-sm text-muted-foreground">No seats polled here.</p>;
  const mark = (u: ExitUnit) => ({ name: u.name, alliance: u.alliance, isPlayer: u.alliance && u.name === game.allianceName.trim() });
  const units = poll.units;
  const leader = units[0];
  const clear = Boolean(leader) && (units.length === 1 || leader.lo > units[1].hi);
  const split = !clear && units.length >= 2 && units[0].lo === units[0].hi && units[1].lo === units[1].hi && units[0].seats === units[1].seats;
  const alliances = units.filter((u) => u.alliance);
  return (
    <div>
      <div className="rounded-lg border border-border p-3">
        <p className="text-xs text-muted-foreground">Projected to lead · {label}</p>
        {clear && leader ? (
          <>
            <UnitName unit={mark(leader)} className="mt-1 block text-lg font-bold" />
            <MemberChips members={leader.members} />
            <p className="mt-1.5 text-xs text-muted-foreground">{rangeText(leader)} of {poll.total} seats</p>
          </>
        ) : split ? (
          <>
            <p className="mt-1 text-lg font-bold">Split verdict</p>
            <p className="mt-1 text-xs text-muted-foreground">{unitLabel(mark(units[0]))} and {unitLabel(mark(units[1]))} hold {units[0].seats} seat{units[0].seats === 1 ? "" : "s"} each.</p>
          </>
        ) : (
          <p className="mt-1 text-lg font-bold">Too close to call</p>
        )}
      </div>
      {alliances.length ? (
        <>
          <h4 className="mt-4 text-sm font-semibold">Alliance seats</h4>
          <ul className="mt-2 space-y-1 text-sm">{alliances.map((u) => <li key={u.id} className="flex justify-between gap-2"><UnitName unit={mark(u)} block={false} /><span className="tabular-nums">{rangeText(u)}</span></li>)}</ul>
        </>
      ) : null}
      <h4 className="mt-4 text-sm font-semibold">Projected seats</h4>
      <p className="text-xs text-muted-foreground">Parties projected to win at least one seat.</p>
      <ul className="mt-2 space-y-2">
        {poll.parties.map((r) => (
          <li key={r.id}>
            <div className="flex items-center gap-2 text-sm"><PartyMark id={r.id} size={18} /><span className="flex-1">{r.id}</span><span className="tabular-nums">{rangeText(r)}</span></div>
            <div className="mt-1"><RangeBar lo={r.lo} hi={r.hi} max={poll.total} color={partyColor(r.id)} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The exit poll for an Assembly election, drawn over the map once polling has closed. */
export function AssemblyExitPollDrawer({ game, results, onClose }: { game: AssemblyGameSave; results: VotingConstituencyResult[]; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("alliances");
  const regions = useMemo(() => toCampaignGame(game).regions?.[game.state] ?? [], [game]);
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");

  // Same game, same exit poll: every seat is nudged by a seed built from the game and the seat, so regions add up to the state.
  const inputs = useMemo(
    () => ({ gameId: game.gameId, groupsByState: game.stateAllianceGroups ?? {}, playerAllianceName: game.allianceName, majority: majorityMark(game.totalConstituencies) }),
    [game],
  );
  const poll = useMemo(() => buildExitPoll({ ...inputs, results }), [inputs, results]);
  const regionPolls = useMemo(() => {
    const out: Record<string, ExitStatePoll | undefined> = {};
    for (const region of regions) {
      const ids = new Set(region.constituencyIds);
      out[region.id] = buildExitPoll({ ...inputs, results: results.filter((r) => ids.has(r.constituencyId)) }).states[game.state];
    }
    return out;
  }, [inputs, results, regions, game.state]);

  const { total, majority } = poll;
  const statePoll = poll.states[game.state];
  const region = regions.find((r) => r.id === regionId) ?? regions[0];
  const regionPoll = region ? regionPolls[region.id] : undefined;
  const mark = (u: ExitUnit) => ({ name: u.name, alliance: u.alliance, isPlayer: u.alliance && u.name === game.allianceName.trim() });
  const shareOf = (u: ExitUnit) => u.members.reduce((n, id) => n + (poll.voteShare.find(([p]) => p === id)?.[1] ?? 0), 0);

  const lead = poll.national[0];
  const leadName = lead ? unitLabel(mark(lead)) : "";
  const status = !lead ? "HUNG" : lead.lo >= majority ? "MAJORITY" : lead.hi >= majority ? "CLOSE" : "HUNG";
  const badge = status === "MAJORITY" ? ["Majority likely", "bg-success/10 text-success"] : status === "CLOSE" ? ["Too close to call", "bg-amber-500/15 text-amber-700 dark:text-amber-300"] : ["Hung assembly", "bg-amber-500/15 text-amber-700 dark:text-amber-300"];
  const headline = status === "HUNG" ? `No one reaches ${majority}` : status === "MAJORITY" ? `${leadName} reaches ${majority}` : `${leadName} is close to a majority`;
  const subline = !lead ? "" : status === "MAJORITY"
    ? `${leadName} is projected at ${rangeText(lead)} seats, above the ${majority} majority mark.`
    : status === "CLOSE"
      ? `${leadName} is projected at ${rangeText(lead)} seats. The ${majority} majority mark sits inside that range, so it could go either way.`
      : `${leadName} is projected at ${rangeText(lead)} seats, below the ${majority} majority mark. Talks decide the government after results.`;

  const alliances = poll.national.filter((u) => u.alliance);
  const lone = poll.national.filter((u) => !u.alliance);
  const regionSelect = (
    <label className="mb-3 block text-xs text-muted-foreground">Region
      <select value={region?.id ?? ""} onChange={(e) => setRegionId(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
        {regions.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.constituencyIds.length} seats)</option>)}
      </select>
    </label>
  );

  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-black/40" onClick={onClose}>
      <aside className="flex h-full w-full max-w-[600px] flex-col overflow-hidden border-l border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <h3 className="font-heading text-lg font-bold">Exit poll</h3>
            <p className="text-xs text-muted-foreground">Estimated from voters leaving the booths · seat figures are ±{Math.round(EXIT_POLL_MARGIN * 100)}% ranges. Real results can differ.</p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}><X /> Close</Button>
        </div>
        <div className="flex gap-0.5 overflow-x-auto border-b border-border px-3 pt-2">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-semibold ${tab === k ? "border-brand text-brand" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "statevote" ? (
            <div>
              <p className="text-xs text-muted-foreground">Estimated vote share across {game.state}.</p>
              <PollShareList rows={statePoll?.voteShare ?? []} />
            </div>
          ) : tab === "regionvote" ? (
            <div>
              {regionSelect}
              <p className="text-xs text-muted-foreground">Estimated vote share in {region?.name}.</p>
              <PollShareList rows={regionPoll?.voteShare ?? []} />
            </div>
          ) : tab === "stateproj" ? (
            <ProjectionView poll={statePoll} label="Whole state" game={game} />
          ) : tab === "regionproj" ? (
            <div>
              {regionSelect}
              <ProjectionView poll={regionPoll} label={region?.name ?? ""} game={game} />
            </div>
          ) : (
            <div className="space-y-4">
              <section className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-heading text-base font-semibold">Final projection</h4>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge[1]}`}>{badge[0]}</span>
                </div>
                <p className="mt-3 font-heading text-2xl font-semibold leading-tight">{headline}</p>
                <p className="mt-1.5 text-sm text-foreground/80">{subline}</p>
                <div className="relative mt-4">
                  <RangeBar lo={lead?.lo ?? 0} hi={lead?.hi ?? 0} max={total} color={lead ? partyColor(mark(lead).isPlayer ? game.playerPartyId : lead.members[0] ?? lead.name) : "var(--muted)"} thick />
                  <div className="absolute -top-1 h-6 w-0.5 bg-foreground" style={{ left: `${(majority / total) * 100}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>0</span><span>{majority} majority</span><span>{total}</span></div>
                <p className="mt-2 text-xs text-muted-foreground">Exit poll figures are estimates. Seat ranges are ±{Math.round(EXIT_POLL_MARGIN * 100)}%. The bar shows the leading alliance: solid is the low end, faded is the possible extra.</p>
              </section>
              <ul className="space-y-3">
                {alliances.map((a, i) => (
                  <li key={a.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold">{i + 1}. <UnitName unit={mark(a)} className="inline-block align-top" />{mark(a).isPlayer ? <span className="ml-2 text-xs font-normal text-brand">You</span> : null}</span>
                      <span className="text-sm tabular-nums">{rangeText(a)} seats</span>
                    </div>
                    <div className="mt-2"><RangeBar lo={a.lo} hi={a.hi} max={total} color={partyColor(mark(a).isPlayer ? game.playerPartyId : a.members[0] ?? a.name)} thick /></div>
                    <p className="mt-1.5 text-xs text-muted-foreground">Vote share {pct(shareOf(a))}</p>
                    <MemberChips members={a.members} />
                  </li>
                ))}
                {lone.length ? <li className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contesting alone</li> : null}
                {lone.slice(0, 12).map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-sm"><PartyMark id={p.id} size={20} /><span className="flex-1">{p.name}</span><span className="tabular-nums">{rangeText(p)} seats</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
