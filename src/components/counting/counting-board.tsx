"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AllianceName } from "@/components/alliance-name";
import { ElectionMap } from "@/components/map/election-map";
import { PartyMark } from "@/components/party-mark";
import { Button } from "@/components/ui/button";
import {
  buildCounts,
  countedShare,
  leadChanges,
  longestRound,
  seatAt,
  unitOf,
  type CountingSeatInput,
  type CountUnit,
  type SeatCount,
  type SeatView,
  type UnitContext,
} from "@/engine/counting-engine";
import type { ExitUnit } from "@/lib/exit-poll";
import { allianceFull, partyColor } from "@/lib/party-style";

type Speed = "slow" | "normal" | "fast";
const TICK_MS: Record<Speed, number> = { slow: 1800, normal: 1000, fast: 300 };
const SPEEDS: Array<[Speed, string]> = [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]];
type SeatFilter = "all" | "won" | "early" | "leading" | "close" | "changed";

const fmt = (n: number) => n.toLocaleString("en-IN");
/** A close seat is one where the lead is under 2% of every vote polled. */
const CLOSE_SHARE = 0.02;

export interface CountingBoardProps {
  kind: "lok-sabha" | "assembly";
  /** The state of an Assembly election (for its map). */
  state?: string;
  gameId: string;
  title: string;
  intro: string;
  groupTitle: string;
  groupNoun: string;
  /** One entry per seat, already carrying the real voting result and its counting plan. */
  seats: CountingSeatInput[];
  ctx: UnitContext;
  majority: number;
  /** National exit poll units, to compare against the count as it goes. */
  exitUnits: ExitUnit[];
  resultsHref: string;
  votingHref: string;
  /** Where this game's counting progress is saved, so coming back shows the finished count instead of restarting. */
  saveKey: string;
}

/** Name of an alliance (N.D.A / I.N.D.I.A with full forms for the rivals) or a party contesting alone. */
function UnitLabel({ unit, block = false }: { unit: CountUnit | Pick<ExitUnit, "name" | "alliance"> & { isPlayer?: boolean }; block?: boolean }) {
  if (!unit.alliance || ("isPlayer" in unit && unit.isPlayer && !allianceFull(unit.name))) return <span>{unit.name}</span>;
  return <AllianceName name={unit.name} block={block} />;
}

const colorOf = (unit: CountUnit, ctx: UnitContext) => partyColor(unit.isPlayer && unit.alliance ? ctx.playerPartyId : unit.members[0] ?? unit.name);

export function CountingBoard(props: CountingBoardProps) {
  const { kind, state, gameId, seats, ctx, majority, exitUnits, resultsHref, votingHref, saveKey } = props;
  const counts = useMemo(() => buildCounts(gameId, seats), [gameId, seats]);
  const last = useMemo(() => longestRound(counts), [counts]);
  const [clock, setClock] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(saveKey) ?? "null") as { gameId: string; round: number } | null;
      return saved && saved.gameId === gameId ? Math.min(Math.max(0, saved.round), longestRound(buildCounts(gameId, seats))) : 0;
    } catch {
      return 0;
    }
  });
  const [speed, setSpeed] = useState<Speed>("normal");
  // Counting waits for the player to press Start. Coming back to a count already under way shows it paused.
  const [started, setStarted] = useState(clock >= 1);
  const [paused, setPaused] = useState(clock >= 1 && clock < last);
  const [tallyBy, setTallyBy] = useState<"alliance" | "party">("alliance");
  const [groupName, setGroupName] = useState<string | null>(null);
  const [seatId, setSeatId] = useState<string | null>(null);
  const [filter, setFilter] = useState<SeatFilter>("all");
  const finished = clock >= last;
  // When counting ends, Pause and Skip to end fade out first, then the results button takes their place.
  const [resultsShown, setResultsShown] = useState(clock >= last);
  useEffect(() => {
    if (!finished) return;
    const timer = window.setTimeout(() => setResultsShown(true), 700);
    return () => window.clearTimeout(timer);
  }, [finished]);

  // Progress is saved every round, so leaving and coming back shows the count as it was (or finished).
  useEffect(() => {
    try {
      localStorage.setItem(saveKey, JSON.stringify({ gameId, round: clock }));
    } catch {
      /* storage unavailable */
    }
  }, [saveKey, gameId, clock]);

  // Counting runs on its own: one round per tick, every seat in the election at once.
  useEffect(() => {
    if (!started || paused || finished) return;
    const timer = window.setTimeout(() => setClock((c) => Math.min(last, c + 1)), TICK_MS[speed]);
    return () => window.clearTimeout(timer);
  }, [clock, started, paused, finished, speed, last]);

  const unitCache = useMemo(() => new Map<string, CountUnit>(), [ctx]);
  const unitFor = (state: string, party: string) => {
    const key = `${state}|${party}`;
    let u = unitCache.get(key);
    if (!u) {
      u = unitOf(ctx, state, party);
      unitCache.set(key, u);
    }
    return u;
  };

  const views = counts.map((c) => seatAt(c, clock));
  const indexById = useMemo(() => new Map(counts.map((c, i) => [c.id, i])), [counts]);
  const won = views.filter((v) => v?.won).length;
  const wonEarly = views.filter((v) => v?.wonEarly).length;
  const counted = countedShare(counts, clock);

  // Groups (states, or regions), biggest first.
  const groups = useMemo(() => {
    const byGroup = new Map<string, SeatCount[]>();
    for (const c of counts) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
    return [...byGroup].map(([name, list]) => ({ name, list })).sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name));
  }, [counts]);
  const activeGroup = groups.find((g) => g.name === groupName) ?? groups[0];

  // Columns: the biggest units by their final seats, always including the player's.
  const columns = useMemo(() => {
    const final = new Map<string, { unit: CountUnit; seats: number }>();
    for (const c of counts) {
      const u = unitFor(c.state, c.winnerPartyId);
      final.set(u.id, { unit: u, seats: (final.get(u.id)?.seats ?? 0) + 1 });
    }
    const all = [...final.values()].sort((a, b) => b.seats - a.seats);
    const top = all.slice(0, 4);
    const mine = all.find((x) => x.unit.isPlayer);
    if (mine && !top.includes(mine)) top[top.length - 1] = mine;
    return top.map((x) => x.unit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unitFor reads a cache keyed on ctx
  }, [counts, ctx]);

  // Running tally by alliance or by party.
  type Row = { id: string; unit: CountUnit | null; party: string; won: number; leading: number };
  const tally = useMemo<Row[]>(() => {
    const rows = new Map<string, Row>();
    counts.forEach((c, i) => {
      const v = views[i];
      if (!v) return;
      const unit = unitFor(c.state, v.leaderId);
      const id = tallyBy === "alliance" ? unit.id : v.leaderId;
      const row = rows.get(id) ?? { id, unit: tallyBy === "alliance" ? unit : null, party: v.leaderId, won: 0, leading: 0 };
      if (v.won) row.won++;
      else row.leading++;
      rows.set(id, row);
    });
    return [...rows.values()].sort((a, b) => b.won + b.leading - (a.won + a.leading) || a.id.localeCompare(b.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- views is rebuilt from clock every render
  }, [counts, clock, tallyBy, ctx]);

  // Seats each alliance (or party contesting alone) is ahead in right now, for the exit poll comparison.
  const aheadByUnit = new Map<string, number>();
  counts.forEach((c, i) => {
    const v = views[i];
    if (!v) return;
    const id = unitFor(c.state, v.leaderId).id;
    aheadByUnit.set(id, (aheadByUnit.get(id) ?? 0) + 1);
  });

  const seatsOfGroup = activeGroup.list;
  const shownSeats = seatsOfGroup.filter((c) => {
    const v = views[indexById.get(c.id) ?? 0];
    if (filter === "all") return true;
    if (!v) return false;
    if (filter === "won") return v.won;
    if (filter === "early") return v.wonEarly;
    if (filter === "leading") return !v.won;
    if (filter === "close") return v.leaderShare > 0 && v.lead < c.totalVotes * CLOSE_SHARE;
    return leadChanges(c, clock).length > 0;
  });
  const selected = seatsOfGroup.find((c) => c.id === seatId) ?? shownSeats[0] ?? seatsOfGroup[0];
  const selectedView = selected ? views[indexById.get(selected.id) ?? 0] : null;
  const chips: Array<[SeatFilter, string, number]> = [
    ["all", `All ${seatsOfGroup.length}`, seatsOfGroup.length],
    ["won", "Won", seatsOfGroup.filter((c) => views[indexById.get(c.id) ?? 0]?.won).length],
    ["early", "Won early", seatsOfGroup.filter((c) => views[indexById.get(c.id) ?? 0]?.wonEarly).length],
    ["leading", "Leading", seatsOfGroup.filter((c) => { const v = views[indexById.get(c.id) ?? 0]; return v && !v.won; }).length],
    ["close", "Close margins", 0],
    ["changed", "Lead changed", 0],
  ];

  const seatLine = (c: SeatCount, v: SeatView | null) => {
    if (!v) return "Counting has not begun";
    return `${c.name} · ${v.won ? (v.wonEarly ? "Won" : "Won, count finished") : "Leading"}: ${v.leaderId} by ${fmt(v.lead)} · round ${v.round} of ${c.rounds}`;
  };
  const mapFill = (id: string) => {
    const i = indexById.get(id);
    const v = i === undefined ? null : views[i];
    if (!v || i === undefined) return "var(--muted)";
    const unit = unitFor(counts[i].state, v.leaderId);
    const hex = colorOf(unit, ctx);
    return v.won ? hex : `${hex}66`;
  };

  const scale = majority || 1;
  const closest = [...counts].filter((c) => c.finalMargin >= 0).sort((a, b) => a.finalMargin - b.finalMargin)[0];
  const biggest = [...counts].sort((a, b) => b.finalMargin - a.finalMargin)[0];

  return (
    <main className="mx-auto max-w-[1280px] space-y-5 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{props.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{props.intro}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!started ? (
            <Button size="lg" className="bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => setStarted(true)}>Start counting</Button>
          ) : (
            <>
              <div role="group" aria-label="Counting speed" className="inline-flex animate-in fade-in overflow-hidden rounded-lg border border-border text-sm duration-500">
                {SPEEDS.map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={speed === id} onClick={() => setSpeed(id)} className={`px-3 py-1.5 font-medium transition ${speed === id ? "bg-brand text-brand-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {resultsShown ? (
                <Button asChild className="animate-in fade-in bg-brand text-brand-foreground duration-500 hover:bg-brand/90"><Link href={resultsHref}>View election results →</Link></Button>
              ) : (
                <>
                  <Button variant="outline" disabled={finished} onClick={() => setPaused((p) => !p)} className="transition-opacity duration-700 disabled:opacity-0">{paused ? "Resume" : "Pause"}</Button>
                  <Button variant="outline" disabled={finished} onClick={() => setClock(last)} className="transition-opacity duration-700 disabled:opacity-0">Skip to end</Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {clock < 1 ? "Counting has not begun" : `Round ${clock} of ${last}`} · all {counts.length} constituencies counting
          </h2>
          <span className="text-sm text-muted-foreground">{won} won · {counts.length - won} still leading · about {Math.round(counted * 100)}% of votes counted</span>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${(clock / last) * 100}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground"><span>Round 1</span><span>{Math.round(last / 2)}</span><span>Round {last}</span></div>
        <p className="mt-2 text-xs text-muted-foreground">
          Each seat has its own number of rounds, set by its polling stations; the bar runs to the longest seat ({last}).
          {clock >= 1 ? ` Of the ${won} won so far, ${won - wonEarly} have finished all their rounds and ${wonEarly} were won early with rounds still to count.` : ""}
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <ElectionMap
          kind={kind}
          state={state}
          title="Counting map"
          subtitle="Click a seat to open it below"
          fill={mapFill}
          label={(id) => { const i = indexById.get(id); return i === undefined ? id : seatLine(counts[i], views[i]); }}
          onSelect={(id) => { const i = indexById.get(id); if (i === undefined) return; setGroupName(counts[i].group); setSeatId(id); setFilter("all"); }}
          belowHeader={kind === "assembly" ? (
            <div className="flex flex-wrap gap-2 text-sm">
              {groups.map((g) => (
                <button key={g.name} type="button" onClick={() => { setGroupName(g.name); setSeatId(null); setFilter("all"); }} className={`rounded-full border px-3 py-1 ${g.name === activeGroup.name ? "border-brand bg-brand/10 font-semibold text-brand" : "border-border text-foreground/80 hover:bg-muted"}`}>
                  {g.name} · {g.list.length}
                </button>
              ))}
            </div>
          ) : undefined}
          legend={[{ color: "var(--success)", label: "Solid colour: Won (even if rounds are still to count)" }, { color: "var(--muted)", label: "Faded colour: leading, still counting" }]}
        />

        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-heading text-base font-semibold">Running tally{clock >= 1 ? ` after round ${clock}` : ""}</h2>
              <span className="text-xs text-muted-foreground">Majority mark {majority}</span>
            </div>
            <div className="mt-3 flex gap-1.5 text-sm">
              {(["alliance", "party"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setTallyBy(k)} className={`rounded-lg px-3 py-1.5 font-semibold ${tallyBy === k ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-muted"}`}>{k === "alliance" ? "Alliances" : "Parties"}</button>
              ))}
            </div>
            {tally.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">Seats appear here once round 1 closes.</p> : (
              <ul className="mt-4 space-y-3.5">
                {tally.slice(0, 8).map((r) => {
                  const total = r.won + r.leading;
                  const color = r.unit ? colorOf(r.unit, ctx) : partyColor(r.party);
                  return (
                    <li key={r.id}>
                      <div className="flex items-start justify-between gap-2 text-sm">
                        <span className="font-semibold">{r.unit ? <UnitLabel unit={r.unit} block /> : <span className="inline-flex items-center gap-1.5"><PartyMark id={r.party} size={16} />{r.party}</span>}{r.unit?.isPlayer || (!r.unit && r.party === ctx.playerPartyId) ? <span className="ml-2 text-xs font-normal text-brand">You</span> : null}</span>
                        <span className="shrink-0 tabular-nums"><b>{total}</b> <span className="text-xs text-muted-foreground">({r.won} won · {r.leading} leading)</span></span>
                      </div>
                      <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                        <div className="absolute inset-y-0 left-0" style={{ width: `${Math.min(100, (r.won / scale) * 100)}%`, background: color }} />
                        <div className="absolute inset-y-0" style={{ left: `${Math.min(100, (r.won / scale) * 100)}%`, width: `${Math.min(100 - Math.min(100, (r.won / scale) * 100), (r.leading / scale) * 100)}%`, background: `${color}66` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">Bars run to {majority}. Solid is seats won, faded is seats still leading. Round by round, seats can swing. A party contesting alone shows under its own name.</p>
          </section>

          <section className="rounded-xl border border-brand/40 bg-brand/5 p-4">
            <h2 className="font-heading text-base font-semibold">Exit poll vs the count now</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {exitUnits.slice(0, 5).map((u) => {
                const ahead = aheadByUnit.get(u.id) ?? 0;
                return (
                  <li key={u.id} className="flex justify-between gap-2">
                    <UnitLabel unit={{ ...u, isPlayer: u.alliance && u.name === ctx.playerAllianceName.trim() }} />
                    <span className="text-muted-foreground">exit poll {u.lo} – {u.hi} · {clock >= 1 ? `ahead in ${ahead}` : "count not begun"}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-base font-semibold">{props.groupTitle}</h2>
          <span className="text-xs text-muted-foreground">Seats won or leading for each group. Round shows the longest seat. Click a row to see its seats.</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">{props.groupNoun}</th><th className="py-2 pr-2 font-medium">Seats</th><th className="py-2 pr-2 font-medium">Round</th>
                {columns.map((u) => <th key={u.id} className="py-2 pr-2 font-medium"><UnitLabel unit={u} /></th>)}
                <th className="py-2 pr-2 font-medium">Others</th><th className="py-2 text-right font-medium">Declared</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const mine = g.list.map((c) => ({ c, v: views[indexById.get(c.id) ?? 0] }));
                const longest = Math.max(...g.list.map((c) => c.rounds));
                const perColumn = columns.map((u) => mine.filter(({ c, v }) => v && unitFor(c.state, v.leaderId).id === u.id).length);
                const others = mine.filter(({ v }) => v).length - perColumn.reduce((a, b) => a + b, 0);
                const decl = mine.filter(({ v }) => v?.won).length;
                return (
                  <tr key={g.name} onClick={() => { setGroupName(g.name); setSeatId(null); setFilter("all"); }} className={`cursor-pointer border-b border-border/60 ${g.name === activeGroup.name ? "bg-brand/5" : "hover:bg-muted/50"}`}>
                    <td className="py-2.5 pr-2 font-semibold">{g.name}</td>
                    <td className="py-2.5 pr-2">{g.list.length}</td>
                    <td className="py-2.5 pr-2 tabular-nums">{clock >= longest ? `Done · ${longest}` : `${Math.min(clock, longest)} / ${longest}`}</td>
                    {perColumn.map((n, i) => <td key={columns[i].id} className={`py-2.5 pr-2 tabular-nums ${columns[i].isPlayer ? "font-semibold text-brand" : ""}`}>{n}</td>)}
                    <td className="py-2.5 pr-2 tabular-nums">{Math.max(0, others)}</td>
                    <td className="py-2.5 text-right tabular-nums">{decl} won</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-base font-semibold">{activeGroup.name} · seat by seat</h2>
            <div className="flex flex-wrap gap-1.5 text-sm">
              {chips.map(([id, label, n]) => (
                <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded-lg px-3 py-1.5 ${filter === id ? "bg-brand font-semibold text-brand-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                  {label}{id === "close" || id === "changed" || id === "all" ? "" : ` ${n}`}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 max-h-[460px] overflow-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Constituency</th><th className="py-2 pr-2 font-medium">Round</th><th className="py-2 pr-2 font-medium">Status</th>
                  <th className="py-2 pr-2 font-medium">Leading / won</th><th className="py-2 pr-2 font-medium">Trailing</th><th className="py-2 text-right font-medium">Lead now</th>
                </tr>
              </thead>
              <tbody>
                {shownSeats.map((c) => {
                  const v = views[indexById.get(c.id) ?? 0];
                  const close = v ? v.lead < c.totalVotes * CLOSE_SHARE : false;
                  const left = c.rounds - (v?.round ?? 0);
                  return (
                    <tr key={c.id} onClick={() => setSeatId(c.id)} className={`cursor-pointer border-b border-border/60 ${c.id === selected.id ? "bg-brand/5" : "hover:bg-muted/50"}`}>
                      <td className="py-2.5 pr-2 font-semibold">{c.name}{c.id === selected.id ? <span className="ml-2 text-xs font-normal text-brand">open below</span> : null}</td>
                      <td className="py-2.5 pr-2 tabular-nums">{v ? `${v.round} / ${c.rounds}` : `0 / ${c.rounds}`}</td>
                      <td className="py-2.5 pr-2">
                        {!v ? <span className="text-xs text-muted-foreground">Waiting</span> : v.won ? (
                          <span><span className="rounded-full bg-success px-2.5 py-0.5 text-xs font-bold text-white">Won</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{v.wonEarly ? `${left} round${left === 1 ? "" : "s"} still to count` : "Count finished"}</span></span>
                        ) : <span className="rounded-full border border-brand px-2.5 py-0.5 text-xs font-bold text-brand">Leading</span>}
                      </td>
                      <td className="py-2.5 pr-2">{v ? <span className={`${columns.find((u) => u.id === unitFor(c.state, v.leaderId).id)?.isPlayer ? "font-semibold text-brand" : ""}`}>{v.leaderId} · {fmt(v.leaderVotes)}</span> : "—"}</td>
                      <td className="py-2.5 pr-2 text-muted-foreground">{v && v.runnerId ? `${v.runnerId} · ${fmt(v.runnerVotes)}` : "—"}</td>
                      <td className={`py-2.5 text-right tabular-nums ${close && v && !v.done ? "font-semibold text-brand" : ""}`}>{v ? `+${fmt(v.lead)}${v.done ? " final" : close ? " · close" : ""}` : "—"}</td>
                    </tr>
                  );
                })}
                {shownSeats.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No seats match this filter yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <RoundByRound count={selected} view={selectedView} clock={clock} />
        </section>
      ) : null}

      <section className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 ${finished ? "border-success/40 bg-success/5" : "border-border bg-card"}`}>
        <div>
          <p className={`font-semibold ${finished ? "text-success" : ""}`}>{finished ? `Counting is complete · all ${counts.length} seats are won` : `When round ${last} closes (the longest seat)`}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {finished
              ? `Every seat shows its final margin. Closest contest: ${closest?.name} (${fmt(closest?.finalMargin ?? 0)} votes). Biggest margin: ${biggest?.name} (${fmt(biggest?.finalMargin ?? 0)} votes).`
              : "Every seat has finished its own rounds and shows its final margin. Seats where no party has over half the votes are won on the last round by the biggest count. The tally then shows only seats won."}
          </p>
        </div>
      </section>
      <p className="text-xs text-muted-foreground">Counting uses the votes already cast. <Link href={votingHref} className="underline underline-offset-4">Back to voting</Link></p>
    </main>
  );
}

/** Every counted round of one seat: who led, the share of all polled votes, and when it was won. */
function RoundByRound({ count, view, clock }: { count: SeatCount; view: SeatView | null; clock: number }) {
  if (!view) return null;
  const upTo = Math.min(clock, count.rounds);
  const changes = new Set(leadChanges(count, clock));
  const rows = Array.from({ length: upTo }, (_, i) => {
    const v = seatAt(count, i + 1)!;
    return { r: i + 1, v };
  });
  const half = Math.floor(count.totalVotes / 2) + 1;
  return (
    <div className="mt-5 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{count.name} · round by round</h3>
        <span className="text-xs text-muted-foreground">{fmt(count.totalVotes)} votes polled · {count.rounds} rounds · {count.stations} polling stations · more than half is {fmt(half)}</span>
      </div>
      <div className="mt-3 max-h-[360px] overflow-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 bg-background"><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-2 pr-2 font-medium">Round</th><th className="py-2 pr-2 font-medium">Leading</th><th className="py-2 pr-2 font-medium">Trailing</th><th className="py-2 pr-2 font-medium">Share of all polled</th><th className="py-2 text-right font-medium">Lead</th></tr></thead>
          <tbody>
            {rows.map(({ r, v }) => (
              <tr key={r} className={`border-b border-border/50 ${r === count.wonAt && v.won ? "bg-success/10" : ""} ${changes.has(r) ? "text-brand" : ""}`}>
                <td className="py-1.5 pr-2 tabular-nums">{r}</td>
                <td className="py-1.5 pr-2">{v.leaderId} · {fmt(v.leaderVotes)}{changes.has(r) ? " ↑" : ""}{r === count.wonAt ? <span className="ml-2 rounded-full bg-success px-2 py-0.5 text-[11px] font-bold text-white">WON</span> : null}</td>
                <td className="py-1.5 pr-2 text-muted-foreground">{v.runnerId ? `${v.runnerId} · ${fmt(v.runnerVotes)}` : "—"}</td>
                <td className="py-1.5 pr-2 tabular-nums">{(v.leaderShare * 100).toFixed(1)}%</td>
                <td className="py-1.5 text-right tabular-nums">+{fmt(v.lead)}{r === count.rounds ? " final" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {count.early
          ? `This seat flips from Leading to Won in round ${count.wonAt}, when the leader passes half of all polled votes. ${count.rounds - upTo > 0 ? `Rounds ${upTo + 1} to ${count.rounds} are still to count and only they decide the final margin.` : `Rounds ${count.wonAt + 1} to ${count.rounds} only added to the margin.`}`
          : "No party passes half of all polled votes before the end, so this seat is won when its last round closes."}
        {" "}An arrow marks a round where the lead changed hands.
      </p>
    </div>
  );
}
