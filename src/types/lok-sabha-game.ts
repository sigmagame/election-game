export type LokSabhaAllianceChoice = "NDA" | "INDIA" | "Independent" | "CUSTOM";
export type SeatAllocationStatus = "UNALLOCATED" | "ALLOCATED";

export interface SeatContestantAllocation {
  partyId: string;
  allianceId: string;
  allianceName: string;
}

export interface LokSabhaGameConstituency {
  constituencyId: string;
  state: string;
  name: string;
  totalVoters: number;
  registeredElectors: number;
  parentAssemblySegments: string[];
  allocations: SeatContestantAllocation[];
  allocatedPartyId: string | null;
  allocationStatus: SeatAllocationStatus;
}

export interface LokSabhaGameAlliance {
  id: string | null;
  name: string;
  type: "PREDEFINED" | "CUSTOM" | "INDEPENDENT";
  memberPartyIds: string[];
  /** Hex colour the player chose for their own front; absent means derive it from the members. */
  color?: string;
}

export type StateAllianceGroupType = "PLAYER" | "PREDEFINED" | "AI_CUSTOM" | "INDEPENDENT";

export interface StateAllianceGroup {
  id: string;
  name: string;
  type: StateAllianceGroupType;
  memberPartyIds: string[];
  isPlayerAlliance: boolean;
}

export interface StateSeatSharePlan {
  /** Party IDs and exact constituency counts for one alliance in one state. */
  [partyId: string]: number;
}

export interface LokSabhaGameSave {
  schemaVersion: 2;
  gameId: string;
  electionType: "LOK_SABHA";
  createdAt: string;
  updatedAt: string;
  electionYear: number;
  playerPartyId: string;
  alliance: LokSabhaGameAlliance;
  constituencies: LokSabhaGameConstituency[];
  /** Every party that is geographically eligible in a state. */
  statePartyParticipation: Record<string, string[]>;
  /** AI-formed electoral groups are calculated independently for each state. */
  stateAllianceGroups: Record<string, StateAllianceGroup[]>;
  /** Manual seat counts for the player's alliance, keyed by state then party. */
  playerSeatShares: Record<string, StateSeatSharePlan>;
  /** Exact seat-share plans used for the last allocation, keyed by state and group. */
  seatShareResults: Record<string, Record<string, StateSeatSharePlan>>;
  /** Parties explicitly removed from a selected predefined alliance or chosen to contest independently. */
  optedOutPartyIds: string[];
  totalConstituencies: number;
  totalVoters: number;
  allocatedConstituencies: number;
  status: "SETUP" | "SEAT_ALLOCATION" | "CAMPAIGN" | "RESULTS";
}
