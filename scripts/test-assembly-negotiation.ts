/**
 * Tests the live negotiation for a hung State Assembly: 7 days plus a 3-day extension, a majority of
 * half the seats plus one, and a government (or a hung result) that the cabinet stage can use.
 * Run with:  npm run test:assembly-negotiation   (uses `npx tsx`)
 */
import assert from "node:assert/strict";
import regionData from "@/data/assembly-regions-2024.json";
import constituencyData from "@/data/assembly-constituencies-2024.json";
import {
  ASSEMBLY_CAMPAIGN_ACTIONS_PER_WEEK,
  ASSEMBLY_CAMPAIGN_WEEKS,
  CAMPAIGN_ACTIONS,
  acknowledgeCampaignEvent,
  completeAssemblyCampaignWeek,
  continueAssemblyCampaignWeek,
  createAssemblyCampaign,
  getAssemblyMajority,
  lockCampaignForVoting,
  queueAssemblyCampaignAction,
} from "@/engine/assembly-campaign-engine";
import {
  createAssemblyGame,
  generateAssemblyField,
  planAssemblyAiSeats,
  toCampaignGame,
  type AssemblyGameSave,
} from "@/engine/assembly-game-engine";
import type {
  AssemblyRegionState,
  AssemblySeatAllocation,
} from "@/engine/assembly-seat-allocation-engine";
import {
  ASSEMBLY_MINISTRIES,
  TOTAL_MINISTRY_POINTS,
  autoAllocateMinistries,
  buildCabinetParties,
  cabinetPointsUsed,
  createAssemblyCabinet,
  validateCabinet,
  type AssemblyCabinetSave,
} from "@/engine/assembly-cabinet-engine";
import {
  getAssemblyGovernmentOutcome,
  runAssemblyVoting,
  type AssemblyVotingSave,
} from "@/engine/assembly-voting-engine";
import {
  distributeByStrength,
  getEligiblePartyIdsForState,
  getPartyStrength,
} from "@/engine/lok-sabha-game-engine";
import type { AssemblyConstituency } from "@/types/constituency";
import { applyNegotiationToOutcome } from "@/engine/assembly-government";
import {
  ASSEMBLY_NEGOTIATION_DAYS,
  ASSEMBLY_NEGOTIATION_EXTENSION_DAYS,
  advanceNegotiationDay,
  buildAssemblyNegotiationOverview,
  getNegotiationBlocTally,
  submitNegotiationOffer,
  buildPortfolioPackage,
  portfolioPackageText,
  type NegotiationSave,
} from "@/engine/lok-sabha-negotiation-engine";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(11);

const states = (regionData as unknown as { states: AssemblyRegionState[] }).states;
const allConstituencies = (
  constituencyData as unknown as { constituencies: AssemblyConstituency[] }
).constituencies;

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

function newGame(stateData: AssemblyRegionState): AssemblyGameSave {
  const state = stateData.state;
  const player = [...getEligiblePartyIdsForState(state)].sort(
    (a, b) => (getPartyStrength(b, state) ?? 0) - (getPartyStrength(a, state) ?? 0),
  )[0];
  const setup = {
    state,
    playerPartyId: player,
    allianceName: "Independent",
    partyIds: [player],
    allianceType: "independent" as const,
  };
  const seatCount = stateData.regions.reduce((n, r) => n + r.constituencyIds.length, 0);
  // The field shown during seat allocation is the field the game uses, region by region.
  const field = generateAssemblyField(setup, seatCount);
  const game = createAssemblyGame({
    setup,
    allocation: allocationFor(stateData, [player]),
    stateData,
    constituencies: allConstituencies.filter((item) => item.state === state),
    field,
  });
  const plans = planAssemblyAiSeats(field, state, stateData.regions.map((r) => ({ id: r.id, name: r.name, seatCount: r.constituencyIds.length })));
  for (const plan of plans)
    for (const region of plan.regions) {
      const ids = new Set(stateData.regions.find((r) => r.id === region.regionId)!.constituencyIds);
      for (const [partyId, count] of Object.entries(region.shares)) {
        const actual = game.constituencies.filter(
          (c) => ids.has(c.id) && c.allocations.some((a) => a.allianceId === plan.group.id && a.partyId === partyId),
        ).length;
        assert.equal(actual, count, `${state}/${region.regionName}: ${partyId} in ${plan.group.name} matches the preview`);
      }
    }
  return game;
}

const ACTIONS = CAMPAIGN_ACTIONS.map((item) => item.id);

function playFullCampaign(game: AssemblyGameSave) {
  const regions = toCampaignGame(game).regions![game.state];
  let campaign = createAssemblyCampaign(game, Math.random);
  for (let week = 1; week <= ASSEMBLY_CAMPAIGN_WEEKS; week += 1) {
    for (let i = 0; i < ASSEMBLY_CAMPAIGN_ACTIONS_PER_WEEK; i += 1) {
      campaign = queueAssemblyCampaignAction(
        campaign,
        game,
        ACTIONS[(week + i) % ACTIONS.length],
        regions[(week + i) % regions.length].id,
      );
    }
    campaign = completeAssemblyCampaignWeek(campaign, game);
    if (week < ASSEMBLY_CAMPAIGN_WEEKS) {
      for (const event of campaign.activeEvents) {
        if (event.priority === "CRITICAL" && !event.acknowledged)
          campaign = acknowledgeCampaignEvent(campaign, event.id);
      }
      campaign = continueAssemblyCampaignWeek(campaign);
    }
  }
  return campaign;
}

/** The same count with every seat handed to the contestant chosen by `pick`. */
function withWinners(
  game: AssemblyGameSave,
  voting: AssemblyVotingSave,
  pick: (
    seatIndex: number,
    contestants: Array<{ partyId: string; allianceName: string }>,
  ) => string,
): AssemblyVotingSave {
  const seats = new Map(game.constituencies.map((seat) => [seat.id, seat]));
  return {
    ...voting,
    results: voting.results.map((result, index) => ({
      ...result,
      winnerPartyId: pick(index, seats.get(result.constituencyId)!.allocations),
    })),
  };
}


let hungStates = 0;
let governments = 0;
let hungClosed = 0;
let extensions = 0;
for (const stateData of states) {
  const game = newGame(stateData);
  const locked = lockCampaignForVoting(playFullCampaign(game));
  const counted = runAssemblyVoting(game, locked);
  // Hand the seats out in turn so that no group can reach a majority.
  const voting = withWinners(game, counted, (index, contestants) => contestants[index % contestants.length].partyId);
  const base = getAssemblyGovernmentOutcome(game, voting);
  if (base.status !== "HUNG") continue;
  hungStates += 1;

  const overview = buildAssemblyNegotiationOverview(game, voting, TOTAL_MINISTRY_POINTS);
  assert.equal(overview.majorityMark, getAssemblyMajority(game), `${game.state}: majority`);
  assert.equal(overview.rules.headTitle, "Chief Minister");
  assert.equal(overview.rules.days, ASSEMBLY_NEGOTIATION_DAYS);
  assert.equal(overview.rules.totalDays, ASSEMBLY_NEGOTIATION_DAYS + ASSEMBLY_NEGOTIATION_EXTENSION_DAYS);
  assert.ok(overview.triggerNegotiations, `${game.state}: a hung result must open talks`);
  assert.equal(
    overview.partyRows.reduce((n, row) => n + row.seats, 0),
    game.totalConstituencies,
    `${game.state}: every seat belongs to a party`,
  );

  let save: NegotiationSave = { schemaVersion: 1, gameId: game.gameId, kind: "ASSEMBLY", day: 1, offers: [], completed: false, updatedAt: "" };
  // Proposals use the state cabinet: ministries plus the Deputy Chief Minister post.
  const rival = overview.partyRows.find((row) => row.partyId !== overview.playerPartyId);
  if (rival && overview.scenario === "PLAYER_INDEPENDENT") {
    const terms = portfolioPackageText(buildPortfolioPackage(6, "ASSEMBLY"), true, "Deputy Chief Minister", "ASSEMBLY");
    assert.match(terms, /Ministry package/);
    const sent = submitNegotiationOffer(save, overview, { id: `PARTY:${rival.partyId}`, name: rival.partyId, partyIds: [rival.partyId], seats: rival.seats, isPlayerBloc: false }, "JOIN", terms);
    assert.equal(sent.offers[0].status, "ACCEPTED", `${game.state}: a state-sized package is enough to join`);
  }
  let steps = 0;
  let extended = false;
  while (!save.completed) {
    save = advanceNegotiationDay(save, overview);
    steps += 1;
    if (save.day > overview.rules.days && !save.completed) extended = true;
    assert.ok(steps <= overview.rules.totalDays + 1, `${game.state}: talks must close by the deadline`);
    assert.ok(save.day <= overview.rules.totalDays, `${game.state}: day never exceeds ${overview.rules.totalDays}`);
  }
  if (extended) extensions += 1;
  assert.ok(save.majoritySnapshot || save.outcome, `${game.state}: talks end in a government or a result`);

  const tally = getNegotiationBlocTally(overview, save);
  assert.ok(tally.every((bloc) => bloc.seats <= game.totalConstituencies), `${game.state}: tally within the house`);
  // The Chief Minister's post goes to the largest member party, even for NDA or INDIA.
  for (const bloc of tally) {
    if (overview.scenario === "PLAYER_INDEPENDENT" && bloc.isPlayerBloc) continue;
    const holder = bloc.parties.find((party) => party.partyId === bloc.primeMinisterPartyId);
    assert.ok(holder, `${game.state}: ${bloc.name}'s CM party is a member`);
    assert.ok(
      bloc.parties.every((party) => party.seats <= holder!.seats),
      `${game.state}: ${bloc.name}'s CM party is its largest member`,
    );
  }

  const effective = applyNegotiationToOutcome(game, base, save);
  if (save.majoritySnapshot) {
    governments += 1;
    assert.equal(effective.status, "MAJORITY", `${game.state}: government formed`);
    assert.ok(effective.rulingGroup && effective.chiefMinisterPartyId, `${game.state}: a Chief Minister is named`);
    const members = Object.keys(effective.rulingGroup!.partySeats);
    assert.ok(members.includes(effective.chiefMinisterPartyId!), `${game.state}: the CM's party is in the government`);
    if (!save.majoritySnapshot.minority && save.outcome?.kind !== "MINORITY_GOVERNMENT")
      assert.ok(effective.rulingGroup!.seats >= overview.majorityMark || save.outcome?.kind === "FLOOR_TEST_MAJORITY", `${game.state}: backed by a majority`);
    const cabinet = createAssemblyCabinet(game.gameId, effective);
    const full = { ...cabinet, assignments: autoAllocateMinistries(cabinet.parties), confirmed: true };
    assert.ok(validateCabinet(full).ok, `${game.state}: the cabinet is valid`);
  } else {
    hungClosed += 1;
    assert.equal(effective.status, "HUNG", `${game.state}: no government, still hung`);
    assert.equal(save.outcome?.kind, "HUNG_PARLIAMENT");
  }
}
assert.ok(hungStates >= 20, `expected most states to produce a hung split, got ${hungStates}`);
console.log(
  `ok - ${hungStates} hung assemblies negotiated: ${governments} governments, ${hungClosed} hung, ${extensions} used the extension`,
);
