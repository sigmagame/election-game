import type { AssemblySeatAllocation } from "@/engine/assembly-seat-allocation-engine";
import {
  getAllocatedConstituencies,
  validateAssemblySeatAllocation,
  type AssemblyRegionState,
} from "@/engine/assembly-seat-allocation-engine";
import {
  buildElectionField,
  distributeByStrength,
  getPartyStrength,
  partyCanContestInState,
  type CreateLokSabhaGameInput,
} from "@/engine/lok-sabha-game-engine";
import type { CampaignGame, CampaignRegion } from "@/types/campaign-profile";
import type { AssemblyConstituency } from "@/types/constituency";
import { plainNamesReviver } from "@/lib/party-style";
import type {
  LokSabhaGameAlliance,
  SeatContestantAllocation,
  StateAllianceGroup,
} from "@/types/lok-sabha-game";

export type AssemblyAllianceType = "alliance" | "independent";

export type AssemblyGameConstituency = AssemblyConstituency & {
  /** The party that contests this seat for the player's alliance. */
  allocatedPartyId: string;
  regionId: string;
  status: "PENDING" | "CAMPAIGN" | "RESULTS";
  /** One candidate per alliance group contesting the seat, including the player's. */
  allocations: SeatContestantAllocation[];
};

export interface AssemblyGameSave {
  schemaVersion: 2;
  gameId: string;
  electionType: "ASSEMBLY";
  createdAt: string;
  updatedAt: string;
  electionYear: number;
  state: string;
  stateId: string;
  playerPartyId: string;
  allianceType: AssemblyAllianceType;
  allianceName: string;
  partyIds: string[];
  alliance: LokSabhaGameAlliance;
  allocation: AssemblySeatAllocation;
  constituencies: AssemblyGameConstituency[];
  /** Every party with a foothold in the state, keyed by state (one entry for an Assembly game). */
  statePartyParticipation: Record<string, string[]>;
  /** The rival alliances and independents contesting the state, formed by the same rules as Lok Sabha. */
  stateAllianceGroups: Record<string, StateAllianceGroup[]>;
  optedOutPartyIds: string[];
  totalConstituencies: number;
  totalVoters: number;
  status: "CAMPAIGN" | "RESULTS";
}

export interface AssemblyGameSetup {
  state: string;
  playerPartyId: string;
  allianceName: string;
  partyIds: string[];
  allianceType?: AssemblyAllianceType;
  /** Hex colour the player chose for their front. */
  allianceColor?: string;
}

const STORAGE_KEY = "indian-election-simulator:assembly-game";

type Random = () => number;

function shuffledWith<T>(items: T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function allianceFromSetup(setup: AssemblyGameSetup): { allianceType: AssemblyAllianceType; alliance: LokSabhaGameAlliance } {
  const allianceType = setup.allianceType ?? (setup.partyIds.length > 1 ? "alliance" : "independent");
  const alliance: LokSabhaGameAlliance =
    allianceType === "alliance"
      ? { id: null, name: setup.allianceName, type: "CUSTOM", memberPartyIds: [...new Set(setup.partyIds)], ...(setup.allianceColor ? { color: setup.allianceColor } : {}) }
      : { id: null, name: "Independent", type: "INDEPENDENT", memberPartyIds: [setup.playerPartyId] };
  return { allianceType, alliance };
}

export type AssemblyField = ReturnType<typeof buildElectionField>;

/** Generates which parties contest and how the AI alliances form (random, so it is made once and reused). */
export function generateAssemblyField(setup: AssemblyGameSetup, seatCount: number): AssemblyField {
  const { allianceType, alliance } = allianceFromSetup(setup);
  const input: CreateLokSabhaGameInput = {
    playerPartyId: setup.playerPartyId,
    allianceChoice: allianceType === "alliance" ? "CUSTOM" : "Independent",
    customAllianceName: alliance.name,
    customPartnerPartyIds: alliance.memberPartyIds.filter((id) => id !== setup.playerPartyId),
  };
  return buildElectionField(input, alliance, Array.from({ length: seatCount }, () => ({ state: setup.state })), "ASSEMBLY");
}

export interface AssemblyAiRegionPlan {
  group: StateAllianceGroup;
  /** Seats each member party fields in each region (every AI alliance contests every seat). */
  regions: Array<{ regionId: string; regionName: string; totalSeats: number; shares: Record<string, number> }>;
  /** The same plan added up over the state. */
  stateShares: Record<string, number>;
  isFallback: boolean;
}

/**
 * How every AI alliance splits the seats of each region among its member parties, by regional strength.
 * Used both to preview the rival field during seat allocation and to build the real candidate list, so
 * the two always agree on the numbers (only which constituency each candidate gets is random).
 */
export function planAssemblyAiSeats(
  field: Pick<AssemblyField, "stateAllianceGroups" | "statePartyParticipation">,
  state: string,
  regions: Array<{ id: string; name: string; seatCount: number }>,
): AssemblyAiRegionPlan[] {
  const groups = field.stateAllianceGroups[state] ?? [];
  const participation = field.statePartyParticipation[state] ?? [];
  const plans: AssemblyAiRegionPlan[] = [];
  for (const group of groups) {
    if (group.isPlayerAlliance) continue;
    const members = group.memberPartyIds.filter(
      (partyId) => participation.includes(partyId) && partyCanContestInState(partyId, state),
    );
    if (!members.length) continue;
    const stateShares: Record<string, number> = {};
    const perRegion = regions.map((region) => {
      const shares =
        group.type === "INDEPENDENT" && members.length === 1
          ? { [members[0]]: region.seatCount }
          : distributeByStrength(members, state, region.seatCount);
      for (const [partyId, count] of Object.entries(shares)) stateShares[partyId] = (stateShares[partyId] ?? 0) + count;
      return { regionId: region.id, regionName: region.name, totalSeats: region.seatCount, shares };
    });
    plans.push({
      group,
      regions: perRegion,
      stateShares,
      isFallback: members.some((partyId) => getPartyStrength(partyId, state) === null),
    });
  }
  return plans;
}

/**
 * Builds the rival field for one state and gives every constituency one candidate per alliance group.
 * The player's own candidates come from the seat allocation they confirmed; every AI group (a
 * predefined or custom alliance, or an independent party) fills every seat by party strength, region by region.
 */
export function buildAssemblyField(args: {
  setup: AssemblyGameSetup;
  constituencies: Array<AssemblyConstituency & { allocatedPartyId: string; regionId: string }>;
  random?: Random;
  /** The field shown during seat allocation, so that the game matches the preview. */
  field?: AssemblyField;
}) {
  const { setup, constituencies, random = Math.random } = args;
  const state = setup.state;
  const { allianceType, alliance } = allianceFromSetup(setup);
  const field = args.field ?? generateAssemblyField(setup, constituencies.length);
  const groups = field.stateAllianceGroups[state] ?? [];
  const playerGroup =
    groups.find((group) => group.isPlayerAlliance) ??
    groups.find((group) => group.memberPartyIds.includes(setup.playerPartyId));
  if (!playerGroup) throw new Error(`${setup.playerPartyId} cannot contest in ${state}.`);

  const byConstituency = new Map<string, SeatContestantAllocation[]>(
    constituencies.map((item) => [
      item.id,
      [{ partyId: item.allocatedPartyId, allianceId: playerGroup.id, allianceName: playerGroup.name }],
    ]),
  );

  const regionIds = [...new Set(constituencies.map((item) => item.regionId))];
  const regionSeats = regionIds.map((id) => ({
    id,
    name: id,
    seatCount: constituencies.filter((item) => item.regionId === id).length,
  }));
  for (const plan of planAssemblyAiSeats(field, state, regionSeats)) {
    for (const region of plan.regions) {
      const seats = shuffledWith(
        constituencies.filter((item) => item.regionId === region.regionId),
        random,
      );
      const sequence = Object.entries(region.shares).flatMap(([partyId, count]) =>
        Array.from({ length: count }, () => partyId),
      );
      const parties = shuffledWith(sequence, random);
      seats.forEach((seat, index) => {
        const partyId = parties[index];
        if (partyId)
          byConstituency
            .get(seat.id)!
            .push({ partyId, allianceId: plan.group.id, allianceName: plan.group.name });
      });
    }
  }

  return {
    allianceType,
    alliance,
    optedOutPartyIds: field.optedOutPartyIds,
    statePartyParticipation: field.statePartyParticipation,
    stateAllianceGroups: field.stateAllianceGroups,
    allocationsById: byConstituency,
  };
}

export function createAssemblyGame(args: {
  setup: AssemblyGameSetup;
  allocation: AssemblySeatAllocation;
  stateData: AssemblyRegionState;
  constituencies: AssemblyConstituency[];
  random?: Random;
  field?: AssemblyField;
}): AssemblyGameSave {
  const validation = validateAssemblySeatAllocation({
    stateData: args.stateData,
    allocation: args.allocation,
    requireComplete: true,
  });
  if (!validation.valid) {
    throw new Error(`Cannot start election: ${validation.issues[0]?.message ?? "seat allocation is incomplete."}`);
  }
  const allocated = getAllocatedConstituencies(args.allocation, args.constituencies);
  if (allocated.length !== validation.totalSeats) {
    throw new Error("The allocation does not resolve to every constituency in the selected state.");
  }
  const field = buildAssemblyField({
    setup: { ...args.setup, state: args.stateData.state },
    constituencies: allocated,
    random: args.random,
    field: args.field,
  });
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 2,
    gameId: `ASSEMBLY-${args.stateData.stateId}-${Date.now()}`,
    electionType: "ASSEMBLY",
    createdAt: timestamp,
    updatedAt: timestamp,
    electionYear: 2024,
    state: args.stateData.state,
    stateId: args.stateData.stateId,
    playerPartyId: args.setup.playerPartyId,
    allianceType: field.allianceType,
    allianceName: args.setup.allianceName,
    partyIds: [...args.setup.partyIds],
    alliance: field.alliance,
    allocation: args.allocation,
    constituencies: allocated.map((item) => ({
      ...item,
      status: "PENDING" as const,
      allocations: field.allocationsById.get(item.id) ?? [],
    })),
    statePartyParticipation: field.statePartyParticipation,
    stateAllianceGroups: field.stateAllianceGroups,
    optedOutPartyIds: field.optedOutPartyIds,
    totalConstituencies: allocated.length,
    totalVoters: allocated.reduce((sum, item) => sum + item.registeredElectors, 0),
    status: "CAMPAIGN",
  };
}

/** The part of an Assembly game the shared campaign engine reads. */
export function toCampaignGame(game: AssemblyGameSave): CampaignGame {
  const names = new Map(game.allocation.regionalShares.map((share) => [share.regionId, share.regionName]));
  const regions: CampaignRegion[] = game.allocation.regionalAllocations.map((region) => ({
    id: region.regionId,
    name: names.get(region.regionId) ?? region.regionId,
    constituencyIds: region.selections.flatMap((selection) => selection.constituencyIds),
  }));
  return {
    gameId: game.gameId,
    playerPartyId: game.playerPartyId,
    alliance: game.alliance,
    constituencies: game.constituencies.map((item) => ({
      constituencyId: item.id,
      state: item.state,
      name: item.name,
      totalVoters: item.totalVoters,
      registeredElectors: item.registeredElectors,
      allocations: item.allocations,
    })),
    statePartyParticipation: game.statePartyParticipation,
    stateAllianceGroups: game.stateAllianceGroups,
    totalConstituencies: game.totalConstituencies,
    allocatedConstituencies: game.constituencies.length,
    regions: { [game.state]: regions },
  };
}

export function saveAssemblyGame(game: AssemblyGameSave): void {
  if (typeof window === "undefined") return;
  const next = { ...game, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/** Saves made before the rival field existed (schema 1) are upgraded by generating the field. */
function upgradeLegacyGame(parsed: Record<string, unknown>): AssemblyGameSave | null {
  try {
    const legacy = parsed as unknown as Omit<AssemblyGameSave, "schemaVersion" | "alliance" | "allianceType" | "statePartyParticipation" | "stateAllianceGroups" | "optedOutPartyIds" | "constituencies"> & {
      constituencies: Array<AssemblyConstituency & { allocatedPartyId: string; regionId: string; status: AssemblyGameConstituency["status"] }>;
    };
    const setup: AssemblyGameSetup = {
      state: legacy.state,
      playerPartyId: legacy.playerPartyId,
      allianceName: legacy.allianceName,
      partyIds: legacy.partyIds,
    };
    const field = buildAssemblyField({ setup, constituencies: legacy.constituencies });
    return {
      ...legacy,
      schemaVersion: 2,
      allianceType: field.allianceType,
      alliance: field.alliance,
      constituencies: legacy.constituencies.map((item) => ({ ...item, allocations: field.allocationsById.get(item.id) ?? [] })),
      statePartyParticipation: field.statePartyParticipation,
      stateAllianceGroups: field.stateAllianceGroups,
      optedOutPartyIds: field.optedOutPartyIds,
    };
  } catch {
    return null;
  }
}

export function loadAssemblyGame(): AssemblyGameSave | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw, plainNamesReviver) as Record<string, unknown>;
    if (parsed.electionType !== "ASSEMBLY" || !Array.isArray(parsed.constituencies)) return null;
    if (parsed.schemaVersion === 2) return parsed as unknown as AssemblyGameSave;
    return upgradeLegacyGame(parsed);
  } catch {
    return null;
  }
}

export function deleteAssemblyGame(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
}
