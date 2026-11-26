"use client";

import { useEffect, useState } from "react";
import partiesData from "@/data/parties.json";
import { loadAssemblyGame } from "@/engine/assembly-game-engine";
import { getAssemblyGovernmentOutcome, loadAssemblyVoting } from "@/engine/assembly-voting-engine";
import type { ElectionKind } from "./game-stages";

const KEYS = {
  "lok-sabha": {
    game: "indian-election-game-lok-sabha-save",
    campaign: "indian-election-game-lok-sabha-campaign-save",
    voting: "indian-election-game-lok-sabha-voting-save",
    negotiation: "indian-election-game-lok-sabha-negotiation-save",
    cabinet: "indian-election-game-lok-sabha-cabinet-save",
  },
  assembly: {
    game: "indian-election-simulator:assembly-game",
    campaign: "indian-election-simulator:assembly-campaign",
    voting: "indian-election-simulator:assembly-voting",
    negotiation: "",
    cabinet: "indian-election-simulator:assembly-cabinet",
  },
} as const;

const partyNames = Object.fromEntries(
  (partiesData.parties as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
);

function read(key: string): Record<string, unknown> | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface GameProgress {
  /** Id of the furthest stage the saved game has reached. */
  reachedId: string;
  partyName: string | null;
  /** True when an Assembly result is hung, which opens the Negotiation tab. */
  hung: boolean;
}

/** Works out how far the saved game has got, from the saves the game already writes. Browser only. */
export function readGameProgress(kind: ElectionKind): GameProgress {
  const keys = KEYS[kind];
  const game = read(keys.game);
  const campaign = read(keys.campaign);
  const voting = read(keys.voting);
  const negotiation = read(keys.negotiation);
  const cabinet = read(keys.cabinet);

  let hung = false;
  if (kind === "assembly") {
    try {
      const assembly = loadAssemblyGame();
      const counted = assembly ? loadAssemblyVoting(assembly.gameId) : null;
      hung =
        Boolean(assembly && counted && counted.results.length === assembly.totalConstituencies) &&
        getAssemblyGovernmentOutcome(assembly!, counted!).status === "HUNG";
    } catch {
      hung = false;
    }
  }

  let reachedId = "setup";
  if (campaign) reachedId = "campaign";
  if (campaign?.status === "LOCKED") reachedId = "voting";
  const votingDone =
    voting?.status === "COMPLETED" ||
    (Array.isArray(voting?.completedPhases) && (voting?.completedPhases as unknown[]).length >= 7);
  if (votingDone) reachedId = "results";
  if (votingDone && (negotiation || hung)) reachedId = "negotiation";
  if (votingDone && cabinet) reachedId = "government";
  if (votingDone && kind === "assembly" && !hung) reachedId = "government";

  const partyId = typeof game?.playerPartyId === "string" ? game.playerPartyId : null;
  return { reachedId, partyName: partyId ? (partyNames[partyId] ?? partyId) : null, hung };
}

export function useGameProgress(kind: ElectionKind, path: string): GameProgress {
  const [progress, setProgress] = useState<GameProgress>({ reachedId: "setup", partyName: null, hung: false });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- saves live in localStorage, which only exists after mount
    setProgress(readGameProgress(kind));
  }, [kind, path]);

  return progress;
}
