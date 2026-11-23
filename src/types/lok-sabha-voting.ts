export interface VotingConstituencyResult {
  constituencyId: string;
  state: string;
  registeredElectors: number;
  turnoutRate: number;
  totalVotes: number;
  notaVotes: number;
  partyVotes: Record<string, number>;
  winnerPartyId: string;
}
export interface VotingPhaseResult {
  phase: number;
  day: number;
  completedAt: string;
  constituencyResults: VotingConstituencyResult[];
}
export interface LokSabhaVotingSave {
  schemaVersion: 1;
  gameId: string;
  scheduleId: string;
  status: "IN_PROGRESS" | "COMPLETED";
  currentPhase: number;
  completedPhases: number[];
  phaseResults: VotingPhaseResult[];
  updatedAt: string;
}
