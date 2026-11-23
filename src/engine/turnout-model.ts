import regionsData from "@/data/assembly-regions-2024.json";

/**
 * Turnout is generated for every new game instead of being read from historical polled-vote data.
 * Each level shifts the level below it, so seats in the same state (and, for Assembly games, the
 * same region) move together while individual constituencies still differ. Nothing here depends on
 * whether a seat is urban or rural, so either can end up with the higher turnout in any given game.
 *
 * The result always stays within TURNOUT_MIN..TURNOUT_MAX (as a fraction of registered electors).
 */
export const TURNOUT_MIN = 0.7;
export const TURNOUT_MAX = 0.95;
/** NOTA as a share of the votes polled in a constituency. */
export const NOTA_MIN = 0.005;
export const NOTA_MAX = 0.015;

const CENTER = 0.825;
const NATIONAL_SWING = 0.04;
const STATE_SWING = 0.05;
const REGION_SWING = 0.03;
const SEAT_SWING = 0.04;
/** Width of the band used to bring an out-of-range value back inside the limits. */
const EDGE_BAND = 0.03;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function random(seed: string): () => number {
  let x = hash(seed);
  return () => {
    x += 0x6d2b79f5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A repeatable value in -1..1 for one named level (national, state, region) of one game. */
function offset(seed: string): number {
  return random(seed)() * 2 - 1;
}

const regionBySeat = new Map<string, string>();
for (const state of regionsData.states)
  for (const region of state.regions)
    for (const id of region.constituencyIds) regionBySeat.set(id, `${state.stateId}:${region.id}`);

export interface TurnoutInput {
  gameId: string;
  /** "assembly" or "lok-sabha"; keeps the two kinds of game independent. */
  scope: string;
  state: string;
  constituencyId: string;
}

export function generateTurnout(input: TurnoutInput): number {
  const { gameId, scope, state, constituencyId } = input;
  const region = regionBySeat.get(constituencyId);
  const seatRng = random(`${gameId}:${scope}:${constituencyId}:turnout`);
  const seatNoise = (seatRng() + seatRng()) - 1; // -1..1, centred
  let turnout =
    CENTER +
    offset(`${gameId}:${scope}:turnout-national`) * NATIONAL_SWING +
    offset(`${gameId}:${scope}:turnout-state:${state}`) * STATE_SWING +
    (region ? offset(`${gameId}:${scope}:turnout-region:${region}`) * REGION_SWING : 0) +
    seatNoise * SEAT_SWING;
  if (turnout < TURNOUT_MIN) turnout = TURNOUT_MIN + seatRng() * EDGE_BAND;
  else if (turnout > TURNOUT_MAX) turnout = TURNOUT_MAX - seatRng() * EDGE_BAND;
  return turnout;
}

export function generateNotaRate(rng: () => number): number {
  return NOTA_MIN + rng() * (NOTA_MAX - NOTA_MIN);
}
