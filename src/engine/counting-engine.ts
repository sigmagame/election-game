/**
 * Counting day. Turns the votes the voting step already decided into a round-by-round count.
 *
 * Nothing here changes a result. Every seat's final votes are exactly what voting produced; counting
 * only decides how those votes appear round by round. Each round counts a batch of polling stations,
 * and a party's share of a batch wobbles a little around its true strength, so close seats can swap
 * the lead between rounds while landslide seats never do. The same game always counts the same way.
 *
 * A seat is declared Won as soon as one party holds more than half of every vote polled in it (nobody
 * can catch up after that), or when its last round closes. Rounds after an early win still run, so the
 * final margin is only known at the end.
 */
import { hashSeed, randomFor } from "@/engine/lok-sabha-voting-engine";
import { blocKey, type LocalGroup } from "@/lib/seat-projection";

/** The parties tracked round by round in each seat. Anyone further back cannot lead. */
const TRACKED_PARTIES = 4;
/** How much one polling station's share can differ from the seat's true share (before averaging over a round). */
const STATION_NOISE = 0.9;
/** How far a party's strength can drift between the first and the last round (urban boxes first, and so on). */
const DRIFT = 0.1;

export interface CountingPlanLike {
  stations: number;
  rounds: number;
  stationsInRound: number[];
}

export interface CountingSeatInput {
  id: string;
  name: string;
  /** The state (Lok Sabha) or region (Assembly) the seat is shown under. */
  group: string;
  /** The state the seat belongs to, used to find the alliance a party stands in. */
  state: string;
  totalVotes: number;
  partyVotes: Record<string, number>;
  winnerPartyId: string;
  plan: CountingPlanLike;
}

export interface SeatCount {
  id: string;
  name: string;
  group: string;
  state: string;
  totalVotes: number;
  rounds: number;
  stations: number;
  /** Round in which the seat is declared Won (an early win, or its last round). */
  wonAt: number;
  /** Whether the seat was won before its last round. */
  early: boolean;
  /** The tracked parties, biggest first (by final votes). */
  parties: string[];
  /** cum[r - 1][i] = votes party i has after round r. The last row is the final result. */
  cum: number[][];
  /** Share of the seat's stations counted after each round, 0 to 1. */
  counted: number[];
  winnerPartyId: string;
  finalMargin: number;
}

export interface SeatView {
  /** Round shown for this seat: the clock round, or the seat's own last round if it has finished. */
  round: number;
  done: boolean;
  won: boolean;
  /** Won before its last round (rounds still to count). */
  wonEarly: boolean;
  leaderId: string;
  leaderVotes: number;
  runnerId: string;
  runnerVotes: number;
  lead: number;
  /** Share of all polled votes the leader holds. */
  leaderShare: number;
  /** The lead changed hands in this round. */
  changed: boolean;
}

function gauss(rng: () => number) {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** The full count of one seat. */
export function countSeat(gameId: string, seat: CountingSeatInput): SeatCount {
  const ranked = Object.entries(seat.partyVotes)
    .filter(([, votes]) => votes > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // Make sure the real winner leads the tracked list, so the last round always ends on the real result.
  const winnerAt = ranked.findIndex(([id]) => id === seat.winnerPartyId);
  if (winnerAt > 0) ranked.unshift(...ranked.splice(winnerAt, 1));
  const tracked = ranked.slice(0, TRACKED_PARTIES);
  const { rounds, stationsInRound, stations } = seat.plan;
  const rng = randomFor(hashSeed(`${gameId}:count:${seat.id}`));

  // weight[i][r]: how much of party i's total falls in round r.
  const weights = tracked.map(() => {
    const drift = gauss(rng) * DRIFT;
    return stationsInRound.map((n, r) => {
      const trend = drift * (2 * ((r + 0.5) / rounds) - 1);
      return n * Math.max(0.15, 1 + (STATION_NOISE * gauss(rng)) / Math.sqrt(n) + trend);
    });
  });
  const cum: number[][] = Array.from({ length: rounds }, () => []);
  tracked.forEach(([, finalVotes], i) => {
    const sum = weights[i].reduce((a, b) => a + b, 0);
    let run = 0;
    for (let r = 0; r < rounds; r++) {
      run += weights[i][r];
      cum[r][i] = r === rounds - 1 ? finalVotes : Math.min(finalVotes, Math.round((finalVotes * run) / sum));
    }
  });

  const counted: number[] = [];
  let stationsDone = 0;
  for (const n of stationsInRound) {
    stationsDone += n;
    counted.push(stationsDone / stations);
  }

  // Declared Won once the leader holds more than half of all polled votes (or at the last round).
  let wonAt = rounds;
  for (let r = 0; r < rounds; r++) {
    if (cum[r][0] * 2 > seat.totalVotes) {
      wonAt = r + 1;
      break;
    }
  }
  const margin = tracked.length > 1 ? tracked[0][1] - tracked[1][1] : tracked[0]?.[1] ?? 0;
  return {
    id: seat.id,
    name: seat.name,
    group: seat.group,
    state: seat.state,
    totalVotes: seat.totalVotes,
    rounds,
    stations,
    wonAt,
    early: wonAt < rounds,
    parties: tracked.map(([id]) => id),
    cum,
    counted,
    winnerPartyId: seat.winnerPartyId,
    finalMargin: margin,
  };
}

/** The counts of every seat. */
export function buildCounts(gameId: string, seats: CountingSeatInput[]): SeatCount[] {
  return seats.map((seat) => countSeat(gameId, seat));
}

/** The longest seat decides how many rounds the counting day lasts. */
export function longestRound(counts: SeatCount[]): number {
  return counts.reduce((n, c) => Math.max(n, c.rounds), 1);
}

function standing(count: SeatCount, round: number) {
  const row = count.cum[Math.min(Math.max(round, 1), count.rounds) - 1];
  const order = count.parties.map((id, i) => ({ id, votes: row[i] })).sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id));
  return order;
}

/** How a seat looks after the given clock round (0 = counting has not begun). */
export function seatAt(count: SeatCount, clock: number): SeatView | null {
  if (clock < 1) return null;
  const round = Math.min(clock, count.rounds);
  const order = standing(count, round);
  const done = clock >= count.rounds;
  const won = clock >= count.wonAt;
  // Once won, the leader is the real winner (nobody can pass a party that holds more than half).
  const first = won ? { id: count.winnerPartyId, votes: order.find((o) => o.id === count.winnerPartyId)?.votes ?? order[0].votes } : order[0];
  const second = order.find((o) => o.id !== first.id);
  let changed = false;
  if (round > 1) changed = standing(count, round - 1)[0].id !== order[0].id;
  return {
    round,
    done,
    won,
    wonEarly: won && !done,
    leaderId: first.id,
    leaderVotes: first.votes,
    runnerId: second?.id ?? "",
    runnerVotes: second?.votes ?? 0,
    lead: first.votes - (second?.votes ?? 0),
    leaderShare: count.totalVotes ? first.votes / count.totalVotes : 0,
    changed,
  };
}

/** Share of all votes counted across the election after the given clock round. */
export function countedShare(counts: SeatCount[], clock: number): number {
  let all = 0;
  let done = 0;
  for (const c of counts) {
    all += c.totalVotes;
    if (clock >= 1) done += c.totalVotes * c.counted[Math.min(clock, c.rounds) - 1];
  }
  return all ? done / all : 0;
}

/** Rounds in which the lead changed hands, for the round-by-round panel. */
export function leadChanges(count: SeatCount, clock: number): number[] {
  const out: number[] = [];
  const upTo = Math.min(clock, count.rounds);
  for (let r = 2; r <= upTo; r++) {
    if (standing(count, r)[0].id !== standing(count, r - 1)[0].id) out.push(r);
  }
  return out;
}

/** An alliance or a party contesting alone, as the exit poll and the results group them. */
export interface CountUnit {
  id: string;
  name: string;
  alliance: boolean;
  isPlayer: boolean;
  members: string[];
}

export interface UnitContext {
  groupsByState: Record<string, LocalGroup[]>;
  playerAllianceName: string;
  playerPartyId: string;
}

/** The unit a party stands in within a state: its alliance, or itself when it contests alone. */
export function unitOf(ctx: UnitContext, state: string, partyId: string): CountUnit {
  const group = (ctx.groupsByState[state] ?? []).find((g) => g.type !== "INDEPENDENT" && g.memberPartyIds.includes(partyId));
  if (!group) return { id: partyId, name: partyId, alliance: false, isPlayer: partyId === ctx.playerPartyId, members: [partyId] };
  const bloc = blocKey(group, ctx.playerAllianceName);
  return { id: bloc.id, name: bloc.name, alliance: true, isPlayer: group.isPlayerAlliance, members: group.memberPartyIds };
}
