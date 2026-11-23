import ministriesData from "@/data/state-ministries.json";
import type { AssemblyGovernmentOutcome } from "@/engine/assembly-voting-engine";

export const ASSEMBLY_CABINET_SAVE_KEY = "indian-election-simulator:assembly-cabinet";

/**
 * The state cabinet is a flat list of posts, with no tiers and no categories. Every ministry has a Minister,
 * worth 4 points. The 35 Ministers are the cabinet proper: seat share decides how many points each ruling
 * party may spend on them. Seven ministries also have a Deputy Minister (2 points). Deputies work like
 * Regular Ministers of State in the Lok Sabha: optional extras handed out after the main cabinet, outside the
 * point total, and limited by how many a party may hold. The Deputy Chief Minister is not a cabinet post
 * either: it costs no cabinet points and goes to any party the player picks. In negotiation it is worth two
 * Ministers.
 */
export const MINISTER_POINTS = 4;
export const DEPUTY_POINTS = 2;
export type PostKind = "MINISTER" | "DEPUTY";
/** Deputy posts get ids from here up: the Deputy of ministry 7 is post 107. */
export const DEPUTY_ID_BASE = 100;

/** What the Deputy Chief Minister post is worth in negotiation: two Ministers. It is never part of the cabinet points. */
export const DEPUTY_CM_POINTS = 2 * MINISTER_POINTS;

export interface AssemblyMinistry {
  /** Unique post id: the ministry's id for a Minister, 100 + the ministry's id for its Deputy. */
  id: number;
  ministryId: number;
  ministryName: string;
  /** The post title, e.g. "Home Minister" or "Deputy Home Minister". */
  name: string;
  kind: PostKind;
  points: number;
}

export interface CabinetParty {
  partyId: string;
  seats: number;
  /** Ministry points this party may hold. Always even; the entitlements of all parties add up to the total. */
  entitlement: number;
}

export interface CabinetAssignment {
  ministryId: number;
  partyId: string;
}

export interface AssemblyCabinetSave {
  schemaVersion: 3;
  gameId: string;
  groupName: string;
  chiefMinisterPartyId: string;
  totalPoints: number;
  parties: CabinetParty[];
  assignments: CabinetAssignment[];
  /** True when the parties shared the ministries without the player (the player sits in opposition). */
  autoAllocated: boolean;
  confirmed: boolean;
  /** Party holding the Deputy Chief Minister post, or null for none. It sits outside the point system. */
  deputyChiefMinisterPartyId: string | null;
  /** False until the player has answered whether to appoint a Deputy Chief Minister. */
  deputyCmDecided: boolean;
  updatedAt: string;
}

type RawMinistry = { id: number; name: string; minister: string; deputy?: string };

export function buildAssemblyMinistries(): AssemblyMinistry[] {
  return (ministriesData.ministries as RawMinistry[]).flatMap((ministry) => {
    const posts: AssemblyMinistry[] = [
      {
        id: ministry.id,
        ministryId: ministry.id,
        ministryName: ministry.name,
        name: ministry.minister,
        kind: "MINISTER",
        points: MINISTER_POINTS,
      },
    ];
    if (ministry.deputy)
      posts.push({
        id: DEPUTY_ID_BASE + ministry.id,
        ministryId: ministry.id,
        ministryName: ministry.name,
        name: ministry.deputy,
        kind: "DEPUTY",
        points: DEPUTY_POINTS,
      });
    return posts;
  });
}

export const ASSEMBLY_MINISTRIES = buildAssemblyMinistries();
export const MINISTER_COUNT = ASSEMBLY_MINISTRIES.filter((post) => post.kind === "MINISTER").length;
export const DEPUTY_COUNT = ASSEMBLY_MINISTRIES.filter((post) => post.kind === "DEPUTY").length;
/** The cabinet proper: every Minister. Its points are what the parties share. */
export const MINISTER_POSTS = ASSEMBLY_MINISTRIES.filter((post) => post.kind === "MINISTER");
export const DEPUTY_POSTS = ASSEMBLY_MINISTRIES.filter((post) => post.kind === "DEPUTY");
export const TOTAL_MINISTRY_POINTS = MINISTER_POSTS.reduce((sum, ministry) => sum + ministry.points, 0);

/** Every post's points together, Deputies included. Negotiation packages are still priced against this. */
export const TOTAL_POINTS_WITH_DEPUTIES = ASSEMBLY_MINISTRIES.reduce((sum, post) => sum + post.points, 0);

/**
 * How many optional Deputy Minister posts a party may hold: its share of the points, rounded up, so the
 * limits always cover every deputy post between the parties.
 */
export function deputyRoom(entitlement: number, totalPoints: number = TOTAL_MINISTRY_POINTS): number {
  return Math.ceil((DEPUTY_COUNT * entitlement) / totalPoints);
}

function largestRemainder(total: number, weights: Array<{ partyId: string; seats: number }>) {
  const sum = weights.reduce((n, party) => n + party.seats, 0);
  const shares: Record<string, number> = Object.fromEntries(
    weights.map((party) => [party.partyId, 0]),
  );
  if (!sum || total <= 0) return shares;
  const raw = weights.map((party) => {
    const value = (total * party.seats) / sum;
    return { partyId: party.partyId, base: Math.floor(value), fraction: value - Math.floor(value) };
  });
  let left = total - raw.reduce((n, party) => n + party.base, 0);
  for (const party of [...raw].sort(
    (a, b) => b.fraction - a.fraction || a.partyId.localeCompare(b.partyId),
  )) {
    if (left <= 0) break;
    party.base += 1;
    left -= 1;
  }
  for (const party of raw) shares[party.partyId] = party.base;
  return shares;
}

/**
 * Splits the ministry points between the ruling parties. Points move in steps of 2 (a Deputy Minister),
 * so the split is worked out in units of 2. Every party that won a seat is guaranteed 2 units (4 points,
 * enough for a Minister); the rest follow seat share, largest remainder first.
 */
export function buildCabinetParties(
  partySeats: Record<string, number>,
  totalPoints: number = TOTAL_MINISTRY_POINTS,
  withDeputyPoints = false,
): CabinetParty[] {
  // Ministers cost 4, so points move in steps of 4 (steps of 2 only if Deputy Ministers were in the pool).
  const step = withDeputyPoints ? DEPUTY_POINTS : MINISTER_POINTS;
  const parties = Object.entries(partySeats)
    .filter(([, seats]) => seats > 0)
    .map(([partyId, seats]) => ({ partyId, seats, entitlement: 0 }))
    .sort((a, b) => b.seats - a.seats || a.partyId.localeCompare(b.partyId));
  if (!parties.length) return [];
  const units = Math.floor(totalPoints / step);
  const floor = Math.min(MINISTER_POINTS / step, Math.floor(units / parties.length));
  const funded = Math.min(parties.length, units);
  const base = floor > 0 ? floor : 1;
  parties.slice(0, floor > 0 ? parties.length : funded).forEach((party) => {
    party.entitlement = base;
  });
  const holders = parties.filter((party) => party.entitlement > 0);
  const shares = largestRemainder(units - base * holders.length, holders);
  holders.forEach((party) => {
    party.entitlement = (party.entitlement + (shares[party.partyId] ?? 0)) * step;
  });
  return parties;
}

/** Greedy: Ministers first, each to the party with the most points left to spend, then the Deputies. */
function allocateGreedily(
  parties: CabinetParty[],
  ministries: AssemblyMinistry[],
): CabinetAssignment[] | null {
  const remaining = new Map(parties.map((party) => [party.partyId, party.entitlement]));
  const seats = new Map(parties.map((party) => [party.partyId, party.seats]));
  const assignments: CabinetAssignment[] = [];
  const ordered = [...ministries].sort((a, b) => b.points - a.points || a.id - b.id);
  for (const ministry of ordered) {
    const pick = [...remaining.entries()]
      .filter(([, left]) => left >= ministry.points)
      .sort(
        (a, b) =>
          b[1] - a[1] ||
          (seats.get(b[0]) ?? 0) - (seats.get(a[0]) ?? 0) ||
          a[0].localeCompare(b[0]),
      )[0];
    if (!pick) return null;
    remaining.set(pick[0], pick[1] - ministry.points);
    assignments.push({ ministryId: ministry.id, partyId: pick[0] });
  }
  return [...remaining.values()].every((left) => left === 0) ? assignments : null;
}

/**
 * Exact search used when the greedy pass gets stuck: decides how many Ministers each party takes so
 * that the Deputy posts fill every gap and each party lands exactly on its entitlement.
 */
function allocateExactly(
  parties: CabinetParty[],
  ministries: AssemblyMinistry[],
): CabinetAssignment[] | null {
  const ministers = ministries.filter((post) => post.kind === "MINISTER").sort((a, b) => a.id - b.id);
  const deputies = ministries.filter((post) => post.kind === "DEPUTY").sort((a, b) => a.id - b.id);
  const layers: Array<Map<number, { prev: number; count: number }>> = [new Map([[0, { prev: -1, count: 0 }]])];
  for (const party of parties) {
    const next = new Map<number, { prev: number; count: number }>();
    for (const used of layers[layers.length - 1].keys()) {
      const most = Math.min(ministers.length - used, Math.floor(party.entitlement / MINISTER_POINTS));
      for (let count = 0; count <= most; count += 1) {
        const target = used + count;
        if (!next.has(target)) next.set(target, { prev: used, count });
      }
    }
    layers.push(next);
  }
  let state = ministers.length;
  if (!layers[layers.length - 1].has(state)) return null;
  const picks: number[] = [];
  for (let index = parties.length; index > 0; index -= 1) {
    const step = layers[index].get(state)!;
    picks[index - 1] = step.count;
    state = step.prev;
  }
  const minister = [...ministers];
  const deputy = [...deputies];
  const assignments: CabinetAssignment[] = [];
  parties.forEach((party, index) => {
    const count = picks[index];
    const spare = (party.entitlement - count * MINISTER_POINTS) / DEPUTY_POINTS;
    for (let i = 0; i < count; i += 1) {
      const post = minister.shift();
      if (post) assignments.push({ ministryId: post.id, partyId: party.partyId });
    }
    for (let i = 0; i < spare; i += 1) {
      const post = deputy.shift();
      if (post) assignments.push({ ministryId: post.id, partyId: party.partyId });
    }
  });
  return assignments.length === ministries.length ? assignments : null;
}

/** A complete, valid split of every ministry that respects each party's entitlement. */
export function autoAllocateMinistries(
  parties: CabinetParty[],
  ministries: AssemblyMinistry[] = MINISTER_POSTS,
): CabinetAssignment[] {
  const assignments = allocateGreedily(parties, ministries) ?? allocateExactly(parties, ministries);
  if (!assignments) throw new Error("No valid ministry split exists for these entitlements.");
  return assignments.sort((a, b) => a.ministryId - b.ministryId);
}

export function createAssemblyCabinet(
  gameId: string,
  outcome: AssemblyGovernmentOutcome,
  negotiatedDeputyCmPartyId: string | null = null,
): AssemblyCabinetSave {
  if (!outcome.rulingGroup || !outcome.chiefMinisterPartyId) {
    throw new Error("A cabinet can be formed only by a group that holds a majority.");
  }
  return {
    schemaVersion: 3,
    gameId,
    groupName: outcome.rulingGroup.name,
    chiefMinisterPartyId: outcome.chiefMinisterPartyId,
    totalPoints: TOTAL_MINISTRY_POINTS,
    parties: buildCabinetParties(outcome.rulingGroup.partySeats),
    assignments: [],
    autoAllocated: false,
    confirmed: false,
    deputyChiefMinisterPartyId: negotiatedDeputyCmPartyId,
    deputyCmDecided: Boolean(negotiatedDeputyCmPartyId),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * AI governments: each Deputy Minister goes to the party that holds the Minister of its ministry, as far as
 * that party's room allows.
 */
export function autoAssignDeputies(
  parties: CabinetParty[],
  assignments: CabinetAssignment[],
): CabinetAssignment[] {
  const held = new Map<string, number>();
  const kept = assignments.filter((item) => item.ministryId < DEPUTY_ID_BASE);
  for (const deputy of DEPUTY_POSTS) {
    const parent = kept.find((item) => item.ministryId === deputy.ministryId);
    const party = parties.find((item) => item.partyId === parent?.partyId);
    if (!party || (held.get(party.partyId) ?? 0) >= deputyRoom(party.entitlement)) continue;
    held.set(party.partyId, (held.get(party.partyId) ?? 0) + 1);
    kept.push({ ministryId: deputy.id, partyId: party.partyId });
  }
  return kept;
}

/** Points each party has spent so far. */
export function cabinetPointsUsed(save: AssemblyCabinetSave): Record<string, number> {
  const used: Record<string, number> = {};
  for (const assignment of save.assignments) {
    const ministry = ASSEMBLY_MINISTRIES.find((item) => item.id === assignment.ministryId);
    // Deputy Ministers are optional extras outside the points.
    if (ministry && ministry.kind === "MINISTER" && assignment.partyId)
      used[assignment.partyId] = (used[assignment.partyId] ?? 0) + ministry.points;
  }
  return used;
}

export interface CabinetValidation {
  ok: boolean;
  unassignedMinistryIds: number[];
  overBudgetPartyIds: string[];
  partiesWithoutMinistry: string[];
  overDeputyRoomPartyIds: string[];
}

export function validateCabinet(save: AssemblyCabinetSave): CabinetValidation {
  const used = cabinetPointsUsed(save);
  const assigned = new Set(
    save.assignments.filter((item) => item.partyId).map((item) => item.ministryId),
  );
  const unassignedMinistryIds = MINISTER_POSTS.filter(
    (ministry) => !assigned.has(ministry.id),
  ).map((ministry) => ministry.id);
  const overBudgetPartyIds = save.parties
    .filter((party) => (used[party.partyId] ?? 0) > party.entitlement)
    .map((party) => party.partyId);
  const partiesWithoutMinistry = save.parties
    .filter((party) => !save.assignments.some((item) => item.partyId === party.partyId && item.ministryId < DEPUTY_ID_BASE))
    .map((party) => party.partyId);
  const overDeputyRoomPartyIds = save.parties
    .filter((party) => save.assignments.filter((item) => item.partyId === party.partyId && item.ministryId >= DEPUTY_ID_BASE).length > deputyRoom(party.entitlement))
    .map((party) => party.partyId);
  return {
    ok:
      !unassignedMinistryIds.length && !overBudgetPartyIds.length && !partiesWithoutMinistry.length && !overDeputyRoomPartyIds.length,
    unassignedMinistryIds,
    overBudgetPartyIds,
    partiesWithoutMinistry,
    overDeputyRoomPartyIds,
  };
}

export function saveAssemblyCabinet(save: AssemblyCabinetSave): AssemblyCabinetSave {
  const next = { ...save, updatedAt: new Date().toISOString() };
  if (typeof window !== "undefined")
    window.localStorage.setItem(ASSEMBLY_CABINET_SAVE_KEY, JSON.stringify(next));
  return next;
}

/** The saved cabinet, only if it belongs to this game and this ruling group. */
export function loadAssemblyCabinet(gameId: string, groupName: string): AssemblyCabinetSave | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ASSEMBLY_CABINET_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AssemblyCabinetSave;
    if (parsed.schemaVersion !== 3 || parsed.gameId !== gameId || parsed.groupName !== groupName)
      return null;
    if (!Array.isArray(parsed.parties) || !Array.isArray(parsed.assignments)) return null;
    return { ...parsed, deputyChiefMinisterPartyId: parsed.deputyChiefMinisterPartyId ?? null, deputyCmDecided: parsed.deputyCmDecided ?? true };
  } catch {
    return null;
  }
}

export function deleteAssemblyCabinet(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(ASSEMBLY_CABINET_SAVE_KEY);
}
