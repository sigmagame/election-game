"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CountingBoard } from "@/components/counting/counting-board";
import { Button } from "@/components/ui/button";
import type { CountingSeatInput, UnitContext } from "@/engine/counting-engine";
import { loadLokSabhaGame } from "@/engine/lok-sabha-game-engine";
import { LOK_SABHA_VOTING_SAVE_KEY } from "@/engine/lok-sabha-voting-engine";
import { buildExitPoll } from "@/lib/exit-poll";
import { countingPlanFor } from "@/lib/lok-sabha-counting-rounds";
import { majorityMark } from "@/types/campaign-profile";
import type { LokSabhaGameSave } from "@/types/lok-sabha-game";
import type { LokSabhaVotingSave } from "@/types/lok-sabha-voting";

export default function LokSabhaCountingPage() {
  const [ready, setReady] = useState(false);
  const [game, setGame] = useState<LokSabhaGameSave | null>(null);
  const [voting, setVoting] = useState<LokSabhaVotingSave | null>(null);

  useEffect(() => {
    const active = loadLokSabhaGame();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates client-only saved state after mount (localStorage is unavailable during SSR)
    setGame(active);
    try {
      const raw = localStorage.getItem(LOK_SABHA_VOTING_SAVE_KEY);
      const saved = raw ? (JSON.parse(raw) as LokSabhaVotingSave) : null;
      if (active && saved && saved.gameId === active.gameId) setVoting(saved);
    } catch {
      /* an unreadable save is treated as "voting not finished" */
    }
    setReady(true);
  }, []);

  const results = useMemo(() => (voting ? voting.phaseResults.flatMap((p) => p.constituencyResults) : []), [voting]);
  const seats = useMemo<CountingSeatInput[]>(() => {
    if (!game) return [];
    const names = new Map(game.constituencies.map((c) => [c.constituencyId, c.name]));
    return results.map((r) => ({
      id: r.constituencyId,
      name: names.get(r.constituencyId) ?? r.constituencyId,
      group: r.state,
      state: r.state,
      totalVotes: r.totalVotes,
      partyVotes: r.partyVotes,
      winnerPartyId: r.winnerPartyId,
      plan: countingPlanFor(r.registeredElectors),
    }));
  }, [game, results]);
  const ctx = useMemo<UnitContext | null>(
    () => (game ? { groupsByState: game.stateAllianceGroups ?? {}, playerAllianceName: game.alliance.name, playerPartyId: game.playerPartyId } : null),
    [game],
  );
  const majority = majorityMark(543);
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
          <p className="mt-2 text-sm text-muted-foreground">Finish polling in all phases first. Counting begins once every constituency has voted.</p>
          <Button asChild className="mt-5"><Link href="/elections/lok-sabha/voting">Go to voting</Link></Button>
        </section>
      </main>
    );
  }

  return (
    <CountingBoard
      kind="lok-sabha"
      gameId={game.gameId}
      title="Counting day"
      intro="Counting starts in all states and union territories at once. Every constituency is counted in rounds. After each round you see who leads and who trails in every seat. A seat is declared Won the moment one party holds more than half of all the votes polled in it, and the remaining rounds still run so the final margin shows. Other seats stay Leading until their own last round closes."
      groupTitle="States and union territories"
      groupNoun="State / UT"
      seats={seats}
      ctx={ctx}
      majority={majority}
      exitUnits={exit.national}
      resultsHref="/elections/lok-sabha/results"
      saveKey="indian-election-game-lok-sabha-counting-save"
      votingHref="/elections/lok-sabha/voting"
    />
  );
}
