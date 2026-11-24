"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CountingBoard } from "@/components/counting/counting-board";
import { Button } from "@/components/ui/button";
import type { CountingSeatInput, UnitContext } from "@/engine/counting-engine";
import { loadAssemblyGame, type AssemblyGameSave } from "@/engine/assembly-game-engine";
import { loadAssemblyVoting, type AssemblyVotingSave } from "@/engine/assembly-voting-engine";
import { countingPlanFor } from "@/lib/assembly-counting-rounds";
import { buildExitPoll } from "@/lib/exit-poll";
import { majorityMark } from "@/types/campaign-profile";

export default function AssemblyCountingPage() {
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

  const results = useMemo(() => voting?.results ?? [], [voting]);
  const seats = useMemo<CountingSeatInput[]>(() => {
    if (!game) return [];
    const regionNames = new Map(game.allocation.regionalShares.map((s) => [s.regionId, s.regionName]));
    const info = new Map<string, { name: string; region: string }>(game.constituencies.map((c) => [c.id, { name: c.name, region: regionNames.get(c.regionId) ?? c.regionId }] as const));
    return results.map((r) => ({
      id: r.constituencyId,
      name: info.get(r.constituencyId)?.name ?? r.constituencyId,
      group: info.get(r.constituencyId)?.region ?? game.state,
      state: game.state,
      totalVotes: r.totalVotes,
      partyVotes: r.partyVotes,
      winnerPartyId: r.winnerPartyId,
      plan: countingPlanFor(r.registeredElectors),
    }));
  }, [game, results]);
  const ctx = useMemo<UnitContext | null>(
    () => (game ? { groupsByState: game.stateAllianceGroups ?? {}, playerAllianceName: game.allianceName, playerPartyId: game.playerPartyId } : null),
    [game],
  );
  const majority = game ? majorityMark(game.totalConstituencies) : 0;
  const exit = useMemo(() => {
    if (!game || !ctx || voting?.status !== "COMPLETED") return null;
    return buildExitPoll({ gameId: game.gameId, results, groupsByState: ctx.groupsByState, playerAllianceName: ctx.playerAllianceName, majority });
  }, [game, ctx, voting, results, majority]);

  const wrap = "mx-auto max-w-[1280px] px-6 py-8";
  if (!ready) return <main className={wrap}><p className="text-sm text-muted-foreground">Loading counting day…</p></main>;
  if (!game || !ctx || !exit || voting?.status !== "COMPLETED") {
    return (
      <main className={wrap}>
        <section className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="font-heading text-xl font-semibold">Counting has not started</h1>
          <p className="mt-2 text-sm text-muted-foreground">Finish polling first. Counting begins once every constituency has voted.</p>
          <Button asChild className="mt-5"><Link href="/elections/assembly/voting">Go to voting</Link></Button>
        </section>
      </main>
    );
  }

  return (
    <CountingBoard
      kind="assembly"
      state={game.state}
      gameId={game.gameId}
      title="Counting day"
      intro={`${game.state}: counting starts in all regions at once. Every constituency is counted in rounds. After each round you see who leads and who trails in every seat. A seat is declared Won the moment one party holds more than half of all the votes polled in it, and the remaining rounds still run so the final margin shows. Other seats stay Leading until their own last round closes.`}
      groupTitle="Regions"
      groupNoun="Region"
      seats={seats}
      ctx={ctx}
      majority={majority}
      exitUnits={exit.national}
      resultsHref="/elections/assembly/results"
      saveKey="indian-election-simulator:assembly-counting"
      votingHref="/elections/assembly/voting"
    />
  );
}
