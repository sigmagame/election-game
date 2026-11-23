/**
 * Assembly counting rounds: how many rounds each assembly constituency's count takes.
 *
 * The rule:
 *  1. A polling station holds at most 2,000 registered voters, so a seat has
 *     ceil(registered electors / 2000) polling stations.
 *  2. Each round counts 15 polling stations, so a seat needs ceil(polling stations / 15) rounds.
 *     The next whole number is always used: a seat that works out at 14.2 rounds takes 15, because
 *     some voter data is validated along the way.
 *  3. No seat takes more than 23 rounds. A seat over the limit still finishes in 23 rounds, and each
 *     of its rounds counts more polling stations.
 *
 * Registered electors are what is counted, because the data is collected station by station: unvoted
 * people are never held in one station.
 */
import seatData from "@/data/assembly-constituencies-2024.json";

export const MAX_VOTERS_PER_STATION = 2000;
export const STATIONS_PER_ROUND = 15;
export const MAX_ROUNDS = 23;

export interface CountingPlan {
  /** Polling stations in the assembly constituency. */
  stations: number;
  /** Rounds the count takes (1 to MAX_ROUNDS). */
  rounds: number;
  /** Polling stations counted in each round, in order. Adds up to `stations`. */
  stationsInRound: number[];
}

/** Polling stations of an assembly constituency with this many registered electors. */
export function pollingStationsFor(registeredElectors: number): number {
  return Math.max(1, Math.ceil(registeredElectors / MAX_VOTERS_PER_STATION));
}

/** Rounds a seat with this many polling stations needs, never more than MAX_ROUNDS. */
export function roundsFor(stations: number): number {
  return Math.min(MAX_ROUNDS, Math.max(1, Math.ceil(stations / STATIONS_PER_ROUND)));
}

/** The full counting plan of one seat. */
export function countingPlanFor(registeredElectors: number): CountingPlan {
  const stations = pollingStationsFor(registeredElectors);
  const rounds = roundsFor(stations);
  // Spread the stations as evenly as possible over the rounds, earlier rounds taking any extra one.
  const base = Math.floor(stations / rounds);
  const extra = stations % rounds;
  const stationsInRound = Array.from({ length: rounds }, (_, index) => base + (index < extra ? 1 : 0));
  return { stations, rounds, stationsInRound };
}

interface SeatRow {
  id: string;
  registeredElectors: number;
}

/** Counting plans for every seat in the data file, keyed by constituency id. */
export function buildCountingPlans(): Record<string, CountingPlan> {
  const rows = (seatData as unknown as { constituencies: SeatRow[] }).constituencies;
  return Object.fromEntries(rows.map((row) => [row.id, countingPlanFor(row.registeredElectors)]));
}

/** The highest round count of any seat: the length of the counting day. */
export function longestCount(plans: Record<string, CountingPlan>): number {
  return Math.max(...Object.values(plans).map((plan) => plan.rounds));
}
