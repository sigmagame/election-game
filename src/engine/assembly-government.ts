import {
  getAssemblyGovernmentOutcome,
  type AssemblyGovernmentOutcome,
  type AssemblyVotingSave,
} from "@/engine/assembly-voting-engine";
import type { AssemblyGameSave } from "@/engine/assembly-game-engine";
import { loadNegotiationSave, type NegotiationSave } from "@/engine/lok-sabha-negotiation-engine";

/**
 * Settles a hung Assembly by what the negotiation decided. The ruling group becomes the bloc that
 * won, with only its formal members sharing ministries (outside supporters hold none), so the
 * cabinet engine can be used unchanged. A hung result with no government stays hung.
 */
export function applyNegotiationToOutcome(
  game: Pick<AssemblyGameSave, "playerPartyId">,
  base: AssemblyGovernmentOutcome,
  save: NegotiationSave,
): AssemblyGovernmentOutcome {
  const snapshot = save.majoritySnapshot;
  if (base.status === "MAJORITY" || !snapshot) return base;
  const partySeats = Object.fromEntries(snapshot.parties.map((party) => [party.partyId, party.seats]));
  const topParty = [...snapshot.parties].sort(
    (a, b) => b.seats - a.seats || a.partyId.localeCompare(b.partyId),
  )[0]?.partyId;
  const playerInGovernment = snapshot.parties.some((party) => party.partyId === game.playerPartyId);
  const rulingGroup = {
    name: snapshot.name,
    seats: snapshot.seats,
    partySeats,
    isPlayerGroup: playerInGovernment,
  };
  return {
    ...base,
    status: "MAJORITY",
    rulingGroup,
    chiefMinisterPartyId: snapshot.primeMinisterPartyId ?? topParty ?? null,
    playerInGovernment,
    negotiated: true,
    minority: Boolean(snapshot.minority) || save.outcome?.kind === "MINORITY_GOVERNMENT",
  };
}

/** The outcome the rest of the game should use: the vote count, adjusted by any negotiation. */
export function getEffectiveAssemblyOutcome(
  game: AssemblyGameSave,
  voting: AssemblyVotingSave,
): AssemblyGovernmentOutcome {
  const base = getAssemblyGovernmentOutcome(game, voting);
  if (base.status === "MAJORITY") return base;
  return applyNegotiationToOutcome(game, base, loadNegotiationSave(game.gameId, "ASSEMBLY"));
}
