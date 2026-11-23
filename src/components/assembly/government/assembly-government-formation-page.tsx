"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { PartyMark } from "@/components/party-mark";
import { AllianceName } from "@/components/alliance-name";
import { allianceShort } from "@/lib/party-style";
import WorkspacePage from "@/components/election-workspace/workspace-page";
import { loadAssemblyGame, type AssemblyGameSave } from "@/engine/assembly-game-engine";
import {
  getAssemblyGovernmentOutcome,
  loadAssemblyVoting,
  type AssemblyVotingSave,
} from "@/engine/assembly-voting-engine";
import partiesData from "@/data/parties.json";

const partyNames = Object.fromEntries(
  (partiesData.parties as Array<{ id: string; name: string }>).map((party) => [
    party.id,
    party.name,
  ]),
);
const nameOf = (id: string) => partyNames[id] ?? id;
const pct = (value: number) => `${value.toFixed(2)}%`;

export default function AssemblyGovernmentFormationPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [game, setGame] = useState<AssemblyGameSave | null>(null);
  const [voting, setVoting] = useState<AssemblyVotingSave | null>(null);

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

  const outcome = useMemo(
    () => (game && voting ? getAssemblyGovernmentOutcome(game, voting) : null),
    [game, voting],
  );

  if (!ready || !game) {
    return (
      <main className="mx-auto max-w-[1280px] px-6 py-8 text-muted-foreground">
        Loading government formation…
      </main>
    );
  }

  if (!voting || !outcome || voting.results.length !== game.totalConstituencies) {
    return (
      <main className="mx-auto max-w-[1280px] px-6 py-8">
        <section className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-8 text-center">
          <h1 className="text-2xl font-black">Government formation is locked</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            It opens once polling day has been held and the results are declared.
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

  const ruling = outcome.rulingGroup;
  const largest = outcome.largestGroup;
  const validVotes = voting.results.reduce(
    (sum, result) => sum + result.totalVotes - result.notaVotes,
    0,
  );

  // Hung assembly: nobody can govern alone, so coalition talks are needed.
  if (!ruling) {
    return (
      <>
        <section className="border-b border-amber-300/30 bg-amber-300/10 px-5 py-4 text-foreground lg:px-10">
          <div className="mx-auto max-w-[1500px]">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-200">
              Hung assembly · negotiation required
            </p>
            <p className="mt-1 text-sm text-foreground/90">
              No group reached the majority mark of {outcome.majority} seats.{" "}
              {largest ? `${largest.name} is the largest with ${largest.seats} seats. ` : ""}
              Your group, {outcome.playerGroupName}, holds {outcome.playerGroupSeats}.
            </p>
          </div>
        </section>
        <WorkspacePage mode="ASSEMBLY" stage="government" />
      </>
    );
  }

  const members = Object.entries(ruling.partySeats).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const rulingVotes = voting.results.reduce((sum, result) => {
    const seat = game.constituencies.find((item) => item.id === result.constituencyId);
    return (
      sum +
      Object.entries(result.partyVotes).reduce(
        (inner, [partyId, count]) =>
          seat?.allocations.find((item) => item.partyId === partyId)?.allianceName === ruling.name
            ? inner + count
            : inner,
        0,
      )
    );
  }, 0);

  const rulingIsPlayer = ruling.name === outcome.playerGroupName;
  const gname = (name: string, isPlayer: boolean, className = "") =>
    isPlayer ? <span className={className}>{name}</span> : <AllianceName name={name} className={className} />;
  const rulingShort = rulingIsPlayer ? ruling.name : allianceShort(ruling.name);
  const spare = ruling.seats - outcome.majority;
  const cmParty = outcome.chiefMinisterPartyId;
  const others = outcome.groups.filter((group) => group.name !== ruling.name);

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-8">
      <header>
        <h1 className="font-heading text-2xl font-semibold">Government negotiation</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          State Assembly · {game.state} · A group with {outcome.majority} seats governs without talks.
        </p>
      </header>

      <div className="mt-5 rounded-xl border border-success/30 bg-success/5 p-5">
        <h2 className="text-xl font-black text-success">Negotiations not required</h2>
        <p className="mt-2 text-sm text-foreground/80">
          {rulingShort} has {ruling.seats} seats, {spare} above the majority mark of {outcome.majority}. Government formation can proceed without coalition negotiations.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {outcome.playerInGovernment
            ? "Your party is in the ruling alliance: you will allocate the ministries between its parties."
            : `Your party is not part of ${rulingShort}, so the cabinet is shared out by the AI in proportion to each ruling party's seats.`}
        </p>
      </div>

      <section className="mt-5 rounded-2xl border border-border bg-card p-6">
        <p className="text-xs font-bold text-success">Majority secured</p>
        <h2 className="mt-2 text-2xl font-black">{gname(ruling.name, rulingIsPlayer)}</h2>
        <p className="mt-1 text-3xl font-black tabular-nums text-success">{ruling.seats} / {outcome.majority} seats</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand" style={{ width: "100%" }} /></div>
        <p className="mt-3 text-sm text-foreground/80">
          Chief Minister&apos;s party: <b>{cmParty ? nameOf(cmParty) : "—"}</b> · Valid vote share {pct(validVotes ? (rulingVotes / validVotes) * 100 : 0)}
        </p>
        <h3 className="mt-5 font-bold">Alliance composition</h3>
        <div className="mt-3 divide-y divide-border border-t border-border">
          {members.map(([partyId, seats], index) => (
            <div key={partyId} className={`flex items-center gap-3 py-3 text-sm ${partyId === game.playerPartyId ? "text-brand" : ""}`}>
              <PartyMark id={partyId} size={22} />
              <span className="flex-1 font-semibold">{nameOf(partyId)}{partyId === game.playerPartyId ? " · you" : ""}</span>
              <span className="text-xs text-muted-foreground">{index === 0 ? "Chief Minister's party" : "Coalition partner"}</span>
              <b className="w-14 text-right tabular-nums">{seats}</b>
            </div>
          ))}
        </div>
      </section>

      <section className={`mt-5 rounded-2xl border p-5 ${outcome.playerInGovernment ? "border-brand/30 bg-brand/10" : "border-border bg-card"}`}>
        <h2 className="text-lg font-bold">{outcome.playerInGovernment ? "Your party is in government" : "Your party sits in opposition"}</h2>
        <p className="mt-1 text-sm text-foreground/80">
          {outcome.playerInGovernment
            ? `${nameOf(game.playerPartyId)} won ${ruling.partySeats[game.playerPartyId] ?? 0} seats within ${rulingShort}.`
            : `${outcome.playerGroupName} won ${outcome.playerGroupSeats} seats, ${Math.max(0, outcome.majority - outcome.playerGroupSeats)} short of a majority. ${rulingShort} governs.`}
        </p>
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-lg font-bold">Other groups in the Assembly</h2>
        <div className="mt-3 space-y-2">
          {others.map((group) => (
            <div key={group.name} className="flex items-center justify-between gap-3 rounded-lg bg-background px-3.5 py-3 text-sm">
              <span className={group.isPlayerGroup ? "font-bold text-brand" : ""}>
                {gname(group.name, group.isPlayerGroup, "font-semibold")}
                {group.isPlayerGroup ? " · your alliance" : ""}
              </span>
              <b className="tabular-nums">{group.seats} seats</b>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-brand/30 bg-brand/5 p-5">
        <div>
          <p className="font-bold">Next: share out the ministries</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {outcome.playerInGovernment
              ? `Allocate the ministries between the parties of ${rulingShort}.`
              : `${rulingShort} will share the ministries among its parties. See the cabinet it forms.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/elections/assembly/results" className="rounded-xl border border-border px-5 py-3 text-sm font-semibold hover:bg-muted">Election results</Link>
          <button onClick={() => router.push("/elections/assembly/government-formation/cabinet")} className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-bold text-brand-foreground hover:opacity-90">
            Next: Cabinet formation <ArrowRight size={17} />
          </button>
        </div>
      </section>
    </main>
  );
}
