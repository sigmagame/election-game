import { getEligiblePartyIdsForState, getPartyStrength } from "@/engine/lok-sabha-game-engine";
import { getPoliticalRelationship } from "@/engine/alliance-engine";
import type { CampaignGame, CampaignProfile } from "@/types/campaign-profile";
import { LOK_SABHA_PROFILE, majorityMark } from "@/types/campaign-profile";
import type { CampaignActionDefinition, CampaignActionRecord, CampaignActionType, ConstituencyPartySupport, LokSabhaCampaignSave, FinalCampaignReport, FinalCampaignBlocRow, FinalCampaignPartyRow } from "@/types/lok-sabha-campaign";
import { generateWeeklyCampaignEvent, getEventSupportEffects, getActiveEventsForWeek } from "@/engine/lok-sabha-random-events";

export const LOK_SABHA_CAMPAIGN_SAVE_KEY = "indian-election-game-lok-sabha-campaign-save";
export const CAMPAIGN_BASE_CONVERSION_RATE = 0.25;
export const CAMPAIGN_WEEKLY_SUPPORT_CHANGE_LIMIT = 2;
export const CAMPAIGN_INITIAL_VARIATION = 0.05;

export const CAMPAIGN_ACTIONS: CampaignActionDefinition[] = [
  { id: "PUBLIC_RALLY", name: "Public Rally", baseImpact: 4, lastingDuration: 1, weeklyDecay: 1, description: "Build visibility through a large public gathering." },
  { id: "DOOR_TO_DOOR", name: "Door-to-door Campaign", baseImpact: 3, lastingDuration: 3, weeklyDecay: 0.3, description: "Build personal connections with voters." },
  { id: "SOCIAL_MEDIA", name: "Social Media Campaign", baseImpact: 3, lastingDuration: 2, weeklyDecay: 0.4, description: "Reach voters through digital channels." },
  { id: "MANIFESTO_PROMOTION", name: "Manifesto Promotion", baseImpact: 2, lastingDuration: 3, weeklyDecay: 0.3, description: "Communicate policy commitments and priorities." },
  { id: "BOOTH_MOBILISATION", name: "Booth-level Worker Mobilisation", baseImpact: 3, lastingDuration: 2, weeklyDecay: 0.35, description: "Strengthen local booth organisation and voter contact." },
  { id: "ROADSHOW", name: "Roadshow", baseImpact: 4, lastingDuration: 2, weeklyDecay: 0.4, description: "Generate visibility across a route and nearby communities." },
];

function randomBetween(min: number, max: number, random: () => number): number {
  return min + (max - min) * random();
}

function roundSupport(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function initializeConstituencySupport(
  game: CampaignGame,
  random: () => number = Math.random,
  profile: CampaignProfile = LOK_SABHA_PROFILE,
): ConstituencyPartySupport[] {
  const support: ConstituencyPartySupport[] = [];
  const statePartyCache = new Map<string, string[]>();
  const variation = profile.localVariation;
  const regionOf = new Map<string, string>();
  for (const [state, regions] of Object.entries(game.regions ?? {})) {
    for (const region of regions) for (const id of region.constituencyIds) regionOf.set(id, `${state}|${region.id}`);
  }
  const regionFactors = new Map<string, number>();
  // Mean-preserving log-normal factor: median slightly below 1, mean exactly 1.
  const lognormal = (sigma: number): number => {
    const gaussian = Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) * Math.cos(2 * Math.PI * random());
    return Math.exp(sigma * gaussian - (sigma * sigma) / 2);
  };
  const baseTransferRates: Record<string, number> = {
    STRONG_ALLY: 0.85,
    FRIENDLY: 0.70,
    NEUTRAL: 0.45,
    RIVAL: 0.05,
    STRONG_RIVAL: 0,
    UNDEFINED: 0.45,
  };

  for (const constituency of game.constituencies) {
    const partyIds = statePartyCache.get(constituency.state) ?? getEligiblePartyIdsForState(constituency.state);
    statePartyCache.set(constituency.state, partyIds);
    if (partyIds.length === 0) throw new Error(`No eligible parties are configured for ${constituency.state}. Campaign initialization cannot continue.`);

    // Core support is generated only for parties with an established foothold
    // in this state. It is a potential supporter pool, not a candidate vote.
    const weighted = partyIds.map((partyId) => {
      const base = getPartyStrength(partyId, constituency.state);
      if (base === null || !Number.isFinite(base) || base < 0) {
        throw new Error(`Missing or invalid base party strength for ${partyId} in ${constituency.state}. Add a valid value to party-strength-by-region.json before starting the campaign.`);
      }
      const regionalValues = partyIds.map((id) => getPartyStrength(id, constituency.state) ?? 0);
      const regionalMaximum = Math.max(0.0001, ...regionalValues);
      // Strong regional parties have steadier local baselines; weaker parties
      // receive wider constituency-level variation, producing local surprises.
      if (variation) {
        const regionKey = `${regionOf.get(constituency.constituencyId) ?? constituency.state}|${partyId}`;
        let regionFactor = regionFactors.get(regionKey);
        if (regionFactor === undefined) {
          regionFactor = lognormal(variation.regionSigma);
          regionFactors.set(regionKey, regionFactor);
        }
        const seatSigma = variation.seatSigma * (1 + variation.smallPartyBoost * (1 - Math.min(1, base / regionalMaximum)));
        return { partyId, value: base * regionFactor * lognormal(seatSigma) };
      }
      const localVariation = 0.025 + (1 - Math.min(1, base / regionalMaximum)) * 0.06;
      return { partyId, value: base * randomBetween(1 - localVariation, 1 + localVariation, random) };
    });
    const potentialTotal = weighted.reduce((sum, item) => sum + item.value, 0);
    if (!(potentialTotal > 0)) throw new Error(`The eligible parties in ${constituency.state} have no positive combined strength. Campaign initialization cannot continue.`);
    const potential = Object.fromEntries(weighted.map((item) => [item.partyId, item.value / potentialTotal * 100]));

    const contestants = constituency.allocations.map((allocation) => allocation.partyId);
    if (!contestants.length) throw new Error(`No allocated candidate found for ${constituency.name}.`);
    const candidateWeights: Record<string, number> = {};
    contestants.forEach((partyId) => { candidateWeights[partyId] = potential[partyId] ?? 0; });

    // Dynamic alliance transfer: only locally allied parties with footholds
    // in this state are eligible. A transfer is considered only when the
    // source party does not contest this constituency and the recipient is
    // the constituency's allocated alliance candidate.
    const localGroups = game.stateAllianceGroups?.[constituency.state] ?? [];
    for (const group of localGroups) {
      const groupCandidates = group.memberPartyIds.filter((id) => contestants.includes(id));
      if (groupCandidates.length !== 1) continue;
      const recipientId = groupCandidates[0];
      const recipient = getPartyStrength(recipientId, constituency.state) ?? 0;
      const stateStrengths = group.memberPartyIds.map((id) => getPartyStrength(id, constituency.state) ?? 0);
      const maxGroupStrength = Math.max(0.0001, ...stateStrengths);
      const localDiscipline = group.type === "PREDEFINED" || group.type === "PLAYER" ? 0.90 : 0.85;

      for (const sourceId of group.memberPartyIds) {
        if (sourceId === recipientId || contestants.includes(sourceId)) continue;
        // A party without a foothold cannot generate a potential support pool.
        if (!partyIds.includes(sourceId)) continue;
        const relationship = getPoliticalRelationship(sourceId, recipientId, {
          electionType: profile.electionType, region: constituency.state, activateConditionalRules: true,
        }).relationship;
        const baseRate = baseTransferRates[relationship] ?? 0.45;
        if (baseRate <= 0) continue;
        const sourceStrength = getPartyStrength(sourceId, constituency.state) ?? 0;
        const localOrganisation = Math.max(0.70, Math.min(1.15, 0.70 + (sourceStrength / maxGroupStrength) * 0.45));
        const candidateAppeal = Math.max(0.70, Math.min(1.20, 0.70 + (recipient / maxGroupStrength) * 0.50));
        const transferRate = Math.min(0.95, baseRate * localDiscipline * localOrganisation * candidateAppeal);
        candidateWeights[recipientId] += (potential[sourceId] ?? 0) * transferRate;
      }
    }

    // Only allocated candidates receive votes. Any untransferred potential
    // support remains outside the receiving candidate's tally; normalization
    // distributes the constituency's valid candidate vote pool among actual
    // contestants without inventing candidates or double-counting supporters.
    const candidateTotal = Object.values(candidateWeights).reduce((sum, value) => sum + Math.max(0, value), 0);
    if (!(candidateTotal > 0)) throw new Error(`No positive candidate support exists for ${constituency.name}.`);
    const partySupport: Record<string, number> = {};
    for (const [partyId, value] of Object.entries(candidateWeights)) {
      partySupport[partyId] = roundSupport(Math.max(0, value) / candidateTotal * 100);
    }
    const sum = Object.values(partySupport).reduce((a, b) => a + b, 0);
    const largestParty = Object.entries(partySupport).sort((a, b) => b[1] - a[1])[0][0];
    partySupport[largestParty] = roundSupport(partySupport[largestParty] + (100 - sum));
    support.push({ constituencyId: constituency.constituencyId, state: constituency.state, partySupport });
  }
  return support;
}

export function summarizeSupport(support: ConstituencyPartySupport[]) {
  const nationalTotals: Record<string, number> = {};
  const stateTotals: Record<string, Record<string, number>> = {};
  const stateCounts: Record<string, number> = {};
  for (const item of support) {
    stateCounts[item.state] = (stateCounts[item.state] ?? 0) + 1;
    stateTotals[item.state] ??= {};
    for (const [partyId, value] of Object.entries(item.partySupport)) {
      nationalTotals[partyId] = (nationalTotals[partyId] ?? 0) + value;
      stateTotals[item.state][partyId] = (stateTotals[item.state][partyId] ?? 0) + value;
    }
  }
  const nationalSupport = Object.fromEntries(Object.entries(nationalTotals).map(([party, total]) => [party, roundSupport(total / support.length)]));
  const stateSupport = Object.fromEntries(Object.entries(stateTotals).map(([state, parties]) => [state, Object.fromEntries(Object.entries(parties).map(([party, total]) => [party, roundSupport(total / stateCounts[state])]))]));
  return { nationalSupport, stateSupport };
}


export const AI_CAMPAIGN_PERSONALITIES = [
  "STRONGHOLD_DEFENDER",
  "EXPANSIONIST",
  "BALANCED",
  "COMPETITIVE",
  "OPPORTUNISTIC",
] as const;

type AiPersonality = typeof AI_CAMPAIGN_PERSONALITIES[number];

const AI_PERSONALITY_RANDOMNESS: Record<AiPersonality, number> = {
  STRONGHOLD_DEFENDER: 0.10,
  EXPANSIONIST: 0.20,
  BALANCED: 0.15,
  COMPETITIVE: 0.25,
  OPPORTUNISTIC: 0.30,
};

const MANDATORY_NATIONAL_AI_PARTIES = new Set(["BJP", "INC", "CPI", "CPM"]);

const AI_PRIORITY_WEIGHTS = {
  strength: 0.20,
  growth: 0.25,
  performance: 0.15,
  polls: 0.15,
  personality: 0.15,
  repetition: 0.05,
  alliance: 0.03,
  events: 0.02,
} as const;

function stableSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (((value ^ (value >>> 14)) >>> 0) / 4294967296);
  };
}

function allGamePartyIds(game: CampaignGame): string[] {
  return [...new Set(Object.values(game.statePartyParticipation ?? {}).flat())].sort();
}

function initializeAiPersonalities(game: CampaignGame): Record<string, string> {
  const ids = allGamePartyIds(game).filter((partyId) => partyId !== game.playerPartyId);
  const random = seededRandom(stableSeed(`${game.gameId}:ai-personalities`));
  return Object.fromEntries(ids.map((partyId) => [
    partyId,
    AI_CAMPAIGN_PERSONALITIES[Math.floor(random() * AI_CAMPAIGN_PERSONALITIES.length)],
  ]));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getPartyStrengthShare(partyId: string, state: string, eligible: string[]): number {
  const values = eligible.map((id) => Math.max(0, getPartyStrength(id, state) ?? 0.5));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 1 / Math.max(1, eligible.length);
  const index = eligible.indexOf(partyId);
  return index < 0 ? 0 : values[index] / total;
}

function getPersonalityActionBias(personality: AiPersonality, actionType: CampaignActionType): number {
  const preferences: Record<AiPersonality, Partial<Record<CampaignActionType, number>>> = {
    STRONGHOLD_DEFENDER: { DOOR_TO_DOOR: 1, BOOTH_MOBILISATION: 1, PUBLIC_RALLY: 0.75, ROADSHOW: 0.65 },
    EXPANSIONIST: { ROADSHOW: 1, PUBLIC_RALLY: 0.95, SOCIAL_MEDIA: 0.9, MANIFESTO_PROMOTION: 0.8 },
    BALANCED: { PUBLIC_RALLY: 0.8, DOOR_TO_DOOR: 0.8, SOCIAL_MEDIA: 0.8, MANIFESTO_PROMOTION: 0.8, BOOTH_MOBILISATION: 0.8, ROADSHOW: 0.8 },
    COMPETITIVE: { PUBLIC_RALLY: 1, ROADSHOW: 1, SOCIAL_MEDIA: 0.9, BOOTH_MOBILISATION: 0.85 },
    OPPORTUNISTIC: { SOCIAL_MEDIA: 1, MANIFESTO_PROMOTION: 0.95, ROADSHOW: 0.9, DOOR_TO_DOOR: 0.85 },
  };
  return preferences[personality][actionType] ?? 0.65;
}

function getRecentPartyStatePerformance(
  campaign: LokSabhaCampaignSave,
  partyId: string,
  state: string,
  targetWeek: number,
): number {
  const recent = (campaign.aiPerformanceHistory ?? [])
    .filter((item) => item.week < targetWeek && targetWeek - item.week <= 3)
    .slice(-3);
  if (!recent.length) return 0.5;
  const changes = recent.map((item) => item.stateChanges[state]?.[partyId] ?? 0);
  const average = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  return clamp01(0.5 + average / 4);
}

function getRecentPollMomentum(
  campaign: LokSabhaCampaignSave,
  partyId: string,
  state: string,
): number {
  const history = campaign.supportHistory.filter((item) => item.stateSupport[state]);
  if (history.length < 2) return 0.5;
  const current = history[history.length - 1].stateSupport[state][partyId] ?? 0;
  const previous = history[history.length - 2].stateSupport[state][partyId] ?? current;
  return clamp01(0.5 + (current - previous) / 4);
}

function getAiPartyStates(game: CampaignGame, partyId: string): string[] {
  return Object.entries(game.statePartyParticipation ?? {})
    .filter(([, partyIds]) => partyIds.includes(partyId))
    .map(([state]) => state)
    .sort();
}

function buildAiCampaignActions(
  campaign: LokSabhaCampaignSave,
  game: CampaignGame,
  profile: CampaignProfile = LOK_SABHA_PROFILE,
): { aiActions: CampaignActionRecord[]; personalities: Record<string, string>; learning: NonNullable<LokSabhaCampaignSave["aiLearningAdjustments"]> } {
  const personalities = { ...(campaign.aiPersonalities ?? {}) };
  const initialPersonalities = initializeAiPersonalities(game);
  for (const [partyId, personality] of Object.entries(initialPersonalities)) {
    if (!personalities[partyId]) personalities[partyId] = personality;
  }
  const learning = { ...(campaign.aiLearningAdjustments ?? {}) };
  const eligibleByState = new Map(Object.keys(game.statePartyParticipation ?? {}).map((state) => [state, getEligiblePartyIdsForState(state)]));
  const supportByState = summarizeSupport(campaign.constituencySupport).stateSupport;
  const generated: CampaignActionRecord[] = [];
  const existingCurrent = campaign.aiActions.filter((action) => action.week === campaign.currentWeek);
  if (existingCurrent.length) {
    return { aiActions: campaign.aiActions, personalities, learning };
  }

  // Re-evaluate action performance on a rolling three-week window. The
  // adjustment is applied once per weekly evaluation and remains bounded.
  if (campaign.currentWeek >= 4) {
    const evaluationWeeks = new Set([campaign.currentWeek - 3, campaign.currentWeek - 2, campaign.currentWeek - 1]);
    const recentActions = campaign.aiActions.filter((item) => evaluationWeeks.has(item.week));
    const grouped: Record<string, number[]> = {};
    for (const action of recentActions) {
      const history = (campaign.aiPerformanceHistory ?? []).find((item) => item.week === action.week);
      const movement = history?.stateChanges[action.state]?.[action.partyId] ?? 0;
      const key = `${action.partyId}|${action.actionType}|${action.state}`;
      (grouped[key] ??= []).push(movement);
    }
    for (const [key, movements] of Object.entries(grouped)) {
      const [partyId, actionType, state] = key.split("|");
      const averageMovement = movements.reduce((sum, value) => sum + value, 0) / movements.length;
      const step = Math.max(-10, Math.min(10, averageMovement * 2));
      learning[partyId] ??= {};
      learning[partyId][actionType] ??= {};
      const old = learning[partyId][actionType][state] ?? 0;
      learning[partyId][actionType][state] = Math.max(-30, Math.min(30, old + step));
    }
  }

  const partyIds = allGamePartyIds(game).filter((partyId) => partyId !== game.playerPartyId);
  const random = seededRandom(stableSeed(`${campaign.gameId}:ai-week:${campaign.currentWeek}`));
  const partnerPlannedStates: Record<string, Record<string, number>> = {};

  for (const partyId of partyIds) {
    const personality = (personalities[partyId] in AI_PERSONALITY_RANDOMNESS
      ? personalities[partyId]
      : "BALANCED") as AiPersonality;
    const states = getAiPartyStates(game, partyId).filter((state) => (eligibleByState.get(state) ?? []).includes(partyId));
    if (!states.length) continue;

    // National parties controlled by AI complete all six weekly actions.
    // Other AI parties retain the flexible zero-to-six action rule.
    const actionCount = MANDATORY_NATIONAL_AI_PARTIES.has(partyId)
      ? profile.actionsPerWeek
      : Math.floor(random() * (profile.actionsPerWeek + 1));
    for (let actionIndex = 0; actionIndex < actionCount; actionIndex += 1) {
      let best: { state: string; actionType: CampaignActionType; score: number } | null = null;
      for (const state of states) {
        const eligible = eligibleByState.get(state) ?? [];
        const strength = getPartyStrengthShare(partyId, state, eligible);
        const currentSupport = supportByState[state]?.[partyId] ?? 0;
        const growth = clamp01(0.5 + (strength * 100 - currentSupport) / 100);
        const performance = getRecentPartyStatePerformance(campaign, partyId, state, campaign.currentWeek);
        const polls = getRecentPollMomentum(campaign, partyId, state);
        const group = game.stateAllianceGroups?.[state]?.find((item) => item.memberPartyIds.includes(partyId));
        const alliedActivity = group?.memberPartyIds.filter((id) => id !== partyId)
          .reduce((sum, id) => sum + (partnerPlannedStates[id]?.[state] ?? 0), 0) ?? 0;
        const alliance = clamp01(0.5 + Math.min(2, alliedActivity) * 0.15 + (group ? 0.1 : 0));
        const activeEventCount = getActiveEventsForWeek(campaign.activeEvents ?? [], campaign.currentWeek).filter((event) => event.scope === "NATIONAL" || event.location === state || event.affectedConstituencyIds.some((id) => campaign.constituencySupport.some((item) => item.constituencyId === id && item.state === state))).length;
        const events = clamp01(0.5 + Math.min(2, activeEventCount) * 0.15);
        // Encourage national parties to spread their six actions across their
        // eligible regions instead of repeatedly concentrating in one state.
        const plannedInState = partnerPlannedStates[partyId]?.[state] ?? 0;
        const geographicCoverage = 1 / (1 + plannedInState * 0.35);

        for (const action of CAMPAIGN_ACTIONS) {
          const history = [...campaign.playerActions, ...campaign.aiActions, ...generated];
          const pseudo: CampaignActionRecord = {
            id: `ai-preview-${partyId}-${campaign.currentWeek}-${actionIndex}-${state}-${action.id}`,
            week: campaign.currentWeek,
            partyId,
            actionType: action.id,
            state,
            createdAt: `${campaign.currentWeek}-${actionIndex}-${state}-${action.id}`,
          };
          const repetition = getActionRepetitionMultiplier(pseudo, history);
          const repetitionScore = clamp01(repetition);
          const personalityScore = getPersonalityActionBias(personality, action.id);
          const adjustment = learning[partyId]?.[action.id]?.[state] ?? 0;
          const weighted =
            AI_PRIORITY_WEIGHTS.strength * strength +
            AI_PRIORITY_WEIGHTS.growth * growth +
            AI_PRIORITY_WEIGHTS.performance * performance +
            AI_PRIORITY_WEIGHTS.polls * polls +
            AI_PRIORITY_WEIGHTS.personality * personalityScore +
            AI_PRIORITY_WEIGHTS.repetition * repetitionScore +
            AI_PRIORITY_WEIGHTS.alliance * alliance +
            AI_PRIORITY_WEIGHTS.events * events +
            adjustment / 100 +
            (MANDATORY_NATIONAL_AI_PARTIES.has(partyId) ? geographicCoverage * 0.04 : 0);
          const noise = (random() - 0.5) * 2 * AI_PERSONALITY_RANDOMNESS[personality] * 0.08;
          const score = weighted + noise;
          if (!best || score > best.score) best = { state, actionType: action.id, score };
        }
      }
      if (!best) continue;
      // In addition to small score noise, each personality occasionally takes
      // a deliberate alternative action/location to avoid deterministic play.
      if (random() < AI_PERSONALITY_RANDOMNESS[personality] * 0.2) {
        const alternativeState = states[Math.floor(random() * states.length)];
        const alternativeAction = CAMPAIGN_ACTIONS[Math.floor(random() * CAMPAIGN_ACTIONS.length)];
        best = { state: alternativeState, actionType: alternativeAction.id, score: best.score };
      }
      const record: CampaignActionRecord = {
        id: `ai-${campaign.currentWeek}-${partyId}-${actionIndex}`,
        week: campaign.currentWeek,
        partyId,
        actionType: best.actionType,
        state: best.state,
        createdAt: new Date(0).toISOString(),
      };
      generated.push(record);
      partnerPlannedStates[partyId] ??= {};
      partnerPlannedStates[partyId][best.state] = (partnerPlannedStates[partyId][best.state] ?? 0) + 1;
    }
  }

  const targeted = game.regions ? assignAiRegionTargets(generated, game, campaign, personalities) : generated;
  return { aiActions: [...campaign.aiActions, ...targeted], personalities, learning };
}

/**
 * Assembly only: after the planner has chosen what each AI party does, pick which region of the state
 * each action targets. Uses its own seeded generator so the planner's random sequence is untouched.
 * Strongholds defenders protect where they are strongest, expansionists go where they are weakest,
 * everyone else spreads out in proportion to region size.
 */
function assignAiRegionTargets(
  actions: CampaignActionRecord[],
  game: CampaignGame,
  campaign: LokSabhaCampaignSave,
  personalities: Record<string, string>,
): CampaignActionRecord[] {
  const supportById = new Map(campaign.constituencySupport.map((item) => [item.constituencyId, item.partySupport]));
  return actions.map((action) => {
    const regions = game.regions?.[action.state] ?? [];
    if (!regions.length) return action;
    const random = seededRandom(stableSeed(`${campaign.gameId}:ai-region:${action.id}`));
    const personality = personalities[action.partyId];
    const weights = regions.map((region) => {
      const seats = region.constituencyIds.length;
      const average = seats ? region.constituencyIds.reduce((sum, id) => sum + (supportById.get(id)?.[action.partyId] ?? 0), 0) / seats : 0;
      if (personality === "STRONGHOLD_DEFENDER") return seats * (0.25 + average / 100);
      if (personality === "EXPANSIONIST") return seats * (1.25 - average / 100);
      return seats;
    });
    const total = weights.reduce((sum, value) => sum + value, 0) || 1;
    let roll = random() * total;
    let chosen = regions[regions.length - 1];
    for (let i = 0; i < regions.length; i += 1) {
      roll -= weights[i];
      if (roll < 0) { chosen = regions[i]; break; }
    }
    return { ...action, targetRegionId: chosen.id, targetConstituencyIds: chosen.constituencyIds };
  });
}

export function createLokSabhaCampaignSave(game: CampaignGame, random: () => number = Math.random, profile: CampaignProfile = LOK_SABHA_PROFILE): LokSabhaCampaignSave {
  if (profile.requiredSeats !== null && game.constituencies.length !== profile.requiredSeats) throw new Error(`Expected ${profile.requiredSeats} ${profile.label} constituencies, but found ${game.constituencies.length}. Check the constituency dataset before starting the campaign.`);
  if (game.allocatedConstituencies !== game.totalConstituencies) throw new Error(`Seat allocation is not complete (${game.allocatedConstituencies}/${game.totalConstituencies}). Complete ${profile.label} seat allocation before starting the campaign.`);
  const constituencySupport = initializeConstituencySupport(game, random, profile);
  const summary = summarizeSupport(constituencySupport);
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    gameId: game.gameId,
    createdAt: now,
    updatedAt: now,
    status: "IN_PROGRESS",
    currentWeek: 1,
    actionsRemaining: profile.actionsPerWeek,
    constituencySupport,
    initialConstituencySupport: constituencySupport.map((item) => ({ ...item, partySupport: { ...item.partySupport } })),
    supportHistory: [{ week: 1, ...summary }],
    playerActions: [],
    aiActions: [],
    activeEvents: [],
    eventHistory: [],
    eventGenerationByWeek: [],
    completedWeeks: [],
    aiPersonalities: initializeAiPersonalities(game),
    aiPerformanceHistory: [],
    aiLearningAdjustments: {},
    repetitionHistory: {},
    lastWeeklySummary: null,
  };
}

export function saveLokSabhaCampaign(campaign: LokSabhaCampaignSave): void {
  if (typeof window === "undefined") throw new Error("Campaign saves are only available in the browser.");
  window.localStorage.setItem(LOK_SABHA_CAMPAIGN_SAVE_KEY, JSON.stringify({ ...campaign, updatedAt: new Date().toISOString() }));
}

export function loadLokSabhaCampaign(gameId?: string): LokSabhaCampaignSave | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOK_SABHA_CAMPAIGN_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LokSabhaCampaignSave;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.constituencySupport) || (gameId && parsed.gameId !== gameId)) return null;
    return parsed;
  } catch { return null; }
}



export function queuePlayerCampaignAction(
  campaign: LokSabhaCampaignSave,
  game: CampaignGame,
  actionType: CampaignActionType,
  state: string,
  regionId?: string,
  profile: CampaignProfile = LOK_SABHA_PROFILE,
): LokSabhaCampaignSave {
  if (campaign.status !== "IN_PROGRESS") throw new Error("This campaign is not accepting actions.");
  if (campaign.currentWeek < 1 || campaign.currentWeek > profile.weeks) throw new Error("The campaign week is invalid.");
  if (campaign.completedWeeks.includes(campaign.currentWeek)) throw new Error("This campaign week has already been completed.");
  const currentWeekActions = campaign.playerActions.filter((action) => action.week === campaign.currentWeek);
  if (currentWeekActions.length >= profile.actionsPerWeek) throw new Error(`You have reached the ${profile.actionsPerWeek === 6 ? "six" : profile.actionsPerWeek}-action limit for this week.`);
  if (!game.constituencies.some((item) => item.state === state)) throw new Error(`Unknown state or union territory: ${state}.`);
  if (!getEligiblePartyIdsForState(state).includes(game.playerPartyId)) {
    throw new Error(`${game.playerPartyId} is not eligible to contest in ${state}. You cannot campaign there.`);
  }
  if (!CAMPAIGN_ACTIONS.some((action) => action.id === actionType)) throw new Error("Invalid campaign action.");
  const region = regionId === undefined ? undefined : game.regions?.[state]?.find((item) => item.id === regionId);
  if (regionId !== undefined && !region) throw new Error(`Unknown campaign region: ${regionId}.`);
  const record: CampaignActionRecord = {
    id: `player-${campaign.currentWeek}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    week: campaign.currentWeek,
    partyId: game.playerPartyId,
    actionType,
    state,
    createdAt: new Date().toISOString(),
    ...(region ? { targetRegionId: region.id, targetConstituencyIds: region.constituencyIds } : {}),
  };
  const updated = {
    ...campaign,
    playerActions: [...campaign.playerActions, record],
    actionsRemaining: profile.actionsPerWeek - currentWeekActions.length - 1,
    updatedAt: new Date().toISOString(),
  };
  return updated;
}

export function removePlayerCampaignAction(
  campaign: LokSabhaCampaignSave,
  actionId: string,
  profile: CampaignProfile = LOK_SABHA_PROFILE,
): LokSabhaCampaignSave {
  if (campaign.status !== "IN_PROGRESS") throw new Error("This campaign is not accepting changes.");
  if (campaign.completedWeeks.includes(campaign.currentWeek)) throw new Error("This campaign week has already been completed.");
  const currentWeekActions = campaign.playerActions.filter((action) => action.week === campaign.currentWeek);
  const exists = currentWeekActions.some((action) => action.id === actionId);
  if (!exists) throw new Error("The selected action is not part of the current campaign week.");
  const playerActions = campaign.playerActions.filter((action) => action.id !== actionId);
  const remaining = playerActions.filter((action) => action.week === campaign.currentWeek).length;
  return {
    ...campaign,
    playerActions,
    actionsRemaining: profile.actionsPerWeek - remaining,
    updatedAt: new Date().toISOString(),
  };
}


/**
 * The configured weeklyDecay is interpreted as the share of impact lost
 * each week. For example, 0.30 means 30% is lost and 70% remains.
 * Lasting impact begins in the week after the action.
 */
export function getActionRepetitionMultiplier(
  action: Pick<CampaignActionRecord, "partyId" | "actionType" | "state" | "week" | "createdAt" | "targetRegionId">,
  actionHistory: CampaignActionRecord[],
): number {
  const definition = CAMPAIGN_ACTIONS.find((item) => item.id === action.actionType);
  if (!definition) throw new Error(`Unknown campaign action: ${action.actionType}`);
  const relevant = actionHistory
    .filter((item) => item.partyId === action.partyId && item.actionType === action.actionType && item.state === action.state && (item.targetRegionId ?? "") === (action.targetRegionId ?? ""))
    .sort((a, b) => a.week - b.week || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  let streak = 0;
  let previousWeek: number | null = null;
  for (const item of relevant) {
    if (previousWeek === null || item.week - previousWeek >= 3) streak = 1;
    else streak += 1;
    previousWeek = item.week;
    if (item.id === (action as CampaignActionRecord).id ||
        (item.week === action.week && item.createdAt === action.createdAt)) {
      return Math.max(0.5, 1 - (streak - 1) * 0.1);
    }
  }
  // An action being evaluated may not yet be present in the history array.
  if (previousWeek === null || action.week - previousWeek >= 3) streak = 1;
  else streak += 1;
  return Math.max(0.5, 1 - (streak - 1) * 0.1);
}

function actionImpactForWeek(
  action: CampaignActionRecord,
  targetWeek: number,
  fullHistory: CampaignActionRecord[],
): { impactPoints: number; impactKind: "IMMEDIATE" | "LASTING"; repetitionMultiplier: number; decayMultiplier: number } | null {
  const definition = CAMPAIGN_ACTIONS.find((item) => item.id === action.actionType);
  if (!definition || targetWeek < action.week || targetWeek > action.week + definition.lastingDuration) return null;
  const repetitionMultiplier = getActionRepetitionMultiplier(action, fullHistory);
  if (targetWeek === action.week) {
    return {
      impactPoints: definition.baseImpact * repetitionMultiplier,
      impactKind: "IMMEDIATE",
      repetitionMultiplier,
      decayMultiplier: 1,
    };
  }
  const weeksAfterAction = targetWeek - action.week;
  const decayMultiplier = Math.pow(1 - definition.weeklyDecay, weeksAfterAction);
  return {
    impactPoints: definition.baseImpact * repetitionMultiplier * decayMultiplier,
    impactKind: "LASTING",
    repetitionMultiplier,
    decayMultiplier,
  };
}

/**
 * Calculates the player's or an AI party's campaign impact in one constituency.
 * A state-targeted action applies equally to every parliamentary constituency
 * in that state. Support redistribution and the weekly +/-2pp cap are handled
 * by the later weekly support-processing stage.
 */
export function calculateConstituencyCampaignImpact(
  constituency: ConstituencyPartySupport,
  targetWeek: number,
  actionHistory: CampaignActionRecord[],
  profile: CampaignProfile = LOK_SABHA_PROFILE,
): import("@/types/lok-sabha-campaign").ConstituencyCampaignImpact {
  if (!Number.isInteger(targetWeek) || targetWeek < 1 || targetWeek > profile.weeks) {
    throw new Error(`Campaign impact target week must be between 1 and ${profile.weeks}.`);
  }
  const partyImpacts: import("@/types/lok-sabha-campaign").ConstituencyCampaignImpact["partyImpacts"] = {};
  for (const action of actionHistory) {
    if (action.state !== constituency.state) continue;
    // A region-targeted action (Assembly) only affects the constituencies of that region.
    if (action.targetConstituencyIds && !action.targetConstituencyIds.includes(constituency.constituencyId)) continue;
    const calculated = actionImpactForWeek(action, targetWeek, actionHistory);
    if (!calculated) continue;
    const supportPercentagePoints = calculated.impactPoints * CAMPAIGN_BASE_CONVERSION_RATE;
    const party = partyImpacts[action.partyId] ??= {
      immediateImpactPoints: 0,
      lastingImpactPoints: 0,
      totalImpactPoints: 0,
      immediateSupportPoints: 0,
      lastingSupportPoints: 0,
      totalSupportPoints: 0,
      contributions: [],
    };
    if (calculated.impactKind === "IMMEDIATE") {
      party.immediateImpactPoints += calculated.impactPoints;
      party.immediateSupportPoints += supportPercentagePoints;
    } else {
      party.lastingImpactPoints += calculated.impactPoints;
      party.lastingSupportPoints += supportPercentagePoints;
    }
    party.totalImpactPoints += calculated.impactPoints;
    party.totalSupportPoints += supportPercentagePoints;
    party.contributions.push({
      actionId: action.id,
      partyId: action.partyId,
      actionType: action.actionType,
      state: action.state,
      sourceWeek: action.week,
      impactKind: calculated.impactKind,
      impactPoints: calculated.impactPoints,
      supportPercentagePoints,
      repetitionMultiplier: calculated.repetitionMultiplier,
      decayMultiplier: calculated.decayMultiplier,
    });
  }
  return { constituencyId: constituency.constituencyId, state: constituency.state, partyImpacts };
}

export function calculateCampaignImpactsForWeek(
  constituencies: ConstituencyPartySupport[],
  targetWeek: number,
  playerActions: CampaignActionRecord[],
  aiActions: CampaignActionRecord[] = [],
  profile: CampaignProfile = LOK_SABHA_PROFILE,
): import("@/types/lok-sabha-campaign").ConstituencyCampaignImpact[] {
  const allActions = [...playerActions, ...aiActions];
  return constituencies.map((constituency) =>
    calculateConstituencyCampaignImpact(constituency, targetWeek, allActions, profile)
  );
}

export interface WeeklyPartyChange {
  partyId: string;
  previousSupport: number;
  currentSupport: number;
  change: number;
}

export interface WeeklyCampaignSummary {
  week: number;
  nationalChanges: WeeklyPartyChange[];
  stateChanges: Record<string, WeeklyPartyChange[]>;
  completedAt: string;
  constituenciesProcessed: number;
  aiActivity?: { partiesActive: number; actionsPerformed: number };
  events?: Array<{ id: string; name: string; category: string; sentiment: string; priority: string; scope: string; location: string; description: string; durationWeeks: number; baseImpact: number; partyEffectsByState?: Record<string, Record<string, number>> }>;
}

function roundFour(value: number): number { return Math.round(value * 10000) / 10000; }

/**
 * Redistributes campaign-driven support within one constituency. Parties
 * receiving positive campaign influence draw support first from rivals, then
 * from all remaining parties proportionally. Every party's weekly net movement
 * is capped at +/-2pp and the final constituency total is exactly 100%.
 */
export function applyWeeklySupportChanges(
  support: ConstituencyPartySupport[],
  impacts: import("@/types/lok-sabha-campaign").ConstituencyCampaignImpact[],
  eventEffects: Record<string, Record<string, number>> = {},
  profile: CampaignProfile = LOK_SABHA_PROFILE,
): ConstituencyPartySupport[] {
  const impactById = new Map(impacts.map((item) => [item.constituencyId, item]));
  return support.map((constituency) => {
    const current = { ...constituency.partySupport };
    const impact = impactById.get(constituency.constituencyId);
    if (!impact) return constituency;
    const parties = Object.keys(current);
    const gains = new Map<string, number>();
    for (const party of parties) {
      const desired = (impact.partyImpacts[party]?.totalSupportPoints ?? 0) + (eventEffects[constituency.constituencyId]?.[party] ?? 0);
      gains.set(party, Math.min(CAMPAIGN_WEEKLY_SUPPORT_CHANGE_LIMIT, Math.max(0, desired)));
    }
    const totalGain = [...gains.values()].reduce((a, b) => a + b, 0);
    // Initialize direct-loss reductions before reading them. Accessing this
    // const earlier triggers a temporal-dead-zone ReferenceError at runtime.
    const reductions = new Map<string, number>(parties.map((party) => [party, Math.min(CAMPAIGN_WEEKLY_SUPPORT_CHANGE_LIMIT, Math.max(0, -((impact.partyImpacts[party]?.totalSupportPoints ?? 0) + (eventEffects[constituency.constituencyId]?.[party] ?? 0))))]));
    const hasDirectLoss = parties.some((party) => (reductions.get(party) ?? 0) > 0);
    if (totalGain <= 0 && !hasDirectLoss) return constituency;

    let remainingToFund = totalGain;
    const recipients = parties.filter((party) => (gains.get(party) ?? 0) > 0);
    // Any party can lose some support while campaigning; this also handles
    // weeks in which every eligible party has positive campaign influence.
    const donors = [...parties];
    const directEventLosers = donors.filter((donor) => (reductions.get(donor) ?? 0) > 0);
    const rivalDonors = donors.filter((donor) => directEventLosers.includes(donor) || recipients.some((recipient) => {
      const relationship = getPoliticalRelationship(recipient, donor, { region: constituency.state, electionType: profile.electionType }).relationship;
      return relationship === "RIVAL" || relationship === "STRONG_RIVAL";
    }));
    const otherDonors = donors.filter((party) => !rivalDonors.includes(party));

    const takeFromGroup = (group: string[]) => {
      if (remainingToFund <= 0 || group.length === 0) return;
      const available = group.reduce((sum, party) => sum + Math.max(0, Math.min(CAMPAIGN_WEEKLY_SUPPORT_CHANGE_LIMIT, current[party]) - (reductions.get(party) ?? 0)), 0);
      const amount = Math.min(remainingToFund, available);
      if (amount <= 0) return;
      // Proportional within the current priority group, respecting each donor's cap.
      let unassigned = amount;
      let active = [...group];
      while (unassigned > 0.0000001 && active.length) {
        const weightTotal = active.reduce((sum, party) => sum + Math.max(0, current[party] - (reductions.get(party) ?? 0)), 0);
        if (weightTotal <= 0) break;
        let distributed = 0;
        for (const party of active) {
          const capacity = Math.max(0, Math.min(CAMPAIGN_WEEKLY_SUPPORT_CHANGE_LIMIT, current[party]) - (reductions.get(party) ?? 0));
          const share = Math.min(capacity, unassigned * (Math.max(0, current[party] - (reductions.get(party) ?? 0)) / weightTotal));
          reductions.set(party, (reductions.get(party) ?? 0) + share);
          distributed += share;
        }
        if (distributed <= 0.0000001) break;
        unassigned -= distributed;
        active = active.filter((party) => (reductions.get(party) ?? 0) + 0.0000001 < Math.min(CAMPAIGN_WEEKLY_SUPPORT_CHANGE_LIMIT, current[party]));
      }
      const funded = amount - Math.max(0, unassigned);
      remainingToFund -= funded;
    };
    takeFromGroup(rivalDonors);
    takeFromGroup(otherDonors);

    // If donors cannot fund every desired gain, scale recipients proportionally.
    const fundedTotal = totalGain - remainingToFund;
    const gainScale = totalGain > 0 ? fundedTotal / totalGain : 0;
    const next: Record<string, number> = {};
    for (const party of parties) {
      const gain = (gains.get(party) ?? 0) * gainScale;
      const reduction = reductions.get(party) ?? 0;
      next[party] = roundFour(Math.max(0, Math.min(100, current[party] + gain - reduction)));
    }
    // Correct rounding drift on the party with the largest resulting support.
    const total = Object.values(next).reduce((sum, value) => sum + value, 0);
    const largest = parties.reduce((best, party) => next[party] > next[best] ? party : best, parties[0]);
    if (largest) next[largest] = roundFour(next[largest] + (100 - total));
    return { ...constituency, partySupport: next };
  });
}


function reportRound(value: number): number { return Math.round(value * 100) / 100; }

export function buildFinalCampaignReport(
  campaign: LokSabhaCampaignSave,
  game: CampaignGame,
  finalSupport: ConstituencyPartySupport[] = campaign.constituencySupport,
  profile: CampaignProfile = LOK_SABHA_PROFILE,
): FinalCampaignReport {
  const seatTotal = game.constituencies.length;
  const majority = majorityMark(seatTotal);
  const partyOrder = [...new Set(Object.values(game.statePartyParticipation ?? {}).flat())];
  const partyIndex = new Map(partyOrder.map((id, index) => [id, index]));
  // Statewide vote share is weighted by registered electors, because turnout is only generated
  // when voting happens.
  const votersById = new Map(game.constituencies.map((item) => [item.constituencyId, Math.max(0, item.totalVoters || item.registeredElectors || 0)]));
  const constituencyById = new Map(game.constituencies.map((item) => [item.constituencyId, item]));
  const totalVoters = game.constituencies.reduce((sum, item) => sum + Math.max(0, item.totalVoters || item.registeredElectors || 0), 0);
  if ((profile.requiredSeats !== null && seatTotal !== profile.requiredSeats) || finalSupport.length !== seatTotal) throw new Error(`The final campaign report requires all ${seatTotal} ${profile.label} constituencies.`);
  if (!(totalVoters > 0)) throw new Error("Registered-voter totals are missing; voter-weighted campaign reporting cannot be generated.");

  const partyVotes: Record<string, number> = {};
  const stateVotes: Record<string, Record<string, number>> = {};
  const stateVoters: Record<string, number> = {};
  const blocVotes: Record<string, number> = {};
  const blocSeats: Record<string, number> = {};
  const blocNames: Record<string, string> = {};
  const blocMembers: Record<string, Set<string>> = {};
  const partySeats: Record<string, number> = {};
  const partySeatsContested: Record<string, number> = {};
  const blocSeatsContested: Record<string, number> = {};
  const nonAlliedSeats: Record<string, number> = {};
  const nonAlliedVotes: Record<string, number> = {};
  const winners: FinalCampaignReport["projectedConstituencyWinners"] = [];
  const impactScore = (partyId: string, state: string) => [...campaign.playerActions, ...campaign.aiActions]
    .filter((action) => action.partyId === partyId && action.state === state)
    .reduce((sum, action) => sum + (CAMPAIGN_ACTIONS.find((definition) => definition.id === action.actionType)?.baseImpact ?? 0), 0);

  // Alliance membership is state-specific in the game setup, but report rows
  // are national. Aggregate state-level groups by their canonical alliance name.
  const canonicalBloc = (group: NonNullable<CampaignGame["stateAllianceGroups"]>[string][number]) => {
    const rawName = (group.isPlayerAlliance ? game.alliance.name : group.name).trim();
    const normalized = rawName.toLocaleLowerCase().replace(/\s+/g, " ");
    const aliases: Record<string, string> = {
      "nda": "nda",
      "national democratic alliance": "nda",
      "india": "india alliance",
      "india alliance": "india alliance",
      "indian national development inclusive alliance": "india alliance",
    };
    const key = aliases[normalized] ?? normalized;
    const name = key === "nda" ? "NDA" : key === "india alliance" ? "INDIA Alliance" : rawName;
    return { id: `BLOC:${key}`, name };
  };

  for (const row of finalSupport) {
    const constituency = constituencyById.get(row.constituencyId);
    if (!constituency) continue;
    const voters = votersById.get(row.constituencyId) ?? 0;
    stateVoters[row.state] = (stateVoters[row.state] ?? 0) + voters;
    stateVotes[row.state] ??= {};
    for (const [partyId, percentage] of Object.entries(row.partySupport)) {
      const weighted = voters * percentage / 100;
      partyVotes[partyId] = (partyVotes[partyId] ?? 0) + weighted;
      stateVotes[row.state][partyId] = (stateVotes[row.state][partyId] ?? 0) + weighted;
    }
    const candidates = Object.entries(row.partySupport);
    candidates.forEach(([partyId]) => { partySeatsContested[partyId] = (partySeatsContested[partyId] ?? 0) + 1; });
    candidates.sort((a, b) => {
      const supportDiff = b[1] - a[1];
      if (Math.abs(supportDiff) > 0.0000001) return supportDiff;
      const strengthDiff = (getPartyStrength(b[0], row.state) ?? 0) - (getPartyStrength(a[0], row.state) ?? 0);
      if (Math.abs(strengthDiff) > 0.0000001) return strengthDiff;
      const campaignDiff = impactScore(b[0], row.state) - impactScore(a[0], row.state);
      if (campaignDiff) return campaignDiff;
      return (partyIndex.get(a[0]) ?? 9999) - (partyIndex.get(b[0]) ?? 9999);
    });
    const winnerId = candidates[0]?.[0];
    if (!winnerId) throw new Error(`No eligible party support found for ${constituency.name}.`);
    partySeats[winnerId] = (partySeats[winnerId] ?? 0) + 1;
    const localGroup = (game.stateAllianceGroups?.[row.state] ?? []).find((item) =>
      item.type !== "INDEPENDENT" && item.memberPartyIds.includes(winnerId)
    );
    // Alliance membership is local to this state/UT. A party that belongs to
    // an alliance elsewhere but contests independently here earns an
    // individual non-allied seat here.
    const blocId = localGroup ? canonicalBloc(localGroup).id : null;
    const blocName = localGroup ? canonicalBloc(localGroup).name : null;
    if (blocId && blocName) {
      blocNames[blocId] = blocName;
      blocMembers[blocId] ??= new Set<string>();
      localGroup!.memberPartyIds.forEach((id) => blocMembers[blocId!].add(id));
      blocSeats[blocId] = (blocSeats[blocId] ?? 0) + 1;
    } else {
      nonAlliedSeats[winnerId] = (nonAlliedSeats[winnerId] ?? 0) + 1;
    }
    winners.push({ constituencyId: row.constituencyId, state: row.state, partyId: winnerId, blocId, blocName });
  }

  // Count alliance seats contested from actual constituency allocations.
  // A state alliance is considered only in states where that group exists.
  for (const constituency of game.constituencies) {
    const groups = game.stateAllianceGroups?.[constituency.state] ?? [];
    const counted = new Set<string>();
    for (const allocation of constituency.allocations) {
      const group = groups.find((item) => item.memberPartyIds.includes(allocation.partyId) && item.type !== "INDEPENDENT");
      if (!group) continue;
      const bloc = canonicalBloc(group);
      if (!counted.has(bloc.id)) {
        blocSeatsContested[bloc.id] = (blocSeatsContested[bloc.id] ?? 0) + 1;
        counted.add(bloc.id);
      }
    }
  }

  // Aggregate vote share using each state's actual alliance membership.
  // Never infer a national alliance from a party's membership in another state.
  for (const row of finalSupport) {
    const voters = votersById.get(row.constituencyId) ?? 0;
    const groups = game.stateAllianceGroups?.[row.state] ?? [];
    const partyToBloc = new Map<string, { id: string; name: string; members: string[] }>();
    for (const group of groups.filter((item) => item.type !== "INDEPENDENT")) {
      const bloc = canonicalBloc(group);
      for (const partyId of group.memberPartyIds) {
        partyToBloc.set(partyId, { id: bloc.id, name: bloc.name, members: group.memberPartyIds });
      }
    }
    for (const [partyId, percentage] of Object.entries(row.partySupport)) {
      const localBloc = partyToBloc.get(partyId);
      if (localBloc) {
        blocNames[localBloc.id] = localBloc.name;
        blocMembers[localBloc.id] ??= new Set<string>();
        localBloc.members.forEach((id) => blocMembers[localBloc.id].add(id));
        blocVotes[localBloc.id] = (blocVotes[localBloc.id] ?? 0) + voters * percentage / 100;
      } else {
        nonAlliedVotes[partyId] = (nonAlliedVotes[partyId] ?? 0) + voters * percentage / 100;
      }
    }
  }

  const partyRows: FinalCampaignPartyRow[] = partyOrder.map((partyId) => ({
    partyId,
    support: reportRound((partyVotes[partyId] ?? 0) / totalVoters * 100),
    projectedSeats: partySeats[partyId] ?? 0,
    seatsContested: partySeatsContested[partyId] ?? 0,
    seatsWon: partySeats[partyId] ?? 0,
    voteShare: reportRound((partyVotes[partyId] ?? 0) / totalVoters * 100),
  })).sort((a,b) => b.support - a.support || (partyIndex.get(a.partyId) ?? 9999) - (partyIndex.get(b.partyId) ?? 9999));

  const allianceRankings: FinalCampaignBlocRow[] = Object.keys(blocVotes).map((id) => ({
    id, name: blocNames[id], projectedSeats: blocSeats[id] ?? 0,
    seatsContested: blocSeatsContested[id] ?? 0,
    seatsWon: blocSeats[id] ?? 0,
    voteShare: reportRound((blocVotes[id] ?? 0) / totalVoters * 100),
    memberPartyIds: [...(blocMembers[id] ?? new Set<string>())],
  })).sort((a,b) => b.projectedSeats - a.projectedSeats || b.voteShare - a.voteShare || a.name.localeCompare(b.name));

  const nonAlliedPartyRankings = partyRows.map((row) => ({
    ...row,
    projectedSeats: nonAlliedSeats[row.partyId] ?? 0,
    voteShare: reportRound((nonAlliedVotes[row.partyId] ?? 0) / totalVoters * 100),
  })).filter((row) => row.projectedSeats > 0)
    .sort((a,b) => b.projectedSeats - a.projectedSeats || b.voteShare - a.voteShare || (partyIndex.get(a.partyId) ?? 9999) - (partyIndex.get(b.partyId) ?? 9999));

  const initial = campaign.initialConstituencySupport;
  const initialWeighted: Record<string, number> = {};
  if (initial?.length === seatTotal) {
    for (const row of initial) {
      const voters = votersById.get(row.constituencyId) ?? 0;
      for (const [partyId, percentage] of Object.entries(row.partySupport)) initialWeighted[partyId] = (initialWeighted[partyId] ?? 0) + voters * percentage / 100;
    }
  } else {
    // Backward compatibility for campaigns created before the immutable baseline field existed.
    const oldNational = campaign.supportHistory.find((item) => item.week === 1)?.nationalSupport ?? {};
    for (const [partyId, percentage] of Object.entries(oldNational)) initialWeighted[partyId] = totalVoters * percentage / 100;
  }
  const nationalSupportComparison = partyOrder.map((partyId) => {
    const week1 = (initialWeighted[partyId] ?? 0) / totalVoters * 100;
    const week12 = (partyVotes[partyId] ?? 0) / totalVoters * 100;
    return { partyId, week1Support: reportRound(week1), week12Support: reportRound(week12), change: reportRound(week12 - week1) };
  }).sort((a,b) => b.week12Support - a.week12Support || (partyIndex.get(a.partyId) ?? 9999) - (partyIndex.get(b.partyId) ?? 9999));

  const stateRows = Object.keys(stateVotes).sort((a,b) => a.localeCompare(b)).map((state) => ({
    state,
    partySupport: Object.fromEntries(Object.entries(stateVotes[state]).map(([partyId, votes]) => [partyId, reportRound(votes / (stateVoters[state] || 1) * 100)])),
  }));
  const totalProjectedPartySeats = Object.values(partySeats).reduce((sum, value) => sum + value, 0);
  if (totalProjectedPartySeats !== seatTotal) throw new Error(`Projected seat totals must equal ${seatTotal}, but calculated ${totalProjectedPartySeats}.`);
  const leadingAlliance = allianceRankings[0];
  const leadingNonAlliance = nonAlliedPartyRankings[0];
  const leading = leadingAlliance && (!leadingNonAlliance || leadingAlliance.projectedSeats >= leadingNonAlliance.projectedSeats)
    ? { id: leadingAlliance.id, name: leadingAlliance.name, seats: leadingAlliance.projectedSeats }
    : leadingNonAlliance ? { id: `PARTY:${leadingNonAlliance.partyId}`, name: leadingNonAlliance.partyId, seats: leadingNonAlliance.projectedSeats } : null;
  const leadingSeats = leading?.seats ?? 0;
  return {
    generatedAt: new Date().toISOString(),
    week1BaselineMethod: initial?.length === seatTotal ? "VOTER_WEIGHTED" : "LEGACY_UNWEIGHTED_FALLBACK",
    totalSeats: seatTotal,
    majorityMark: majority,
    parliamentStatus: leadingSeats >= majority ? "MAJORITY" : "HUNG_PARLIAMENT",
    leadingBlocId: leadingSeats >= majority ? leading?.id ?? null : null,
    leadingBlocName: leadingSeats >= majority ? leading?.name ?? null : null,
    leadingBlocSeats: leadingSeats,
    seatsNeeded: Math.max(0, majority - leadingSeats),
    allianceRankings,
    nonAlliedPartyRankings,
    partyRows,
    nationalSupportComparison,
    stateRows,
    projectedConstituencyWinners: winners,
  };
}

export function finalizeCampaignReport(campaign: LokSabhaCampaignSave, game: CampaignGame, profile: CampaignProfile = LOK_SABHA_PROFILE): LokSabhaCampaignSave {
  if (!campaign.completedWeeks.includes(profile.weeks)) throw new Error(`Complete Week ${profile.weeks} before generating the final campaign report.`);
  if (campaign.finalReport) return { ...campaign, status: "FINAL_REPORT" };
  const finalReport = buildFinalCampaignReport(campaign, game, campaign.constituencySupport, profile);
  return { ...campaign, finalReport, status: "FINAL_REPORT", updatedAt: new Date().toISOString() };
}

export function completeCampaignWeek(campaign: LokSabhaCampaignSave, game: CampaignGame, profile: CampaignProfile = LOK_SABHA_PROFILE): LokSabhaCampaignSave {
  if (campaign.status !== "IN_PROGRESS") throw new Error("This campaign is not currently active.");
  const week = campaign.currentWeek;
  if (week < 1 || week > profile.weeks || campaign.completedWeeks.includes(week)) throw new Error("This campaign week has already been completed or is invalid.");
  const aiPlan = buildAiCampaignActions(campaign, game, profile);
  const generatedEvent = generateWeeklyCampaignEvent(campaign, game, Math.random, profile);
  const allEvents = [...(campaign.activeEvents ?? []).filter((event) => week < event.week + event.durationWeeks), ...(generatedEvent ? [generatedEvent] : [])];
  const eventHistory = generatedEvent ? [...(campaign.eventHistory ?? []), { eventDefinitionId: generatedEvent.eventDefinitionId, week, eventId: generatedEvent.id }] : (campaign.eventHistory ?? []);
  const campaignWithAi = { ...campaign, aiActions: aiPlan.aiActions, aiPersonalities: aiPlan.personalities, aiLearningAdjustments: aiPlan.learning, activeEvents: allEvents, eventHistory, eventGenerationByWeek: [...(campaign.eventGenerationByWeek ?? []), week] };
  const impacts = calculateCampaignImpactsForWeek(campaign.constituencySupport, week, campaignWithAi.playerActions, campaignWithAi.aiActions, profile);
  const constituencyStates = Object.fromEntries(campaign.constituencySupport.map((item) => [item.constituencyId, item.state]));
  const eventEffects = getEventSupportEffects(allEvents, week, constituencyStates);
  const updatedSupport = applyWeeklySupportChanges(campaign.constituencySupport, impacts, eventEffects, profile);
  const previous = summarizeSupport(campaign.constituencySupport);
  const current = summarizeSupport(updatedSupport);
  const nationalChanges = Object.keys(current.nationalSupport).map((partyId) => ({
    partyId,
    previousSupport: previous.nationalSupport[partyId] ?? 0,
    currentSupport: current.nationalSupport[partyId] ?? 0,
    change: roundFour((current.nationalSupport[partyId] ?? 0) - (previous.nationalSupport[partyId] ?? 0)),
  })).sort((a, b) => b.currentSupport - a.currentSupport);
  const stateChanges: Record<string, WeeklyPartyChange[]> = {};
  for (const state of Object.keys(current.stateSupport)) {
    stateChanges[state] = Object.keys(current.stateSupport[state]).map((partyId) => ({
      partyId,
      previousSupport: previous.stateSupport[state]?.[partyId] ?? 0,
      currentSupport: current.stateSupport[state][partyId] ?? 0,
      change: roundFour((current.stateSupport[state][partyId] ?? 0) - (previous.stateSupport[state]?.[partyId] ?? 0)),
    })).sort((a, b) => b.currentSupport - a.currentSupport);
  }
  const summary: WeeklyCampaignSummary = {
    week,
    nationalChanges,
    stateChanges,
    completedAt: new Date().toISOString(),
    constituenciesProcessed: updatedSupport.length,
    events: allEvents.filter((event) => week >= event.week && week < event.week + event.durationWeeks).map((event) => ({ id: event.id, name: event.name, category: event.category, sentiment: event.sentiment, priority: event.priority, scope: event.scope, location: event.location, description: event.description, durationWeeks: event.durationWeeks, baseImpact: event.baseImpact, partyEffectsByState: Object.fromEntries(Object.entries(event.partyEffectsByState ?? {}).map(([state, effects]) => [state, Object.fromEntries(Object.entries(effects).map(([party, value]) => [party, roundFour(value * (week === event.week ? 1 : 0.5))]))])) })),
  };
  const performanceEntry = {
    week,
    stateChanges: Object.fromEntries(Object.entries(stateChanges).map(([state, rows]) => [
      state,
      Object.fromEntries(rows.map((row) => [row.partyId, row.change])),
    ])),
  };
  const updatedCampaign: LokSabhaCampaignSave = {
    ...campaignWithAi,
    constituencySupport: updatedSupport,
    supportHistory: [...campaign.supportHistory, { week: week + 1, ...current }],
    aiPerformanceHistory: [...(campaign.aiPerformanceHistory ?? []), performanceEntry],
    completedWeeks: [...campaign.completedWeeks, week],
    currentWeek: week,
    actionsRemaining: profile.actionsPerWeek - campaign.playerActions.filter((action) => action.week === week).length,
    lastWeeklySummary: JSON.stringify({ ...summary, aiActivity: {
      partiesActive: new Set(campaignWithAi.aiActions.filter((action) => action.week === week).map((action) => action.partyId)).size,
      actionsPerformed: campaignWithAi.aiActions.filter((action) => action.week === week).length,
    } }),
    updatedAt: new Date().toISOString(),
  };
  return week === profile.weeks ? finalizeCampaignReport(updatedCampaign, game, profile) : updatedCampaign;
}

export function getLastWeeklySummary(campaign: LokSabhaCampaignSave): WeeklyCampaignSummary | null {
  if (!campaign.lastWeeklySummary) return null;
  try { return JSON.parse(campaign.lastWeeklySummary) as WeeklyCampaignSummary; } catch { return null; }
}


export function acknowledgeCampaignEvent(campaign: LokSabhaCampaignSave, eventId: string): LokSabhaCampaignSave {
  const found = (campaign.activeEvents ?? []).some((event) => event.id === eventId && event.priority === "CRITICAL");
  if (!found) throw new Error("The critical event could not be found.");
  return { ...campaign, activeEvents: campaign.activeEvents.map((event) => event.id === eventId ? { ...event, acknowledged: true } : event), updatedAt: new Date().toISOString() };
}

/** Ends the campaign early: the final report is built from today's support and voting is unlocked. */
export function skipToVoting(campaign: LokSabhaCampaignSave, game: CampaignGame, profile: CampaignProfile = LOK_SABHA_PROFILE): LokSabhaCampaignSave {
  if (campaign.status !== "IN_PROGRESS") throw new Error("This campaign is not currently active.");
  const finalReport = buildFinalCampaignReport(campaign, game, campaign.constituencySupport, profile);
  return { ...campaign, finalReport, status: "LOCKED", updatedAt: new Date().toISOString() };
}

export function lockCampaignForVoting(campaign: LokSabhaCampaignSave): LokSabhaCampaignSave {
  if (!campaign.finalReport || campaign.status !== "FINAL_REPORT") throw new Error("Generate and review the final campaign report before proceeding to Voting.");
  return { ...campaign, status: "LOCKED", updatedAt: new Date().toISOString() };
}

export function continueToNextCampaignWeek(campaign: LokSabhaCampaignSave, profile: CampaignProfile = LOK_SABHA_PROFILE): LokSabhaCampaignSave {
  if (!campaign.completedWeeks.includes(campaign.currentWeek)) throw new Error("Complete the current week before moving forward.");
  const pendingCritical = (campaign.activeEvents ?? []).find((event) => event.priority === "CRITICAL" && !event.acknowledged && campaign.currentWeek < event.week + event.durationWeeks);
  if (pendingCritical) throw new Error("Acknowledge the critical random-event notification before continuing the campaign.");
  if (campaign.currentWeek >= profile.weeks) throw new Error(`The ${profile.weeks}-week campaign is complete. Review the final campaign report and proceed to Voting.`);
  return { ...campaign, currentWeek: campaign.currentWeek + 1, actionsRemaining: profile.actionsPerWeek, lastWeeklySummary: null, updatedAt: new Date().toISOString() };
}
