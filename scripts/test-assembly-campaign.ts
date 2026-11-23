/**
 * Tests for the Assembly game field and the 8-week Assembly campaign, using the real datasets.
 * Run with:  npm run test:assembly   (uses `npx tsx`)
 *
 * Every state and union territory is played through a complete campaign, so a data problem in any
 * one of them (missing strengths, impossible groupings, ...) fails here and not in the browser.
 */
import assert from "node:assert/strict";
import regionData from "@/data/assembly-regions-2024.json";
import constituencyData from "@/data/assembly-constituencies-2024.json";
import { getPoliticalRelationship } from "@/engine/alliance-engine";
import {
  ASSEMBLY_CAMPAIGN_ACTIONS_PER_WEEK,
  ASSEMBLY_CAMPAIGN_WEEKS,
  acknowledgeCampaignEvent,
  completeAssemblyCampaignWeek,
  continueAssemblyCampaignWeek,
  createAssemblyCampaign,
  getAssemblyMajority,
  getAssemblyRegionSupport,
  queueAssemblyCampaignAction,
  removeAssemblyCampaignAction,
  CAMPAIGN_ACTIONS,
} from "@/engine/assembly-campaign-engine";
import { createAssemblyGame, loadAssemblyGame, toCampaignGame, type AssemblyGameSave } from "@/engine/assembly-game-engine";
import type { AssemblyRegionState, AssemblySeatAllocation } from "@/engine/assembly-seat-allocation-engine";
import {
  buildFinalCampaignReport,
  calculateConstituencyCampaignImpact,
  getActionRepetitionMultiplier,
} from "@/engine/lok-sabha-campaign-engine";
import { ASSEMBLY_PROFILE } from "@/types/campaign-profile";
import { distributeByStrength, getEligiblePartyIdsForState, getPartyStrength } from "@/engine/lok-sabha-game-engine";
import type { AssemblyConstituency } from "@/types/constituency";
import type { CampaignActionRecord, CampaignActionType, ConstituencyPartySupport } from "@/types/lok-sabha-campaign";

// ---- seeded environment ----------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(7);

const states = (regionData as unknown as { states: AssemblyRegionState[] }).states;
const allConstituencies = (constituencyData as unknown as { constituencies: AssemblyConstituency[] }).constituencies;

// ---- helpers ---------------------------------------------------------------------------------
/** Splits every region's seats among the player's alliance by strength, as a confirmed allocation. */
function allocationFor(stateData: AssemblyRegionState, partyIds: string[]): AssemblySeatAllocation {
  const regionalShares = stateData.regions.map((region) => {
    const plan = distributeByStrength(partyIds, stateData.state, region.constituencyIds.length);
    return {
      regionId: region.id,
      regionName: region.name,
      totalSeats: region.constituencyIds.length,
      partyShares: partyIds.map((partyId) => ({ partyId, seats: plan[partyId] ?? 0 })),
    };
  });
  return {
    state: stateData.state,
    stateId: stateData.stateId,
    partyIds,
    regionalShares,
    regionalAllocations: stateData.regions.map((region, index) => {
      let cursor = 0;
      return {
        regionId: region.id,
        selections: regionalShares[index].partyShares.map((share) => {
          const constituencyIds = region.constituencyIds.slice(cursor, cursor + share.seats);
          cursor += share.seats;
          return { partyId: share.partyId, constituencyIds };
        }),
      };
    }),
  };
}

function strongestParty(state: string): string {
  return [...getEligiblePartyIdsForState(state)].sort((a, b) => (getPartyStrength(b, state) ?? 0) - (getPartyStrength(a, state) ?? 0))[0];
}

function newGame(stateData: AssemblyRegionState, withPartner = false): AssemblyGameSave {
  const state = stateData.state;
  const player = strongestParty(state);
  const partners = withPartner
    ? getEligiblePartyIdsForState(state).filter((id) => {
        if (id === player) return false;
        const relation = getPoliticalRelationship(player, id, { region: state, electionType: "ASSEMBLY" }).relationship;
        return relation === "STRONG_ALLY" || relation === "FRIENDLY";
      }).slice(0, 1)
    : [];
  const partyIds = [player, ...partners];
  return createAssemblyGame({
    setup: {
      state,
      playerPartyId: player,
      allianceName: partners.length ? "Test Front" : "Independent",
      partyIds,
      allianceType: partners.length ? "alliance" : "independent",
    },
    allocation: allocationFor(stateData, partyIds),
    stateData,
    constituencies: allConstituencies.filter((item) => item.state === state),
  });
}

const ACTIONS = CAMPAIGN_ACTIONS.map((item) => item.id);

/** Plays all 8 weeks, spreading the six weekly actions over the state's regions. */
function playFullCampaign(game: AssemblyGameSave) {
  const regions = toCampaignGame(game).regions![game.state];
  let campaign = createAssemblyCampaign(game, Math.random);
  for (let week = 1; week <= ASSEMBLY_CAMPAIGN_WEEKS; week += 1) {
    for (let i = 0; i < ASSEMBLY_CAMPAIGN_ACTIONS_PER_WEEK; i += 1) {
      campaign = queueAssemblyCampaignAction(campaign, game, ACTIONS[(week + i) % ACTIONS.length], regions[(week + i) % regions.length].id);
    }
    campaign = completeAssemblyCampaignWeek(campaign, game);
    if (week < ASSEMBLY_CAMPAIGN_WEEKS) {
      for (const event of campaign.activeEvents) {
        if (event.priority === "CRITICAL" && !event.acknowledged) campaign = acknowledgeCampaignEvent(campaign, event.id);
      }
      campaign = continueAssemblyCampaignWeek(campaign);
    }
  }
  return campaign;
}

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// ---- the field -------------------------------------------------------------------------------
test("every state: each constituency gets the player's candidate plus rival candidates", () => {
  for (const stateData of states) {
    const game = newGame(stateData);
    const eligible = new Set(getEligiblePartyIdsForState(stateData.state));
    assert.equal(game.constituencies.length, stateData.regions.reduce((n, r) => n + r.constituencyIds.length, 0), stateData.state);
    for (const seat of game.constituencies) {
      const parties = seat.allocations.map((a) => a.partyId);
      assert.equal(new Set(parties).size, parties.length, `${stateData.state}/${seat.name}: duplicate contestant`);
      assert.ok(parties.includes(seat.allocatedPartyId), `${stateData.state}/${seat.name}: player candidate missing`);
      for (const partyId of parties) assert.ok(eligible.has(partyId), `${stateData.state}: ${partyId} has no foothold`);
    }
    assert.ok(game.stateAllianceGroups[stateData.state].length >= 1, stateData.state);
  }
});

test("an alliance game keeps the player's partner in the player's group", () => {
  const stateData = states.find((s) => s.state === "Telangana")!;
  const game = newGame(stateData, true);
  const group = game.stateAllianceGroups[stateData.state].find((g) => g.isPlayerAlliance)!;
  assert.ok(group, "player group exists");
  assert.ok(group.memberPartyIds.includes(game.playerPartyId));
  assert.equal(game.allianceType, game.partyIds.length > 1 ? "alliance" : "independent");
});

// ---- the campaign ----------------------------------------------------------------------------
test("every state: a full 8-week campaign runs and ends in a consistent final report", () => {
  for (const stateData of states) {
    const game = newGame(stateData);
    const campaign = playFullCampaign(game);
    const report = campaign.finalReport;
    assert.ok(report, `${stateData.state}: no final report`);
    assert.equal(campaign.status, "FINAL_REPORT", stateData.state);
    assert.equal(campaign.completedWeeks.length, 8, stateData.state);
    assert.equal(report.totalSeats, game.totalConstituencies, stateData.state);
    assert.equal(report.majorityMark, Math.floor(game.totalConstituencies / 2) + 1, stateData.state);
    assert.equal(report.majorityMark, getAssemblyMajority(game));
    assert.equal(report.partyRows.reduce((n, r) => n + r.projectedSeats, 0), game.totalConstituencies, `${stateData.state}: seats do not add up`);
    assert.equal(report.projectedConstituencyWinners.length, game.totalConstituencies, stateData.state);
    for (const seat of campaign.constituencySupport) {
      const total = Object.values(seat.partySupport).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(total - 100) < 0.01, `${stateData.state}: support sums to ${total}`);
    }
  }
});

test("the campaign is exactly 8 weeks of 6 actions", () => {
  const game = newGame(states.find((s) => s.state === "Goa")!);
  const region = toCampaignGame(game).regions!["Goa"][0].id;
  let campaign = createAssemblyCampaign(game, Math.random);
  assert.equal(campaign.actionsRemaining, 6);
  for (let i = 0; i < 6; i += 1) campaign = queueAssemblyCampaignAction(campaign, game, ACTIONS[i], region);
  assert.equal(campaign.actionsRemaining, 0);
  assert.throws(() => queueAssemblyCampaignAction(campaign, game, "ROADSHOW", region), /six-action limit/);
  const finished = playFullCampaign(game);
  assert.throws(() => continueAssemblyCampaignWeek(finished), /8-week campaign is complete/);
});

test("removing a queued action frees a slot", () => {
  const game = newGame(states.find((s) => s.state === "Goa")!);
  const region = toCampaignGame(game).regions!["Goa"][0].id;
  let campaign = queueAssemblyCampaignAction(createAssemblyCampaign(game, Math.random), game, "PUBLIC_RALLY", region);
  campaign = removeAssemblyCampaignAction(campaign, campaign.playerActions[0].id);
  assert.equal(campaign.actionsRemaining, 6);
});

test("an action in an unknown region is rejected", () => {
  const game = newGame(states.find((s) => s.state === "Goa")!);
  assert.throws(() => queueAssemblyCampaignAction(createAssemblyCampaign(game, Math.random), game, "PUBLIC_RALLY", "no-such-region"), /Unknown campaign region/);
});

test("a region-targeted action only affects constituencies of that region", () => {
  const rows: ConstituencyPartySupport[] = [
    { constituencyId: "IN", state: "Goa", partySupport: { A: 50, B: 50 } },
    { constituencyId: "OUT", state: "Goa", partySupport: { A: 50, B: 50 } },
  ];
  const action: CampaignActionRecord = {
    id: "a1", week: 1, partyId: "A", actionType: "PUBLIC_RALLY", state: "Goa", createdAt: "x",
    targetRegionId: "r1", targetConstituencyIds: ["IN"],
  };
  const inside = calculateConstituencyCampaignImpact(rows[0], 1, [action]);
  const outside = calculateConstituencyCampaignImpact(rows[1], 1, [action]);
  assert.ok((inside.partyImpacts.A?.totalImpactPoints ?? 0) > 0);
  assert.equal(outside.partyImpacts.A, undefined);
  // An action without a region target still covers the whole state (Lok Sabha behaviour).
  const statewide = { ...action, targetRegionId: undefined, targetConstituencyIds: undefined };
  assert.ok((calculateConstituencyCampaignImpact(rows[1], 1, [statewide]).partyImpacts.A?.totalImpactPoints ?? 0) > 0);
});

test("repeating an action in the same region loses effect; another region does not", () => {
  const base = { partyId: "A", actionType: "PUBLIC_RALLY" as CampaignActionType, state: "Goa" };
  const week1: CampaignActionRecord = { ...base, id: "w1", week: 1, createdAt: "1", targetRegionId: "north" };
  const sameRegion = { ...base, week: 2, createdAt: "2", targetRegionId: "north" };
  const otherRegion = { ...base, week: 2, createdAt: "2", targetRegionId: "south" };
  assert.equal(getActionRepetitionMultiplier(sameRegion, [week1]), 0.9);
  assert.equal(getActionRepetitionMultiplier(otherRegion, [week1]), 1);
});

test("AI parties campaign by region, and events stay inside the state", () => {
  for (const name of ["Telangana", "Goa", "Uttar Pradesh"]) {
    const stateData = states.find((s) => s.state === name)!;
    const game = newGame(stateData);
    const campaign = playFullCampaign(game);
    const regionIds = new Set(stateData.regions.map((r) => r.id));
    assert.ok(campaign.aiActions.length > 0, `${name}: AI parties never campaigned`);
    for (const action of campaign.aiActions) {
      assert.ok(action.targetRegionId && regionIds.has(action.targetRegionId), `${name}: AI action without a region`);
      assert.ok(action.targetConstituencyIds!.length > 0);
    }
    for (const event of campaign.eventHistory ?? []) {
      const full = campaign.activeEvents.find((e) => e.id === event.eventId);
      if (full) assert.notEqual(full.scope, "NATIONAL", `${name}: national event in an Assembly election`);
    }
    for (const event of campaign.activeEvents) assert.notEqual(event.location, "All India");
  }
});

test("region support summary averages the constituencies of each region", () => {
  const game = newGame(states.find((s) => s.state === "Telangana")!);
  const campaign = createAssemblyCampaign(game, Math.random);
  const summary = getAssemblyRegionSupport(campaign, game);
  assert.equal(summary.length, 4);
  for (const row of summary) {
    const total = Object.values(row.support).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 100) < 0.5, `${row.region.name}: ${total}`);
    assert.equal(row.actionsThisWeek, 0);
  }
});

test("a game saved before the rival field existed (schema 1) is upgraded on load", () => {
  const stateData = states.find((s) => s.state === "Goa")!;
  const modern = newGame(stateData);
  const legacy = JSON.parse(JSON.stringify(modern)) as Record<string, unknown>;
  for (const key of ["alliance", "allianceType", "statePartyParticipation", "stateAllianceGroups", "optedOutPartyIds"]) delete legacy[key];
  legacy.schemaVersion = 1;
  legacy.constituencies = (legacy.constituencies as Array<Record<string, unknown>>).map((item) => {
    const copy = { ...item };
    delete copy.allocations;
    return copy;
  });
  const store = new Map<string, string>([["indian-election-simulator:assembly-game", JSON.stringify(legacy)]]);
  (globalThis as unknown as { window: unknown }).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined } };
  const loaded = loadAssemblyGame() as AssemblyGameSave;
  delete (globalThis as unknown as { window?: unknown }).window;
  assert.equal(loaded.schemaVersion, 2);
  assert.ok(loaded.constituencies.every((c) => c.allocations.length >= 1));
  assert.ok(loaded.stateAllianceGroups["Goa"].length >= 1);
});


test("calibration: a state election is competitive, not a sweep (all 31 states, 3 seeds)", () => {
  const rows: Array<{ share: number; groups: number; hung: boolean }> = [];
  for (let rep = 0; rep < 3; rep += 1) {
    for (const stateData of states) {
      Math.random = mulberry32(100 + rep * 37 + stateData.state.length);
      const game = newGame(stateData);
      const report = createAssemblyCampaign(game, Math.random);
      const projection = buildFinalCampaignReport(report, toCampaignGame(game), report.constituencySupport, ASSEMBLY_PROFILE);
      const groups = [
        ...projection.allianceRankings.map((g) => g.projectedSeats),
        ...projection.nonAlliedPartyRankings.map((g) => g.projectedSeats),
      ].sort((a, b) => b - a);
      rows.push({ share: (groups[0] / projection.totalSeats) * 100, groups: groups.filter((n) => n > 0).length, hung: groups[0] < projection.majorityMark });
    }
  }
  const mean = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0) / rows.length;
  assert.ok(mean((r) => r.share) > 50 && mean((r) => r.share) < 72, `average leader seat share ${mean((r) => r.share).toFixed(1)}%`);
  assert.equal(rows.filter((r) => r.groups === 1).length, 0, "a single group won every seat");
  assert.ok(rows.filter((r) => r.share > 90).length / rows.length < 0.1, "too many near-sweeps");
  assert.ok(mean((r) => r.groups) >= 2.5, `only ${mean((r) => r.groups).toFixed(1)} groups win seats on average`);
  const hung = rows.filter((r) => r.hung).length / rows.length;
  assert.ok(hung > 0.05 && hung < 0.35, `${(hung * 100).toFixed(0)}% hung assemblies`);
  Math.random = mulberry32(7);
});

let failed = 0;
for (const [name, fn] of tests) {
  const started = Date.now();
  try {
    fn();
    console.log(`PASS  ${name}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} tests passed.`);
if (failed > 0) process.exit(1);
