"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { AllianceName } from "@/components/alliance-name";
import { PartyMark } from "@/components/party-mark";
import { ResultsMaps } from "@/components/results/results-maps";
import { allianceColor, allianceShort } from "@/lib/party-style";
import { ResultsOverview, StatBox } from "@/components/results/results-overview";
import { Button } from "@/components/ui/button";
import { getAssemblyMajority } from "@/engine/assembly-campaign-engine";
import { loadAssemblyGame, type AssemblyGameSave } from "@/engine/assembly-game-engine";
import { loadAssemblyVoting, type AssemblyVotingSave } from "@/engine/assembly-voting-engine";
import partiesData from "@/data/parties.json";

const partyNames = Object.fromEntries(
  (partiesData.parties as Array<{ id: string; name: string }>).map((party) => [
    party.id,
    party.name,
  ]),
);
const nameOf = (id: string) => partyNames[id] ?? id;
const fmt = (value: number) => value.toLocaleString("en-IN");
const pct = (value: number) => `${value.toFixed(2)}%`;

const TABS = [
  "Overview",
  "Party Results",
  "Alliance Results",
  "Maps",
  "Constituency Results",
  "Region Results",
  "Voter Turnout",
] as const;
type Tab = (typeof TABS)[number];

interface SeatRow {
  id: string;
  name: string;
  region: string;
  winnerId: string;
  winnerName: string;
  allianceName: string;
  winnerVotes: number;
  runnerUpName: string;
  margin: number;
  turnout: number;
}

export default function AssemblyResultsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [game, setGame] = useState<AssemblyGameSave | null>(null);
  const [voting, setVoting] = useState<AssemblyVotingSave | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [query, setQuery] = useState("");
  const [regionFilter, setRegionFilter] = useState("All regions");
  const [partyFilter, setPartyFilter] = useState("All parties");
  const [allianceTab, setAllianceTab] = useState<"overview" | "tally">("overview");

  useEffect(() => {
    const saved = loadAssemblyGame();
    if (!saved) {
      router.replace("/elections/assembly/new-game");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates client-only saved state after mount (localStorage is unavailable during SSR)
    setGame(saved);
    setVoting(loadAssemblyVoting(saved.gameId));
    setReady(true);
  }, [router]);

  const data = useMemo(() => {
    if (!game || !voting) return null;
    const regionNames = new Map(
      game.allocation.regionalShares.map((share) => [share.regionId, share.regionName]),
    );
    const seatsById = new Map(game.constituencies.map((seat) => [seat.id, seat]));

    const seats: SeatRow[] = voting.results.map((result) => {
      const seat = seatsById.get(result.constituencyId);
      const ranking = Object.entries(result.partyVotes).sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      );
      const [winner, runnerUp] = ranking;
      return {
        id: result.constituencyId,
        name: seat?.name ?? result.constituencyId,
        region: regionNames.get(seat?.regionId ?? "") ?? seat?.regionId ?? "—",
        winnerId: result.winnerPartyId,
        winnerName: nameOf(result.winnerPartyId),
        allianceName:
          seat?.allocations.find((allocation) => allocation.partyId === result.winnerPartyId)
            ?.allianceName ?? "Independent",
        winnerVotes: winner?.[1] ?? 0,
        runnerUpName: runnerUp ? nameOf(runnerUp[0]) : "—",
        margin: (winner?.[1] ?? 0) - (runnerUp?.[1] ?? 0),
        turnout: result.turnoutRate * 100,
      };
    });

    const registered = voting.results.reduce((sum, result) => sum + result.registeredElectors, 0);
    const polled = voting.results.reduce((sum, result) => sum + result.totalVotes, 0);
    const nota = voting.results.reduce((sum, result) => sum + result.notaVotes, 0);
    const valid = polled - nota;

    const seatsWon: Record<string, number> = {};
    const contested: Record<string, number> = {};
    const votesByParty: Record<string, number> = {};
    const alliances: Record<
      string,
      { seats: number; contested: number; votes: number; parties: Set<string> }
    > = {};
    const regions: Record<
      string,
      { seats: number; registered: number; polled: number; wins: Record<string, number>; allianceWins: Record<string, number> }
    > = {};
    const allianceEntry = (name: string) =>
      (alliances[name] ??= { seats: 0, contested: 0, votes: 0, parties: new Set<string>() });

    voting.results.forEach((result, index) => {
      const seat = seatsById.get(result.constituencyId);
      seatsWon[result.winnerPartyId] = (seatsWon[result.winnerPartyId] ?? 0) + 1;
      const winningGroup = allianceEntry(seats[index].allianceName);
      winningGroup.seats += 1;
      winningGroup.parties.add(result.winnerPartyId);

      const countedAlliances = new Set<string>();
      for (const allocation of seat?.allocations ?? []) {
        contested[allocation.partyId] = (contested[allocation.partyId] ?? 0) + 1;
        if (!countedAlliances.has(allocation.allianceName)) {
          allianceEntry(allocation.allianceName).contested += 1;
          countedAlliances.add(allocation.allianceName);
        }
      }
      for (const [partyId, count] of Object.entries(result.partyVotes)) {
        votesByParty[partyId] = (votesByParty[partyId] ?? 0) + count;
        const group = allianceEntry(
          seat?.allocations.find((allocation) => allocation.partyId === partyId)?.allianceName ??
            "Independent",
        );
        group.votes += count;
        group.parties.add(partyId);
      }

      const region = (regions[seats[index].region] ??= {
        seats: 0,
        registered: 0,
        polled: 0,
        wins: {},
        allianceWins: {},
      });
      region.seats += 1;
      region.registered += result.registeredElectors;
      region.polled += result.totalVotes;
      region.wins[result.winnerPartyId] = (region.wins[result.winnerPartyId] ?? 0) + 1;
      const winningAlliance = seats[index].allianceName;
      region.allianceWins[winningAlliance] = (region.allianceWins[winningAlliance] ?? 0) + 1;
    });

    const partyRows = Object.entries(votesByParty)
      .map(([id, votes]) => ({
        id,
        name: nameOf(id),
        seats: seatsWon[id] ?? 0,
        contested: contested[id] ?? 0,
        votes,
        share: valid ? (votes / valid) * 100 : 0,
      }))
      .sort((a, b) => b.seats - a.seats || b.votes - a.votes);
    const allianceRows = Object.entries(alliances)
      .map(([name, row]) => ({
        name,
        seats: row.seats,
        contested: row.contested,
        votes: row.votes,
        share: valid ? (row.votes / valid) * 100 : 0,
        parties: [...row.parties],
      }))
      .sort((a, b) => b.seats - a.seats || b.votes - a.votes);
    const regionRows = Object.entries(regions)
      .map(([name, row]) => {
        const lead = Object.entries(row.allianceWins).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        return {
          name,
          seats: row.seats,
          registered: row.registered,
          polled: row.polled,
          turnout: row.registered ? (row.polled / row.registered) * 100 : 0,
          leadAlliance: lead?.[0] ?? "",
          leadSeats: lead?.[1] ?? 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      seats,
      registered,
      polled,
      nota,
      valid,
      seatsWon,
      partyRows,
      allianceRows,
      regionRows,
      turnout: registered ? (polled / registered) * 100 : 0,
    };
  }, [game, voting]);

  const filteredSeats = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.seats
      .filter(
        (seat) =>
          (regionFilter === "All regions" || seat.region === regionFilter) &&
          (partyFilter === "All parties" || seat.winnerId === partyFilter),
      )
      .filter(
        (seat) => !q || `${seat.name} ${seat.region} ${seat.winnerName}`.toLowerCase().includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, query, regionFilter, partyFilter]);

  if (!ready || !game) {
    return (
      <p className="p-8 text-muted-foreground">Loading election results…</p>
    );
  }

  if (!voting || !data || data.seats.length !== game.totalConstituencies) {
    return (
      <main className="mx-auto max-w-[1280px] px-6 py-8">
        <section className="max-w-xl rounded-2xl border border-border bg-card p-8 text-center">
          <h1 className="text-2xl font-black">Results are still sealed</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Results unlock once polling day has been held for all {game.totalConstituencies}{" "}
            constituencies.
          </p>
          <Link
            href="/elections/assembly/voting"
            className="mt-5 inline-flex rounded-xl bg-brand text-brand-foreground px-5 py-3 font-bold hover:opacity-90"
          >
            Go to voting
          </Link>
        </section>
      </main>
    );
  }

  const majority = getAssemblyMajority(game);
  const topAlliance = data.allianceRows[0];
  const hung = !topAlliance || topAlliance.seats < majority;
  const topParty = data.partyRows[0];
  const playerSeats = data.seatsWon[game.playerPartyId] ?? 0;
  // Found by the group's flag, not game.alliance.name: a solo player's group is listed under the
  // party's name on the ballot, while the save stores the label "Independent".
  const playerGroupName =
    game.stateAllianceGroups[game.state]?.find((group) => group.isPlayerAlliance)?.name ??
    game.alliance.name;
  const myAlliance = data.allianceRows.find((row) => row.name === playerGroupName);
  /** The player's own group shows exactly as typed; rival groups use the short form (N.D.A, I.N.D.I.A). */
  const shown = (name: string) => (name === playerGroupName ? name : allianceShort(name));
  const groupName = (name: string) => (name === playerGroupName ? <span className="font-semibold">{name}</span> : <AllianceName name={name} className="font-semibold" />);
  const groupList = data.allianceRows.map((a) => {
    const parties = a.parties.map((id) => ({ name: nameOf(id), seats: data.seatsWon[id] ?? 0 })).sort((x, y) => y.seats - x.seats);
    return { name: a.name, seats: a.seats, parties, color: allianceColor(parties, a.name === playerGroupName ? game.alliance.color : undefined) };
  });
  // The alliance each party most often won under, shown beside it in the party-map legend.
  const partyAlliance = new Map<string, string>();
  {
    const tally = new Map<string, Map<string, number>>();
    for (const row of data.seats) {
      const m = tally.get(row.winnerId) ?? new Map<string, number>();
      m.set(row.allianceName, (m.get(row.allianceName) ?? 0) + 1);
      tally.set(row.winnerId, m);
    }
    tally.forEach((m, id) => partyAlliance.set(id, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]));
  }
  const playerGroupWon = !hung && topAlliance.name === playerGroupName;

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-8">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold">Results</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {game.state} · {game.electionYear} · All {game.totalConstituencies} constituencies declared
            </p>
          </div>
          <Button onClick={() => router.push("/elections/assembly/government-formation")}>
            Next: Government formation <ArrowRight size={16} />
          </Button>
        </div>

        <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Constituencies declared"
            value={`${data.seats.length} / ${game.totalConstituencies}`}
            detail="Polling held in one day"
          />
          <Metric
            label="Registered electors"
            value={fmt(data.registered)}
            detail={`Across ${game.state}`}
          />
          <Metric
            label="Votes polled"
            value={fmt(data.polled)}
            detail={`${pct(data.turnout)} turnout`}
          />
          <Metric
            label="Majority mark"
            value={`${majority} seats`}
            detail={`${majority} of ${game.totalConstituencies} seats needed`}
          />
        </section>

        <div className="mt-6 flex gap-2 overflow-x-auto border-b border-border pb-2">
          {TABS.map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold ${tab === item ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {item}
            </button>
          ))}
        </div>

        {tab === "Overview" && (
          <div className="mt-6">
            <ResultsOverview
              total={game.totalConstituencies}
              majority={majority}
              groups={groupList}
              outcome={hung
                ? { hung: true, title: "Hung assembly", text: `No group reached ${majority} seats. The largest, ${topAlliance ? shown(topAlliance.name) : "—"}, won ${topAlliance?.seats ?? 0}.` }
                : { hung: false, title: `${shown(topAlliance.name)} won a majority`, text: `${topAlliance.seats} seats · ${pct(topAlliance.share)} of valid votes · ${topAlliance.seats - majority} above the majority mark.` }}
              nextHint={hung ? `No group has ${majority} seats, so Negotiation opens next.` : "A group has a majority: go straight to Government."}
              partyRows={data.partyRows.map((p) => ({ name: p.name, seats: p.seats, share: p.share, votes: p.votes }))}
              mapCaption=""
              compact
              performance={
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label={`Your party · ${game.playerPartyId}`} value={playerSeats} note="Seats won" />
                  <StatBox
                    label={`Your group · ${playerGroupName}`}
                    value={myAlliance?.seats ?? 0}
                    note={playerGroupWon ? "Majority secured" : hung ? `${Math.max(0, majority - (myAlliance?.seats ?? 0))} short of majority` : "Not the winning group"}
                  />
                </div>
              }
            />
          </div>
        )}

        {tab === "Party Results" && (
          <div className="mt-6">
            <Panel title="Party-wise performance">
              <DataTable
                headers={[
                  "Rank",
                  "Party",
                  "Seats contested",
                  "Seats won",
                  "Total votes",
                  "Valid vote share",
                ]}
                rows={data.partyRows.map((row, index) => [
                  String(index + 1),
                  row.name,
                  fmt(row.contested),
                  fmt(row.seats),
                  fmt(row.votes),
                  pct(row.share),
                ])}
              />
            </Panel>
          </div>
        )}

        {tab === "Alliance Results" && (
          <div className="mt-6 space-y-5">
            <div role="group" aria-label="Alliance views" className="inline-flex gap-1 rounded-lg bg-muted p-1 text-sm font-semibold">
              {([["overview", "Seats Overview"], ["tally", "Seat Tally"]] as Array<["overview" | "tally", string]>).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={allianceTab === k} onClick={() => setAllianceTab(k)} className={`rounded-md px-4 py-2 ${allianceTab === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
              ))}
            </div>
            {allianceTab === "overview" && (
              <Panel title="Alliance seats">
                <div className="-mt-2 mb-3 text-right text-sm text-muted-foreground">Majority mark: {majority}</div>
                <div className="space-y-4">
                  {groupList.filter((g) => g.seats > 0).map((g) => (
                    <div key={g.name} className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        {groupName(g.name)}
                        <span className="text-muted-foreground">{g.seats} seats</span>
                      </div>
                      <div className="relative h-6 rounded-md bg-muted">
                        <div className="h-full rounded-md" style={{ width: `${(g.seats / game.totalConstituencies) * 100}%`, background: g.color }} />
                        <div className="absolute -bottom-1 -top-1 w-0.5 bg-foreground/70" style={{ left: `${(majority / game.totalConstituencies) * 100}%` }} />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {g.parties.filter((p) => p.seats > 0).map((p) => (
                          <span key={p.name} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs"><PartyMark id={p.name} size={14} />{p.name} {p.seats}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Every bar uses the same scale; member parties are listed under each front. The line marks the majority.</p>
              </Panel>
            )}
            {allianceTab === "tally" && (
              <Panel title="Alliance-wise seat tally">
                <p className="mb-4 text-sm text-muted-foreground">
                  Party votes are grouped using each party&apos;s constituency allocation. Your own alliance keeps the name you gave it. Seats are credited to the alliance of the constituency winner.
                </p>
                <DataTable
                  headers={["Alliance / group", "Seats contested", "Seats won", "Total votes", "Valid vote share", "Parties"]}
                  rows={data.allianceRows.map((row) => [
                    groupName(row.name),
                    fmt(row.contested),
                    fmt(row.seats),
                    fmt(row.votes),
                    pct(row.share),
                    row.parties.map(nameOf).join(", "),
                  ])}
                />
              </Panel>
            )}
          </div>
        )}

        {tab === "Maps" && (
          <div className="mt-6">
            <ResultsMaps
              kind="assembly"
              state={game.state}
              seats={data.seats.map((r) => ({ constituencyId: r.id, name: r.name, winnerPartyId: r.winnerId, winnerName: r.winnerName, allianceName: r.allianceName, margin: r.margin }))}
              groups={groupList.map((g) => ({ name: g.name, seats: g.seats, color: g.color }))}
              parties={data.partyRows.filter((p) => p.seats > 0).map((p) => ({ id: p.id, name: p.name, seats: p.seats, alliance: shown(partyAlliance.get(p.id) ?? "Independent") }))}
              playerGroupName={playerGroupName}
            />
          </div>
        )}

        {tab === "Constituency Results" && (
          <div className="mt-6">
            <Panel title="Constituency-wise declared results">
              <div className="mb-4 grid gap-3 md:grid-cols-4">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search constituency, region or winner"
                  className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm md:col-span-2"
                />
                <select
                  value={regionFilter}
                  onChange={(event) => setRegionFilter(event.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                >
                  <option>All regions</option>
                  {data.regionRows.map((row) => (
                    <option key={row.name}>{row.name}</option>
                  ))}
                </select>
                <select
                  value={partyFilter}
                  onChange={(event) => setPartyFilter(event.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                >
                  <option>All parties</option>
                  {data.partyRows
                    .filter((row) => row.seats > 0)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                </select>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                Showing {filteredSeats.length} of {data.seats.length} constituencies
              </p>
              <DataTable
                headers={[
                  "Constituency",
                  "Region",
                  "Winner",
                  "Winner votes",
                  "Runner-up",
                  "Margin",
                  "Turnout",
                ]}
                rows={filteredSeats.map((seat) => [
                  seat.name,
                  seat.region,
                  seat.winnerName,
                  fmt(seat.winnerVotes),
                  seat.runnerUpName,
                  fmt(seat.margin),
                  pct(seat.turnout),
                ])}
              />
            </Panel>
          </div>
        )}

        {tab === "Region Results" && (
          <div className="mt-6">
            <Panel title={`Regions of ${game.state}`}>
              <p className="mb-4 text-sm text-muted-foreground">
                The leading alliance is the one that won the most seats in the region. Your own alliance keeps the name you gave it.
              </p>
              <DataTable
                headers={["Region", "Constituencies", "Leading alliance", "Seats won", "Registered electors", "Votes polled", "Turnout"]}
                rows={data.regionRows.map((row) => [
                  <span key="n" className="font-semibold text-foreground">{row.name}</span>,
                  String(row.seats),
                  row.leadAlliance ? groupName(row.leadAlliance) : "—",
                  `${row.leadSeats} of ${row.seats} seats`,
                  fmt(row.registered),
                  fmt(row.polled),
                  pct(row.turnout),
                ])}
              />
            </Panel>
          </div>
        )}

        {tab === "Voter Turnout" && (
          <div className="mt-6 space-y-5">
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="Overall turnout"
                value={pct(data.turnout)}
                detail="Votes polled / registered electors"
              />
              <Metric label="Valid votes" value={fmt(data.valid)} detail="Party votes only" />
              <Metric
                label="NOTA votes"
                value={fmt(data.nota)}
                detail={`${pct(data.polled ? (data.nota / data.polled) * 100 : 0)} of votes polled`}
              />
              <Metric
                label="Non-voters"
                value={fmt(data.registered - data.polled)}
                detail="Registered electors who did not vote"
              />
            </section>
            <Panel title="Turnout by region">
              <DataTable
                headers={["Region", "Turnout", "Votes polled", "Registered electors"]}
                rows={[...data.regionRows]
                  .sort((a, b) => b.turnout - a.turnout)
                  .map((row) => [row.name, pct(row.turnout), fmt(row.polled), fmt(row.registered)])}
              />
            </Panel>
          </div>
        )}

        <footer className="mt-8 flex flex-wrap justify-between gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
          <span>Result data is calculated from the saved constituency voting records.</span>
          <Link href="/elections/assembly" className="underline underline-offset-4">
            Assembly dashboard
          </Link>
        </footer>
      </div>
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 break-words text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            {headers.map((header) => (
              <th key={header} className="px-3 py-3 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-3 text-foreground/80">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No matching records.</p>
      )}
    </div>
  );
}
