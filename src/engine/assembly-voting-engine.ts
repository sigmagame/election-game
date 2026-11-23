import type { AssemblyGameSave } from "@/engine/assembly-game-engine";
import { allocateVotes, hashSeed, randomFor } from "@/engine/lok-sabha-voting-engine";
import { generateNotaRate, generateTurnout } from "@/engine/turnout-model";
import { majorityMark } from "@/types/campaign-profile";
import type { LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";
import type { VotingConstituencyResult } from "@/types/lok-sabha-voting";

export const ASSEMBLY_VOTING_SAVE_KEY = "indian-election-simulator:assembly-voting";

/**
 * An Assembly election is held statewide, so polling is a single day covering every constituency
 * (Lok Sabha needs seven phases). The per-constituency maths matches the Lok Sabha voting engine:
 * turnout is drawn per seat, a small share goes to NOTA, and the rest is split between the
 * contesting parties in proportion to their campaign support.
 */
export interface AssemblyVotingSave {
  schemaVersion: 1;
  gameId: string;
  status: "COMPLETED";
  completedAt: string;
  results: VotingConstituencyResult[];
  updatedAt: string;
}

export function runAssemblyVoting(
  game: AssemblyGameSave,
  campaign: LokSabhaCampaignSave,
): AssemblyVotingSave {
  if (campaign.status !== "LOCKED")
    throw new Error("Voting can begin only after the campaign is locked.");
  if (campaign.gameId !== game.gameId) throw new Error("The campaign belongs to a different game.");

  const supportById = new Map(
    campaign.constituencySupport.map((item) => [item.constituencyId, item.partySupport]),
  );
  const results: VotingConstituencyResult[] = game.constituencies.map((seat) => {
    const registered = seat.registeredElectors || seat.totalVoters;
    const rng = randomFor(hashSeed(`${game.gameId}:assembly:${seat.id}:votes`));
    const turnoutRate = generateTurnout({
      gameId: game.gameId,
      scope: "assembly",
      state: seat.state,
      constituencyId: seat.id,
    });
    const totalVotes = Math.min(registered, Math.round(registered * turnoutRate));
    const contesting = new Set(seat.allocations.map((allocation) => allocation.partyId));
    const parties = Object.entries(supportById.get(seat.id) ?? {}).filter(([partyId]) =>
      contesting.has(partyId),
    );
    if (!parties.length) throw new Error(`No contesting candidates found for ${seat.name}.`);
    const notaVotes = Math.round(totalVotes * generateNotaRate(rng));
    const partyVotes = allocateVotes(
      totalVotes - notaVotes,
      parties.map(([id, value]) => ({ id, weight: Math.max(0, value) })),
    );
    const winnerPartyId = Object.entries(partyVotes).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0];
    if (!winnerPartyId) throw new Error(`Unable to determine the winner for ${seat.name}.`);
    return {
      constituencyId: seat.id,
      state: seat.state,
      registeredElectors: registered,
      turnoutRate,
      totalVotes,
      notaVotes,
      partyVotes,
      winnerPartyId,
    };
  });

  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    gameId: game.gameId,
    status: "COMPLETED",
    completedAt: now,
    results,
    updatedAt: now,
  };
}

export function saveAssemblyVoting(voting: AssemblyVotingSave): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    ASSEMBLY_VOTING_SAVE_KEY,
    JSON.stringify({ ...voting, updatedAt: new Date().toISOString() }),
  );
}

export function loadAssemblyVoting(gameId?: string): AssemblyVotingSave | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ASSEMBLY_VOTING_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AssemblyVotingSave;
    if (
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.results) ||
      (gameId && parsed.gameId !== gameId)
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

export function deleteAssemblyVoting(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(ASSEMBLY_VOTING_SAVE_KEY);
}

export interface AssemblyGroupTally {
  /** The alliance, front or independent party as named on the ballot. */
  name: string;
  seats: number;
  partySeats: Record<string, number>;
  isPlayerGroup: boolean;
}

export interface AssemblyGovernmentOutcome {
  totalSeats: number;
  majority: number;
  /** Groups that won at least one seat, largest first. */
  groups: AssemblyGroupTally[];
  /** MAJORITY: one group already has the seats to govern, so no negotiation is needed. */
  status: "MAJORITY" | "HUNG";
  largestGroup: AssemblyGroupTally | null;
  /** The group with a majority, or null for a hung assembly. */
  rulingGroup: AssemblyGroupTally | null;
  /** The largest party inside the ruling group; it takes the Chief Minister's post. */
  chiefMinisterPartyId: string | null;
  playerGroupName: string;
  playerGroupSeats: number;
  playerInGovernment: boolean;
  /** True when a hung result was settled by negotiation (the ruling group may need outside support). */
  negotiated?: boolean;
  /** True when the government rules as a minority after a floor test. */
  minority?: boolean;
}

/**
 * Who can form the government once the votes are counted. A group is the unit that governs: the
 * pre-poll alliance, front or independent party that each winning candidate stood for.
 */
export function getAssemblyGovernmentOutcome(
  game: AssemblyGameSave,
  voting: AssemblyVotingSave,
): AssemblyGovernmentOutcome {
  const seatsById = new Map(game.constituencies.map((seat) => [seat.id, seat]));
  // The player's group is looked up by its flag, not by game.alliance.name: a solo player's group
  // is shown under the party's name on the ballot, while the save stores the label "Independent".
  const playerGroupName =
    game.stateAllianceGroups[game.state]?.find((group) => group.isPlayerAlliance)?.name ??
    game.alliance.name;

  const tallies = new Map<string, AssemblyGroupTally>();
  for (const result of voting.results) {
    const allocation = seatsById
      .get(result.constituencyId)
      ?.allocations.find((item) => item.partyId === result.winnerPartyId);
    const name = allocation?.allianceName ?? "Independent";
    const tally = tallies.get(name) ?? {
      name,
      seats: 0,
      partySeats: {},
      isPlayerGroup: name === playerGroupName,
    };
    tally.seats += 1;
    tally.partySeats[result.winnerPartyId] = (tally.partySeats[result.winnerPartyId] ?? 0) + 1;
    tallies.set(name, tally);
  }

  const groups = [...tallies.values()].sort(
    (a, b) => b.seats - a.seats || a.name.localeCompare(b.name),
  );
  const majority = majorityMark(game.totalConstituencies);
  const largestGroup = groups[0] ?? null;
  const rulingGroup = largestGroup && largestGroup.seats >= majority ? largestGroup : null;
  const chiefMinisterPartyId = rulingGroup
    ? (Object.entries(rulingGroup.partySeats).sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0]?.[0] ?? null)
    : null;

  return {
    totalSeats: game.totalConstituencies,
    majority,
    groups,
    status: rulingGroup ? "MAJORITY" : "HUNG",
    largestGroup,
    rulingGroup,
    chiefMinisterPartyId,
    playerGroupName,
    playerGroupSeats: tallies.get(playerGroupName)?.seats ?? 0,
    playerInGovernment: Boolean(rulingGroup && rulingGroup.name === playerGroupName),
  };
}
