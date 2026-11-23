import type { LokSabhaGameAlliance, SeatContestantAllocation, StateAllianceGroup } from "@/types/lok-sabha-game";

export type CampaignElectionType = "LOK_SABHA" | "ASSEMBLY";

/** Everything that differs between election types in the shared campaign engine. */
export interface CampaignProfile {
  electionType: CampaignElectionType;
  /** Display name used in messages, e.g. "Lok Sabha". */
  label: string;
  weeks: number;
  actionsPerWeek: number;
  /** Strict seat-count check for fixed-size houses (543). Null means "use the game's own count". */
  requiredSeats: number | null;
  /**
   * Opt-in log-normal spread of each party's starting support. A shared regional factor models
   * strongholds; a per-seat factor models local contests, and is larger for parties whose statewide
   * base is small (their votes are concentrated, not spread evenly). Leave unset for the small
   * uniform variation Lok Sabha uses.
   */
  localVariation?: { regionSigma: number; seatSigma: number; smallPartyBoost: number };
}

export const LOK_SABHA_PROFILE: CampaignProfile = {
  electionType: "LOK_SABHA",
  label: "Lok Sabha",
  weeks: 12,
  actionsPerWeek: 6,
  requiredSeats: 543,
};

export const ASSEMBLY_PROFILE: CampaignProfile = {
  electionType: "ASSEMBLY",
  label: "Assembly",
  weeks: 8,
  actionsPerWeek: 6,
  requiredSeats: null,
  // Calibrated on all 31 states: the leading group wins about 60% of seats on about 44% of the vote,
  // roughly three groups win seats, outright sweeps do not occur and about one election in six is
  // hung. Without this spread every constituency in a state looks alike and the leader sweeps.
  localVariation: { regionSigma: 0.22, seatSigma: 0.32, smallPartyBoost: 0.8 },
};

/** Simple majority of a house: 272 of 543, 60 of 119, 21 of 40. */
export function majorityMark(totalSeats: number): number {
  return Math.floor(totalSeats / 2) + 1;
}

export interface CampaignRegion {
  id: string;
  name: string;
  constituencyIds: string[];
}

export interface CampaignConstituency {
  constituencyId: string;
  state: string;
  name: string;
  totalVoters: number;
  registeredElectors: number;
  allocations: SeatContestantAllocation[];
}

/**
 * The part of a game save the campaign engine reads. Both the Lok Sabha save and the Assembly save
 * (through its adapter) satisfy it.
 */
export interface CampaignGame {
  gameId: string;
  playerPartyId: string;
  alliance: LokSabhaGameAlliance;
  constituencies: CampaignConstituency[];
  statePartyParticipation: Record<string, string[]>;
  stateAllianceGroups: Record<string, StateAllianceGroup[]>;
  totalConstituencies: number;
  allocatedConstituencies: number;
  /** Assembly only: campaign regions per state, so actions can target a region. */
  regions?: Record<string, CampaignRegion[]>;
}
