/**
 * Tests the stages after the 8-week Assembly campaign: locking the campaign (the "Next" button),
 * polling day and the result invariants the results page relies on.
 * Run with:  npm run test:assembly-voting   (uses `npx tsx`)
 *
 * Every state and union territory is played from the opening campaign week through voting.
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
  return createAssemblyGame({
    setup: {
      state,
      playerPartyId: player,
      allianceName: "Independent",
      partyIds: [player],
      allianceType: "independent",
    },
    allocation: allocationFor(stateData, [player]),
    stateData,
    constituencies: allConstituencies.filter((item) => item.state === state),
  });
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

let checkedStates = 0;
let hungChecked = 0;
let cabinetsChecked = 0;
let multiPartyCabinets = 0;
for (const stateData of states) {
  const game = newGame(stateData);
  const campaign = playFullCampaign(game);

  // The Next button on the campaign page: week 8 produces the final report, and locking unlocks voting.
  assert.equal(
    campaign.status,
    "FINAL_REPORT",
    `${game.state}: campaign should end at the final report`,
  );
  assert.throws(
    () => runAssemblyVoting(game, campaign),
    /locked/,
    `${game.state}: voting must require a locked campaign`,
  );
  const locked = lockCampaignForVoting(campaign);
  assert.equal(locked.status, "LOCKED", game.state);

  // Polling day.
  const voting = runAssemblyVoting(game, locked);
  assert.equal(voting.status, "COMPLETED", game.state);
  assert.equal(
    voting.results.length,
    game.totalConstituencies,
    `${game.state}: every seat must be declared`,
  );

  const seatsById = new Map(game.constituencies.map((seat) => [seat.id, seat]));
  const seatsWon: Record<string, number> = {};
  for (const result of voting.results) {
    const seat = seatsById.get(result.constituencyId);
    assert.ok(seat, `${game.state}: unknown constituency ${result.constituencyId}`);
    const contesting = new Set(seat.allocations.map((allocation) => allocation.partyId));
    for (const partyId of Object.keys(result.partyVotes))
      assert.ok(contesting.has(partyId), `${seat.name}: ${partyId} is not contesting`);
    assert.ok(contesting.has(result.winnerPartyId), `${seat.name}: winner is not a contestant`);
    const top = Math.max(...Object.values(result.partyVotes));
    assert.equal(
      result.partyVotes[result.winnerPartyId],
      top,
      `${seat.name}: winner does not have the most votes`,
    );
    const partyTotal = Object.values(result.partyVotes).reduce((sum, count) => sum + count, 0);
    assert.equal(
      partyTotal + result.notaVotes,
      result.totalVotes,
      `${seat.name}: votes do not add up`,
    );
    assert.ok(result.totalVotes <= result.registeredElectors, `${seat.name}: turnout above 100%`);
    seatsWon[result.winnerPartyId] = (seatsWon[result.winnerPartyId] ?? 0) + 1;
  }
  assert.equal(
    Object.values(seatsWon).reduce((sum, count) => sum + count, 0),
    game.totalConstituencies,
    game.state,
  );

  // Same game, same campaign, same votes: reloading or re-opening the page cannot change the result.
  const again = runAssemblyVoting(game, locked);
  assert.deepEqual(again.results, voting.results, `${game.state}: voting must be deterministic`);

  // A campaign from another game must not be accepted.
  assert.throws(
    () => runAssemblyVoting({ ...game, gameId: "someone-else" }, locked),
    /different game/,
    game.state,
  );
  assert.ok(getAssemblyMajority(game) > game.totalConstituencies / 2, game.state);

  // The Government Formation page: who governs, and whether any negotiation is needed.
  const outcome = getAssemblyGovernmentOutcome(game, voting);
  const playerGroup = game.stateAllianceGroups[game.state].find((group) => group.isPlayerAlliance)!;
  assert.equal(
    outcome.playerGroupName,
    playerGroup.name,
    `${game.state}: player group must be found by its flag`,
  );
  assert.equal(outcome.majority, getAssemblyMajority(game), game.state);
  assert.equal(
    outcome.groups.reduce((sum, group) => sum + group.seats, 0),
    game.totalConstituencies,
    game.state,
  );
  for (let i = 1; i < outcome.groups.length; i += 1)
    assert.ok(outcome.groups[i - 1].seats >= outcome.groups[i].seats, game.state);
  if (outcome.largestGroup && outcome.largestGroup.seats >= outcome.majority) {
    assert.equal(outcome.status, "MAJORITY", game.state);
    assert.equal(outcome.rulingGroup, outcome.largestGroup, game.state);
    assert.ok(
      outcome.chiefMinisterPartyId &&
        outcome.rulingGroup!.partySeats[outcome.chiefMinisterPartyId] > 0,
      game.state,
    );
  } else {
    assert.equal(outcome.status, "HUNG", game.state);
    assert.equal(outcome.rulingGroup, null, game.state);
    assert.equal(outcome.chiefMinisterPartyId, null, game.state);
    assert.equal(outcome.playerInGovernment, false, game.state);
  }

  // A group that wins most seats forms the government outright: no negotiation.
  const sweep = getAssemblyGovernmentOutcome(
    game,
    withWinners(game, voting, (_i, contestants) => contestants[0].partyId),
  );
  assert.equal(sweep.status, "MAJORITY", `${game.state}: a group with every seat must govern`);
  assert.equal(sweep.rulingGroup!.seats, game.totalConstituencies, game.state);

  // The player's own group winning every seat puts the player in government with their party as CM.
  const player = game.constituencies[0].allocatedPartyId;
  const playerSweep = getAssemblyGovernmentOutcome(
    game,
    withWinners(game, voting, (i) => game.constituencies[i].allocatedPartyId),
  );
  assert.equal(playerSweep.status, "MAJORITY", game.state);
  assert.equal(playerSweep.playerInGovernment, true, game.state);
  assert.equal(playerSweep.rulingGroup!.name, playerGroup.name, game.state);
  assert.ok(playerSweep.chiefMinisterPartyId, game.state);
  assert.ok(player, game.state);

  // Three blocs sharing the seats evenly: nobody has a majority, so the assembly is hung. Blocs are
  // told apart by name, as the results do: two groups with one name (say the player's solo BJP and
  // an AI-built "NDA") count as a single bloc.
  const oneContestantPerBloc = (contestants: Array<{ partyId: string; allianceName: string }>) =>
    contestants.filter(
      (c, i) => contestants.findIndex((o) => o.allianceName === c.allianceName) === i,
    );
  if (game.constituencies.every((seat) => oneContestantPerBloc(seat.allocations).length >= 3)) {
    const split = getAssemblyGovernmentOutcome(
      game,
      withWinners(game, voting, (i, contestants) => {
        const blocs = oneContestantPerBloc(contestants);
        return blocs[i % 3].partyId;
      }),
    );
    assert.equal(split.status, "HUNG", `${game.state}: an even three-way split must be hung`);
    assert.equal(split.rulingGroup, null, game.state);
    hungChecked += 1;
  }

  // Cabinet formation: the ruling group, with every party in it, shares the ministries.
  const groupParties = new Map<string, Set<string>>();
  for (const seat of game.constituencies) {
    for (const allocation of seat.allocations) {
      const set = groupParties.get(allocation.allianceName) ?? new Set<string>();
      set.add(allocation.partyId);
      groupParties.set(allocation.allianceName, set);
    }
  }
  const everySeat = (name: string) =>
    game.constituencies.every((seat) => seat.allocations.some((a) => a.allianceName === name));
  const bestGroup = [...groupParties.entries()]
    .filter(([name, parties]) => parties.size >= 1 && everySeat(name))
    .sort((a, b) => b[1].size - a[1].size)[0];
  assert.ok(bestGroup, `${game.state}: no group contests every seat`);
  const [bestName, bestParties] = bestGroup;
  const coalition = getAssemblyGovernmentOutcome(
    game,
    withWinners(game, voting, (i, contestants) => {
      const members = contestants.filter((c) => c.allianceName === bestName);
      return members[i % members.length].partyId;
    }),
  );
  assert.equal(
    coalition.status,
    "MAJORITY",
    `${game.state}: ${bestName} winning every seat must govern`,
  );
  const cabinet: AssemblyCabinetSave = createAssemblyCabinet(game.gameId, coalition);
  assert.equal(cabinet.groupName, bestName, game.state);
  assert.equal(cabinet.totalPoints, TOTAL_MINISTRY_POINTS, game.state);
  assert.equal(cabinet.chiefMinisterPartyId, coalition.chiefMinisterPartyId, game.state);
  assert.deepEqual(
    cabinet.parties.map((p) => p.partyId).sort(),
    Object.keys(coalition.rulingGroup!.partySeats).sort(),
    `${game.state}: cabinet parties must be the ruling group's parties`,
  );
  assert.equal(
    cabinet.parties.reduce((sum, p) => sum + p.entitlement, 0),
    TOTAL_MINISTRY_POINTS,
    `${game.state}: entitlements must add up to the total points`,
  );
  assert.ok(
    cabinet.parties.every((p) => p.entitlement >= 1),
    `${game.state}: every party needs a point`,
  );
  for (let i = 1; i < cabinet.parties.length; i += 1) {
    assert.ok(cabinet.parties[i - 1].seats >= cabinet.parties[i].seats, game.state);
    assert.ok(
      cabinet.parties[i - 1].entitlement >= cabinet.parties[i].entitlement,
      `${game.state}: more seats cannot mean fewer points`,
    );
  }
  assert.equal(validateCabinet(cabinet).ok, false, `${game.state}: an empty cabinet is not valid`);
  const assignments = autoAllocateMinistries(cabinet.parties);
  const full: AssemblyCabinetSave = { ...cabinet, assignments };
  assert.equal(validateCabinet(full).ok, true, `${game.state}: auto-allocation must be valid`);
  assert.equal(
    new Set(assignments.map((a) => a.ministryId)).size,
    ASSEMBLY_MINISTRIES.length,
    `${game.state}: every ministry exactly once`,
  );
  const spent = cabinetPointsUsed(full);
  for (const party of cabinet.parties)
    assert.equal(
      spent[party.partyId],
      party.entitlement,
      `${game.state}: ${party.partyId} must use exactly its points`,
    );
  // Moving one ministry to a party with no room left must be caught by the validation.
  const overloaded = {
    ...full,
    assignments: full.assignments.map((a, index) =>
      index === 0 ? { ...a, partyId: cabinet.parties[cabinet.parties.length - 1].partyId } : a,
    ),
  };
  if (
    cabinet.parties.length > 1 &&
    full.assignments[0].partyId !== cabinet.parties[cabinet.parties.length - 1].partyId
  ) {
    assert.equal(
      validateCabinet(overloaded).ok,
      false,
      `${game.state}: over-budget cabinet must be rejected`,
    );
  }
  cabinetsChecked += 1;
  if (bestParties.size > 1) multiPartyCabinets += 1;
  checkedStates += 1;
}

// Random ruling groups of 1-18 parties always have a valid, exact split of the ministries.
{
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let parties = 1; parties <= 18; parties += 1) {
    for (let run = 0; run < 300; run += 1) {
      const seats: Record<string, number> = {};
      for (let i = 0; i < parties; i += 1) seats[`P${i}`] = 1 + Math.floor(rnd() ** 2 * 120);
      const built = buildCabinetParties(seats);
      const result = autoAllocateMinistries(built);
      const save = { parties: built, assignments: result } as AssemblyCabinetSave;
      assert.equal(validateCabinet(save).ok, true, `${parties} parties: ${JSON.stringify(built)}`);
      const used = cabinetPointsUsed(save);
      assert.ok(
        built.every((p) => used[p.partyId] === p.entitlement),
        `${parties} parties: exact fit`,
      );
    }
  }
}

assert.equal(checkedStates, states.length);
assert.equal(cabinetsChecked, states.length);
assert.ok(multiPartyCabinets > 0, "no state produced a multi-party ruling group");
assert.ok(
  hungChecked > 0,
  "no state had three contestants per seat, so the hung branch went untested",
);
console.log(
  `ok - ${checkedStates} states: campaign -> lock -> voting -> government outcome (hung branch checked in ${hungChecked}) -> cabinet (${multiPartyCabinets} multi-party groups)`,
);
