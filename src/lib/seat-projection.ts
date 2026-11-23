import type { ConstituencyPartySupport } from "@/types/lok-sabha-campaign";

/** A seat decided by this many points or fewer could still go to the runner-up. */
export const CLOSE_MARGIN = 4;
/** Even if few seats are close, a winning party can lose about this share of its seats. */
export const MIN_SLACK = 0.1;

export interface PartyRange {
  partyId: string;
  /** Seats the game projects (never shown to the player on its own). */
  seats: number;
  /** Seats the party actually contests in this set of constituencies. */
  contested: number;
  lo: number;
  hi: number;
}

export const rangeText = (r: { lo: number; hi: number }) => (r.lo === r.hi ? `${r.lo}` : `${r.lo}–${r.hi}`);

/**
 * Seat range for every party over a set of constituencies (one state, or the whole country).
 *
 * A winner can lose its at-risk seats: every seat decided by CLOSE_MARGIN points or fewer, and at
 * least the closest MIN_SLACK share of its seats. A lost seat can only go to that seat's own
 * runner-up, so each at-risk seat adds one to its runner-up's top end. A party's top end never
 * passes the seats it contests.
 */
export function projectPartyRanges(rows: ConstituencyPartySupport[], winnerBySeat: Map<string, string>): Record<string, PartyRange> {
  const out: Record<string, PartyRange> = {};
  const get = (id: string) => (out[id] ??= { partyId: id, seats: 0, contested: 0, lo: 0, hi: 0 });
  const wins: Record<string, Array<{ margin: number; runnerUp: string | null }>> = {};

  for (const row of rows) {
    const entries = Object.entries(row.partySupport).sort((a, b) => b[1] - a[1]);
    if (!entries.length) continue;
    entries.forEach(([id]) => { get(id).contested += 1; });
    const winner = winnerBySeat.get(row.constituencyId) ?? entries[0][0];
    const runner = entries.find(([id]) => id !== winner);
    const margin = runner ? (row.partySupport[winner] ?? 0) - runner[1] : 100;
    get(winner).seats += 1;
    (wins[winner] ??= []).push({ margin, runnerUp: runner ? runner[0] : null });
  }

  const gains: Record<string, number> = {};
  for (const [id, seats] of Object.entries(wins)) {
    const sorted = [...seats].sort((a, b) => a.margin - b.margin);
    const close = sorted.filter((s) => s.margin <= CLOSE_MARGIN).length;
    const atRisk = Math.min(sorted.length, Math.max(close, Math.round(sorted.length * MIN_SLACK)));
    out[id].lo = sorted.length - atRisk;
    for (const s of sorted.slice(0, atRisk)) if (s.runnerUp) gains[s.runnerUp] = (gains[s.runnerUp] ?? 0) + 1;
  }
  for (const p of Object.values(out)) {
    if (!wins[p.partyId]) p.lo = 0;
    p.hi = Math.min(p.contested, p.seats + (gains[p.partyId] ?? 0));
  }
  return out;
}

/** An alliance is the sum of its members: each seat has one candidate per alliance, so nothing is counted twice. */
export function clubRanges(memberIds: string[], ranges: Record<string, PartyRange>) {
  let lo = 0;
  let hi = 0;
  for (const id of memberIds) {
    lo += ranges[id]?.lo ?? 0;
    hi += ranges[id]?.hi ?? 0;
  }
  return { lo, hi };
}

export interface BlocRange {
  id: string;
  name: string;
  members: string[];
  seats: number;
  lo: number;
  hi: number;
}

export interface NationalProjection {
  parties: Record<string, PartyRange>;
  blocs: BlocRange[];
  /** Parties counted on their own: seats won where they contest without an alliance. */
  lone: PartyRange[];
}

export interface LocalGroup {
  name: string;
  type: string;
  memberPartyIds: string[];
  isPlayerAlliance: boolean;
}

// Same naming rules the final report uses, so alliance ids line up with it.
export function blocKey(group: LocalGroup, playerAllianceName: string) {
  const raw = (group.isPlayerAlliance ? playerAllianceName : group.name).trim();
  const normalized = raw.toLocaleLowerCase().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    "nda": "nda",
    "national democratic alliance": "nda",
    "india": "india alliance",
    "india alliance": "india alliance",
    "indian national development inclusive alliance": "india alliance",
  };
  const key = aliases[normalized] ?? normalized;
  const name = key === "nda" ? "NDA" : key === "india alliance" ? "INDIA Alliance" : raw;
  return { id: `BLOC:${key}`, name };
}

/**
 * National ranges, built from the bottom: every state is projected party by party, an alliance is
 * the sum of its members' ranges in each state it exists in, and a party's national range is the
 * sum of its state ranges. Alliance membership is state-specific, as in the game setup.
 */
export function projectNational(
  rows: ConstituencyPartySupport[],
  winnerBySeat: Map<string, string>,
  groupsByState: Record<string, LocalGroup[]>,
  playerAllianceName: string,
): NationalProjection {
  const byState = new Map<string, ConstituencyPartySupport[]>();
  for (const row of rows) {
    const list = byState.get(row.state) ?? [];
    list.push(row);
    byState.set(row.state, list);
  }
  const parties: Record<string, PartyRange> = {};
  const blocs = new Map<string, BlocRange & { memberSet: Set<string> }>();
  const lone = new Map<string, PartyRange>();
  const add = (target: { seats: number; lo: number; hi: number }, r: { seats: number; lo: number; hi: number }) => {
    target.seats += r.seats;
    target.lo += r.lo;
    target.hi += r.hi;
  };

  for (const [state, stateRows] of byState) {
    const ranges = projectPartyRanges(stateRows, winnerBySeat);
    const inGroup = new Set<string>();
    for (const r of Object.values(ranges)) {
      add((parties[r.partyId] ??= { partyId: r.partyId, seats: 0, contested: 0, lo: 0, hi: 0 }), r);
      parties[r.partyId].contested += r.contested;
    }
    for (const group of (groupsByState[state] ?? []).filter((g) => g.type !== "INDEPENDENT")) {
      const bloc = blockOf(group);
      const entry = blocs.get(bloc.id) ?? { id: bloc.id, name: bloc.name, members: [], memberSet: new Set<string>(), seats: 0, lo: 0, hi: 0 };
      for (const id of group.memberPartyIds) {
        entry.memberSet.add(id);
        inGroup.add(id);
        if (ranges[id]) add(entry, ranges[id]);
      }
      blocs.set(bloc.id, entry);
    }
    for (const r of Object.values(ranges)) {
      if (inGroup.has(r.partyId)) continue;
      add(lone.get(r.partyId) ?? (lone.set(r.partyId, { partyId: r.partyId, seats: 0, contested: 0, lo: 0, hi: 0 }), lone.get(r.partyId)!), r);
    }
  }
  function blockOf(group: LocalGroup) {
    return blocKey(group, playerAllianceName);
  }
  return {
    parties,
    blocs: [...blocs.values()].map(({ memberSet, ...rest }) => ({ ...rest, members: [...memberSet] })),
    lone: [...lone.values()],
  };
}
