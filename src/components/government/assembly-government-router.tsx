"use client";

import { useEffect, useState } from "react";
import AssemblyGovernmentFormationPage from "@/components/assembly/government/assembly-government-formation-page";
import NegotiationPage from "@/components/government/negotiation-page";
import { loadAssemblyGame } from "@/engine/assembly-game-engine";
import { getAssemblyGovernmentOutcome, loadAssemblyVoting } from "@/engine/assembly-voting-engine";

/**
 * A party or group with a majority goes straight to the government page. A hung Assembly opens the
 * same live negotiation page the Lok Sabha uses.
 */
export default function AssemblyGovernmentRouter() {
  const [mode, setMode] = useState<"loading" | "government" | "negotiation">("loading");

  useEffect(() => {
    const game = loadAssemblyGame();
    const voting = game ? loadAssemblyVoting(game.gameId) : null;
    const complete = Boolean(game && voting && voting.results.length === game.totalConstituencies);
    const hung = game && voting && complete && getAssemblyGovernmentOutcome(game, voting).status === "HUNG";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the saved game, which only exists in the browser
    setMode(hung ? "negotiation" : "government");
  }, []);

  if (mode === "loading") return null;
  return mode === "negotiation" ? (
    <NegotiationPage election="ASSEMBLY" />
  ) : (
    <AssemblyGovernmentFormationPage />
  );
}
