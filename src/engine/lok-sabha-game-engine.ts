import { lokSabhaConstituencies, getAssemblySegmentsForParliamentaryConstituency } from "@/data/constituency-data";
import type {
  LokSabhaGameAlliance,
  LokSabhaGameSave,
  LokSabhaAllianceChoice,
  SeatContestantAllocation,
  StateAllianceGroup,
  StateSeatSharePlan,
} from "@/types/lok-sabha-game";
import partiesData from "@/data/parties.json";
import allianceData from "@/data/alliances.json";
import alignmentRulesData from "@/data/party-alignment-rules.json";
import footholdData from "@/data/party-foothold-regions.json";
import strengthData from "@/data/party-strength-by-region.json";
import { getPoliticalRelationship } from "@/engine/alliance-engine";
import { plainNamesReviver } from "@/lib/party-style";

export const LOK_SABHA_SAVE_KEY = "indian-election-game-lok-sabha-save";
const parties = partiesData.parties as { id: string; name: string }[];
const alliances = allianceData.alliances as { id: string; name: string; corePartyIds: string[] }[];
const footholds = footholdData.parties as { partyId: string; coreFootholdRegions: string[] }[];
const alignmentRules = alignmentRulesData.rules as { partyIds: string[]; eligibleAlignments: string[] }[];
const regionalStrengths = strengthData.regions as Record<string, Record<string, number>>;

/**
 * Election type used for political-relationship lookups while alliance groups are formed. Group
 * formation is synchronous, so it is switched for the duration of one call with withElectionType.
 */
let activeElectionType: "LOK_SABHA" | "ASSEMBLY" = "LOK_SABHA";
function withElectionType<T>(electionType: "LOK_SABHA" | "ASSEMBLY", build: () => T): T {
  const previous = activeElectionType;
  activeElectionType = electionType;
  try {
    return build();
  } finally {
    activeElectionType = previous;
  }
}

export interface CreateLokSabhaGameInput {
  playerPartyId: string;
  allianceChoice: LokSabhaAllianceChoice;
  customAllianceName?: string;
  customAllianceColor?: string;
  customPartnerPartyIds?: string[];
}

export function normalizeElectionRegion(value: string): string {
  return value
    .toLowerCase()
    .replace(/\band\b/g, "&")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^nct of /, "");
}

export function getPartyFootholdRegions(partyId: string): string[] {
  return footholds.find((item) => item.partyId === partyId)?.coreFootholdRegions ?? [];
}

export function partyCanContestInState(partyId: string, state: string): boolean {
  const allowed = getPartyFootholdRegions(partyId).map(normalizeElectionRegion);
  return allowed.includes(normalizeElectionRegion(state));
}

export function getEligiblePartyIdsForState(state: string): string[] {
  return parties.map((party) => party.id).filter((partyId) => partyCanContestInState(partyId, state));
}

export function getPartyStrength(partyId: string, state: string): number | null {
  const target = normalizeElectionRegion(state);
  const entry = Object.entries(regionalStrengths).find(([region]) => normalizeElectionRegion(region) === target);
  const value = entry?.[1]?.[partyId];
  return typeof value === "number" ? value : null;
}

function getStrengthWeight(partyId: string, state: string): number {
  // The one eligible party/state pair without a source value uses a neutral
  // fallback weight. It is not presented as a measured strength percentage.
  return getPartyStrength(partyId, state) ?? 0.5;
}

export function distributeByStrength(partyIds: string[], state: string, totalSeats: number): StateSeatSharePlan {
  const result: StateSeatSharePlan = {};
  if (!partyIds.length) return result;
  if (partyIds.length === 1) return { [partyIds[0]]: totalSeats };
  const weights = partyIds.map((partyId) => Math.max(0.0001, getStrengthWeight(partyId, state)));
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((weight) => (weight / sum) * totalSeats);
  const floors = raw.map(Math.floor);
  let remaining = totalSeats - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction || partyIds[a.index].localeCompare(partyIds[b.index]));
  order.forEach(({ index }) => { if (remaining > 0) { floors[index] += 1; remaining -= 1; } });
  partyIds.forEach((partyId, index) => { result[partyId] = floors[index]; });
  return result;
}

function canonicalPairKey(partyA: string, partyB: string): string {
  return [partyA, partyB].sort().join("|");
}

type GlobalAiAllianceDecision = "JOIN_EXISTING" | "FORM_NEW" | "INDEPENDENT";
type GlobalAiAllianceDecisions = ReadonlyMap<string, GlobalAiAllianceDecision>;

/** Make the one-third AI alliance decision once per party for the whole election. */
function createGlobalAiAllianceDecisions(partyIds: string[]): Map<string, GlobalAiAllianceDecision> {
  const decisions = new Map<string, GlobalAiAllianceDecision>();
  for (const partyId of [...new Set(partyIds)]) {
    const roll = Math.random();
    decisions.set(partyId, roll < 1 / 3 ? "JOIN_EXISTING" : roll < 2 / 3 ? "FORM_NEW" : "INDEPENDENT");
  }
  return decisions;
}

function relationshipBlocks(
  partyA: string,
  partyB: string,
  state: string,
  mutuallySelectedConditionalPairs: ReadonlySet<string> = new Set(),
): boolean {
  const relationship = getPoliticalRelationship(partyA, partyB, {
    electionType: activeElectionType,
    region: state,
    activateConditionalRules: true,
  });
  if (relationship.relationship === "STRONG_RIVAL") return true;
  if (relationship.relationship !== "RIVAL") return false;
  // Conditional relationships require explicit, reciprocal partner selection.
  if (relationship.conditional) {
    return !mutuallySelectedConditionalPairs.has(canonicalPairKey(partyA, partyB));
  }
  return true;
}

function canJoinGroup(
  partyId: string,
  currentMembers: string[],
  state: string,
  mutuallySelectedConditionalPairs: ReadonlySet<string> = new Set(),
): boolean {
  return currentMembers.every((memberId) =>
    !relationshipBlocks(partyId, memberId, state, mutuallySelectedConditionalPairs)
  );
}

/**
 * Simulate each AI party independently selecting conditional cooperation partners.
 * A pair is approved only when both parties select one another.
 */
function selectMutualConditionalPartners(
  partyIds: string[],
  playerPartyId?: string,
  playerSelectedPartnerIds: ReadonlySet<string> = new Set(),
): Set<string> {
  // Partner preferences are generated once for the election, not separately
  // in every state. A conditional pair is relevant if its rule is national or
  // applies in at least one state where both parties are eligible.
  const uniquePartyIds = [...new Set(partyIds)];
  const mutual = new Set<string>();
  for (let i = 0; i < uniquePartyIds.length; i++) {
    for (let j = i + 1; j < uniquePartyIds.length; j++) {
      const partyA = uniquePartyIds[i];
      const partyB = uniquePartyIds[j];
      const sharedRegions = getPartyFootholdRegions(partyA).filter((region) =>
        partyCanContestInState(partyB, region)
      );
      const contexts = [
        { electionType: activeElectionType, activateConditionalRules: true },
        ...sharedRegions.map((region) => ({
          electionType: activeElectionType,
          region,
          activateConditionalRules: true,
        })),
      ];
      const hasConditionalRule = contexts.some((context) => {
        const resolved = getPoliticalRelationship(partyA, partyB, context);
        return resolved.relationship === "RIVAL" && resolved.conditional;
      });
      if (!hasConditionalRule) continue;

      // A player's explicit alliance selection counts as their preference;
      // AI parties independently select (or decline) each conditional partner.
      const partyASelected = partyA === playerPartyId
        ? playerSelectedPartnerIds.has(partyB)
        : Math.random() < 0.5;
      const partyBSelected = partyB === playerPartyId
        ? playerSelectedPartnerIds.has(partyA)
        : Math.random() < 0.5;
      if (partyASelected && partyBSelected) mutual.add(canonicalPairKey(partyA, partyB));
    }
  }
  return mutual;
}

const MULTI_STATE_FRONT_NAMES = [
  "Progressive Democratic Front",
  "United Secular Front",
  "Democratic Progressive Alliance",
  "People's Democratic Front",
  "Social Justice Front",
  "United Democratic Front",
];

function partyDisplayName(partyId: string): string {
  return parties.find((party) => party.id === partyId)?.name ?? partyId;
}

/**
 * Form shared AI political fronts for compatible parties whose footholds do
 * not overlap. Their shared identity is national/multi-state, not a seat-
 * sharing arrangement: each state receives only its locally eligible members.
 */
function getMultiStateRelationshipBlocks(
  partyA: string,
  partyB: string,
  mutuallySelectedConditionalPairs: ReadonlySet<string> = new Set(),
): boolean {
  const regionsA = getPartyFootholdRegions(partyA);
  const regionsB = getPartyFootholdRegions(partyB);
  const commonRegions = regionsA.filter((region) =>
    regionsB.some((other) => normalizeElectionRegion(region) === normalizeElectionRegion(other))
  );

  // If the parties share a foothold, check every shared state. A single
  // state-specific RIVAL / STRONG_RIVAL is enough to block the front.
  const contexts = commonRegions.length
    ? commonRegions.map((region) => ({ electionType: activeElectionType, region, activateConditionalRules: true }))
    : [{ electionType: activeElectionType, activateConditionalRules: true }];

  return contexts.some((context) => {
    const resolved = getPoliticalRelationship(partyA, partyB, context);
    if (resolved.relationship === "STRONG_RIVAL") return true;
    if (resolved.relationship !== "RIVAL") return false;
    return !resolved.conditional || !mutuallySelectedConditionalPairs.has(canonicalPairKey(partyA, partyB));
  });
}

/**
 * Form shared AI political fronts across regions. Parties do not need a
 * common foothold: local eligibility is applied later when each state's
 * electoral group is built. A party is admitted only when it is compatible
 * with every existing front member.
 */
function createMultiStateAiFronts(
  candidateIds: string[],
  mutuallySelectedConditionalPairs: ReadonlySet<string> = new Set(),
): StateAllianceGroup[] {
  const uniqueCandidates = [...new Set(candidateIds)];
  // Start with the most constrained parties first. This gives parties such as
  // YSRCP, which have specific regional rivals, a chance to form a compatible
  // front before less-constrained parties are grouped together.
  const remaining = uniqueCandidates.sort((a, b) => {
    const conflictCount = (partyId: string) => uniqueCandidates.filter(
      (otherId) => otherId !== partyId && getMultiStateRelationshipBlocks(partyId, otherId, mutuallySelectedConditionalPairs)
    ).length;
    return conflictCount(b) - conflictCount(a) || a.localeCompare(b);
  });
  const fronts: StateAllianceGroup[] = [];
  let nameIndex = 0;

  while (remaining.length > 0) {
    const seed = remaining.shift()!;
    const members = [seed];

    // Keep adding compatible parties. There is deliberately no common-region
    // requirement and no arbitrary member cap: a front is a political grouping,
    // not a constituency-sharing group.
    for (let index = 0; index < remaining.length;) {
      const candidate = remaining[index];
      const compatible = members.every(
        (memberId) => !getMultiStateRelationshipBlocks(candidate, memberId, mutuallySelectedConditionalPairs)
      );
      if (compatible) {
        members.push(candidate);
        remaining.splice(index, 1);
      } else {
        index += 1;
      }
    }

    if (members.length >= 2) {
      const sortedMembers = [...members].sort((a, b) => a.localeCompare(b));
      const id = `AI-FRONT:${sortedMembers.join("+")}`;
      fronts.push({
        id,
        name: MULTI_STATE_FRONT_NAMES[nameIndex % MULTI_STATE_FRONT_NAMES.length],
        type: "AI_CUSTOM",
        memberPartyIds: sortedMembers,
        isPlayerAlliance: false,
      });
      nameIndex += 1;
    }
  }
  return fronts;
}


/**
 * Resolve JOIN_EXISTING once for the whole election. Each party is assigned
 * one concrete global target (NDA, INDIA, or an already-created inter-state
 * front). The returned memberships are projected into every eligible state.
 */
function resolveGlobalJoinMemberships(
  joinerIds: string[],
  existingFronts: StateAllianceGroup[],
  excludedPartyIds: ReadonlySet<string>,
  mutuallySelectedConditionalPairs: ReadonlySet<string>,
): StateAllianceGroup[] {
  const memberships = new Map<string, string[]>();
  const names = new Map<string, string>();
  const types = new Map<string, "PREDEFINED" | "AI_CUSTOM">();

  // Existing custom fronts are valid global targets.
  for (const front of existingFronts) {
    memberships.set(front.id, [...front.memberPartyIds]);
    names.set(front.id, front.name);
    types.set(front.id, "AI_CUSTOM");
  }

  // National alliances are global targets, even if their core members are
  // not all eligible in the same state.
  for (const alliance of alliances) {
    const id = `AI-GLOBAL-ALLIANCE:${alliance.id}`;
    memberships.set(id, alliance.corePartyIds.filter((partyId) => !excludedPartyIds.has(partyId)));
    names.set(id, alliance.id === "NDA" ? "NDA" : "INDIA Alliance");
    types.set(id, "PREDEFINED");
  }

  const assigned = new Set<string>();
  for (const partyId of joinerIds) {
    const targets: string[] = [];
    for (const [targetId, members] of memberships) {
      if (members.includes(partyId) || members.length === 0) continue;
      const isNational = targetId.startsWith("AI-GLOBAL-ALLIANCE:");
      if (isNational) {
        const allianceId = targetId.split(":")[1];
        const canAlign = alignmentRules.some((rule) =>
          rule.partyIds.includes(partyId) && rule.eligibleAlignments.includes(allianceId)
        );
        if (!canAlign) continue;
      }
      const compatible = members.every((memberId) =>
        memberId === partyId || !getMultiStateRelationshipBlocks(
          partyId, memberId, mutuallySelectedConditionalPairs
        )
      );
      if (compatible) targets.push(targetId);
    }
    if (!targets.length) continue;
    const targetId = targets[Math.floor(Math.random() * targets.length)];
    memberships.get(targetId)!.push(partyId);
    assigned.add(partyId);
  }

  return [...memberships.entries()]
    .filter(([id, members]) => members.length >= 2 && (id.startsWith("AI-GLOBAL-ALLIANCE:") || members.some((m) => assigned.has(m))))
    .map(([id, memberPartyIds]) => ({
      id,
      name: names.get(id) ?? "Progressive Democratic Front",
      type: types.get(id) ?? "AI_CUSTOM",
      memberPartyIds: [...new Set(memberPartyIds)],
      isPlayerAlliance: false,
    }));
}

function getSoloCampaignGroupName(partyId: string): string {
  // BJP and INC retain their reserved campaign identities even when no
  // coalition partner joins them. The group remains a solo contesting group.
  if (partyId === "BJP") return "NDA";
  if (partyId === "INC") return "INDIA Alliance";
  return partyDisplayName(partyId);
}

function getLocalAiGroupName(memberIds: string[], state: string): string {
  const members = new Set(memberIds);

  // National / established bloc identities take precedence over the generic
  // strongest-party naming convention.
  if (members.has("BJP")) return "NDA";
  if (members.has("INC")) return "INDIA Alliance";
  if (members.has("CPI") && members.has("CPM")) return "Left Front";

  if (memberIds.length < 2) return partyDisplayName(memberIds[0]);
  const leader = [...memberIds].sort((a, b) =>
    getStrengthWeight(b, state) - getStrengthWeight(a, state) || a.localeCompare(b)
  )[0];
  return `${partyDisplayName(leader)}+`;
}

function getPredefinedBlocName(memberIds: string[], state: string, fallback: string): string {
  const members = new Set(memberIds);
  if (members.has("BJP")) return "NDA";
  if (members.has("INC")) return "INDIA Alliance";
  if (members.has("CPI") && members.has("CPM")) return "Left Front";
  if (members.size === 1) {
    const only = memberIds[0];
    if (only === "BJP") return "NDA";
    if (only === "INC") return "INDIA Alliance";
    // A singleton core member retains its configured national alliance
    // identity; it is not relabelled as an independent or party-only group.
    if (fallback === "National Democratic Alliance" || fallback === "NDA") return "NDA";
    if (fallback === "Indian National Developmental Inclusive Alliance" || fallback === "INDIA Alliance") return "INDIA Alliance";
    return fallback;
  }
  if (fallback === "National Democratic Alliance") return "NDA";
  if (fallback === "Indian National Developmental Inclusive Alliance") return "INDIA Alliance";
  return fallback;
}

function relationshipScore(partyA: string, partyB: string, state: string): number {
  const relationship = getPoliticalRelationship(partyA, partyB, {
    electionType: activeElectionType,
    region: state,
    activateConditionalRules: true,
  }).relationship;
  if (relationship === "STRONG_ALLY") return 4;
  if (relationship === "FRIENDLY") return 3;
  if (relationship === "NEUTRAL" || relationship === "UNDEFINED") return 1;
  return -100;
}

function buildCompatibleAllianceBlocs(
  candidateIds: string[],
  state: string,
  baseId: string,
  baseName: string,
  type: "PLAYER" | "PREDEFINED" | "AI_CUSTOM",
  playerPartyId?: string,
  mutuallySelectedConditionalPairs: ReadonlySet<string> = new Set(),
): StateAllianceGroup[] {
  const ordered = [...new Set(candidateIds)].sort((a, b) => {
    if (a === playerPartyId) return -1;
    if (b === playerPartyId) return 1;
    return 0;
  });
  const memberGroups: string[][] = [];
  for (const partyId of ordered) {
    const compatibleGroups = memberGroups
      .map((members, index) => ({ members, index }))
      .filter(({ members }) => canJoinGroup(partyId, members, state, mutuallySelectedConditionalPairs))
      .sort((a, b) => {
        const score = (members: string[]) => members.reduce((sum, memberId) => sum + relationshipScore(partyId, memberId, state), 0);
        return score(b.members) - score(a.members);
      });
    if (compatibleGroups.length) compatibleGroups[0].members.push(partyId);
    else memberGroups.push([partyId]);
  }

  return memberGroups.map((members, index) => {
    const isPlayerAlliance = Boolean(playerPartyId && members.includes(playerPartyId));
    // A single remaining member of a predefined national alliance is still
    // affiliated with that alliance; do not relabel it as an independent.
    // Genuine singleton AI-created groups remain independent.
    if (members.length === 1 && !isPlayerAlliance && type !== "PREDEFINED") {
      const partyId = members[0];
      return {
        id: `INDEPENDENT:${partyId}`,
        name: partyId === "BJP" ? "NDA" : partyId === "INC" ? "INDIA Alliance" : partyDisplayName(partyId),
        type: "INDEPENDENT" as const,
        memberPartyIds: members,
        isPlayerAlliance: false,
      };
    }
    const suffix = index === 0 ? "" : `:${normalizeElectionRegion(state).replace(/ /g, "-")}:BLOC${index + 1}`;
    return {
      id: `${baseId}${suffix}`,
      name: type === "PREDEFINED" ? getPredefinedBlocName(members, state, baseName) : index === 0 ? baseName : `${baseName} – ${state} Bloc ${index + 1}`,
      // Keep split blocs tied to their predefined alliance identity.
      type: isPlayerAlliance ? "PLAYER" as const : type === "PREDEFINED" ? "PREDEFINED" as const : index === 0 ? type : "AI_CUSTOM" as const,
      memberPartyIds: members,
      isPlayerAlliance,
    };
  });
}

function buildStateAllianceGroups(
  state: string,
  eligiblePartyIds: string[],
  playerAlliance: LokSabhaGameAlliance,
  optedOutPartyIds: string[],
  allianceChoice: LokSabhaAllianceChoice,
  multiStateAiFronts: StateAllianceGroup[] = [],
  mutuallySelectedConditionalPairs: ReadonlySet<string> = new Set(),
  globalAiDecisions: GlobalAiAllianceDecisions = new Map(),
): StateAllianceGroup[] {
  const eligible = new Set(eligiblePartyIds);
  const groups: StateAllianceGroup[] = [];
  const assigned = new Set<string>();
  const playerPartyId = playerAlliance.memberPartyIds[0];

  // The player's selection is authoritative. "Independent" is a party status,
  // never an alliance group and must not be represented as a PLAYER alliance.
  if (allianceChoice !== "Independent") {
    const playerMembers = playerAlliance.memberPartyIds.filter((id) => eligible.has(id));
    if (playerMembers.length) {
      const playerBlocs = buildCompatibleAllianceBlocs(
        playerMembers,
        state,
        playerAlliance.id ?? `PLAYER-CUSTOM:${playerAlliance.name}`,
        playerAlliance.name,
        "PLAYER",
        eligible.has(playerPartyId) ? playerPartyId : undefined,
        mutuallySelectedConditionalPairs,
      );
      for (const bloc of playerBlocs) {
        // A one-party player selection is not an alliance.
        if (bloc.memberPartyIds.length > 1) groups.push(bloc);
        else if (allianceChoice === "NDA" || allianceChoice === "INDIA") {
          // A player who selects the predefined national alliance remains its
          // member even when they are its only locally eligible/player-selected
          // representative. Do not relabel them as independent.
          groups.push({
            id: `${allianceChoice}:${normalizeElectionRegion(state)}:PLAYER`,
            name: allianceChoice === "NDA" ? "NDA" : "INDIA Alliance",
            type: "PREDEFINED",
            memberPartyIds: bloc.memberPartyIds,
            isPlayerAlliance: true,
          });
        } else if (allianceChoice === "CUSTOM") {
          // Preserve the custom front identity even when only one member has
          // a foothold in this state. The local group remains the player's
          // front; it is not reclassified as an independent party.
          groups.push({
            id: `PLAYER-CUSTOM:${playerAlliance.name}:${normalizeElectionRegion(state)}`,
            name: playerAlliance.name,
            type: "AI_CUSTOM",
            memberPartyIds: bloc.memberPartyIds,
            isPlayerAlliance: bloc.memberPartyIds.includes(playerPartyId),
          });
        } else groups.push({
          id: `INDEPENDENT:${bloc.memberPartyIds[0]}`,
          name: getSoloCampaignGroupName(bloc.memberPartyIds[0]),
          type: "INDEPENDENT",
          memberPartyIds: bloc.memberPartyIds,
          isPlayerAlliance: false,
        });
        bloc.memberPartyIds.forEach((id) => assigned.add(id));
      }
    }
  } else if (eligible.has(playerPartyId)) {
    // Independent status does not grant nationwide eligibility. The player's
    // party is added only in states listed in its configured core footholds.
    assigned.add(playerPartyId);
    groups.push({
      id: `INDEPENDENT:${playerPartyId}`,
      name: getSoloCampaignGroupName(playerPartyId),
      type: "INDEPENDENT",
      memberPartyIds: [playerPartyId],
      // The player's independent party is still the player's seat-share group.
      isPlayerAlliance: true,
    });
  }

  // Apply globally-created AI front memberships in every eligible state.
  // National alliance memberships are consolidated into exactly one local
  // group per alliance. The sole configured exception is Kerala's Left Front.
  for (const front of multiStateAiFronts) {
    const localMembers = front.memberPartyIds.filter((id) =>
      eligible.has(id) && !assigned.has(id) && !optedOutPartyIds.includes(id)
    );
    if (localMembers.length === 0) continue;

    const isNationalNda = front.id === "AI-GLOBAL-ALLIANCE:NDA";
    const isNationalIndia = front.id === "AI-GLOBAL-ALLIANCE:INDIA";
    if (isNationalNda || isNationalIndia) {
      if (isNationalIndia && normalizeElectionRegion(state) === "kerala" &&
          localMembers.includes("CPI") && localMembers.includes("CPM")) {
        const leftMembers = ["CPI", "CPM"];
        groups.push({
          id: `GLOBAL-LEFT-FRONT:${normalizeElectionRegion(state)}`,
          name: "Left Front",
          type: "AI_CUSTOM",
          memberPartyIds: leftMembers,
          isPlayerAlliance: false,
        });
        leftMembers.forEach((id) => assigned.add(id));
      }
      const remaining = localMembers.filter((id) => !assigned.has(id));
      if (remaining.length) {
        const nationalName = isNationalNda ? "NDA" : "INDIA Alliance";
        const existingNationalGroup = groups.find((group) =>
          group.name === nationalName && group.type === "PREDEFINED"
        );
        if (existingNationalGroup) {
          existingNationalGroup.memberPartyIds = Array.from(new Set([
            ...existingNationalGroup.memberPartyIds,
            ...remaining,
          ]));
          if (existingNationalGroup.memberPartyIds.includes(playerPartyId)) {
            existingNationalGroup.isPlayerAlliance = true;
          }
        } else {
          groups.push({
            id: `${front.id}:${normalizeElectionRegion(state)}`,
            name: nationalName,
            type: "PREDEFINED",
            memberPartyIds: remaining,
            isPlayerAlliance: false,
          });
        }
        remaining.forEach((id) => assigned.add(id));
      }
      continue;
    }

    // Custom inter-state fronts retain one identity globally. Regional
    // incompatibilities split only custom local groupings.
    const localBlocs: string[][] = [];
    for (const partyId of localMembers) {
      const compatible = localBlocs.find((members) =>
        canJoinGroup(partyId, members, state, mutuallySelectedConditionalPairs)
      );
      if (compatible) compatible.push(partyId);
      else localBlocs.push([partyId]);
    }
    localBlocs.forEach((members, index) => {
      if (members.length < 2) return;
      const name = front.name;
      groups.push({
        id: `${front.id}:${normalizeElectionRegion(state)}:${index + 1}`,
        name,
        type: "AI_CUSTOM",
        memberPartyIds: members,
        isPlayerAlliance: false,
      });
      members.forEach((id) => assigned.add(id));
    });
    for (const members of localBlocs.filter((bloc) => bloc.length === 1)) {
      const id = members[0];
      groups.push({ id: `${front.id}:${normalizeElectionRegion(state)}:SOLO:${id}`, name: front.name,
        type: "AI_CUSTOM", memberPartyIds: members, isPlayerAlliance: false });
      assigned.add(id);
    }
  }

  // Project configured national-core memberships into every eligible state.
  // The core alliance identity is global; local incompatibility may split the
  // state group, but must not turn a national member into an independent.
  for (const nationalAlliance of alliances) {
    const coreMembers = nationalAlliance.corePartyIds.filter((id) =>
      eligible.has(id) &&
      !assigned.has(id) &&
      !optedOutPartyIds.includes(id) &&
      id !== playerPartyId
    );
    if (!coreMembers.length) continue;

    // Special Kerala exception: CPI and CPM remain INDIA members nationally,
    // but form the mandatory Left Front together in Kerala when both are
    // eligible and both are configured INDIA core members.
    const isKerala = normalizeElectionRegion(state) === "kerala";
    const hasBothLeftParties = nationalAlliance.id === "INDIA" &&
      coreMembers.includes("CPI") && coreMembers.includes("CPM");
    const leftFrontMembers = isKerala && hasBothLeftParties ? ["CPI", "CPM"] : [];
    if (leftFrontMembers.length === 2) {
      groups.push({
        id: `GLOBAL-LEFT-FRONT:${normalizeElectionRegion(state)}`,
        name: "Left Front",
        type: "AI_CUSTOM",
        memberPartyIds: leftFrontMembers,
        isPlayerAlliance: false,
      });
      leftFrontMembers.forEach((id) => assigned.add(id));
    }

    const remainingCoreMembers = coreMembers.filter((id) => !assigned.has(id));
    if (remainingCoreMembers.length) {
      const coreBlocs = buildCompatibleAllianceBlocs(
        remainingCoreMembers,
        state,
        `GLOBAL-CORE:${nationalAlliance.id}`,
        nationalAlliance.id === "NDA" ? "NDA" : "INDIA Alliance",
        "PREDEFINED",
        undefined,
        mutuallySelectedConditionalPairs,
      );
      groups.push(...coreBlocs);
      remainingCoreMembers.forEach((id) => assigned.add(id));
    }
  }

  const candidates = eligiblePartyIds.filter((id) =>
    !assigned.has(id) && !optedOutPartyIds.includes(id)
  );
  const joinExisting: string[] = [];
  const formNew: string[] = [];
  const independent: string[] = [];

  // Decisions supplied by the election-wide planner are stable across every
  // state. Parties not yet covered by the global planner retain the legacy
  // local fallback until their configured national-core handling is migrated.
  for (const partyId of candidates) {
    const decision = globalAiDecisions.get(partyId);
    if (decision === "JOIN_EXISTING") joinExisting.push(partyId);
    else if (decision === "FORM_NEW") formNew.push(partyId);
    else if (decision === "INDEPENDENT") independent.push(partyId);
    else {
      const roll = Math.random();
      if (roll < 1 / 3) joinExisting.push(partyId);
      else if (roll < 2 / 3) formNew.push(partyId);
      else independent.push(partyId);
    }
  }

  // Parties choosing "join" may join a compatible player alliance or a
  // compatible predefined bloc. Rivalry checks are state-specific.
  const allianceBuckets = new Map<string, string[]>();
  for (const partyId of joinExisting) {
    const possibleTargets: { id: string; name: string; members: string[]; type: "PLAYER" | "PREDEFINED" }[] = [];
    for (const group of groups) {
      if (group.type !== "INDEPENDENT" && canJoinGroup(partyId, group.memberPartyIds, state, mutuallySelectedConditionalPairs)) {
        possibleTargets.push({ id: group.id, name: group.name, members: group.memberPartyIds, type: "PLAYER" });
      }
    }
    for (const alliance of alliances) {
      const canAlign = alliance.corePartyIds.includes(partyId) ||
        alignmentRules.some((rule) => rule.partyIds.includes(partyId) && rule.eligibleAlignments.includes(alliance.id));
      if (!canAlign) continue;
      const compatibleMembers = joinExisting.filter((otherId) =>
        otherId !== partyId &&
        (alliance.corePartyIds.includes(otherId) ||
          alignmentRules.some((rule) => rule.partyIds.includes(otherId) && rule.eligibleAlignments.includes(alliance.id))) &&
        !relationshipBlocks(partyId, otherId, state, mutuallySelectedConditionalPairs)
      );
      if (compatibleMembers.length) {
        possibleTargets.push({
          id: `AI-PREDEFINED:${alliance.id}`,
          name: alliance.id === "NDA" ? "NDA" : alliance.id === "INDIA" ? "INDIA Alliance" : alliance.name,
          members: compatibleMembers,
          type: "PREDEFINED",
        });
      }
    }
    if (!possibleTargets.length) {
      independent.push(partyId);
      continue;
    }
    const target = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
    const bucket = allianceBuckets.get(target.id) ?? [...target.members];
    if (canJoinGroup(partyId, bucket, state, mutuallySelectedConditionalPairs)) {
      bucket.push(partyId);
      allianceBuckets.set(target.id, bucket);
    } else {
      independent.push(partyId);
    }
  }

  for (const [id, memberIds] of allianceBuckets) {
    const uniqueMembers = [...new Set(memberIds)].filter((id) => eligible.has(id));
    if (uniqueMembers.length < 2) continue;
    const existingGroup = groups.find((group) => group.id === id);
    if (existingGroup) {
      existingGroup.memberPartyIds = uniqueMembers;
      uniqueMembers.forEach((partyId) => assigned.add(partyId));
      continue;
    }
    const predefined = id.startsWith("AI-PREDEFINED:");
    const allianceId = predefined ? id.split(":")[1] : id;
    const configured = predefined ? alliances.find((item) => item.id === allianceId) : undefined;
    const name = predefined
      ? getPredefinedBlocName(uniqueMembers, state, configured?.name ?? allianceId)
      : getLocalAiGroupName(uniqueMembers, state);
    const finalId = predefined ? `AI-ALLIANCE:${allianceId}:${normalizeElectionRegion(state)}` : id;
    groups.push({
      id: finalId,
      name,
      type: predefined ? "PREDEFINED" : "AI_CUSTOM",
      memberPartyIds: uniqueMembers,
      isPlayerAlliance: false,
    });
    uniqueMembers.forEach((partyId) => assigned.add(partyId));
  }

  // Parties selecting "form" create new alliances only with other form-selecting
  // parties that are mutually compatible in this state.
  const remainingForm = [...formNew];
  let sequence = 1;
  while (remainingForm.length) {
    const seed = remainingForm.shift()!;
    const members = [seed];
    for (let index = 0; index < remainingForm.length;) {
      const candidate = remainingForm[index];
      if (canJoinGroup(candidate, members, state, mutuallySelectedConditionalPairs)) {
        members.push(candidate);
        remainingForm.splice(index, 1);
      } else index += 1;
    }
    if (members.length > 1) {
      groups.push({
        id: `AI-RANDOM-${normalizeElectionRegion(state)}-${sequence++}`,
        name: getLocalAiGroupName(members, state),
        type: "AI_CUSTOM",
        memberPartyIds: members,
        isPlayerAlliance: false,
      });
      members.forEach((partyId) => assigned.add(partyId));
    } else {
      independent.push(members[0]);
    }
  }

  for (const partyId of independent) {
    if (assigned.has(partyId)) continue;
    groups.push({
      id: `INDEPENDENT:${partyId}`,
      name: getSoloCampaignGroupName(partyId),
      type: "INDEPENDENT",
      memberPartyIds: [partyId],
      isPlayerAlliance: false,
    });
    assigned.add(partyId);
  }

  // Defensive completion: every eligible party must belong to exactly one
  // alliance or independent contesting group.
  for (const partyId of eligiblePartyIds) {
    if (assigned.has(partyId)) continue;
    groups.push({
      id: `INDEPENDENT:${partyId}`,
      name: getSoloCampaignGroupName(partyId),
      type: "INDEPENDENT",
      memberPartyIds: [partyId],
      isPlayerAlliance: false,
    });
    assigned.add(partyId);
  }
  // BJP convenes the NDA and INC convenes INDIA. When the player leads that party but does not take its national
  // alliance (runs alone or forms a custom front), the AI parties left over are no longer that alliance: the name
  // goes with its convener, so they get a front of their own named after their strongest member.
  const absentConvener = playerPartyId === "BJP" ? "NDA" : playerPartyId === "INC" ? "INDIA Alliance" : "";
  const keepsNationalAlliance = (playerPartyId === "BJP" && allianceChoice === "NDA") || (playerPartyId === "INC" && allianceChoice === "INDIA");
  if (absentConvener && !keepsNationalAlliance) {
    const strength = (id: string) => Object.values(regionalStrengths).reduce((sum, region) => sum + (region[id] ?? 0), 0);
    for (const group of groups) {
      if (group.name !== absentConvener || group.isPlayerAlliance || group.memberPartyIds.includes(playerPartyId)) continue;
      const lead = [...group.memberPartyIds].sort((x, y) => strength(y) - strength(x) || x.localeCompare(y))[0];
      group.name = `${lead}+`;
      group.type = "AI_CUSTOM";
    }
  }
  return groups;
}

function getOptedOutPartyIds(input: CreateLokSabhaGameInput, alliance: LokSabhaGameAlliance): string[] {
  if (input.allianceChoice === "Independent") return [input.playerPartyId];
  if (input.allianceChoice === "NDA" || input.allianceChoice === "INDIA") return [];
  return alliance.memberPartyIds;
}

/** The parties, alliance groups and player seat shares of every state in an election. */
export function buildElectionField(
  input: CreateLokSabhaGameInput,
  alliance: LokSabhaGameAlliance,
  constituencies: Array<{ state: string }>,
  electionType: "LOK_SABHA" | "ASSEMBLY" = "LOK_SABHA",
) {
  return withElectionType(electionType, () => {
    const statePartyParticipation: Record<string, string[]> = {};
    const stateAllianceGroups: Record<string, StateAllianceGroup[]> = {};
    const playerSeatShares: Record<string, StateSeatSharePlan> = {};
    const optedOutPartyIds = getOptedOutPartyIds(input, alliance);
    const allEligiblePartyIds = Array.from(new Set(constituencies.flatMap((item) => getEligiblePartyIdsForState(item.state))));
    const playerAlliancePartyIds = new Set(alliance.memberPartyIds);
    const globalCustomCandidates = allEligiblePartyIds.filter((id) =>
      !optedOutPartyIds.includes(id) &&
      !playerAlliancePartyIds.has(id) &&
      // Every non-core AI party receives one election-wide decision. Alignment
      // eligibility is checked when resolving a target, not used to exclude
      // parties from the global decision process.
      !alliances.some((item) => item.corePartyIds.includes(id))
    );
    const globalAiDecisions = createGlobalAiAllianceDecisions(globalCustomCandidates);
    const globalFormCandidates = globalCustomCandidates.filter((id) => globalAiDecisions.get(id) === "FORM_NEW");
    const globalJoinCandidates = globalCustomCandidates.filter((id) => globalAiDecisions.get(id) === "JOIN_EXISTING");
    const mutuallySelectedConditionalPairs = selectMutualConditionalPartners(
      allEligiblePartyIds,
      input.playerPartyId,
      new Set(input.customPartnerPartyIds ?? alliance.memberPartyIds.filter((id) => id !== input.playerPartyId)),
    );
    const formedMultiStateAiFronts = createMultiStateAiFronts(globalFormCandidates, mutuallySelectedConditionalPairs);
    const globalJoinMemberships = resolveGlobalJoinMemberships(
      globalJoinCandidates,
      formedMultiStateAiFronts,
      new Set([...optedOutPartyIds, ...playerAlliancePartyIds]),
      mutuallySelectedConditionalPairs,
    );
    const multiStateAiFronts = [...formedMultiStateAiFronts, ...globalJoinMemberships];

    for (const state of Array.from(new Set(constituencies.map((item) => item.state)))) {
      const eligible = getEligiblePartyIdsForState(state);
      statePartyParticipation[state] = eligible;
      const groups = buildStateAllianceGroups(state, eligible, alliance, optedOutPartyIds, input.allianceChoice, multiStateAiFronts, mutuallySelectedConditionalPairs, globalAiDecisions);
      stateAllianceGroups[state] = groups;
      const stateSeatCount = constituencies.filter((item) => item.state === state).length;
      const playerGroup = groups.find((group) => group.isPlayerAlliance);
      if (playerGroup) playerSeatShares[state] = distributeByStrength(playerGroup.memberPartyIds, state, stateSeatCount);
    }

    return { statePartyParticipation, stateAllianceGroups, playerSeatShares, optedOutPartyIds };
  });
}

export function createLokSabhaGame(input: CreateLokSabhaGameInput): LokSabhaGameSave {
  if (!input.playerPartyId || !input.allianceChoice) throw new Error("Choose a party and alliance before starting.");
  const predefined = input.allianceChoice === "NDA" || input.allianceChoice === "INDIA";
  const custom = input.allianceChoice === "CUSTOM";
  let alliance: LokSabhaGameAlliance;
  if (predefined) {
    const configured = alliances.find((item) => item.id === input.allianceChoice);
    const members = [input.playerPartyId];
    alliance = { id: input.allianceChoice, name: configured?.name ?? input.allianceChoice, type: "PREDEFINED", memberPartyIds: members };
  } else if (custom) {
    const name = input.customAllianceName?.trim();
    const members = Array.from(new Set([input.playerPartyId, ...(input.customPartnerPartyIds ?? [])]));
    if (!name || members.length < 2) throw new Error("A custom alliance needs a name and at least one partner.");
    alliance = { id: null, name, type: "CUSTOM", memberPartyIds: members, ...(input.customAllianceColor ? { color: input.customAllianceColor } : {}) };
  } else {
    alliance = { id: null, name: "Independent", type: "INDEPENDENT", memberPartyIds: [input.playerPartyId] };
  }

  const constituencies = lokSabhaConstituencies.map((pc) => ({
    constituencyId: pc.id, state: pc.state, name: pc.name, totalVoters: pc.totalVoters,
    registeredElectors: pc.registeredElectors,
    parentAssemblySegments: getAssemblySegmentsForParliamentaryConstituency(pc.state, pc.name).map((ac) => ac.id),
    allocations: [] as SeatContestantAllocation[], allocatedPartyId: null, allocationStatus: "UNALLOCATED" as const,
  }));
  const { statePartyParticipation, stateAllianceGroups, playerSeatShares, optedOutPartyIds } = buildElectionField(input, alliance, constituencies);

  const now = new Date().toISOString();
  return {
    schemaVersion: 2, gameId: `lok-sabha-${Date.now()}`, electionType: "LOK_SABHA", createdAt: now, updatedAt: now,
    electionYear: 2024, playerPartyId: input.playerPartyId, alliance,
    constituencies, statePartyParticipation, stateAllianceGroups, playerSeatShares, seatShareResults: {}, optedOutPartyIds,
    totalConstituencies: constituencies.length,
    totalVoters: constituencies.reduce((sum, item) => sum + item.totalVoters, 0), allocatedConstituencies: 0, status: "SEAT_ALLOCATION",
  };
}

export function saveLokSabhaGame(game: LokSabhaGameSave): void {
  if (typeof window === "undefined") throw new Error("Game saves are only available in the browser.");
  window.localStorage.setItem(LOK_SABHA_SAVE_KEY, JSON.stringify({ ...game, updatedAt: new Date().toISOString() }));
}

/** Shape of a pre-schemaVersion-2 save: only the fields migration reads are required. */
type LegacyLokSabhaSave = Partial<LokSabhaGameSave> & Pick<LokSabhaGameSave, "alliance" | "playerPartyId" | "constituencies">;

function migrateLegacySave(parsed: LegacyLokSabhaSave): LokSabhaGameSave {
  const parsedAlliance = parsed.alliance as LokSabhaGameAlliance;
  const baseAlliance: LokSabhaGameAlliance = parsedAlliance.type === "PREDEFINED"
    ? { ...parsedAlliance, memberPartyIds: [parsed.playerPartyId] }
    : parsedAlliance;
  const constituencies = parsed.constituencies as LokSabhaGameSave["constituencies"];
  const optedOutPartyIds = Array.isArray(parsed.optedOutPartyIds) ? parsed.optedOutPartyIds : [];
  const statePartyParticipation: Record<string, string[]> = parsed.statePartyParticipation ?? {};
  const stateAllianceGroups: Record<string, StateAllianceGroup[]> = {};
  const playerSeatShares: Record<string, StateSeatSharePlan> = {};
  const allEligiblePartyIds = Array.from(new Set(constituencies.flatMap((item) => getEligiblePartyIdsForState(item.state))));
  const playerAlliancePartyIds = new Set(baseAlliance.memberPartyIds);
  const globalCustomCandidates = allEligiblePartyIds.filter((id) =>
    !optedOutPartyIds.includes(id) &&
    !playerAlliancePartyIds.has(id) &&
    // Every non-core AI party receives one election-wide decision. Alignment
    // eligibility is checked when resolving a target, not used to exclude
    // parties from the global decision process.
    !alliances.some((item) => item.corePartyIds.includes(id))
  );
  const mutuallySelectedConditionalPairs = selectMutualConditionalPartners(
    allEligiblePartyIds,
    parsed.playerPartyId,
    new Set(baseAlliance.memberPartyIds.filter((id) => id !== parsed.playerPartyId)),
  );
  const multiStateAiFronts = createMultiStateAiFronts(globalCustomCandidates, mutuallySelectedConditionalPairs);
  for (const state of Array.from(new Set(constituencies.map((item) => item.state)))) {
    statePartyParticipation[state] = getEligiblePartyIdsForState(state);
    const groups = buildStateAllianceGroups(state, statePartyParticipation[state], baseAlliance, optedOutPartyIds, baseAlliance.type === "PREDEFINED" ? (baseAlliance.id as LokSabhaAllianceChoice) : baseAlliance.type === "CUSTOM" ? "CUSTOM" : "Independent", multiStateAiFronts, mutuallySelectedConditionalPairs);
    stateAllianceGroups[state] = groups;
    const playerGroup = groups.find((group) => group.isPlayerAlliance);
    if (playerGroup) playerSeatShares[state] = distributeByStrength(playerGroup.memberPartyIds, state, constituencies.filter((item) => item.state === state).length);
  }
  return {
    ...parsed,
    schemaVersion: 2,
    statePartyParticipation,
    stateAllianceGroups,
    playerSeatShares,
    seatShareResults: {},
    optedOutPartyIds,
    constituencies: constituencies.map((item) => ({ ...item, allocations: item.allocations ?? (item.allocatedPartyId ? [{ partyId: item.allocatedPartyId, allianceId: "INDEPENDENT", allianceName: "Independent" }] : []) })),
  } as LokSabhaGameSave;
}

export function loadLokSabhaGame(): LokSabhaGameSave | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LOK_SABHA_SAVE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw, plainNamesReviver);
    if (![1, 2].includes(parsed.schemaVersion) || parsed.electionType !== "LOK_SABHA" || !Array.isArray(parsed.constituencies)) return null;
    const migrated = parsed.schemaVersion === 1 ? migrateLegacySave(parsed) : parsed as LokSabhaGameSave;
    return migrated;
  } catch { return null; }
}

export function updatePlayerSeatShare(
  game: LokSabhaGameSave,
  state: string,
  partyId: string,
  seats: number,
): LokSabhaGameSave {
  const group = game.stateAllianceGroups[state]?.find((item) => item.isPlayerAlliance);
  if (!group || !group.memberPartyIds.includes(partyId)) throw new Error(`${partyId} is not part of your alliance in ${state}.`);
  const totalSeats = game.constituencies.filter((item) => item.state === state).length;
  const currentShares = game.playerSeatShares[state] ?? {};
  const otherPartyShares = group.memberPartyIds
    .filter((memberId) => memberId !== partyId)
    .reduce((sum, memberId) => sum + Math.max(0, currentShares[memberId] ?? 0), 0);
  // A slider can only use seats not already assigned to the other partners.
  const availableForParty = Math.max(0, totalSeats - otherPartyShares);
  const nextValue = Math.max(0, Math.min(availableForParty, Math.round(seats)));
  const playerSeatShares = {
    ...game.playerSeatShares,
    [state]: { ...currentShares, [partyId]: nextValue },
  };
  return { ...game, playerSeatShares, updatedAt: new Date().toISOString() };
}

export function getPlayerSeatShareStatus(game: LokSabhaGameSave, state: string): { assigned: number; total: number; remaining: number; valid: boolean } {
  const total = game.constituencies.filter((item) => item.state === state).length;
  const group = game.stateAllianceGroups[state]?.find((item) => item.isPlayerAlliance);
  if (!group) return { assigned: 0, total, remaining: total, valid: false };
  const assigned = group.memberPartyIds.reduce((sum, partyId) => sum + (game.playerSeatShares[state]?.[partyId] ?? 0), 0);
  return { assigned, total, remaining: total - assigned, valid: assigned === total };
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

export function getSeatSharePreview(game: LokSabhaGameSave, state: string): Array<{ group: StateAllianceGroup; shares: StateSeatSharePlan; total: number; isFallback: boolean }> {
  const totalSeats = game.constituencies.filter((seat) => seat.state === state).length;
  return (game.stateAllianceGroups[state] ?? []).map((group) => {
    const members = group.memberPartyIds.filter((partyId) => (game.statePartyParticipation[state] ?? []).includes(partyId));
    const shares = group.isPlayerAlliance
      ? Object.fromEntries(members.map((partyId) => [partyId, game.playerSeatShares[state]?.[partyId] ?? 0]))
      : group.type === "INDEPENDENT" && members.length === 1
        ? { [members[0]]: totalSeats }
        : distributeByStrength(members, state, totalSeats);
    const isFallback = members.some((partyId) => getPartyStrength(partyId, state) === null);
    return { group, shares, total: Object.values(shares).reduce((sum, value) => sum + value, 0), isFallback };
  });
}

export function randomlyAllocateSeats(game: LokSabhaGameSave): LokSabhaGameSave {
  const seatShareResults: Record<string, Record<string, StateSeatSharePlan>> = {};
  const allocationsByConstituency = new Map<string, SeatContestantAllocation[]>();
  game.constituencies.forEach((seat) => allocationsByConstituency.set(seat.constituencyId, []));
  const states = Array.from(new Set(game.constituencies.map((seat) => seat.state)));

  for (const state of states) {
    const stateSeats = game.constituencies.filter((seat) => seat.state === state);
    const groups = game.stateAllianceGroups[state] ?? [];
    seatShareResults[state] = {};

    for (const group of groups) {
      const eligibleMembers = group.memberPartyIds.filter((partyId) =>
        (game.statePartyParticipation[state] ?? []).includes(partyId) && partyCanContestInState(partyId, state)
      );
      if (!eligibleMembers.length) continue;

      let plan: StateSeatSharePlan;
      if (group.isPlayerAlliance) {
        plan = Object.fromEntries(eligibleMembers.map((partyId) => [partyId, game.playerSeatShares[state]?.[partyId] ?? 0]));
        const assigned = Object.values(plan).reduce((sum, value) => sum + value, 0);
        if (assigned !== stateSeats.length) {
          throw new Error(`${state}: your alliance has allocated ${assigned} of ${stateSeats.length} seats. Adjust the sliders so the total matches exactly.`);
        }
      } else if (group.type === "INDEPENDENT" && eligibleMembers.length === 1) {
        plan = { [eligibleMembers[0]]: stateSeats.length };
      } else {
        plan = distributeByStrength(eligibleMembers, state, stateSeats.length);
      }
      seatShareResults[state][group.id] = plan;

      const partySequence: string[] = [];
      for (const partyId of eligibleMembers) {
        const count = plan[partyId] ?? 0;
        for (let i = 0; i < count; i++) partySequence.push(partyId);
      }
      const randomizedSeats = shuffled(stateSeats);
      const randomizedParties = shuffled(partySequence);
      randomizedSeats.forEach((seat, index) => {
        const partyId = randomizedParties[index];
        if (!partyId) return;
        const target = allocationsByConstituency.get(seat.constituencyId)!;
        target.push({ partyId, allianceId: group.id, allianceName: group.name });
      });
    }
  }

  const constituencies = game.constituencies.map((seat) => {
    const allocations = allocationsByConstituency.get(seat.constituencyId) ?? [];
    return { ...seat, allocations, allocatedPartyId: allocations[0]?.partyId ?? null, allocationStatus: allocations.length ? "ALLOCATED" as const : "UNALLOCATED" as const };
  });
  return {
    ...game,
    constituencies,
    seatShareResults,
    allocatedConstituencies: constituencies.filter((item) => item.allocations.length > 0).length,
    updatedAt: new Date().toISOString(),
  };
}

export function setConstituencyPartyAllocation(game: LokSabhaGameSave, constituencyId: string, partyId: string, allianceId: string, allianceName: string): LokSabhaGameSave {
  const seat = game.constituencies.find((item) => item.constituencyId === constituencyId);
  if (!seat) throw new Error("Constituency not found.");
  if (!(game.statePartyParticipation[seat.state] ?? []).includes(partyId) || !partyCanContestInState(partyId, seat.state)) throw new Error(`${partyId} is not eligible to contest in ${seat.state}.`);
  if (seat.allocations.some((item) => item.allianceId === allianceId && item.partyId !== partyId)) throw new Error(`Another party is already assigned for ${allianceName} in this constituency.`);
  const allocations = [...seat.allocations.filter((item) => item.partyId !== partyId && item.allianceId !== allianceId), { partyId, allianceId, allianceName }];
  const constituencies = game.constituencies.map((item) => item.constituencyId === constituencyId ? { ...item, allocations, allocatedPartyId: allocations[0]?.partyId ?? null, allocationStatus: "ALLOCATED" as const } : item);
  return { ...game, constituencies, allocatedConstituencies: constituencies.filter((item) => item.allocations.length > 0).length, updatedAt: new Date().toISOString() };
}

export function removeConstituencyPartyAllocation(game: LokSabhaGameSave, constituencyId: string, partyId: string): LokSabhaGameSave {
  const constituencies = game.constituencies.map((item) => {
    if (item.constituencyId !== constituencyId) return item;
    const allocations = item.allocations.filter((allocation) => allocation.partyId !== partyId);
    return { ...item, allocations, allocatedPartyId: allocations[0]?.partyId ?? null, allocationStatus: allocations.length ? "ALLOCATED" as const : "UNALLOCATED" as const };
  });
  return { ...game, constituencies, allocatedConstituencies: constituencies.filter((item) => item.allocations.length > 0).length, updatedAt: new Date().toISOString() };
}

export function deleteLokSabhaGame(): void { if (typeof window !== "undefined") window.localStorage.removeItem(LOK_SABHA_SAVE_KEY); }
