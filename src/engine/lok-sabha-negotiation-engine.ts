import type { AssemblyGameSave } from "@/engine/assembly-game-engine";
import { DEPUTY_CM_POINTS, DEPUTY_COUNT, DEPUTY_POINTS, MINISTER_COUNT, MINISTER_POINTS, TOTAL_POINTS_WITH_DEPUTIES } from "@/engine/assembly-cabinet-engine";
import { DEPUTY_PM_POINTS, MINISTRY_POINTS as UNION_POINTS, TOTAL_UNION_POINTS } from "@/engine/lok-sabha-cabinet-engine";
import type { AssemblyVotingSave } from "@/engine/assembly-voting-engine";
import type { LokSabhaGameSave, SeatContestantAllocation } from "@/types/lok-sabha-game";
import type { LokSabhaVotingSave, VotingConstituencyResult } from "@/types/lok-sabha-voting";

export const LOK_SABHA_NEGOTIATION_SAVE_KEY = "indian-election-game-lok-sabha-negotiation-save";
export const NEGOTIATION_DAYS = 14;
/** If nobody has 272 seats after the 14 days, talks continue for one more week. */
export const NEGOTIATION_EXTENSION_DAYS = 7;
export const NEGOTIATION_TOTAL_DAYS = NEGOTIATION_DAYS + NEGOTIATION_EXTENSION_DAYS;
export const NEGOTIATION_ROUNDS_PER_PARTY = 5;
export const MAJORITY_MARK = 272;

export type NegotiationElectionKind = "LOK_SABHA" | "ASSEMBLY";
export const ASSEMBLY_NEGOTIATION_SAVE_KEY = "indian-election-simulator:assembly-negotiation";
export const ASSEMBLY_NEGOTIATION_DAYS = 7;
export const ASSEMBLY_NEGOTIATION_EXTENSION_DAYS = 3;

/** Everything that differs between a Lok Sabha and a State Assembly negotiation. */
export interface NegotiationRules {
  kind: NegotiationElectionKind;
  /** Seats needed to govern. */
  majority: number;
  days: number;
  extensionDays: number;
  totalDays: number;
  totalSeats: number;
  /** "Prime Minister" for Lok Sabha, "Chief Minister" for an Assembly. */
  headTitle: string;
  deputyTitle: string;
  /** Points to share between governing parties (the cabinet's ministry points). */
  portfolioPoints: number;
  /** The state, for judging party relationships in an Assembly election. */
  region?: string;
}

export const LOK_SABHA_RULES: NegotiationRules = {
  kind: "LOK_SABHA",
  majority: MAJORITY_MARK,
  days: NEGOTIATION_DAYS,
  extensionDays: NEGOTIATION_EXTENSION_DAYS,
  totalDays: NEGOTIATION_TOTAL_DAYS,
  totalSeats: 543,
  headTitle: "Prime Minister",
  deputyTitle: "Deputy Prime Minister",
  portfolioPoints: TOTAL_UNION_POINTS,
};

export function assemblyNegotiationRules(
  totalSeats: number,
  state: string,
  portfolioPoints: number,
): NegotiationRules {
  return {
    kind: "ASSEMBLY",
    majority: Math.floor(totalSeats / 2) + 1,
    days: ASSEMBLY_NEGOTIATION_DAYS,
    extensionDays: ASSEMBLY_NEGOTIATION_EXTENSION_DAYS,
    totalDays: ASSEMBLY_NEGOTIATION_DAYS + ASSEMBLY_NEGOTIATION_EXTENSION_DAYS,
    totalSeats,
    headTitle: "Chief Minister",
    deputyTitle: "Deputy Chief Minister",
    portfolioPoints,
    region: state,
  };
}

function defaultRules(kind?: NegotiationElectionKind): NegotiationRules {
  return kind === "ASSEMBLY"
    ? assemblyNegotiationRules(234, "", TOTAL_POINTS_WITH_DEPUTIES)
    : LOK_SABHA_RULES;
}
/** The rules a save or overview plays by (Lok Sabha unless it says otherwise). */
function rulesOf(save: { kind?: NegotiationElectionKind }, overview?: NegotiationOverview): NegotiationRules {
  return overview?.rules ?? defaultRules(save.kind);
}
/** A Lok Sabha seat threshold, scaled to the size of this house. */
function scaledSeats(seats: number, overview: NegotiationOverview): number {
  return Math.max(1, Math.round((seats * overview.rules.majority) / MAJORITY_MARK));
}
function relationContext(rules: NegotiationRules) {
  return rules.kind === "ASSEMBLY"
    ? { electionType: "ASSEMBLY" as const, region: rules.region, activateConditionalRules: true }
    : { electionType: "LOK_SABHA" as const, activateConditionalRules: true };
}

export type NegotiationScenario =
  | "PLAYER_NATIONAL_ALLIANCE_CONVENER"
  | "PLAYER_INDEPENDENT"
  | "PLAYER_CUSTOM_FRONT_LEADER"
  | "NO_NEGOTIATION_REQUIRED";
export interface NegotiationBloc {
  id: string;
  name: string;
  partyIds: string[];
  seats: number;
  isPlayerBloc: boolean;
  /** Incoming offers only: false when the player cannot formally join, so the bloc asks for outside support only. */
  joinable?: boolean;
  /** The bloc's convener, for judging whether it would welcome a party. */
  convenerPartyId?: string;
}
export interface NegotiationParty {
  partyId: string;
  seats: number;
  allianceId: string;
  allianceName: string;
}
export interface NegotiationOverview {
  scenario: NegotiationScenario;
  triggerNegotiations: boolean;
  majorityMark: number;
  rules: NegotiationRules;
  partyRows: NegotiationParty[];
  blocs: NegotiationBloc[];
  playerPartySeats: number;
  playerPartyId: string;
  playerBlocName: string;
  largestPartyId: string;
  largestPartySeats: number;
  largestBlocName: string;
  largestBlocSeats: number;
  /**
   * Who coordinated each pre-poll bloc (keyed by bloc id), fixed for the game: BJP for NDA, INC for the
   * INDIA Alliance, CPM for the Left Front, the player for a front the player built, and otherwise the
   * member with the greatest national strength. A convener keeps the role whatever its seats.
   */
  conveners: Record<string, string>;
  /**
   * The party that takes the Prime Minister's post if the bloc governs, keyed by bloc id: BJP for NDA and
   * INC for INDIA whatever their seats, otherwise the pre-poll member with the most seats. A party that
   * joins after the election can never claim it.
   */
  primeMinisters: Record<string, string>;
}

export function buildNegotiationOverview(
  game: LokSabhaGameSave,
  voting: LokSabhaVotingSave,
): NegotiationOverview {
  if (
    voting.gameId !== game.gameId ||
    voting.status !== "COMPLETED" ||
    voting.phaseResults.reduce((n, p) => n + p.constituencyResults.length, 0) !== 543
  )
    throw new Error("Negotiations unlock only after all 543 constituency results are declared.");
  return buildOverviewFrom(
    game,
    voting.phaseResults.flatMap((phase) => phase.constituencyResults),
    LOK_SABHA_RULES,
  );
}

/** What the overview needs to know about a game, whichever kind of election it is. */
export interface NegotiationGameSource {
  gameId: string;
  playerPartyId: string;
  alliance: LokSabhaGameSave["alliance"];
  constituencies: Array<{ constituencyId: string; allocations: SeatContestantAllocation[] }>;
}

/** The overview for a State Assembly election, once every seat has been declared. */
export function buildAssemblyNegotiationOverview(
  game: AssemblyGameSave,
  voting: AssemblyVotingSave,
  portfolioPoints: number,
): NegotiationOverview {
  if (voting.gameId !== game.gameId || voting.results.length !== game.totalConstituencies)
    throw new Error("Negotiations unlock only after every constituency result is declared.");
  const source: NegotiationGameSource = {
    gameId: game.gameId,
    playerPartyId: game.playerPartyId,
    alliance: game.alliance,
    constituencies: game.constituencies.map((seat) => ({
      constituencyId: seat.id,
      allocations: seat.allocations,
    })),
  };
  return buildOverviewFrom(
    source,
    voting.results,
    assemblyNegotiationRules(game.totalConstituencies, game.state, portfolioPoints),
  );
}

function buildOverviewFrom(
  game: NegotiationGameSource,
  results: VotingConstituencyResult[],
  rules: NegotiationRules,
): NegotiationOverview {
  const partySeats: Record<string, number> = {};
  const partyBloc: Record<string, { id: string; name: string }> = {};
  const blocSeats: Record<string, number> = {};
  const blocMembers: Record<string, Set<string>> = {};
  // A party can sit in different groups in different states. It is treated as a member of the group
  // under which it won the most seats, so one party is never counted in two blocs.
  const seatsByGroup: Record<
    string,
    Record<string, { id: string; name: string; seats: number }>
  > = {};
  const playerIndependent =
    game.alliance.type === "INDEPENDENT" || game.alliance.name === "Independent";
  {
    for (const result of results) {
      const winner = result.winnerPartyId;
      partySeats[winner] = (partySeats[winner] ?? 0) + 1;
      const constituency = game.constituencies.find(
        (c) => c.constituencyId === result.constituencyId,
      );
      const allocation = constituency?.allocations.find((a) => a.partyId === winner);
      // A player who chose to run independently stands alone, whatever group the seat was listed under.
      const name =
        playerIndependent && winner === game.playerPartyId
          ? "Independent"
          : allocation?.allianceName || "Independent";
      const id = name === "Independent" ? `PARTY:${winner}` : `BLOC:${name}`;
      const groups = (seatsByGroup[winner] ??= {});
      (groups[id] ??= { id, name: name === "Independent" ? winner : name, seats: 0 }).seats += 1;
    }
  }
  for (const [partyId, groups] of Object.entries(seatsByGroup)) {
    const best = Object.values(groups).sort(
      (a, b) => b.seats - a.seats || a.id.localeCompare(b.id),
    )[0];
    partyBloc[partyId] = { id: best.id, name: best.name };
    blocSeats[best.id] = (blocSeats[best.id] ?? 0) + partySeats[partyId];
    (blocMembers[best.id] ??= new Set()).add(partyId);
  }
  const partyRows = Object.entries(partySeats)
    .map(([partyId, seats]) => ({
      partyId,
      seats,
      allianceId: partyBloc[partyId]?.id ?? `PARTY:${partyId}`,
      allianceName: partyBloc[partyId]?.name ?? partyId,
    }))
    .sort((a, b) => b.seats - a.seats);
  const blocs = Object.entries(blocSeats)
    .map(([id, seats]) => ({
      id,
      name: id.startsWith("PARTY:")
        ? id.slice(6)
        : (partyBloc[[...(blocMembers[id] ?? [])][0]]?.name ?? id),
      partyIds: [...(blocMembers[id] ?? [])],
      seats,
      isPlayerBloc: (blocMembers[id] ?? new Set()).has(game.playerPartyId),
    }))
    .sort((a, b) => b.seats - a.seats);
  const nationalStrength = (partyId: string) =>
    Object.values(strengthData.regions as Record<string, Record<string, number>>).reduce(
      (sum, region) => sum + (region[partyId] ?? 0),
      0,
    );
  const contested: Record<string, Set<string>> = {};
  for (const constituency of game.constituencies)
    for (const allocation of constituency.allocations)
      if (allocation.allianceName)
        (contested[allocation.allianceName] ??= new Set()).add(allocation.partyId);
  const conveners: Record<string, string> = {};
  const primeMinisters: Record<string, string> = {};
  for (const [id, members] of Object.entries(blocMembers)) {
    const name = partyBloc[[...members][0]]?.name ?? id;
    const founders = new Set([
      ...members,
      ...(id.startsWith("BLOC:") ? (contested[name] ?? []) : []),
    ]);
    const fixed =
      name === "NDA"
        ? "BJP"
        : name === "INDIA Alliance" || name === "INDIA"
          ? "INC"
          : name === "Left Front"
            ? "CPM"
            : "";
    const strongest = [...founders].sort(
      (a, b) => nationalStrength(b) - nationalStrength(a) || a.localeCompare(b),
    )[0];
    conveners[id] = fixed && founders.has(fixed) ? fixed : strongest;
    const present = [...members].sort(
      (a, b) => (partySeats[b] ?? 0) - (partySeats[a] ?? 0) || a.localeCompare(b),
    );
    primeMinisters[id] =
      (name === "NDA" || name === "INDIA Alliance" || name === "INDIA") && members.has(fixed)
        ? fixed
        : present[0];
  }
  if (game.alliance.type === "CUSTOM" && partyBloc[game.playerPartyId])
    conveners[partyBloc[game.playerPartyId].id] = game.playerPartyId;
  const playerPartySeats = partySeats[game.playerPartyId] ?? 0;
  const playerBloc = partyBloc[game.playerPartyId];
  const playerBlocData = blocs.find((b) => b.id === playerBloc?.id);
  const largestParty = partyRows[0] ?? { partyId: "", seats: 0 };
  const largestBloc = blocs[0] ?? { name: "", seats: 0 };
  const triggerNegotiations =
    !partyRows.some((p) => p.seats >= rules.majority) &&
    !blocs.some((b) => b.seats >= rules.majority);
  const scenario: NegotiationScenario = triggerNegotiations
    ? classifyPlayerScenario(game, playerBloc?.name)
    : "NO_NEGOTIATION_REQUIRED";
  return {
    scenario,
    triggerNegotiations,
    majorityMark: rules.majority,
    rules,
    partyRows,
    blocs,
    playerPartySeats,
    playerPartyId: game.playerPartyId,
    playerBlocName: playerBlocData?.name ?? game.playerPartyId,
    largestPartyId: largestParty.partyId,
    largestPartySeats: largestParty.seats,
    largestBlocName: largestBloc.name,
    largestBlocSeats: largestBloc.seats,
    conveners,
    primeMinisters,
  };
}

/**
 * How the player entered the election decides who starts the talks after a hung result:
 *  - a party that contested on its own does NOT go looking for partners; alliances and fronts approach it;
 *  - the convener of a national alliance or the leader of a custom front approaches other parties.
 * A solo player's group is named "Independent – <Party>" (BJP and INC keep "NDA" / "INDIA Alliance"), so the
 * player's alliance type is checked first rather than guessing from the group name.
 */
export function classifyPlayerScenario(
  game: Pick<NegotiationGameSource, "alliance" | "playerPartyId">,
  playerBlocName?: string,
): Exclude<NegotiationScenario, "NO_NEGOTIATION_REQUIRED"> {
  const soloGroup =
    playerBlocName === game.playerPartyId ||
    playerBlocName === "Independent" ||
    Boolean(playerBlocName?.startsWith("Independent –"));
  if (game.alliance.type === "INDEPENDENT" || game.alliance.name === "Independent" || soloGroup)
    return "PLAYER_INDEPENDENT";
  if (game.alliance.type === "CUSTOM") return "PLAYER_CUSTOM_FRONT_LEADER";
  if (game.alliance.type === "PREDEFINED") return "PLAYER_NATIONAL_ALLIANCE_CONVENER";
  return playerBlocName && !["NDA", "INDIA", "INDIA Alliance"].includes(playerBlocName)
    ? "PLAYER_CUSTOM_FRONT_LEADER"
    : "PLAYER_NATIONAL_ALLIANCE_CONVENER";
}

// Milestone 2: compatibility-gated, persisted negotiation rounds.
import partiesData from "@/data/parties.json";
import strengthData from "@/data/party-strength-by-region.json";
import { getPoliticalRelationship } from "@/engine/alliance-engine";
import { hashSeed, randomFor } from "@/engine/lok-sabha-voting-engine";
import type { PoliticalRelationship } from "@/types/alliance";
import { getPartyFootholdRegions, normalizeElectionRegion } from "@/engine/lok-sabha-game-engine";

export type NegotiationArrangement = "JOIN" | "OUTSIDE_SUPPORT";
export type NegotiationOfferStatus =
  | "OFFERED"
  | "COUNTERED"
  | "ACCEPTED"
  | "REJECTED"
  | "EXHAUSTED";
export interface NegotiationOffer {
  id: string;
  targetBlocId: string;
  targetName: string;
  targetPartyIds: string[];
  arrangement: NegotiationArrangement;
  round: number;
  status: NegotiationOfferStatus;
  terms: string;
  counterTerms?: string;
  responseNote?: string;
  /** True once the agreement has taken effect on the tally (so it is applied only once). */
  committed?: boolean;
  /**
   * Lok Sabha: the player asked this alliance for posts (or offered outside support), so the offer moves the
   * player's party, the way an offer an alliance sent the player does.
   */
  playerAsks?: boolean;
  /** Points the other side will concede at most (playerAsks offers). */
  ceilingPoints?: number;
  /** Points a party asked for when it approached the player (REQUEST- offers). */
  askedPoints?: number;
  /** Points a single party needed to join the player's bloc (Lok Sabha), fixed when the offer was made. */
  joinPrice?: number;
  /** A party with up to three seats: its seats, and whether its seats decide whether the bloc governs. */
  tiny?: { seats: number; pivotal: boolean };
  createdAt: string;
  updatedAt: string;
}
export interface NegotiationSave {
  schemaVersion: 1;
  gameId: string;
  /** Which kind of election the talks belong to (Lok Sabha when absent). */
  kind?: NegotiationElectionKind;
  day: number;
  offers: NegotiationOffer[];
  completed: boolean;
  winningBlocId?: string;
  /** Parties that formally joined a bloc (committed when the player advances the day). */
  partyAssignments?: Record<string, { id: string; name: string }>;
  /**
   * Names the player (or a merger) gave to coalitions, by bloc id. Shown instead of the name the
   * bloc started with.
   */
  blocNames?: Record<string, string>;
  /**
   * Parties backing a bloc from outside (committed when the player advances the day). Their seats
   * count toward that bloc's majority, but they hold no ministries and no longer count for the
   * bloc they came from.
   */
  outsideSupport?: Record<string, { blocId: string; blocName: string; offerId: string }>;
  majoritySnapshot?: {
    id: string;
    name: string;
    /** Members plus outside supporters. */
    seats: number;
    /** Formal members only: the parties that share ministries. */
    parties: Array<{ partyId: string; seats: number }>;
    memberSeats?: number;
    outsideSupporters?: NegotiationOutsideSupporter[];
    convenerPartyId?: string;
    primeMinisterPartyId?: string;
    /** True when no bloc reached 272 and the largest one was asked to govern anyway. */
    minority?: boolean;
  };
  /** How the talks ended; set once they are closed. */
  outcome?: NegotiationOutcome;
  /** Lok Sabha: the first parties have already approached the player as leader of a bloc. */
  requestsSeeded?: boolean;
  /** What the other blocs and parties did each day (the AI negotiates too), newest last. */
  events?: NegotiationEvent[];
  updatedAt: string;
}

export type NegotiationOutcomeKind =
  | "MAJORITY"
  | "FLOOR_TEST_MAJORITY"
  | "MINORITY_GOVERNMENT"
  | "HUNG_PARLIAMENT";

export type FloorVote = "FOR" | "AGAINST" | "ABSTAIN";

/** One vote of confidence on the floor of the House. */
export interface FloorTestRecord {
  blocId: string;
  blocName: string;
  /** The bloc's own seats, including its formal outside supporters. */
  blocSeats: number;
  forSeats: number;
  againstSeats: number;
  abstainSeats: number;
  passed: boolean;
  votes: Array<{ partyId: string; seats: number; vote: FloorVote }>;
}

export interface NegotiationOutcome {
  kind: NegotiationOutcomeKind;
  floorTests: FloorTestRecord[];
}

export type NegotiationEventKind = "APPROACH" | "JOIN" | "OUTSIDE" | "DECLINE" | "PLAYER" | "INFO";

export interface NegotiationEvent {
  day: number;
  text: string;
  /** Running number, assigned when the save is stored, so a page can tell which events are new. */
  seq?: number;
  kind?: NegotiationEventKind;
  /** The change this event makes to the tally, so a page can replay the day one step at a time. */
  move?: { partyId: string; blocId: string; blocName: string; arrangement: NegotiationArrangement };
}

export interface NegotiationOutsideSupporter {
  partyId: string;
  seats: number;
}
export interface NegotiationTallyBloc {
  id: string;
  name: string;
  /** Members plus outside supporters: the number that counts toward the 272-seat majority. */
  seats: number;
  memberSeats: number;
  outsideSupportSeats: number;
  /** Formal members of the bloc. */
  parties: Array<{ partyId: string; seats: number }>;
  outsideSupporters: NegotiationOutsideSupporter[];
  isPlayerBloc: boolean;
  /** True when the player's own party backs this bloc from outside. */
  playerSupports: boolean;
  /** Who coordinates the bloc's talks: its fixed convener, or the player once the player leads the bloc. */
  convenerPartyId: string;
  /** The party that would take the Prime Minister's post. */
  primeMinisterPartyId: string;
}

function negotiationKey(kind?: NegotiationElectionKind): string {
  return kind === "ASSEMBLY" ? ASSEMBLY_NEGOTIATION_SAVE_KEY : LOK_SABHA_NEGOTIATION_SAVE_KEY;
}

export function loadNegotiationSave(
  gameId: string,
  kind: NegotiationElectionKind = "LOK_SABHA",
): NegotiationSave {
  if (typeof window === "undefined") return emptyNegotiationSave(gameId, kind);
  try {
    const raw = window.localStorage.getItem(negotiationKey(kind));
    if (!raw) return emptyNegotiationSave(gameId, kind);
    const parsed = JSON.parse(raw) as Partial<NegotiationSave>;
    if (parsed.gameId !== gameId || !Array.isArray(parsed.offers))
      return emptyNegotiationSave(gameId, kind);
    return {
      schemaVersion: 1,
      gameId,
      ...(kind === "ASSEMBLY" ? { kind } : {}),
      day: Math.min(defaultRules(kind).totalDays, Math.max(1, parsed.day ?? 1)),
      offers: parsed.offers,
      completed: Boolean(parsed.completed),
      winningBlocId: parsed.winningBlocId,
      partyAssignments: parsed.partyAssignments ?? {},
      blocNames: parsed.blocNames ?? {},
      outsideSupport: parsed.outsideSupport ?? {},
      majoritySnapshot: parsed.majoritySnapshot,
      events: parsed.events ?? [],
      outcome: parsed.outcome,
      requestsSeeded: parsed.requestsSeeded,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return emptyNegotiationSave(gameId, kind);
  }
}
function emptyNegotiationSave(gameId: string, kind: NegotiationElectionKind = "LOK_SABHA"): NegotiationSave {
  return {
    schemaVersion: 1,
    gameId,
    ...(kind === "ASSEMBLY" ? { kind } : {}),
    day: 1,
    offers: [],
    completed: false,
    updatedAt: new Date().toISOString(),
  };
}
function persistNegotiationSave(save: NegotiationSave): NegotiationSave {
  let seq = Math.max(0, ...(save.events ?? []).map((event) => event.seq ?? 0));
  const events = (save.events ?? []).map((event) =>
    event.seq ? event : { ...event, seq: (seq += 1) },
  );
  const next = { ...save, events, updatedAt: new Date().toISOString() };
  if (typeof window !== "undefined")
    window.localStorage.setItem(negotiationKey(save.kind), JSON.stringify(next));
  return next;
}

/** A bloc is compatible only if every cross-bloc party pair is compatible. */
export function checkNegotiationCompatibility(
  playerPartyIds: string[],
  targetPartyIds: string[],
  rules: NegotiationRules = LOK_SABHA_RULES,
): { compatible: boolean; blockedPairs: string[] } {
  const blockedPairs: string[] = [];
  for (const a of playerPartyIds)
    for (const b of targetPartyIds) {
      const regionsA = getPartyFootholdRegions(a);
      const regionsB = getPartyFootholdRegions(b);
      const shared = regionsA.filter((region) =>
        regionsB.some(
          (other) => normalizeElectionRegion(other) === normalizeElectionRegion(region),
        ),
      );
      const contexts =
        rules.kind === "ASSEMBLY"
          ? [relationContext(rules)]
          : [
              relationContext(rules),
              ...shared.map((region) => ({
                electionType: "LOK_SABHA" as const,
                region,
                activateConditionalRules: true,
              })),
            ];
      const blocked = contexts.some((context) => {
        const relationship = getPoliticalRelationship(a, b, context);
        return (
          relationship.relationship === "STRONG_RIVAL" || relationship.relationship === "RIVAL"
        );
      });
      if (blocked) blockedPairs.push(`${a} ↔ ${b}`);
    }
  return { compatible: blockedPairs.length === 0, blockedPairs };
}

export function getCompatibleNegotiationBlocs(overview: NegotiationOverview): NegotiationBloc[] {
  const playerBloc = overview.blocs.find((bloc) => bloc.isPlayerBloc);
  if (!playerBloc) return [];
  return overview.blocs.filter(
    (bloc) =>
      !bloc.isPlayerBloc &&
      bloc.seats < overview.rules.majority &&
      checkNegotiationCompatibility(playerBloc.partyIds, bloc.partyIds, overview.rules).compatible,
  );
}

/**
 * Individual winning parties the player may negotiate with: parties outside the player's CURRENT
 * bloc that are compatible with every current member. Pass the negotiation save so the list follows
 * the bloc as parties join it. Outside supporters are not members and do not restrict the list.
 */
export function getCompatibleNegotiationPartyTargets(
  overview: NegotiationOverview,
  save?: NegotiationSave,
): NegotiationBloc[] {
  const playerBloc = getNegotiationBlocTally(overview, save).find((bloc) => bloc.isPlayerBloc);
  if (!playerBloc) return [];
  const memberIds = playerBloc.parties.map((party) => party.partyId);
  return overview.partyRows
    .filter((row) => !memberIds.includes(row.partyId))
    .filter((row) => checkNegotiationCompatibility(memberIds, [row.partyId], overview.rules).compatible)
    .map((row) => ({
      id: `PARTY:${row.partyId}`,
      name: row.partyId,
      partyIds: [row.partyId],
      seats: row.seats,
      isPlayerBloc: false,
    }));
}

/**
 * Alliances, fronts and coalitions the player may propose a merger to: every bloc of two or more parties
 * outside the player's current bloc whose members all get along with the player's members.
 */
export function getCompatibleNegotiationAllianceTargets(
  overview: NegotiationOverview,
  save?: NegotiationSave,
): NegotiationBloc[] {
  const tally = getNegotiationBlocTally(overview, save);
  const playerBloc = tally.find((bloc) => bloc.isPlayerBloc);
  if (!playerBloc) return [];
  const memberIds = playerBloc.parties.map((party) => party.partyId);
  return tally
    .filter(
      (bloc) =>
        !bloc.isPlayerBloc &&
        bloc.parties.length > 1 &&
        bloc.seats < overview.rules.majority &&
        checkNegotiationCompatibility(
          memberIds,
          bloc.parties.map((party) => party.partyId),
          overview.rules,
        ).compatible,
    )
    .map((bloc) => ({
      id: bloc.id,
      name: bloc.name,
      partyIds: bloc.parties.map((party) => party.partyId),
      seats: bloc.seats,
      isPlayerBloc: false,
      convenerPartyId: bloc.convenerPartyId,
    }));
}

/**
 * Live seat tally for every bloc: formal members plus outside supporters.
 * A party that backs another bloc from outside stops counting for its own bloc, so a seat never
 * counts toward two governments.
 */
export function getNegotiationBlocTally(
  overview: NegotiationOverview,
  save?: NegotiationSave,
): NegotiationTallyBloc[] {
  const assignments = save?.partyAssignments ?? {};
  const outsideSupport = save?.outsideSupport ?? {};
  const groups = new Map<
    string,
    Omit<NegotiationTallyBloc, "convenerPartyId" | "primeMinisterPartyId">
  >();
  const groupFor = (id: string, name: string) => {
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        name,
        seats: 0,
        memberSeats: 0,
        outsideSupportSeats: 0,
        parties: [],
        outsideSupporters: [],
        isPlayerBloc: false,
        playerSupports: false,
      };
      groups.set(id, group);
    }
    return group;
  };

  for (const row of overview.partyRows) {
    if (outsideSupport[row.partyId]) continue;
    const bloc = assignments[row.partyId] ?? { id: row.allianceId, name: row.allianceName };
    const group = groupFor(bloc.id, bloc.name);
    group.parties.push({ partyId: row.partyId, seats: row.seats });
    group.memberSeats += row.seats;
    if (row.partyId === overview.playerPartyId) group.isPlayerBloc = true;
  }
  for (const row of overview.partyRows) {
    const support = outsideSupport[row.partyId];
    if (!support) continue;
    const group = groupFor(support.blocId, support.blocName);
    group.outsideSupporters.push({ partyId: row.partyId, seats: row.seats });
    group.outsideSupportSeats += row.seats;
    if (row.partyId === overview.playerPartyId) group.playerSupports = true;
  }
  const rowOf = new Map(overview.partyRows.map((row) => [row.partyId, row]));
  const originId = rowOf.get(overview.playerPartyId)?.allianceId;
  const blocNames = save?.blocNames ?? {};
  return [...groups.values()]
    .map((group) => {
      const byName = (
        a: { partyId: string; seats: number },
        b: { partyId: string; seats: number },
      ) => b.seats - a.seats || a.partyId.localeCompare(b.partyId);
      // The player coordinates the talks of the bloc they lead (for an independent player, once they have joined one).
      const independent = overview.scenario === "PLAYER_INDEPENDENT";
      const playerLeads =
        group.isPlayerBloc && (independent ? group.parties.length > 1 : group.id === originId);
      // A coalition the independent player built from scratch gives its top post to the player's party.
      const playerBuilt = independent && group.isPlayerBloc && group.id === originId && group.parties.length > 1;
      const founders = group.parties.filter(
        (party) => rowOf.get(party.partyId)?.allianceId === group.id,
      );
      const planned = overview.primeMinisters[group.id];
      // In a state the Chief Minister's post goes to the largest member party, so a bigger party
      // joining a bloc takes it over from the bloc's original leader (a tie keeps the original
      // holder). The Union keeps its fixed rule: BJP for NDA, INC for INDIA, and no later joiner.
      const fallback =
        (founders.slice().sort(byName)[0] ?? group.parties.slice().sort(byName)[0])?.partyId ?? "";
      const holder = group.parties.some((party) => party.partyId === planned) ? planned : fallback;
      const topSeats = Math.max(0, ...group.parties.map((party) => party.seats));
      const holderSeats = group.parties.find((party) => party.partyId === holder)?.seats ?? 0;
      const primeMinisterPartyId = playerBuilt
        ? overview.playerPartyId
        : overview.rules.kind !== "ASSEMBLY" || holderSeats >= topSeats
        ? holder
        : (group.parties.slice().sort(byName)[0]?.partyId ?? holder);
      return {
        ...group,
        name: blocNames[group.id] ?? group.name,
        seats: group.memberSeats + group.outsideSupportSeats,
        convenerPartyId: playerLeads
          ? overview.playerPartyId
          : (overview.conveners[group.id] ?? group.parties.slice().sort(byName)[0]?.partyId ?? ""),
        primeMinisterPartyId,
      };
    })
    .sort((a, b) => b.seats - a.seats);
}

export function createNegotiationOffer(
  save: NegotiationSave,
  bloc: NegotiationBloc,
  arrangement: NegotiationArrangement,
  terms: string,
): NegotiationSave {
  if (save.completed) throw new Error("Negotiations are already closed.");
  if (save.day > rulesOf(save).totalDays) throw new Error("The negotiation deadline has expired.");
  const existing = save.offers.filter((offer) => offer.targetBlocId === bloc.id);
  if (existing.length >= NEGOTIATION_ROUNDS_PER_PARTY)
    throw new Error("This party/front has used all five negotiation chances.");
  if (!terms.trim()) throw new Error("Enter the proposed negotiation terms.");
  const now = new Date().toISOString();
  const offer: NegotiationOffer = {
    id: `${bloc.id}-${existing.length + 1}-${Date.now()}`,
    targetBlocId: bloc.id,
    targetName: bloc.name,
    targetPartyIds: [...bloc.partyIds],
    arrangement,
    round: existing.length + 1,
    status: "OFFERED",
    terms: terms.trim(),
    createdAt: now,
    updatedAt: now,
  };
  return persistNegotiationSave({ ...save, offers: [...save.offers, offer] });
}

/**
 * The player's answer to an open offer, plus the AI's reply to a counter-offer.
 *  - Offers the player sent: the party wants at least 10 points of ministries to join.
 *  - Offers a bloc sent the player (id "INCOMING-…"): the player asks for a bigger package and the bloc
 *    agrees up to a ceiling above what it first offered, otherwise it answers with that ceiling.
 * Outside support carries no ministries, so it can only be accepted or rejected.
 * Accepting one incoming proposal withdraws the others: a party can back only one government.
 */
export function respondToNegotiationOffer(
  save: NegotiationSave,
  offerId: string,
  action: "ACCEPT" | "REJECT" | "COUNTER",
  counterTerms = "",
): NegotiationSave {
  if (save.completed) throw new Error("Negotiations are already closed.");
  const index = save.offers.findIndex((offer) => offer.id === offerId);
  if (index < 0) throw new Error("Negotiation offer not found.");
  const offer = save.offers[index];
  if (offer.status === "ACCEPTED" || offer.status === "REJECTED" || offer.status === "EXHAUSTED")
    throw new Error("This negotiation is already closed.");
  const incoming = movesPlayer(offer);
  const request = isRequest(offer);
  const offers = [...save.offers];
  const now = new Date().toISOString();
  if (action === "ACCEPT") {
    offers[index] = {
      ...offer,
      terms: offer.counterTerms ?? offer.terms,
      status: "ACCEPTED",
      responseNote: offer.counterTerms
        ? "The player accepted the party’s counter-offer."
        : "Agreement accepted by the player.",
      updatedAt: now,
    };
    if (incoming) {
      offers.forEach((other, i) => {
        if (i !== index && movesPlayer(other) && (other.status === "OFFERED" || other.status === "COUNTERED")) {
          offers[i] = {
            ...other,
            status: "REJECTED",
            responseNote: `${other.targetName} withdrew its proposal after you accepted another one.`,
            updatedAt: now,
          };
        }
      });
    }
  } else if (action === "REJECT")
    offers[index] = {
      ...offer,
      status: "REJECTED",
      responseNote: "Offer rejected by the player.",
      updatedAt: now,
    };
  else {
    if (offer.arrangement === "OUTSIDE_SUPPORT")
      throw new Error(
        "Outside support carries no ministries, so there is nothing to counter. Accept or reject it.",
      );
    if (!counterTerms.trim()) throw new Error("Enter your counter-offer terms.");
    if (offer.round >= NEGOTIATION_ROUNDS_PER_PARTY)
      offers[index] = {
        ...offer,
        status: "EXHAUSTED",
        counterTerms: counterTerms.trim(),
        responseNote: "Maximum five negotiation chances reached; no further round is available.",
        updatedAt: now,
      };
    else if (request) {
      if (offer.tiny && !withinTinyLimit(counterTerms, offer.tiny)) {
        const limit = tinyPostLimits(offer.tiny.seats).max;
        throw new Error(
          `${offer.targetName} has ${offer.tiny.seats} seat${offer.tiny.seats === 1 ? "" : "s"}, so it can be offered at most ${limit} post${limit === 1 ? "" : "s"}${rulesOf(save).kind === "ASSEMBLY" ? " (Minister posts)" : offer.tiny.pivotal ? " (one of them a Big ministry)" : ", all Small ministries or lower"}, and not the ${rulesOf(save).deputyTitle} post.`,
        );
      }
      const asked = offer.askedPoints ?? portfolioPoints(offer.terms);
      const floor = Math.ceil(asked * 0.8);
      const given = portfolioPoints(counterTerms);
      if (given >= floor) {
        offers[index] = {
          ...offer,
          terms: counterTerms.trim(),
          counterTerms: undefined,
          status: "ACCEPTED",
          responseNote: `${offer.targetName} accepted your package and will join when the day advances.`,
          updatedAt: now,
        };
      } else {
        const next = Math.min(asked, Math.max(floor, Math.round((given + asked) / 2)));
        offers[index] = {
          ...offer,
          round: offer.round + 1,
          status: "COUNTERED",
          counterTerms: portfolioPackageText(
            buildPortfolioPackage(next, rulesOf(save).kind),
            false,
            rulesOf(save).deputyTitle,
            save.kind,
          ),
          responseNote: `${offer.targetName} wants more than that, but will settle for ${next} points.`,
          updatedAt: now,
        };
      }
    } else if (incoming) {
      const asked = askedPoints(counterTerms, rulesOf(save));
      const ceiling = incomingCeiling(offer, rulesOf(save));
      if (asked <= ceiling && (!offer.tiny || withinTinyLimit(counterTerms, offer.tiny))) {
        offers[index] = {
          ...offer,
          terms: counterTerms.trim(),
          counterTerms: undefined,
          status: "ACCEPTED",
          responseNote: `${offer.targetName} agreed to your requested portfolio package.`,
          updatedAt: now,
        };
        offers.forEach((other, i) => {
          if (i !== index && movesPlayer(other) && (other.status === "OFFERED" || other.status === "COUNTERED")) {
            offers[i] = {
              ...other,
              status: "REJECTED",
              responseNote: `${other.targetName} withdrew its proposal after you accepted another one.`,
              updatedAt: now,
            };
          }
        });
      } else {
        offers[index] = {
          ...offer,
          round: offer.round + 1,
          status: "COUNTERED",
          counterTerms: portfolioPackageText(
            offer.tiny ? tinyBestPackage(offer.tiny.seats, offer.tiny.pivotal, rulesOf(save).kind) : buildPortfolioPackage(ceiling, save.kind),
            false,
            rulesOf(save).deputyTitle,
            save.kind,
          ),
          responseNote: `${offer.targetName} cannot meet that demand, but can improve its offer to ${ceiling} points.`,
          updatedAt: now,
        };
      }
    } else {
      const offeredPoints = portfolioPoints(counterTerms);
      const price = offer.joinPrice ?? joinAcceptancePoints(rulesOf(save));
      if (offeredPoints >= price) {
        offers[index] = {
          ...offer,
          terms: counterTerms.trim(),
          counterTerms: undefined,
          status: "ACCEPTED",
          responseNote: "The party accepted your revised portfolio package.",
          updatedAt: now,
        };
      } else {
        offers[index] = {
          ...offer,
          round: offer.round + 1,
          status: "COUNTERED",
          counterTerms: portfolioPackageText(
            price < joinAcceptancePoints(rulesOf(save)) ? buildPortfolioPackage(price, save.kind) : aiCounterPackage(save.kind),
            false,
            rulesOf(save).deputyTitle,
            save.kind,
          ),
          responseNote:
            "The party reviewed your revised package and has made another counter-offer.",
          updatedAt: now,
        };
      }
    }
  }
  const what = offer.arrangement === "JOIN" ? "offer to join" : "request for outside support";
  const after = offers[index];
  const events: NegotiationEvent[] = [...(save.events ?? [])];
  const say = (text: string, kind: NegotiationEventKind = "PLAYER") =>
    events.push({ day: save.day, kind, text });
  if (action === "ACCEPT")
    say(`You accepted ${offer.targetName}'s ${what}. It takes effect when the day advances.`);
  else if (action === "REJECT") say(`You rejected ${offer.targetName}'s ${what}.`);
  else if (after.status === "ACCEPTED")
    say(
      `You countered ${offer.targetName}, and it agreed to your package. It takes effect when the day advances.`,
    );
  else say(`You countered ${offer.targetName}: ${after.responseNote ?? "a new round of talks"}`);
  offers.forEach((other, i) => {
    if (i !== index && other.status === "REJECTED" && save.offers[i].status !== "REJECTED")
      say(`${other.targetName} withdrew its proposal after you accepted another one.`, "DECLINE");
  });
  return persistNegotiationSave({ ...save, offers, events: events.slice(-EVENT_LOG_LIMIT) });
}

/** The bloc a party currently belongs to, taking committed JOIN agreements into account. */
function currentBlocOf(
  overview: NegotiationOverview,
  assignments: NonNullable<NegotiationSave["partyAssignments"]>,
  partyId: string,
) {
  const assigned = assignments[partyId];
  if (assigned) return assigned;
  const row = overview.partyRows.find((item) => item.partyId === partyId);
  return row ? { id: row.allianceId, name: row.allianceName } : null;
}

/** NDA and INDIA keep their names (and their leadership) whenever another coalition joins them. */
function isFlagshipBloc(name: string): boolean {
  return name === "NDA" || name === "INDIA" || name === "INDIA Alliance";
}
const RESERVED_COALITION_NAMES = ["nda", "india", "india alliance"];

/** The name an independent player's coalition carries until the player names it. */
export function defaultCoalitionName(playerPartyId: string): string {
  return `${playerPartyId} Front`;
}

/**
 * Applies every accepted agreement to the seat tally, once each. JOIN means formal membership, OUTSIDE_SUPPORT
 * means the seats count toward the bloc's majority without membership or ministries.
 *  - A proposal to a single party brings that party into the player's current bloc.
 *  - A proposal to (or an offer from) a whole alliance, front or coalition merges the two blocs. The merged
 *    coalition keeps the name of the one with more seats, except that NDA and INDIA always keep theirs; with
 *    equal seats the player's coalition keeps its name. A party standing alone is not a coalition: it joins
 *    the other bloc. Whoever leads the surviving bloc leads the merged one.
 *  - Outside support never renames or merges anything: the supporters just back the bloc.
 */
function commitAcceptedAgreements(save: NegotiationSave, overview: NegotiationOverview) {
  const assignments = { ...(save.partyAssignments ?? {}) };
  const outsideSupport = { ...(save.outsideSupport ?? {}) };
  const blocNames = { ...(save.blocNames ?? {}) };
  const me = overview.playerPartyId;
  const rows = overview.partyRows;
  const originId = rows.find((row) => row.partyId === me)?.allianceId;
  const independent = overview.scenario === "PLAYER_INDEPENDENT";
  const blocOfRow = (row: (typeof rows)[number]) => assignments[row.partyId]?.id ?? row.allianceId;
  const membersOf = (id: string) =>
    rows.filter((row) => !outsideSupport[row.partyId] && blocOfRow(row) === id);
  const nameOfBloc = (id: string) => {
    if (blocNames[id]) return blocNames[id];
    const first = membersOf(id)[0];
    return first ? (assignments[first.partyId]?.name ?? first.allianceName) : id;
  };

  const applied = new Set<string>();
  for (const offer of save.offers) {
    if (offer.status !== "ACCEPTED" || offer.committed) continue;
    applied.add(offer.id);
    // An offer a bloc sent the player moves the player (and the coalition they lead) to that bloc. A
    // proposal the player sent brings the target into the player's current bloc.
    const incoming = movesPlayer(offer);
    const mine = currentBlocOf(overview, assignments, me);
    if (!mine) continue;

    if (offer.arrangement === "OUTSIDE_SUPPORT") {
      const movers = incoming ? [me] : offer.targetPartyIds;
      const destination = incoming
        ? currentBlocOf(overview, assignments, offer.targetPartyIds[0] ?? "")
        : mine;
      if (!destination) continue;
      const named = { id: destination.id, name: nameOfBloc(destination.id) };
      for (const partyId of movers)
        if (partyId && !assignments[partyId] && !outsideSupport[partyId])
          outsideSupport[partyId] = {
            blocId: named.id,
            blocName: named.name,
            offerId: offer.id,
          };
      continue;
    }

    // The player's coalition gets its default name the moment it stops being a single party.
    const nameMine = () => {
      if (independent && mine.id === originId && !blocNames[mine.id])
        blocNames[mine.id] = defaultCoalitionName(me);
      return nameOfBloc(mine.id);
    };

    // JOIN with one party: it comes over to the player's bloc.
    if (!incoming && offer.targetBlocId.startsWith("PARTY:")) {
      const movers = offer.targetPartyIds.filter((partyId) => partyId && !assignments[partyId]);
      if (!movers.length) continue;
      const named = { id: mine.id, name: nameMine() };
      for (const partyId of movers) {
        assignments[partyId] = named;
        delete outsideSupport[partyId]; // full membership supersedes outside support
      }
      continue;
    }

    // JOIN with a whole bloc: the two merge.
    const other = incoming
      ? currentBlocOf(overview, assignments, offer.targetPartyIds[0] ?? "")
      : { id: offer.targetBlocId, name: offer.targetName };
    if (!other || other.id === mine.id) continue;
    const mineIds = membersOf(mine.id);
    const otherIds = membersOf(other.id);
    if (!otherIds.length) continue;
    const mineBloc = { id: mine.id, name: nameOfBloc(mine.id) };
    const otherBloc = { id: other.id, name: nameOfBloc(other.id) };
    const sum = (list: typeof rows) => list.reduce((n, row) => n + row.seats, 0);
    let keepMine: boolean;
    if (isFlagshipBloc(mineBloc.name)) keepMine = true;
    else if (isFlagshipBloc(otherBloc.name)) keepMine = false;
    else if (mineIds.length === 1) keepMine = !incoming && otherIds.length === 1;
    else if (otherIds.length === 1) keepMine = true;
    else keepMine = sum(mineIds) >= sum(otherIds); // a tie goes to the player's coalition
    if (keepMine) mineBloc.name = nameMine();
    const winner = keepMine ? mineBloc : otherBloc;
    const loser = keepMine ? otherBloc : mineBloc;
    for (const row of membersOf(loser.id)) {
      assignments[row.partyId] = { id: winner.id, name: winner.name };
      delete outsideSupport[row.partyId];
    }
    // Parties backing the absorbed bloc from outside now back the merged one.
    for (const [partyId, support] of Object.entries(outsideSupport))
      if (support.blocId === loser.id)
        outsideSupport[partyId] = { ...support, blocId: winner.id, blocName: winner.name };
  }
  const committedOffers = save.offers.map((offer) =>
    applied.has(offer.id) ? { ...offer, committed: true } : offer,
  );
  return { assignments, outsideSupport, blocNames, offers: committedOffers };
}

export interface PartyPosition {
  partyId: string;
  seats: number;
  /** The alliance, front or party it sits in; "Independent" for a party standing alone. */
  group: string;
  status: "MEMBER" | "OUTSIDE_SUPPORT" | "INDEPENDENT";
  /** For outside support, the bloc it backs. */
  backs?: string;
}

/** Where every party stands right now, for the party-wise tally. */
export function getPartyPositions(
  overview: NegotiationOverview,
  save?: NegotiationSave,
): PartyPosition[] {
  const tally = getNegotiationBlocTally(overview, save);
  const positions: PartyPosition[] = [];
  for (const bloc of tally) {
    const solo = bloc.parties.length === 1 && !["BJP", "INC"].includes(bloc.parties[0].partyId);
    for (const party of bloc.parties)
      positions.push({
        partyId: party.partyId,
        seats: party.seats,
        group: solo ? "Independent" : bloc.name,
        status: solo ? "INDEPENDENT" : "MEMBER",
      });
    for (const party of bloc.outsideSupporters)
      positions.push({
        partyId: party.partyId,
        seats: party.seats,
        group: "Independent",
        status: "OUTSIDE_SUPPORT",
        backs: bloc.name,
      });
  }
  return positions.sort((a, b) => b.seats - a.seats || a.partyId.localeCompare(b.partyId));
}

/** A bloc this size, or one of the three largest, actively recruits partners. */
const RECRUITER_MIN_SEATS = 60;
const EVENT_LOG_LIMIT = 200;

function snapshotOf(
  bloc: NegotiationTallyBloc,
  minority: boolean,
): NonNullable<NegotiationSave["majoritySnapshot"]> {
  return {
    id: bloc.id,
    name: bloc.name,
    seats: bloc.seats,
    parties: bloc.parties,
    memberSeats: bloc.memberSeats,
    outsideSupporters: bloc.outsideSupporters,
    convenerPartyId: bloc.convenerPartyId,
    primeMinisterPartyId: bloc.primeMinisterPartyId,
    ...(minority ? { minority: true } : {}),
  };
}

/**
 * One day of talks among the blocs themselves. Every bloc that is not led by the player (and every
 * party still standing alone, except the player's) takes part:
 *  - each recruiting bloc (60+ seats, or one of the three largest) approaches the most valuable
 *    unattached party that it would welcome (on about two days in three);
 *  - a party weighs every approach it received like any other offer (relationship, how close the bloc is
 *    to 272, the deadline, a seeded variation) and takes the best one it likes;
 *  - warm and decisive: it joins the bloc and shares ministries; otherwise it backs the bloc from
 *    outside; otherwise it turns the approach down and may be asked again tomorrow.
 * Parties already inside an alliance or front stay with it.
 */
function runAiNegotiationDay(
  overview: NegotiationOverview,
  save: NegotiationSave,
): NegotiationSave {
  const tally = getNegotiationBlocTally(overview, save);
  const player = overview.playerPartyId;
  // The player's bloc is the player's to run: they negotiate for it, or, standing alone, for no one.
  const led = (bloc: NegotiationTallyBloc) => bloc.isPlayerBloc;
  const recruiters = tally.filter(
    (bloc, index) =>
      !led(bloc) &&
      bloc.seats < overview.rules.majority &&
      (bloc.seats >= scaledSeats(RECRUITER_MIN_SEATS, overview) || index < 3),
  );
  // Whom the recruiters can approach:
  //  - parties standing alone, whatever the group is called ("Independent – NTK", a one-party front);
  //  - members of other alliances and fronts, except a bloc's largest party (it is the bloc), a bloc led
  //    by the player, and the player's own party. These can only be won over by a much warmer view.
  // BJP and INC convene NDA and INDIA and never leave them. The convener and prime-minister party of
  // any alliance or front are the heart of it and stay too; a party standing alone has no one to stay with.
  const nuclei = new Set([
    "BJP",
    "INC",
    ...tally
      .filter((bloc) => bloc.parties.length > 1)
      .flatMap((bloc) => [bloc.convenerPartyId, bloc.primeMinisterPartyId]),
  ]);
  const groupIdOf = new Map<string, string>();
  const groupNameOf = new Map<string, string>();
  const soloPartyOfGroup = new Map<string, string>();
  const loose: Array<{ partyId: string; seats: number; defects: boolean }> = [];
  for (const bloc of tally) {
    for (const party of bloc.parties) {
      groupIdOf.set(party.partyId, bloc.id);
      groupNameOf.set(party.partyId, bloc.name);
    }
    const solo = bloc.parties.length === 1 && bloc.outsideSupporters.length === 0;
    if (bloc.parties.length === 1) soloPartyOfGroup.set(bloc.id, bloc.parties[0].partyId);
    if (led(bloc)) continue;
    const biggest = bloc.parties.slice().sort((a, b) => b.seats - a.seats)[0];
    for (const party of bloc.parties) {
      if (party.partyId === player) continue;
      if (solo) {
        if (!nuclei.has(party.partyId)) loose.push({ ...party, defects: false });
      } else if (party.partyId !== biggest.partyId && !nuclei.has(party.partyId)) {
        loose.push({ ...party, defects: true });
      }
    }
  }

  interface Proposal {
    recruiter: NegotiationTallyBloc;
    score: number;
    relation: number;
  }
  const proposals = new Map<string, Proposal[]>();
  for (const recruiter of recruiters) {
    // Talks take time: a bloc makes its approach on about two days in three.
    if (randomFor(hashSeed(`${save.gameId}:active:${recruiter.id}:${save.day}`))() >= 0.65)
      continue;
    const ranked = loose
      .filter(
        (party) =>
          groupIdOf.get(party.partyId) !== recruiter.id &&
          blocWelcomes(party.partyId, recruiter.parties, recruiter.convenerPartyId).ok,
      )
      .map((party) => {
        const detail = scoreSupport(overview, save, party.partyId, recruiter.id, tally);
        // Each party has its own lasting leanings toward each bloc, fixed for the game.
        const affinity =
          (randomFor(hashSeed(`${save.gameId}:affinity:${party.partyId}:${recruiter.id}`))() -
            0.5) *
          0.4;
        // Walking out on an alliance is harder than leaving no alliance at all.
        const defection = party.defects ? -0.25 : 0;
        return {
          party,
          detail: detail && { ...detail, score: detail.score + affinity + defection },
        };
      })
      .filter((item): item is { party: (typeof loose)[number]; detail: SupportScore } =>
        Boolean(item.detail),
      )
      .sort((a, b) => b.party.seats - a.party.seats || b.detail.score - a.detail.score);
    // A bloc goes for the most valuable party that is plausibly willing; approaching someone who is
    // sure to refuse, day after day, would stall every other deal. With nobody plausible it only
    // occasionally tries the most promising long shot.
    const plausible = ranked.filter((item) => item.detail.score >= SUPPORT_ACCEPT_SCORE - 0.1);
    const longShot = ranked
      .slice()
      .sort((a, b) => b.detail.score - a.detail.score)
      .slice(0, 1)
      .filter(
        () => randomFor(hashSeed(`${save.gameId}:longshot:${recruiter.id}:${save.day}`))() < 0.25,
      );
    const chosen = plausible.length ? plausible.slice(0, 1) : longShot;
    for (const { party, detail } of chosen) {
      const list = proposals.get(party.partyId) ?? [];
      list.push({ recruiter, score: detail.score, relation: detail.relation });
      proposals.set(party.partyId, list);
    }
  }

  const assignments = { ...(save.partyAssignments ?? {}) };
  const outsideSupport = { ...(save.outsideSupport ?? {}) };
  const events = [...(save.events ?? [])];
  // Everyone sees who approached whom before the answers come in.
  for (const [partyId, list] of proposals)
    for (const proposal of list)
      events.push({
        day: save.day,
        kind: "APPROACH",
        text: `${proposal.recruiter.name} approached ${partyLabel(partyId)} for its support.`,
      });
  const moved = new Set<string>();
  const recruitedLeaders = new Set<string>();
  const order = [...proposals.entries()].sort(
    (a, b) =>
      Math.max(...b[1].map((p) => p.recruiter.seats)) -
      Math.max(...a[1].map((p) => p.recruiter.seats)),
  );
  for (const [partyId, list] of order) {
    const best = list.slice().sort((a, b) => b.score - a.score)[0];
    const label = partyLabel(partyId);
    // A party that recruits for its own group cannot be taken while others are joining that group today.
    const leaderBlocId = groupIdOf.get(partyId) ?? `PARTY:${partyId}`;
    const ownGroupBusy = [...moved].some(
      (id) => assignments[id]?.id === leaderBlocId || outsideSupport[id]?.blocId === leaderBlocId,
    );
    // A one-party recruiter that has itself just been taken can no longer recruit.
    const recruiterGone = [...moved].some((id) => soloPartyOfGroup.get(best.recruiter.id) === id);
    const from = groupNameOf.get(partyId);
    const leaving =
      (loose.find((item) => item.partyId === partyId)?.defects ?? false) && from
        ? `left ${from} and `
        : "";
    if (ownGroupBusy || recruiterGone || recruitedLeaders.has(best.recruiter.id)) continue;
    if (best.score < SUPPORT_ACCEPT_SCORE) {
      events.push({
        day: save.day,
        kind: "DECLINE",
        text: `${label} turned down ${best.recruiter.name}'s approach for now.`,
      });
      continue;
    }
    moved.add(partyId);
    recruitedLeaders.add(leaderBlocId);
    if (best.relation >= 0.15 && best.score >= 0.75) {
      assignments[partyId] = { id: best.recruiter.id, name: best.recruiter.name };
      events.push({
        day: save.day,
        kind: "JOIN",
        text: `${label} ${leaving}joined ${best.recruiter.name} and will share ministries.`,
        move: {
          partyId,
          blocId: best.recruiter.id,
          blocName: best.recruiter.name,
          arrangement: "JOIN",
        },
      });
    } else {
      outsideSupport[partyId] = {
        blocId: best.recruiter.id,
        blocName: best.recruiter.name,
        offerId: `AI-DAY${save.day}`,
      };
      events.push({
        day: save.day,
        kind: "OUTSIDE",
        text: `${label} ${leaving}will back ${best.recruiter.name} from outside, without joining the government.`,
        move: {
          partyId,
          blocId: best.recruiter.id,
          blocName: best.recruiter.name,
          arrangement: "OUTSIDE_SUPPORT",
        },
      });
    }
  }
  return {
    ...save,
    partyAssignments: assignments,
    outsideSupport,
    events: events.slice(-EVENT_LOG_LIMIT),
  };
}

/** Share of the seats a party must be lukewarm about before it abstains instead of voting. */
const FLOOR_SUPPORT_SCORE = 0.12;
/** A party tied to a rival alliance needs a much warmer view of the candidate to cross over. */
const FLOOR_CROSSOVER_SCORE = 0.3;

/**
 * A vote of confidence on the floor of the House for `candidate`. The bloc's own members and formal
 * outside supporters vote for it. Every other party votes by how it sees the bloc's members, seat
 * weighted, with a seeded personal leaning: warm parties vote for, hostile ones against, and the rest
 * abstain. Members of a rival alliance (60+ seats) need to be much warmer to cross over. The bloc wins when
 * the votes for outnumber the votes against, so abstentions can carry a minority government through.
 */
export function runFloorTest(
  overview: NegotiationOverview,
  save: NegotiationSave,
  candidate: NegotiationTallyBloc,
  tally = getNegotiationBlocTally(overview, save),
): FloorTestRecord {
  const supporting = new Set([
    ...candidate.parties.map((party) => party.partyId),
    ...candidate.outsideSupporters.map((party) => party.partyId),
  ]);
  const groupOf = (partyId: string) =>
    tally.find(
      (bloc) =>
        bloc.parties.some((party) => party.partyId === partyId) ||
        bloc.outsideSupporters.some((party) => party.partyId === partyId),
    );
  const weight = candidate.parties.reduce((sum, member) => sum + member.seats, 0) || 1;
  const votes: FloorTestRecord["votes"] = [];
  for (const row of overview.partyRows) {
    if (supporting.has(row.partyId)) continue;
    const relation =
      candidate.parties.reduce((sum, member) => {
        const resolved = getPoliticalRelationship(
          row.partyId,
          member.partyId,
          relationContext(overview.rules),
        );
        return sum + member.seats * RELATION_SCORE[resolved.relationship];
      }, 0) / weight;
    const leaning =
      (randomFor(hashSeed(`${save.gameId}:floor:${row.partyId}:${candidate.id}`))() - 0.5) * 0.3;
    const score = relation + leaning;
    const group = groupOf(row.partyId);
    const inRivalAlliance = Boolean(
      group &&
        group.id !== candidate.id &&
        group.parties.length > 1 &&
        group.seats >= scaledSeats(60, overview),
    );
    const vote: FloorVote = inRivalAlliance
      ? score >= FLOOR_CROSSOVER_SCORE
        ? "FOR"
        : score <= 0.05
          ? "AGAINST"
          : "ABSTAIN"
      : score >= FLOOR_SUPPORT_SCORE
        ? "FOR"
        : score <= -FLOOR_SUPPORT_SCORE
          ? "AGAINST"
          : "ABSTAIN";
    votes.push({ partyId: row.partyId, seats: row.seats, vote });
  }
  const sum = (kind: FloorVote) =>
    votes.filter((item) => item.vote === kind).reduce((n, item) => n + item.seats, 0);
  const forSeats = candidate.seats + sum("FOR");
  const againstSeats = sum("AGAINST");
  return {
    blocId: candidate.id,
    blocName: candidate.name,
    blocSeats: candidate.seats,
    forSeats,
    againstSeats,
    abstainSeats: sum("ABSTAIN"),
    passed: forSeats > againstSeats,
    votes,
  };
}

/**
 * What happens when the 14 days and the extension week end without a bloc at 272 seats. The largest
 * bloc is invited to form the government and must win a floor test; if it fails, the second largest
 * (with at least 80 seats) is invited. The result is one of:
 *  - FLOOR_TEST_MAJORITY: the vote carried with 272+ votes for it, so it has a working majority;
 *  - MINORITY_GOVERNMENT: it carried on abstentions with fewer than 272 votes for it;
 *  - HUNG_PARLIAMENT: no invited bloc could win, so there is no government and fresh elections follow.
 * Also repairs saves that were closed by the old deadline without a government.
 */
export function resolveNegotiationDeadline(
  save: NegotiationSave,
  overview: NegotiationOverview,
): NegotiationSave {
  if (save.majoritySnapshot || save.outcome) return save;
  const tally = getNegotiationBlocTally(overview, save);
  const invited = tally
    .filter((bloc, index) => index === 0 || bloc.seats >= scaledSeats(80, overview))
    .slice(0, 2);
  const floorTests: FloorTestRecord[] = [];
  const events = [...(save.events ?? [])];
  const day = Math.min(save.day, overview.rules.totalDays);
  let winner: { bloc: NegotiationTallyBloc; record: FloorTestRecord } | null = null;
  for (const bloc of invited) {
    const record = runFloorTest(overview, save, bloc, tally);
    floorTests.push(record);
    events.push({
      day,
      text: `Floor test for ${bloc.name}: ${record.forSeats} for, ${record.againstSeats} against, ${record.abstainSeats} abstaining. ${record.passed ? "It carried." : "It failed."}`,
    });
    if (record.passed) {
      winner = { bloc, record };
      break;
    }
  }
  if (!winner) {
    events.push({ day, text: "No bloc could win a floor test. The result is a hung parliament." });
    return persistNegotiationSave({
      ...save,
      completed: true,
      outcome: { kind: "HUNG_PARLIAMENT", floorTests },
      events: events.slice(-EVENT_LOG_LIMIT),
    });
  }
  const { bloc, record } = winner;
  const formalMajority = record.forSeats >= overview.rules.majority;
  const backers = record.votes.filter((item) => item.vote === "FOR");
  const snapshot = formalMajority
    ? {
        ...snapshotOf(bloc, false),
        seats: record.forSeats,
        outsideSupporters: [
          ...bloc.outsideSupporters,
          ...backers.map((item) => ({ partyId: item.partyId, seats: item.seats })),
        ],
      }
    : snapshotOf(bloc, true);
  events.push({
    day,
    text: formalMajority
      ? `${bloc.name} won the floor test with ${record.forSeats} votes and forms the government.`
      : `${bloc.name} survived the floor test on abstentions and forms a minority government.`,
  });
  return persistNegotiationSave({
    ...save,
    completed: true,
    winningBlocId: bloc.id,
    majoritySnapshot: snapshot,
    outcome: { kind: formalMajority ? "FLOOR_TEST_MAJORITY" : "MINORITY_GOVERNMENT", floorTests },
    events: events.slice(-EVENT_LOG_LIMIT),
  });
}

/**
 * Ends the day. In order: the player's accepted agreements take effect, the other blocs and parties
 * negotiate among themselves (unless `ai: false`), and each bloc is checked against 272. If nobody has
 * 272 by day 14, talks continue for a 7-day extension week; advancing from day 21 closes them and
 * resolveNegotiationDeadline decides between a floor-test government, a minority government and a hung
 * parliament.
 */
export function advanceNegotiationDay(
  save: NegotiationSave,
  overview?: NegotiationOverview,
  options: { ai?: boolean } = {},
): NegotiationSave {
  if (save.completed) return save;
  // Accepted agreements only take effect on the tally when the player advances to the next day.
  const committed = overview
    ? commitAcceptedAgreements(save, overview)
    : {
        assignments: save.partyAssignments ?? {},
        outsideSupport: save.outsideSupport ?? {},
        blocNames: save.blocNames ?? {},
        offers: save.offers,
      };
  const rules = rulesOf(save, overview);
  const finalDay = save.day >= rules.totalDays;
  const nextDay = finalDay ? rules.totalDays : save.day + 1;
  // Agreements the player made take effect first, each one a step the page can replay.
  const takeEffect: NegotiationEvent[] = [];
  if (overview) {
    const me = overview.playerPartyId;
    for (const [partyId, to] of Object.entries(committed.assignments))
      if (save.partyAssignments?.[partyId]?.id !== to.id)
        takeEffect.push({
          day: save.day,
          kind: partyId === me ? "PLAYER" : "JOIN",
          text:
            partyId === me
              ? `Your agreement took effect: your party joined ${to.name}.`
              : `${partyLabel(partyId)} joined ${to.name} under your agreement.`,
          move: { partyId, blocId: to.id, blocName: to.name, arrangement: "JOIN" },
        });
    for (const [partyId, to] of Object.entries(committed.outsideSupport))
      if (!save.outsideSupport?.[partyId])
        takeEffect.push({
          day: save.day,
          kind: partyId === me ? "PLAYER" : "OUTSIDE",
          text:
            partyId === me
              ? `Your agreement took effect: your party now backs ${to.blocName} from outside.`
              : `${partyLabel(partyId)} now backs ${to.blocName} from outside under your agreement.`,
          move: {
            partyId,
            blocId: to.blocId,
            blocName: to.blocName,
            arrangement: "OUTSIDE_SUPPORT",
          },
        });
  }
  let next: NegotiationSave = {
    ...save,
    day: save.day,
    partyAssignments: committed.assignments,
    outsideSupport: committed.outsideSupport,
    blocNames: committed.blocNames,
    offers: committed.offers,
    events: [...(save.events ?? []), ...takeEffect],
  };
  if (!overview)
    return persistNegotiationSave({ ...next, day: nextDay, completed: finalDay || next.completed });

  const findMajority = (candidate: NegotiationSave) =>
    getNegotiationBlocTally(overview, candidate).find((bloc) => bloc.seats >= rules.majority);
  if (!findMajority(next) && options.ai !== false) next = runAiNegotiationDay(overview, next);
  const majority = findMajority(next);
  next = { ...next, day: nextDay };
  if (majority) {
    return persistNegotiationSave({
      ...next,
      completed: true,
      winningBlocId: majority.id,
      majoritySnapshot: snapshotOf(majority, false),
      outcome: { kind: "MAJORITY", floorTests: [] },
      events: [
        ...(next.events ?? []),
        {
          day: save.day,
          text: `${majority.name} reached ${majority.seats} seats and will form the government.`,
        },
      ].slice(-EVENT_LOG_LIMIT),
    });
  }
  if (finalDay)
    return resolveNegotiationDeadline({ ...next, day: rules.totalDays }, overview);
  if (save.day === rules.days)
    next = {
      ...next,
      events: [
        ...(next.events ?? []),
        {
          day: save.day,
          text: `The ${rules.days} days are over and no bloc has ${rules.majority} seats. The talks are extended by ${rules.extensionDays} days.`,
        },
      ].slice(-EVENT_LOG_LIMIT),
    };
  return persistNegotiationSave(createPartyRequests(refreshIncomingOffers(next, overview), overview));
}

/**
 * When one bloc already has 272 seats there are no talks, but the cabinet stage still needs to know who
 * governs. This records that bloc as the majority (once) so the cabinet can be formed from it.
 */
export function recordMajorityWithoutNegotiation(
  gameId: string,
  overview: NegotiationOverview,
): NegotiationSave | null {
  const existing = loadNegotiationSave(gameId, overview.rules.kind);
  if (existing.majoritySnapshot) return existing;
  const bloc = overview.blocs.find((item) => item.seats >= overview.rules.majority);
  if (!bloc) return null;
  const tallyBloc = getNegotiationBlocTally(overview).find((item) => item.id === bloc.id);
  const seatsByParty = new Map(overview.partyRows.map((row) => [row.partyId, row.seats]));
  const parties = bloc.partyIds
    .map((partyId) => ({ partyId, seats: seatsByParty.get(partyId) ?? 0 }))
    .filter((party) => party.seats > 0);
  return persistNegotiationSave({
    ...existing,
    completed: true,
    winningBlocId: bloc.id,
    outcome: { kind: "MAJORITY", floorTests: [] },
    majoritySnapshot: {
      id: bloc.id,
      name: bloc.name,
      seats: bloc.seats,
      parties,
      memberSeats: bloc.seats,
      outsideSupporters: [],
      convenerPartyId: tallyBloc?.convenerPartyId,
      primeMinisterPartyId: tallyBloc?.primeMinisterPartyId,
    },
  });
}

// ---------------------------------------------------------------------------
// Offer packages and AI decisions
// ---------------------------------------------------------------------------

export interface PortfolioPackage {
  key: number;
  big: number;
  small: number;
  /** Union cabinet only: MoS (Independent Charge). Always 0 for a state cabinet. */
  independent: number;
  /** Union cabinet only: Regular MoS. Always 0 for a state cabinet. */
  regular: number;
}
/**
 * Points of ministries a party wants in return for formally joining a bloc. The figures are written
 * for a cabinet of 84 points and scaled to the cabinet actually being shared (the Union cabinet is
 * now 236 points), so TOTAL_PORTFOLIO_POINTS stays 84 as the scaling base.
 */
export const JOIN_ACCEPTANCE_POINTS = 10;
export const TOTAL_PORTFOLIO_POINTS = 84;
/** Points a party wants to join, scaled to the size of the cabinet being shared. */
export function joinAcceptancePoints(rules: NegotiationRules): number {
  return Math.max(3, Math.round((JOIN_ACCEPTANCE_POINTS * rules.portfolioPoints) / TOTAL_PORTFOLIO_POINTS));
}
/** What the Deputy PM / Deputy CM post is worth, in cabinet points. */
export function deputyPostPoints(rules: NegotiationRules): number {
  if (rules.kind === "LOK_SABHA") return DEPUTY_PM_POINTS;
  // A state's Deputy Chief Minister is worth two Ministers.
  return DEPUTY_CM_POINTS;
}

/** Parties with up to this many seats are priced and limited by their seats, not by cabinet points. */
export const TINY_PARTY_SEATS = 5;
/** Posts a tiny party is assured (about a third of its seats) and the most it may hold (half), at least one. */
export function tinyPostLimits(seats: number): { assured: number; max: number } {
  return { assured: Math.max(1, Math.round(seats * 0.33)), max: Math.max(1, Math.floor(seats * 0.5)) };
}
/** True when the bloc is short of a majority and this party's seats alone take it over. */
export function decidesGovernment(rules: NegotiationRules, blocSeats: number, partySeats: number): boolean {
  return blocSeats < rules.majority && blocSeats + partySeats >= rules.majority;
}
/** The packages a tiny party gets: Small ministries, plus one Big ministry if its seats decide the government. */
function tinyPackage(posts: number, pivotal: boolean, kind: NegotiationElectionKind = "LOK_SABHA"): PortfolioPackage {
  // A state cabinet has only Ministers (`big` in a package) and Deputy Ministers (`small`): a tiny party gets Ministers.
  if (kind === "ASSEMBLY") return { key: 0, big: posts, small: 0, independent: 0, regular: 0 };
  return pivotal
    ? { key: 0, big: 1, small: Math.max(0, posts - 1), independent: 0, regular: 0 }
    : { key: 0, big: 0, small: posts, independent: 0, regular: 0 };
}
/** What a tiny party is assured: a third of its seats in posts (at least one), one of them Big if it decides the government. */
export function tinyAssuredPackage(seats: number, pivotal: boolean, kind: NegotiationElectionKind = "LOK_SABHA"): PortfolioPackage {
  return tinyPackage(tinyPostLimits(seats).assured, pivotal, kind);
}
/** The best a tiny party can be given: half its seats in posts, one of them Big if it decides the government. */
export function tinyBestPackage(seats: number, pivotal: boolean, kind: NegotiationElectionKind = "LOK_SABHA"): PortfolioPackage {
  return tinyPackage(tinyPostLimits(seats).max, pivotal, kind);
}
/**
 * What a single party needs to join a bloc, in points (Lok Sabha). It follows the party's share of the
 * bloc's seats, never less than two Small ministries and never more than the full join price. A party
 * with up to five seats asks for posts rather than points: the posts it is assured, Small ministries or,
 * if its seats decide the government, one Big ministry and Small ones. A larger party that decides the
 * government pays the full price.
 */
export function partyJoinPrice(rules: NegotiationRules, partySeats: number, blocSeats: number): number {
  const full = joinAcceptancePoints(rules);
  if (rules.kind === "ASSEMBLY") return full;
  const pivotal = decidesGovernment(rules, blocSeats, partySeats);
  if (partySeats <= TINY_PARTY_SEATS) return portfolioPackageValue(tinyAssuredPackage(partySeats, pivotal, rules.kind), rules.kind);
  if (pivotal) return full;
  const share = Math.round((rules.portfolioPoints * partySeats) / (blocSeats + partySeats));
  return Math.min(full, Math.max(2 * UNION_POINTS.SMALL, share));
}
/** The posts counted in an offer's terms. */
export function parsePostCounts(terms: string): PortfolioPackage | undefined {
  const m = terms.match(/(\d+) Key Cabinet Ministry; (\d+) Big Cabinet Ministry; (\d+) Small Cabinet Ministry; (\d+) MoS \(Independent Charge\); (\d+) Regular MoS/i);
  return m ? { key: +m[1], big: +m[2], small: +m[3], independent: +m[4], regular: +m[5] } : undefined;
}
/**
 * Whether an offer respects what a tiny party may hold: at most half its seats in posts, no Deputy PM post,
 * no Key ministry, and a Big ministry only (one) if its seats decide the government.
 */
export function withinTinyLimit(
  terms: string,
  tiny: { seats: number; pivotal: boolean },
): boolean {
  if (/Deputy (?:Prime|Chief) Minister post:\s*Yes/i.test(terms)) return false;
  const posts = parsePostCounts(terms);
  if (!posts) return true;
  const total = posts.key + posts.big + posts.small + posts.independent + posts.regular;
  if (total > tinyPostLimits(tiny.seats).max) return false;
  if (posts.key > 0) return false;
  return tiny.pivotal ? posts.big <= 1 : posts.big === 0;
}
/** Worth 28 points: 3 Big (12), 3 Small (9), 2 MoS (Independent Charge) (4) and 3 Ministers of State (3). */
const UNION_AI_COUNTER_PACKAGE: PortfolioPackage = {
  key: 0,
  big: 3,
  small: 3,
  independent: 2,
  regular: 3,
};
/** The most the Union cabinet holds of each post. */
export const UNION_PACKAGE_LIMITS = { key: 10, big: 24, small: 12, independent: 8, regular: 8 };
/** The most a state cabinet can hold: every Minister post and every Deputy Minister post. */
const STATE_TIER_COUNTS = { key: 0, big: MINISTER_COUNT, small: DEPUTY_COUNT };
export const STATE_PACKAGE_LIMITS = STATE_TIER_COUNTS;
/** What a party counters with when a proposal falls short: exactly enough to join. */
function aiCounterPackage(kind: NegotiationElectionKind | undefined): PortfolioPackage {
  if (kind !== "ASSEMBLY") return UNION_AI_COUNTER_PACKAGE;
  const need = joinAcceptancePoints(defaultRules("ASSEMBLY"));
  return buildPortfolioPackage(need, "ASSEMBLY");
}

export function portfolioPackageValue(p: PortfolioPackage, kind: NegotiationElectionKind = "LOK_SABHA"): number {
  if (kind === "ASSEMBLY") return p.big * MINISTER_POINTS + p.small * DEPUTY_POINTS;
  return p.key * UNION_POINTS.KEY + p.big * UNION_POINTS.BIG + p.small * UNION_POINTS.SMALL + p.independent * UNION_POINTS.MOS_INDEPENDENT_CHARGE + p.regular * UNION_POINTS.REGULAR_MOS;
}
export function portfolioPackageText(
  p: PortfolioPackage,
  deputyPrimeMinister = false,
  deputyTitle = "Deputy Prime Minister",
  kind: NegotiationElectionKind = "LOK_SABHA",
): string {
  if (kind === "ASSEMBLY")
    return `Ministry package: ${p.big} Minister${p.big === 1 ? "" : "s"}; ${p.small} Deputy Minister${p.small === 1 ? "" : "s"}. Portfolio value: ${portfolioPackageValue(p, kind)} points. ${deputyTitle} post: ${deputyPrimeMinister ? "Yes" : "No"}.`;
  return `Portfolio package: ${p.key} Key Cabinet Ministry; ${p.big} Big Cabinet Ministry; ${p.small} Small Cabinet Ministry; ${p.independent} MoS (Independent Charge); ${p.regular} Regular MoS. Portfolio value: ${portfolioPackageValue(p, kind)} points. ${deputyTitle} post: ${deputyPrimeMinister ? "Yes" : "No"}.`;
}
/** The points written in an offer's terms (0 when the offer carries no package). */
export function portfolioPoints(terms: string): number {
  return Number(terms.match(/Portfolio value:\s*(\d+)/i)?.[1] ?? 0);
}
/**
 * A package worth exactly `points`. Union: Key and Big ministries first, then Small ones, one MoS
 * (Independent Charge), and Regular MoS for the rest. State: Ministers and Deputy Ministers
 * only (4 and 2 points), capped at what the cabinet holds.
 */
export function buildPortfolioPackage(
  points: number,
  kind: NegotiationElectionKind = "LOK_SABHA",
): PortfolioPackage {
  let left = Math.max(0, Math.round(points));
  if (kind === "ASSEMBLY") {
    // Ministers (4 points) and Deputy Ministers (2 points); points move in steps of 2, so an odd figure rounds down.
    let units = Math.floor(left / DEPUTY_POINTS);
    const deputies = Math.min(STATE_TIER_COUNTS.small, Math.floor(units * 0.3));
    units -= deputies;
    const ministers = Math.min(STATE_TIER_COUNTS.big, Math.floor(units / 2));
    units -= ministers * 2;
    const extraDeputies = Math.min(STATE_TIER_COUNTS.small - deputies, units);
    return { key: 0, big: ministers, small: deputies + extraDeputies, independent: 0, regular: 0 };
  }
  const L = UNION_PACKAGE_LIMITS;
  const take = (cost: number, max: number, share: number) => {
    const count = Math.min(max, Math.floor((left * share) / cost));
    left -= count * cost;
    return count;
  };
  const pack = {
    key: take(UNION_POINTS.KEY, L.key, 0.3),
    big: take(UNION_POINTS.BIG, L.big, 0.3),
    small: take(UNION_POINTS.SMALL, L.small, 0.15),
    independent: take(UNION_POINTS.MOS_INDEPENDENT_CHARGE, L.independent, 0.1),
    regular: 0,
  };
  // Spend what is left on whichever posts still have room, smallest posts first, so the package is worth exactly `points`.
  const tiers: Array<[keyof PortfolioPackage, number]> = [
    ["regular", UNION_POINTS.REGULAR_MOS],
    ["independent", UNION_POINTS.MOS_INDEPENDENT_CHARGE],
    ["small", UNION_POINTS.SMALL],
    ["big", UNION_POINTS.BIG],
    ["key", UNION_POINTS.KEY],
  ];
  for (let changed = true; changed && left > 0; ) {
    changed = false;
    for (const [tier, cost] of tiers) {
      if (left >= cost && pack[tier] < L[tier]) {
        pack[tier] += 1;
        left -= cost;
        changed = true;
      }
    }
  }
  return pack;
}

function partyLabel(partyId: string): string {
  return (
    (partiesData.parties as Array<{ id: string; name: string }>).find(
      (party) => party.id === partyId,
    )?.name ?? partyId
  );
}

const RELATION_SCORE: Record<PoliticalRelationship, number> = {
  STRONG_ALLY: 0.35,
  FRIENDLY: 0.2,
  NEUTRAL: 0,
  UNDEFINED: 0,
  RIVAL: -0.4,
  STRONG_RIVAL: -0.6,
};
/** A supporter agrees when its score reaches this value. */
export const SUPPORT_ACCEPT_SCORE = 0.55;

export interface SupportDecision {
  accepted: boolean;
  note: string;
  score: number;
}

/**
 * A party's own decision on backing the player's bloc from outside, made the way a party decides a join
 * offer: by the party, not the player. It weighs
 *  - how friendly it is with the bloc's members (seat-weighted),
 *  - how close the bloc is to 272 (parties back a government that can actually be formed),
 *  - loyalty to its own alliance or its own chance of leading a government,
 *  - the 14-day deadline, which makes holdouts more willing,
 *  - a small seeded variation. It is fixed for a given party, bloc and day, so asking again the same day
 *    gives the same answer and re-proposing cannot be used as a reroll.
 */
interface SupportScore {
  score: number;
  relation: number;
  closeness: number;
  loyalty: number;
  ownIsBigger: boolean;
  own?: NegotiationTallyBloc;
  receiving: NegotiationTallyBloc;
}

/** How willing `partyId` is to back or join the bloc `receivingId` today (see decideOutsideSupport). */
function scoreSupport(
  overview: NegotiationOverview,
  save: NegotiationSave,
  partyId: string,
  receivingId: string,
  tally = getNegotiationBlocTally(overview, save),
): SupportScore | null {
  const receiving = tally.find((bloc) => bloc.id === receivingId);
  if (!receiving) return null;
  const own = tally.find((bloc) => bloc.parties.some((party) => party.partyId === partyId));
  const weight = receiving.parties.reduce((sum, member) => sum + member.seats, 0) || 1;
  const relation =
    receiving.parties.reduce((sum, member) => {
      const resolved = getPoliticalRelationship(
        partyId,
        member.partyId,
        relationContext(overview.rules),
      );
      return sum + member.seats * RELATION_SCORE[resolved.relationship];
    }, 0) / weight;
  const closeness = Math.min(1, receiving.seats / overview.rules.majority);
  // Holdouts soften as the 14 days run down, and a little more in the extension week.
  const pressure =
    Math.min(1, (save.day - 1) / (overview.rules.days - 1)) * 0.2 +
    (save.day > overview.rules.days ? 0.05 : 0);
  const hasOwnAlliance = (own?.parties.length ?? 0) > 1;
  const ownIsBigger = Boolean(own && own.id !== receiving.id && own.seats > receiving.seats);
  const loyalty = (hasOwnAlliance ? -0.15 : 0) + (ownIsBigger ? -0.2 : 0);
  const jitter =
    (randomFor(hashSeed(`${save.gameId}:support:${partyId}:${receiving.id}:${save.day}`))() - 0.5) *
    0.12;
  return {
    score: 0.2 + relation + 0.45 * closeness + pressure + loyalty + jitter,
    relation,
    closeness,
    loyalty,
    ownIsBigger,
    own,
    receiving,
  };
}

export function decideOutsideSupport(
  overview: NegotiationOverview,
  save: NegotiationSave,
  supporterPartyId: string,
): SupportDecision {
  const label = partyLabel(supporterPartyId);
  const playerBloc = getNegotiationBlocTally(overview, save).find((bloc) => bloc.isPlayerBloc);
  const detail = playerBloc ? scoreSupport(overview, save, supporterPartyId, playerBloc.id) : null;
  if (!detail) return { accepted: false, score: 0, note: `${label} sees no government to back.` };
  const { score, relation, closeness, loyalty, ownIsBigger, own, receiving } = detail;
  const accepted = score >= SUPPORT_ACCEPT_SCORE;
  if (accepted)
    return {
      accepted,
      score,
      note: `${label} will back ${receiving.name} from outside. It stays out of the ministry and supports the government in the House.`,
    };
  const reason =
    loyalty <= -0.15 && relation < 0.2
      ? ownIsBigger
        ? `it sees a better chance of leading a government around ${own?.name}`
        : `it prefers to stay with ${own?.name}`
      : closeness < 0.7
        ? `it does not yet believe ${receiving.name} can reach a majority`
        : relation <= 0
          ? "it sees too little common ground"
          : "it is not ready to commit yet";
  return {
    accepted,
    score,
    note: `${label} declined to extend outside support: ${reason}. Its view may change as the deadline nears or your bloc grows.`,
  };
}

/**
 * Whether the player sends proposals. Everyone does, an independent player included: the independent
 * player can offer ministries to other parties and alliances, and still receives offers from them.
 */
export function playerNegotiates(overview: NegotiationOverview, _save?: NegotiationSave): boolean {
  return overview.scenario !== "NO_NEGOTIATION_REQUIRED";
}

/**
 * The player's proposal, answered by the other side straight away:
 *  - JOIN with a party: it joins the player's bloc when the package is worth enough, otherwise it counters;
 *  - JOIN with an alliance, front or coalition: the two merge (the larger name survives, NDA/INDIA keep theirs);
 *  - OUTSIDE_SUPPORT (single parties only): accepted or declined by the party's own decision.
 * The package is what the player offers in ministries, plus the Deputy PM / Deputy CM post.
 */
export function submitNegotiationOffer(
  save: NegotiationSave,
  overview: NegotiationOverview,
  bloc: NegotiationBloc,
  arrangement: NegotiationArrangement,
  terms: string,
): NegotiationSave {
  const rules = rulesOf(save, overview);
  const wholeBloc = !bloc.id.startsWith("PARTY:");
  const askMode = isAskingAlliance(overview, save, wholeBloc);
  if (arrangement === "OUTSIDE_SUPPORT" && wholeBloc && !askMode)
    throw new Error("Outside support is asked of a single party. To work with an alliance, offer it a merger.");
  // A proposal to a party that had approached the player replaces its own request.
  if (!wholeBloc)
    save = {
      ...save,
      offers: save.offers.map((o) =>
        o.id === `REQUEST-${bloc.partyIds[0]}` && (o.status === "OFFERED" || o.status === "COUNTERED")
          ? { ...o, status: "REJECTED" as const, responseNote: "Replaced by your own proposal.", updatedAt: new Date().toISOString() }
          : o,
      ),
    };
  if (askMode) return submitAskToAlliance(save, overview, bloc, arrangement, terms);
  if (!wholeBloc && arrangement === "JOIN" && rules.kind !== "ASSEMBLY" && bloc.seats <= TINY_PARTY_SEATS) {
    const mineSeats = getNegotiationBlocTally(overview, save).find((item) => item.isPlayerBloc)?.seats ?? 0;
    const tiny = { seats: bloc.seats, pivotal: decidesGovernment(rules, mineSeats, bloc.seats) };
    if (!withinTinyLimit(terms, tiny)) {
      const limit = tinyPostLimits(tiny.seats).max;
      throw new Error(
        `${partyLabel(bloc.partyIds[0] ?? bloc.name)} has ${tiny.seats} seat${tiny.seats === 1 ? "" : "s"}, so it can be offered at most ${limit} post${limit === 1 ? "" : "s"}${rules.kind === "ASSEMBLY" ? " (Minister posts)" : tiny.pivotal ? " (one of them a Big ministry, since its seats decide the government)" : ", all Small ministries or lower"}, and not the ${rules.deputyTitle} post.`,
      );
    }
  }
  if (
    save.offers.some(
      (o) => o.targetBlocId === bloc.id && o.arrangement === arrangement && o.status === "ACCEPTED",
    )
  )
    throw new Error(`${bloc.name} has already agreed to this arrangement.`);
  const created = createNegotiationOffer(save, bloc, arrangement, terms);
  const index = created.offers.length - 1;
  const offer = created.offers[index];
  const now = new Date().toISOString();
  const label = wholeBloc ? bloc.name : partyLabel(bloc.partyIds[0] ?? bloc.name);
  let decided: NegotiationOffer;
  if (arrangement === "JOIN") {
    const offered =
      portfolioPoints(terms) +
      (/Deputy (?:Prime|Chief) Minister post:\s*Yes/i.test(terms) ? deputyPostPoints(rules) : 0);
    const mineSeats = getNegotiationBlocTally(overview, save).find((item) => item.isPlayerBloc)?.seats ?? 0;
    const price = wholeBloc ? joinAcceptancePoints(rules) : partyJoinPrice(rules, bloc.seats, mineSeats);
    const counter =
      !wholeBloc && price < joinAcceptancePoints(rules)
        ? buildPortfolioPackage(price, rules.kind)
        : aiCounterPackage(rules.kind);
    decided =
      offered >= price
        ? {
            ...offer,
            joinPrice: price,
            status: "ACCEPTED",
            responseNote: `${label} is satisfied with the proposed package and accepted the offer.`,
            updatedAt: now,
          }
        : {
            ...offer,
            joinPrice: price,
            status: "COUNTERED",
            counterTerms: portfolioPackageText(
              counter,
              false,
              rules.deputyTitle,
              rules.kind,
            ),
            responseNote: `${label} reviewed your proposal and requests a revised portfolio package.`,
            updatedAt: now,
          };
  } else {
    const decision = decideOutsideSupport(overview, created, bloc.partyIds[0] ?? "");
    decided = {
      ...offer,
      status: decision.accepted ? "ACCEPTED" : "REJECTED",
      responseNote: decision.note,
      updatedAt: now,
    };
  }
  const verdict =
    decided.status === "ACCEPTED"
      ? "accepted"
      : decided.status === "REJECTED"
        ? "declined"
        : "answered with a counter-offer";
  return persistNegotiationSave({
    ...created,
    offers: created.offers.map((item, i) => (i === index ? decided : item)),
    events: [
      ...(created.events ?? []),
      {
        day: save.day,
        kind: "PLAYER" as const,
        text: wholeBloc
          ? `You proposed a merger with ${label}. ${label} ${verdict}.`
          : `You proposed ${arrangement === "JOIN" ? "that" : "outside support from"} ${label}${arrangement === "JOIN" ? " join your bloc" : ""}. ${label} ${verdict}.`,
      },
    ].slice(-EVENT_LOG_LIMIT),
  });
}

// ---------------------------------------------------------------------------
// Lok Sabha: an independent player asks an alliance for posts, or backs it from outside
// ---------------------------------------------------------------------------

/** Posts plus the Deputy PM post, in points, as written in an offer's terms. */
function askedPoints(terms: string, rules: NegotiationRules): number {
  return (
    portfolioPoints(terms) +
    (/Deputy (?:Prime|Chief) Minister post:\s*Yes/i.test(terms) ? deputyPostPoints(rules) : 0)
  );
}

/** True when the player stands alone and approaches a whole alliance: the player then asks for posts. */
function isAskingAlliance(
  overview: NegotiationOverview,
  save: NegotiationSave,
  wholeBloc: boolean,
): boolean {
  if (!wholeBloc || overview.rules.kind === "ASSEMBLY" || overview.scenario !== "PLAYER_INDEPENDENT")
    return false;
  const player = overview.playerPartyId;
  if (save.outsideSupport?.[player]) return false;
  const mine = getNegotiationBlocTally(overview, save).find((bloc) =>
    bloc.parties.some((party) => party.partyId === player),
  );
  return Boolean(mine && mine.parties.length === 1);
}

/** The most posts an alliance will give a party of this size, in points. */
function allianceCeiling(rules: NegotiationRules, blocSeats: number, playerSeats: number): number {
  const scale = rules.portfolioPoints / TOTAL_PORTFOLIO_POINTS;
  const share = Math.round((rules.portfolioPoints * playerSeats) / (blocSeats + playerSeats));
  const spare = Math.min(Math.round(40 * scale), Math.max(Math.max(2, Math.round(4 * scale)), share));
  return Math.min(Math.round(60 * scale), Math.max(spare + 1, Math.ceil(spare * 1.3)));
}

function submitAskToAlliance(
  save: NegotiationSave,
  overview: NegotiationOverview,
  bloc: NegotiationBloc,
  arrangement: NegotiationArrangement,
  terms: string,
): NegotiationSave {
  const rules = rulesOf(save, overview);
  const player = overview.playerPartyId;
  const created = createNegotiationOffer(save, bloc, arrangement, terms);
  const index = created.offers.length - 1;
  const now = new Date().toISOString();
  const tally = getNegotiationBlocTally(overview, save);
  const target = tally.find((item) => item.id === bloc.id);
  const members = target?.parties ?? bloc.partyIds.map((partyId) => ({ partyId, seats: 0 }));
  const welcome = blocWelcomes(player, members, target?.convenerPartyId ?? bloc.convenerPartyId);
  const label = bloc.name;
  const blocSeats = target?.seats ?? bloc.seats;
  let decided: NegotiationOffer = { ...created.offers[index], playerAsks: true, updatedAt: now };
  if (!welcome.ok) {
    decided = {
      ...decided,
      status: "REJECTED",
      responseNote: `${label} will not work with your party: it includes ${welcome.blocked.map(partyLabel).join(", ")}, with whom you are at odds.`,
    };
  } else if (arrangement === "OUTSIDE_SUPPORT") {
    const ok = (blocSeats + overview.playerPartySeats) / rules.majority >= 0.7;
    decided = ok
      ? {
          ...decided,
          status: "ACCEPTED",
          responseNote: `${label} welcomes your outside support. You stay out of the ministry and back the government in the House.`,
        }
      : {
          ...decided,
          status: "REJECTED",
          responseNote: `${label} does not yet see a path to ${rules.majority} seats with your support and declined. Its view may change as it grows.`,
        };
  } else {
    const tiny =
      overview.playerPartySeats <= TINY_PARTY_SEATS
        ? { seats: overview.playerPartySeats, pivotal: decidesGovernment(rules, blocSeats, overview.playerPartySeats) }
        : undefined;
    const best = tiny ? tinyBestPackage(tiny.seats, tiny.pivotal, rules.kind) : undefined;
    const ceiling = best
      ? portfolioPackageValue(best, rules.kind)
      : allianceCeiling(rules, blocSeats, overview.playerPartySeats);
    const asked = askedPoints(terms, rules);
    const fine = tiny ? withinTinyLimit(terms, tiny) : asked <= ceiling;
    decided = fine
      ? {
          ...decided,
          ceilingPoints: ceiling,
          tiny,
          status: "ACCEPTED",
          responseNote: `${label} agreed to give you the posts you asked for. You will become its convener when the day advances.`,
        }
      : {
          ...decided,
          ceilingPoints: ceiling,
          tiny,
          status: "COUNTERED",
          counterTerms: portfolioPackageText(
            best ?? buildPortfolioPackage(ceiling, rules.kind),
            false,
            rules.deputyTitle,
            rules.kind,
          ),
          responseNote: tiny
            ? rules.kind === "ASSEMBLY"
              ? `${label} will give a party of your size at most ${tinyPostLimits(tiny.seats).max} Minister post${tinyPostLimits(tiny.seats).max === 1 ? "" : "s"}, and not the ${rules.deputyTitle} post. Accept that, or counter again.`
              : tiny.pivotal
              ? `${label} needs your ${tiny.seats === 1 ? "seat" : "seats"} to govern, but a party of your size holds at most ${tinyPostLimits(tiny.seats).max} post${tinyPostLimits(tiny.seats).max === 1 ? "" : "s"}, one of them a Big ministry, and cannot have the ${rules.deputyTitle} post. Accept that, or counter again.`
              : `${label} will give a party of your size at most ${tinyPostLimits(tiny.seats).max} Small ministr${tinyPostLimits(tiny.seats).max === 1 ? "y" : "ies"} or lower posts, and not the ${rules.deputyTitle} post. Accept that, or counter again.`
            : `${label} cannot give that much. It can offer ${ceiling} points of posts. Accept that, or counter again.`,
        };
  }
  const verdict =
    decided.status === "ACCEPTED" ? "agreed" : decided.status === "REJECTED" ? "declined" : "answered with a counter-offer";
  return persistNegotiationSave({
    ...created,
    offers: created.offers.map((item, i) => (i === index ? decided : item)),
    events: [
      ...(created.events ?? []),
      {
        day: save.day,
        kind: "PLAYER" as const,
        text: `You asked ${label} to ${arrangement === "JOIN" ? "take you in for posts" : "accept your outside support"}. ${label} ${verdict}.`,
      },
    ].slice(-EVENT_LOG_LIMIT),
  });
}

/** An offer that moves the player's party: one an alliance sent, or one the player asked for. */
function movesPlayer(offer: NegotiationOffer): boolean {
  return offer.id.startsWith("INCOMING-") || Boolean(offer.playerAsks);
}

// ---------------------------------------------------------------------------
// Lok Sabha: parties approach the leader of a bloc
// ---------------------------------------------------------------------------

/** Whether the player leads a bloc that other parties can ask to join or back. */
export function playerLeadsBloc(overview: NegotiationOverview, save?: NegotiationSave): boolean {
  if (overview.rules.kind === "ASSEMBLY" || overview.scenario === "NO_NEGOTIATION_REQUIRED") return false;
  const bloc = getNegotiationBlocTally(overview, save).find((item) => item.isPlayerBloc);
  if (!bloc) return false;
  return overview.scenario !== "PLAYER_INDEPENDENT" || bloc.parties.length > 1;
}

const isRequest = (offer: NegotiationOffer) => offer.id.startsWith("REQUEST-");
const isOpen = (offer: NegotiationOffer) => offer.status === "OFFERED" || offer.status === "COUNTERED";
const MAX_OPEN_REQUESTS = 4;

/**
 * Standalone parties outside the player's bloc approach its leader: most ask to join in return for posts,
 * the rest offer outside support. Requests from parties that have since gone elsewhere are withdrawn.
 * The first batch is made when the talks open (`initial`); later, each day a few more may come.
 */
export function createPartyRequests(
  save: NegotiationSave,
  overview: NegotiationOverview,
  options: { initial?: boolean } = {},
): NegotiationSave {
  if (save.completed || !playerLeadsBloc(overview, save)) return save;
  const rules = rulesOf(save, overview);
  const tally = getNegotiationBlocTally(overview, save);
  const mine = tally.find((bloc) => bloc.isPlayerBloc);
  if (!mine) return save;
  const now = new Date().toISOString();
  const events = [...(save.events ?? [])];
  const standalone = new Set(
    tally.filter((bloc) => bloc.parties.length === 1 && !bloc.isPlayerBloc).map((bloc) => bloc.parties[0].partyId),
  );
  let offers = save.offers.map((offer) => {
    if (!isRequest(offer) || !isOpen(offer) || standalone.has(offer.targetPartyIds[0])) return offer;
    events.push({
      day: save.day,
      kind: "DECLINE",
      text: `${offer.targetName} went elsewhere and withdrew its offer to you.`,
    });
    return { ...offer, status: "REJECTED" as const, responseNote: `${offer.targetName} went elsewhere.`, updatedAt: now };
  });
  let open = offers.filter((offer) => isRequest(offer) && isOpen(offer)).length;
  const memberIds = mine.parties.map((party) => party.partyId);
  const scale = rules.portfolioPoints / TOTAL_PORTFOLIO_POINTS;
  const candidates = tally
    .filter((bloc) => bloc.parties.length === 1 && !bloc.isPlayerBloc && bloc.seats > 0)
    .map((bloc) => bloc.parties[0])
    .filter((party) => !offers.some((offer) => offer.id === `REQUEST-${party.partyId}`))
    .filter((party) => checkNegotiationCompatibility(memberIds, [party.partyId], rules).compatible)
    .sort((a, b) => b.seats - a.seats || a.partyId.localeCompare(b.partyId));
  for (const party of candidates) {
    if (open >= MAX_OPEN_REQUESTS) break;
    const draw = randomFor(hashSeed(`${save.gameId}:req:${party.partyId}:${options.initial ? 0 : save.day}`));
    if (draw() >= (options.initial ? 0.6 : 0.3)) continue;
    const relation = scoreSupport(overview, save, party.partyId, mine.id, tally)?.relation ?? 0;
    const join = relation >= 0.15 && draw() < 0.7;
    const label = partyLabel(party.partyId);
    const price = partyJoinPrice(rules, party.seats, mine.seats);
    const share = Math.round((rules.portfolioPoints * party.seats) / (mine.seats + party.seats));
    const tiny =
      party.seats <= TINY_PARTY_SEATS
        ? { seats: party.seats, pivotal: decidesGovernment(rules, mine.seats, party.seats) }
        : undefined;
    // A tiny party asks for a post or two; a larger one asks for its share, never below the join price.
    const askPackage = tiny
      ? tinyAssuredPackage(party.seats, tiny.pivotal, rules.kind)
      : buildPortfolioPackage(Math.min(Math.round(40 * scale), Math.max(price, share)), rules.kind);
    const ask = portfolioPackageValue(askPackage, rules.kind);
    offers = [
      ...offers,
      {
        id: `REQUEST-${party.partyId}`,
        targetBlocId: `PARTY:${party.partyId}`,
        targetName: label,
        targetPartyIds: [party.partyId],
        arrangement: join ? "JOIN" : "OUTSIDE_SUPPORT",
        round: 1,
        status: "OFFERED",
        askedPoints: join ? ask : undefined,
        tiny,
        terms: join
          ? `${label} (${party.seats} seats) asks to join ${mine.name}. ${portfolioPackageText(askPackage, false, rules.deputyTitle, rules.kind)}`
          : `${label} (${party.seats} seats) offers ${mine.name} outside support without formal membership. No ministry or MoS positions are included.`,
        createdAt: now,
        updatedAt: now,
      },
    ];
    open += 1;
    events.push({ day: save.day, kind: "APPROACH", text: `${label} has approached you with an offer.` });
  }
  return persistNegotiationSave({ ...save, offers, events: events.slice(-EVENT_LOG_LIMIT), requestsSeeded: true });
}

// ---------------------------------------------------------------------------
// An independent player is approached by alliances and fronts
// ---------------------------------------------------------------------------

/** A bloc this size (a quarter of the majority mark) or one of the two largest is a serious contender. */
export const INCOMING_MIN_BLOC_SEATS = Math.ceil(MAJORITY_MARK / 4);

const pairCache = new Map<string, boolean>();
function pairCompatible(a: string, b: string): boolean {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  let value = pairCache.get(key);
  if (value === undefined) {
    value = checkNegotiationCompatibility([a], [b]).compatible;
    pairCache.set(key, value);
  }
  return value;
}

/**
 * Whether a bloc would take `partyId` in. A bloc is not shut to a party because one small member
 * dislikes it: it welcomes the party unless that party is at odds with the bloc's convener (or, with no
 * convener given, its largest member) or with more than a quarter of its seats.
 */
export function blocWelcomes(
  partyId: string,
  members: Array<{ partyId: string; seats: number }>,
  convenerPartyId?: string,
): { ok: boolean; blocked: string[] } {
  const total = members.reduce((sum, member) => sum + member.seats, 0) || 1;
  const leaderId = convenerPartyId ?? members.slice().sort((a, b) => b.seats - a.seats)[0]?.partyId;
  const blocked = members.filter((member) => !pairCompatible(partyId, member.partyId));
  const blockedSeats = blocked.reduce((sum, member) => sum + member.seats, 0);
  const leaderBlocked = Boolean(
    leaderId && leaderId !== partyId && !pairCompatible(partyId, leaderId),
  );
  const names = blocked.map((member) => member.partyId);
  if (leaderBlocked && leaderId && !names.includes(leaderId)) names.push(leaderId);
  return { ok: !leaderBlocked && blockedSeats / total <= 0.25, blocked: names };
}

/**
 * The coalition an independent player has built from scratch (two or more parties led by the player),
 * so the page can offer to name it. Null while the player is alone or has joined someone else's bloc.
 */
export function getPlayerCoalition(
  overview: NegotiationOverview,
  save?: NegotiationSave,
): { id: string; name: string; parties: string[]; seats: number } | null {
  if (overview.scenario !== "PLAYER_INDEPENDENT") return null;
  const origin = overview.partyRows.find((row) => row.partyId === overview.playerPartyId)?.allianceId;
  const bloc = getNegotiationBlocTally(overview, save).find(
    (item) => item.isPlayerBloc && item.id === origin && item.parties.length > 1,
  );
  return bloc
    ? {
        id: bloc.id,
        name: bloc.name,
        parties: bloc.parties.map((party) => party.partyId),
        seats: bloc.seats,
      }
    : null;
}

/** The player names the coalition they lead. NDA and INDIA are reserved, and so is any name another bloc already uses. */
export function nameCoalition(
  save: NegotiationSave,
  overview: NegotiationOverview,
  rawName: string,
): NegotiationSave {
  const coalition = getPlayerCoalition(overview, save);
  if (!coalition) throw new Error("You can name your coalition once other parties have joined you.");
  const name = rawName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40)
    throw new Error("A coalition name needs 2 to 40 characters.");
  if (RESERVED_COALITION_NAMES.includes(name.toLowerCase()))
    throw new Error("NDA and INDIA are reserved for those alliances. Choose another name.");
  const taken = getNegotiationBlocTally(overview, save).some(
    (bloc) => bloc.id !== coalition.id && bloc.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) throw new Error(`Another alliance is already called ${name}.`);
  const assignments = { ...(save.partyAssignments ?? {}) };
  for (const [partyId, to] of Object.entries(assignments))
    if (to.id === coalition.id) assignments[partyId] = { id: to.id, name };
  return persistNegotiationSave({
    ...save,
    partyAssignments: assignments,
    blocNames: { ...(save.blocNames ?? {}), [coalition.id]: name },
    events: [
      ...(save.events ?? []),
      { day: save.day, kind: "PLAYER" as const, text: `You named your coalition ${name}.` },
    ].slice(-EVENT_LOG_LIMIT),
  });
}

/**
 * The alliances, fronts and parties that approach an independent player: every serious contender to
 * govern (a quarter of the majority mark, or one of the three largest). A bloc that would take the player
 * in may ask to join or for outside support; one with a party the player is at odds with can only ask
 * for outside support (`joinable: false`), and the player decides. Pass the save to follow the blocs as they grow during the 14 days; once the player has
 * joined or backed a bloc, nobody else approaches.
 */
export function getIncomingOfferBlocs(
  overview: NegotiationOverview,
  save?: NegotiationSave,
): NegotiationBloc[] {
  const tally = getNegotiationBlocTally(overview, save);
  const player = overview.playerPartyId;
  const playerGroup = tally.find((bloc) => bloc.parties.some((party) => party.partyId === player));
  if (!playerGroup || playerGroup.parties.length > 1 || save?.outsideSupport?.[player]) return [];
  const candidates = tally.filter(
    (bloc) => bloc.id !== playerGroup.id && bloc.seats < overview.rules.majority,
  );
  const serious = candidates.filter(
    (bloc) => bloc.seats >= Math.ceil(overview.rules.majority / 4) || tally.indexOf(bloc) < 3,
  );
  return (serious.length ? serious : candidates.slice(0, 2)).map((bloc) => ({
    id: bloc.id,
    name: bloc.name,
    partyIds: bloc.parties.map((party) => party.partyId),
    seats: bloc.seats,
    isPlayerBloc: false,
    // A bloc with a party the player is at odds with cannot take the player in, but it can still ask for outside support.
    joinable: blocWelcomes(player, bloc.parties, bloc.convenerPartyId).ok,
    convenerPartyId: bloc.convenerPartyId,
  }));
}

/** Most a bloc will concede when the player asks for more than it first offered. */
function incomingCeiling(offer: NegotiationOffer, rules: NegotiationRules): number {
  if (offer.ceilingPoints !== undefined) return offer.ceilingPoints;
  const offered = portfolioPoints(offer.terms);
  const cap = Math.round((60 * rules.portfolioPoints) / TOTAL_PORTFOLIO_POINTS);
  return Math.min(cap, Math.max(offered + 1, Math.ceil(offered * 1.3)));
}

function buildIncomingOffer(
  save: NegotiationSave,
  bloc: NegotiationBloc,
  overview: NegotiationOverview,
  now: string,
): NegotiationOffer {
  const arrangement: NegotiationArrangement =
    bloc.joinable !== false && randomFor(hashSeed(`${save.gameId}:incoming:${bloc.id}`))() < 0.8
      ? "JOIN"
      : "OUTSIDE_SUPPORT";
  const scale = overview.rules.portfolioPoints / TOTAL_PORTFOLIO_POINTS;
  const points = Math.min(
    Math.round(40 * scale),
    Math.max(
      Math.max(2, Math.round(4 * scale)),
      Math.round(
        (overview.rules.portfolioPoints * overview.playerPartySeats) /
          (bloc.seats + overview.playerPartySeats),
      ),
    ),
  );
  const seatsOf = new Map(overview.partyRows.map((row) => [row.partyId, row.seats]));
  const blocked = blocWelcomes(
    overview.playerPartyId,
    bloc.partyIds.map((partyId) => ({ partyId, seats: seatsOf.get(partyId) ?? 0 })),
    bloc.convenerPartyId,
  ).blocked;
  const caveat = blocked.length
    ? bloc.joinable === false
      ? ` It includes ${blocked.map(partyLabel).join(", ")}, with whom your party is at odds, so it is not asking you to join. It only needs your support from outside to reach a majority. The decision is yours.`
      : ` Note: it includes ${blocked.map(partyLabel).join(", ")}, with whom your party is at odds.`
    : "";
  return {
    id: `INCOMING-${bloc.id}`,
    targetBlocId: bloc.id,
    targetName: bloc.name,
    targetPartyIds: [...bloc.partyIds],
    arrangement,
    round: 1,
    status: "OFFERED",
    terms:
      (arrangement === "JOIN"
        ? `${bloc.name} (${bloc.seats} seats) invites your party to formally join its alliance/front. ${portfolioPackageText(buildPortfolioPackage(points, overview.rules.kind), false, overview.rules.deputyTitle, overview.rules.kind)}`
        : `${bloc.name} (${bloc.seats} seats) asks your party for outside support without formal membership. No ministry or MoS positions are included.`) +
      caveat,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Every serious bloc that would take the independent player in approaches at the same time. About 80%
 * ask the player to join formally, with a ministry package sized to the player's share of the combined
 * seats; the rest ask for outside support. Which does which is fixed per game, so reloading the page
 * never changes the offers.
 */
export function createSimultaneousIncomingOffers(
  save: NegotiationSave,
  blocs: NegotiationBloc[],
  overview: NegotiationOverview,
): NegotiationSave {
  if (save.offers.length || save.completed || !blocs.length) return save;
  const now = new Date().toISOString();
  const events = blocs.map((bloc) => ({
    day: save.day,
    kind: "APPROACH" as const,
    text: `${bloc.name} has approached your party with an offer.`,
  }));
  return persistNegotiationSave({
    ...save,
    offers: blocs.map((bloc) => buildIncomingOffer(save, bloc, overview, now)),
    events: [...(save.events ?? []), ...events],
  });
}

/**
 * Called each day for an independent player: withdraws offers from blocs that no longer exist as they
 * were (they merged into a bigger bloc) and lets blocs that have grown into serious contenders, and had
 * not approached yet, make their offer (a seeded 40% chance a day).
 */
function refreshIncomingOffers(
  save: NegotiationSave,
  overview: NegotiationOverview,
): NegotiationSave {
  if (overview.scenario !== "PLAYER_INDEPENDENT" || save.completed) return save;
  const now = new Date().toISOString();
  const tally = getNegotiationBlocTally(overview, save);
  const live = new Set(tally.map((bloc) => bloc.id));
  const events = [...(save.events ?? [])];
  let offers = save.offers.map((offer) => {
    const open = offer.status === "OFFERED" || offer.status === "COUNTERED";
    if (!movesPlayer(offer) || !open || live.has(offer.targetBlocId)) return offer;
    events.push({
      day: save.day,
      kind: "DECLINE",
      text: `${offer.targetName} merged into a larger bloc and withdrew its offer.`,
    });
    return {
      ...offer,
      status: "REJECTED" as const,
      responseNote: `${offer.targetName} merged into a larger bloc and withdrew its offer.`,
      updatedAt: now,
    };
  });
  const settled = offers.some(
    (offer) => movesPlayer(offer) && offer.status === "ACCEPTED",
  );
  if (!settled) {
    for (const bloc of getIncomingOfferBlocs(overview, save)) {
      if (offers.some((offer) => offer.targetBlocId === bloc.id)) continue;
      if (randomFor(hashSeed(`${save.gameId}:late:${bloc.id}:${save.day}`))() >= 0.4) continue;
      offers = [...offers, buildIncomingOffer(save, bloc, overview, now)];
      events.push({
        day: save.day,
        kind: "APPROACH",
        text: `${bloc.name} has approached your party with an offer.`,
      });
    }
  }
  return { ...save, offers, events };
}
