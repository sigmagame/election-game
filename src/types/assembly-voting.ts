import type { VotingConstituencyResult } from "@/types/lok-sabha-voting";

export interface AssemblyConstituencyResult extends VotingConstituencyResult {
  constituencyName: string;
  regionId: string;
  /** The alliance group (or independent party) the winner contested for. */
  winnerAllianceId: string;
  winnerAllianceName: string;
  runnerUpPartyId: string | null;
  /** The winner's lead over the runner-up, in votes and as a share of all votes polled. */
  margin: number;
  marginPercent: number;
  /** Who the final campaign report projected to win this seat, when it recorded one. */
  projectedWinnerPartyId: string | null;
}

export interface AssemblyGroupResult {
  id: string;
  name: string;
  partyIds: string[];
  seats: number;
  votes: number;
  /** Percentage of all votes polled (NOTA included). */
  voteShare: number;
  isPlayerAlliance: boolean;
}

export interface AssemblyPartyResult {
  partyId: string;
  allianceId: string;
  allianceName: string;
  seatsContested: number;
  seatsWon: number;
  votes: number;
  voteShare: number;
}

export interface AssemblyElectionSummary {
  totalSeats: number;
  majorityMark: number;
  totalElectors: number;
  totalVotes: number;
  turnoutRate: number;
  notaVotes: number;
  /** Every alliance group and independent party, most seats first. */
  groups: AssemblyGroupResult[];
  parties: AssemblyPartyResult[];
  status: "MAJORITY" | "HUNG_ASSEMBLY";
  largestGroupId: string;
  largestGroupSeats: number;
  /** Seats the largest group is short of a majority (0 when it has one). */
  seatsShortOfMajority: number;
  /** Seats won by someone other than the final campaign report's projected winner. */
  differentFromProjection: number;
}

export interface AssemblyVotingSave {
  schemaVersion: 1;
  gameId: string;
  status: "COMPLETED";
  completedAt: string;
  results: AssemblyConstituencyResult[];
  summary: AssemblyElectionSummary;
  updatedAt: string;
}
