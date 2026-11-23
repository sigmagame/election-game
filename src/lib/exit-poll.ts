import { hashSeed, randomFor } from "@/engine/lok-sabha-voting-engine";
import { blocKey, type LocalGroup } from "@/lib/seat-projection";
import type { VotingConstituencyResult } from "@/types/lok-sabha-voting";

/** Seat ranges in the exit poll are this share either side of the estimate (opinion polls use 10%). */
export const EXIT_POLL_MARGIN = 0.05;
/** How far each party's share in a seat can be misjudged (cross-voting, small samples). */
const SEAT_NOISE = 0.12;
/** A party's mood in a whole state can be misjudged a little as well. */
const STATE_NOISE = 0.04;

export interface ExitUnit {
  id: string;
  name: string;
  members: string[];
  alliance: boolean;
  /** The exit poll's central estimate. */
  seats: number;
  lo: number;
  hi: number;
}

export interface ExitStatePoll {
  state: string;
  total: number;
  /** Alliances (members with candidates here) and lone parties, biggest first. */
  units: ExitUnit[];
  parties: Array<{ id: string; seats: number; lo: number; hi: number }>;
  voteShare: Array<[string, number]>;
}

export interface ExitPoll {
  total: number;
  majority: number;
  /** Alliances and lone parties across the country, biggest first. */
  national: ExitUnit[];
  voteShare: Array<[string, number]>;
  states: Record<string, ExitStatePoll>;
}

const spread = (seats: number, cap: number) => {
  const d = Math.round(seats * EXIT_POLL_MARGIN);
  return { lo: Math.max(0, seats - d), hi: Math.min(cap, seats + d) };
};

/**
 * Every seat is won by exactly one side, so a top end cannot claim seats the others hold for sure:
 * it is capped at the total minus the others' low ends. Without this, NDA 14-16 can sit beside two
 * rivals holding one seat each in a 17-seat state. The low end is left alone, since a seat can
 * still slip away.
 */
function fit<T extends { lo: number; hi: number }>(items: T[], total: number): T[] {
  const sumLo = items.reduce((n, x) => n + x.lo, 0);
  return items.map((x) => ({ ...x, hi: Math.max(x.lo, Math.min(x.hi, total - (sumLo - x.lo))) }));
}

function gauss(rng: () => number) {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * The exit poll is the real result seen through a noisy lens: every party's share in every seat is
 * nudged by a small random error (plus one small error per party per state), the seat goes to
 * whoever leads after that, and seat totals get a plus or minus 5% range. Most seats are called
 * right; a few close ones are not. The same game always gives the same exit poll.
 */
export function buildExitPoll(opts: {
  gameId: string;
  results: VotingConstituencyResult[];
  groupsByState: Record<string, LocalGroup[]>;
  playerAllianceName: string;
  majority: number;
}): ExitPoll {
  const { gameId, results, groupsByState, playerAllianceName, majority } = opts;
  const bias = new Map<string, number>();
  const stateBias = (state: string, party: string) => {
    const key = `${state}|${party}`;
    if (!bias.has(key)) bias.set(key, gauss(randomFor(hashSeed(`${gameId}:exit:${key}`))) * STATE_NOISE);
    return bias.get(key)!;
  };

  type Seat = { state: string; winner: string; weights: Record<string, number> };
  const seats: Seat[] = results.map((r) => {
    const rng = randomFor(hashSeed(`${gameId}:exit:seat:${r.constituencyId}`));
    const weights: Record<string, number> = {};
    for (const [party, votes] of Object.entries(r.partyVotes).sort((a, b) => a[0].localeCompare(b[0]))) {
      weights[party] = votes * Math.exp(gauss(rng) * SEAT_NOISE + stateBias(r.state, party));
    }
    const winner = Object.entries(weights).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? r.winnerPartyId;
    return { state: r.state, winner, weights };
  });

  const shareOf = (list: Seat[]): Array<[string, number]> => {
    const sum: Record<string, number> = {};
    let all = 0;
    for (const s of list) for (const [id, w] of Object.entries(s.weights)) { sum[id] = (sum[id] ?? 0) + w; all += w; }
    return Object.entries(sum).map(([id, w]) => [id, all ? (w / all) * 100 : 0] as [string, number]).sort((a, b) => b[1] - a[1]);
  };

  const byState = new Map<string, Seat[]>();
  for (const s of seats) byState.set(s.state, [...(byState.get(s.state) ?? []), s]);

  const states: Record<string, ExitStatePoll> = {};
  const nationalBlocs = new Map<string, ExitUnit>();
  const nationalLone = new Map<string, ExitUnit>();
  const contestedNational = new Map<string, number>();

  for (const [state, list] of byState) {
    const wins: Record<string, number> = {};
    const contested: Record<string, number> = {};
    for (const s of list) {
      wins[s.winner] = (wins[s.winner] ?? 0) + 1;
      for (const id of Object.keys(s.weights)) contested[id] = (contested[id] ?? 0) + 1;
    }
    const groups = (groupsByState[state] ?? []).filter((g) => g.type !== "INDEPENDENT");
    const inGroup = new Set(groups.flatMap((g) => g.memberPartyIds));
    const units: ExitUnit[] = [];
    const sumOf = (ids: string[], m: Record<string, number>) => ids.reduce((n, id) => n + (m[id] ?? 0), 0);

    for (const g of groups) {
      const members = g.memberPartyIds.filter((id) => (contested[id] ?? 0) > 0);
      if (!members.length) continue;
      const seatsWon = sumOf(members, wins);
      const bloc = blocKey(g as LocalGroup, playerAllianceName);
      // Every seat has one candidate per alliance, so contested seats are the seats where any member stands.
      const cap = list.filter((s) => members.some((id) => id in s.weights)).length;
      units.push({ id: bloc.id, name: bloc.name, members, alliance: true, seats: seatsWon, ...spread(seatsWon, cap) });
      const agg = nationalBlocs.get(bloc.id) ?? { id: bloc.id, name: bloc.name, members: [], alliance: true, seats: 0, lo: 0, hi: 0 };
      agg.seats += seatsWon;
      agg.members = [...new Set([...agg.members, ...members])];
      nationalBlocs.set(bloc.id, agg);
      contestedNational.set(bloc.id, (contestedNational.get(bloc.id) ?? 0) + cap);
    }
    for (const id of Object.keys(contested)) {
      if (inGroup.has(id)) continue;
      const seatsWon = wins[id] ?? 0;
      units.push({ id, name: id, members: [id], alliance: false, seats: seatsWon, ...spread(seatsWon, contested[id]) });
      const agg = nationalLone.get(id) ?? { id, name: id, members: [id], alliance: false, seats: 0, lo: 0, hi: 0 };
      agg.seats += seatsWon;
      nationalLone.set(id, agg);
      contestedNational.set(id, (contestedNational.get(id) ?? 0) + contested[id]);
    }
    states[state] = {
      state,
      total: list.length,
      units: fit(units, list.length).filter((u) => u.seats >= 1 || u.hi >= 1).sort((a, b) => b.seats - a.seats || b.hi - a.hi),
      parties: fit(Object.keys(contested).map((id) => ({ id, seats: wins[id] ?? 0, ...spread(wins[id] ?? 0, contested[id]) })), list.length)
        .filter((p) => p.hi >= 1)
        .sort((a, b) => b.seats - a.seats || b.hi - a.hi),
      voteShare: shareOf(list),
    };
  }

  const national = fit(
    [...nationalBlocs.values(), ...nationalLone.values()].map((u) => ({ ...u, ...spread(u.seats, Math.min(seats.length, contestedNational.get(u.id) ?? seats.length)) })),
    seats.length,
  )
    .filter((u) => u.hi >= 1)
    .sort((a, b) => b.seats - a.seats || b.hi - a.hi);

  return { total: seats.length, majority, national, voteShare: shareOf(seats), states };
}
