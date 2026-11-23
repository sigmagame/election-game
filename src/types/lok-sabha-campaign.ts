export const LOK_SABHA_CAMPAIGN_WEEKS = 12;
export const LOK_SABHA_CAMPAIGN_ACTIONS_PER_WEEK = 6;

export type CampaignActionType =
  | "PUBLIC_RALLY"
  | "DOOR_TO_DOOR"
  | "SOCIAL_MEDIA"
  | "MANIFESTO_PROMOTION"
  | "BOOTH_MOBILISATION"
  | "ROADSHOW";

export interface CampaignActionDefinition {
  id: CampaignActionType;
  name: string;
  baseImpact: number;
  lastingDuration: number;
  weeklyDecay: number;
  description: string;
}

export interface ConstituencyPartySupport {
  constituencyId: string;
  state: string;
  partySupport: Record<string, number>;
}

export interface CampaignActionRecord {
  id: string;
  week: number;
  partyId: string;
  actionType: CampaignActionType;
  state: string;
  createdAt: string;
  targetConstituencyIds?: string[];
  /** Assembly only: the region this action targets. Absent means the whole state. */
  targetRegionId?: string;
}

export type CampaignEventCategory = "PUBLIC_CAMPAIGN" | "POLITICAL" | "ECONOMIC_PUBLIC_ISSUES" | "MEDIA_OPINION" | "NATURAL_REGIONAL" | "ELECTION_ADMINISTRATION";
export type CampaignEventSentiment = "POSITIVE" | "NEGATIVE" | "NEUTRAL";
export type CampaignEventScope = "CONSTITUENCY" | "STATE" | "NATIONAL";
export type CampaignEventPriority = "INFORMATIONAL" | "LOW" | "MEDIUM" | "CRITICAL";

export interface CampaignEventRecord {
  id: string;
  eventDefinitionId: string;
  name: string;
  week: number;
  category: CampaignEventCategory;
  sentiment: CampaignEventSentiment;
  priority: CampaignEventPriority;
  scope: CampaignEventScope;
  location: string;
  durationWeeks: number;
  description: string;
  baseImpact: number;
  affectedConstituencyIds: string[];
  partyEffects: Record<string, number>;
  partyEffectsByState?: Record<string, Record<string, number>>;
  acknowledged: boolean;
  expiresAfterWeek: number;
}

export interface CampaignEventHistoryRecord {
  eventDefinitionId: string;
  week: number;
  eventId: string;
}


export interface LokSabhaCampaignSave {
  schemaVersion: 1;
  gameId: string;
  createdAt: string;
  updatedAt: string;
  status: "OVERVIEW" | "IN_PROGRESS" | "FINAL_REPORT" | "LOCKED";
  currentWeek: number;
  actionsRemaining: number;
  constituencySupport: ConstituencyPartySupport[];
  /** Immutable Week 1 baseline used for the final campaign comparison. */
  initialConstituencySupport?: ConstituencyPartySupport[];
  finalReport?: FinalCampaignReport;
  supportHistory: Array<{ week: number; nationalSupport: Record<string, number>; stateSupport: Record<string, Record<string, number>> }>;
  playerActions: CampaignActionRecord[];
  aiActions: CampaignActionRecord[];
  activeEvents: CampaignEventRecord[];
  eventHistory?: CampaignEventHistoryRecord[];
  eventGenerationByWeek?: number[];
  completedWeeks: number[];
  aiPersonalities: Record<string, string>;
  repetitionHistory: Record<string, Record<string, number>>;
  lastWeeklySummary: string | null;
  aiPerformanceHistory?: Array<{ week: number; stateChanges: Record<string, Record<string, number>> }>;
  aiLearningAdjustments?: Record<string, Record<string, Record<string, number>>>;
}



export interface FinalCampaignPartyRow {
  partyId: string;
  support: number;
  projectedSeats: number;
  seatsContested: number;
  seatsWon: number;
  voteShare: number;
}
export interface FinalCampaignBlocRow {
  id: string;
  name: string;
  projectedSeats: number;
  seatsContested: number;
  seatsWon: number;
  voteShare: number;
  memberPartyIds: string[];
}
export interface FinalCampaignStateRow {
  state: string;
  partySupport: Record<string, number>;
}
export interface FinalCampaignReport {
  generatedAt: string;
  week1BaselineMethod: "VOTER_WEIGHTED" | "LEGACY_UNWEIGHTED_FALLBACK";
  totalSeats: number;
  majorityMark: number;
  parliamentStatus: "MAJORITY" | "HUNG_PARLIAMENT";
  leadingBlocId: string | null;
  leadingBlocName: string | null;
  leadingBlocSeats: number;
  seatsNeeded: number;
  allianceRankings: FinalCampaignBlocRow[];
  nonAlliedPartyRankings: FinalCampaignPartyRow[];
  partyRows: FinalCampaignPartyRow[];
  nationalSupportComparison: Array<{ partyId: string; week1Support: number; week12Support: number; change: number }>;
  stateRows: FinalCampaignStateRow[];
  projectedConstituencyWinners: Array<{ constituencyId: string; state: string; partyId: string; blocId: string | null; blocName: string | null }>;
}

export interface CampaignImpactContribution {
  actionId: string;
  partyId: string;
  actionType: CampaignActionType;
  state: string;
  sourceWeek: number;
  impactKind: "IMMEDIATE" | "LASTING";
  impactPoints: number;
  supportPercentagePoints: number;
  repetitionMultiplier: number;
  decayMultiplier: number;
}

export interface ConstituencyCampaignImpact {
  constituencyId: string;
  state: string;
  partyImpacts: Record<string, {
    immediateImpactPoints: number;
    lastingImpactPoints: number;
    totalImpactPoints: number;
    immediateSupportPoints: number;
    lastingSupportPoints: number;
    totalSupportPoints: number;
    contributions: CampaignImpactContribution[];
  }>;
}
