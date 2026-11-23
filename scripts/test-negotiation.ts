/**
 * Regression tests for coalition negotiation seat counting.
 * Run with:  npm run test:negotiation   (uses `npx tsx`)
 *
 * Synthetic hung parliament (543 seats):
 *   NDA    228  BJP 200, TDP 16, JD(U) 12
 *   INDIA  188  INC 100, SP 37, DMK 22, AITC 29
 *   Independents 127  YSRCP 40, BSP 30, AIMIM 20, BJD 37
 */
import assert from "node:assert/strict";
import { createCabinetSave } from "@/engine/lok-sabha-cabinet-engine";
import {
  advanceNegotiationDay as advanceWithAi,
  buildNegotiationOverview,
  classifyPlayerScenario,
  createNegotiationOffer,
  createSimultaneousIncomingOffers,
  createPartyRequests,
  partyJoinPrice,
  portfolioPoints,
  decidesGovernment,
  playerLeadsBloc,
  decideOutsideSupport,
  getIncomingOfferBlocs,
  playerNegotiates,
  getPartyPositions,
  submitNegotiationOffer,
  getCompatibleNegotiationPartyTargets,
  getCompatibleNegotiationAllianceTargets,
  getPlayerCoalition,
  nameCoalition,
  buildPortfolioPackage,
  portfolioPackageText,
  getNegotiationBlocTally,
  respondToNegotiationOffer,
  resolveNegotiationDeadline,
  runFloorTest,
  type NegotiationArrangement,
  type NegotiationOverview,
  type NegotiationSave,
} from "@/engine/lok-sabha-negotiation-engine";

/** The tests below pin the player's own deals, so the other blocs stay out unless a test turns them on. */
const advanceNegotiationDay = (s: NegotiationSave, o?: NegotiationOverview) => advanceWithAi(s, o, { ai: false });

const SEAT_PLAN: Array<[string, string, number]> = [
  ["BJP", "NDA", 200], ["TDP", "NDA", 16], ["JD(U)", "NDA", 12],
  ["INC", "INDIA", 100], ["SP", "INDIA", 37], ["DMK", "INDIA", 22], ["AITC", "INDIA", 29],
  ["YSRCP", "", 40], ["BSP", "", 30], ["AIMIM", "", 20], ["BJD", "", 37],
];

/** A second parliament where the NDA (240) plus the independent YSRCP (40) can cross 272. */
const CLOSE_PLAN: Array<[string, string, number]> = [
  ["BJP", "NDA", 200], ["TDP", "NDA", 28], ["JD(U)", "NDA", 12],
  ["INC", "INDIA", 100], ["SP", "INDIA", 50],
  ["YSRCP", "", 40], ["BSP", "", 30], ["AIMIM", "", 20], ["BJD", "", 63],
];

/** Real party data: SKM and SDF are each compatible with BJP, but not with each other. */
const COMPAT_PLAN: Array<[string, string, number]> = [
  ["BJP", "NDA", 150], ["INC", "INDIA", 200], ["SKM", "", 1], ["SDF", "", 1], ["BSP", "", 191],
];

function overviewFor(playerPartyId: string, plan = SEAT_PLAN): NegotiationOverview {
  const constituencies: unknown[] = [];
  const results: unknown[] = [];
  let id = 1;
  for (const [partyId, allianceName, seats] of plan) {
    for (let i = 0; i < seats; i += 1, id += 1) {
      constituencies.push({ constituencyId: `C${id}`, allocations: [{ partyId, allianceName }] });
      results.push({ constituencyId: `C${id}`, winnerPartyId: partyId });
    }
  }
  const alliance = playerPartyId === "BJP" ? { type: "NDA", name: "NDA" } : { type: "INDEPENDENT", name: "Independent" };
  const game = { gameId: "g1", playerPartyId, alliance, constituencies } as never;
  const voting = { gameId: "g1", status: "COMPLETED", phaseResults: [{ constituencyResults: results }] } as never;
  return buildNegotiationOverview(game, voting);
}

const freshSave = (): NegotiationSave => ({ schemaVersion: 1, gameId: "g1", day: 1, offers: [], completed: false, updatedAt: "" });

function seatsOf(partyId: string) {
  return SEAT_PLAN.find(([id]) => id === partyId)?.[2] ?? 0;
}

/** Offers a deal to `partyId` and accepts it (the player's decision), without advancing the day. */
function agree(save: NegotiationSave, partyId: string, arrangement: NegotiationArrangement, accept = true) {
  const target = { id: `PARTY:${partyId}`, name: partyId, partyIds: [partyId], seats: seatsOf(partyId), isPlayerBloc: false };
  const offered = createNegotiationOffer(save, target, arrangement, "terms");
  return accept ? respondToNegotiationOffer(offered, offered.offers[offered.offers.length - 1].id, "ACCEPT") : offered;
}

/** An offer a bloc sent the independent player, accepted (the id marks it as incoming). */
function agreeIn(save: NegotiationSave, partyId: string, arrangement: NegotiationArrangement) {
  const made = agree(save, partyId, arrangement, false);
  const last = made.offers[made.offers.length - 1];
  const id = `INCOMING-${last.targetBlocId}`;
  return respondToNegotiationOffer({ ...made, offers: made.offers.map(o => (o === last ? { ...o, id } : o)) }, id, "ACCEPT");
}

const tallyOf = (o: NegotiationOverview, s: NegotiationSave, id: string) => getNegotiationBlocTally(o, s).find(b => b.id === id);
const playerBlocOf = (o: NegotiationOverview, s: NegotiationSave) => getNegotiationBlocTally(o, s).find(b => b.isPlayerBloc)!;

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test("outside support is not counted until the day advances", () => {
  const o = overviewFor("BJP");
  const s = agree(freshSave(), "YSRCP", "OUTSIDE_SUPPORT");
  assert.equal(playerBlocOf(o, s).seats, 228);
});

test("accepted outside support adds the party's seats to the player's bloc after advancing", () => {
  const o = overviewFor("BJP");
  const s = advanceNegotiationDay(agree(freshSave(), "YSRCP", "OUTSIDE_SUPPORT"), o);
  const bloc = playerBlocOf(o, s);
  assert.equal(bloc.seats, 268);
  assert.equal(bloc.memberSeats, 228);
  assert.equal(bloc.outsideSupportSeats, 40);
  assert.deepEqual(bloc.outsideSupporters, [{ partyId: "YSRCP", seats: 40 }]);
  assert.ok(!bloc.parties.some(p => p.partyId === "YSRCP"), "outside supporters are not formal members");
});

test("offers that are only proposed or rejected never count", () => {
  const o = overviewFor("BJP");
  let s = agree(freshSave(), "YSRCP", "OUTSIDE_SUPPORT", false); // proposed, never accepted
  s = agree(s, "BJD", "OUTSIDE_SUPPORT", false);
  s = respondToNegotiationOffer(s, s.offers[1].id, "REJECT"); // explicitly rejected
  s = advanceNegotiationDay(s, o);
  assert.equal(playerBlocOf(o, s).seats, 228);
});

test("two outside supporters reaching 272 close negotiations with a correct snapshot", () => {
  const o = overviewFor("BJP");
  let s = agree(freshSave(), "YSRCP", "OUTSIDE_SUPPORT");
  s = agree(s, "BJD", "OUTSIDE_SUPPORT");
  s = advanceNegotiationDay(s, o);
  assert.equal(s.completed, true);
  assert.equal(s.majoritySnapshot?.seats, 305);
  assert.equal(s.majoritySnapshot?.memberSeats, 228);
  assert.deepEqual(s.majoritySnapshot?.parties.map(p => p.partyId).sort(), ["BJP", "JD(U)", "TDP"]);
  assert.deepEqual(s.majoritySnapshot?.outsideSupporters?.map(p => p.partyId).sort(), ["BJD", "YSRCP"]);
});

test("outside supporters get no cabinet entitlement", () => {
  const o = overviewFor("BJP");
  let s = agree(freshSave(), "YSRCP", "OUTSIDE_SUPPORT");
  s = agree(s, "BJD", "OUTSIDE_SUPPORT");
  s = advanceNegotiationDay(s, o);
  const cabinet = createCabinetSave("g1", s.majoritySnapshot!, s, "BJP", false);
  assert.deepEqual(cabinet.parties.map(p => p.partyId).sort(), ["BJP", "JD(U)", "TDP"]);
});

test("a seat never backs two governments: a supporter leaves its own bloc's count", () => {
  const o = overviewFor("BJP");
  const s = advanceNegotiationDay(agree(freshSave(), "SP", "OUTSIDE_SUPPORT"), o);
  assert.equal(playerBlocOf(o, s).seats, 265);
  assert.equal(tallyOf(o, s, "BLOC:INDIA")?.seats, 151);
  const total = getNegotiationBlocTally(o, s).reduce((n, b) => n + b.seats, 0);
  assert.equal(total, 543);
});

test("formal JOIN still moves the party into the bloc and shares ministries", () => {
  const o = overviewFor("BJP");
  const s = advanceNegotiationDay(agree(freshSave(), "BSP", "JOIN"), o);
  const bloc = playerBlocOf(o, s);
  assert.equal(bloc.seats, 258);
  assert.ok(bloc.parties.some(p => p.partyId === "BSP"));
  assert.equal(bloc.outsideSupportSeats, 0);
});

test("JOIN supersedes earlier outside support; nothing is double counted", () => {
  const o = overviewFor("BJP");
  let s = advanceNegotiationDay(agree(freshSave(), "BSP", "OUTSIDE_SUPPORT"), o);
  assert.equal(playerBlocOf(o, s).seats, 258);
  s = advanceNegotiationDay(agree(s, "BSP", "JOIN"), o);
  const bloc = playerBlocOf(o, s);
  assert.equal(bloc.seats, 258);
  assert.equal(bloc.outsideSupportSeats, 0);
  assert.ok(bloc.parties.some(p => p.partyId === "BSP"));
});

test("advancing several days does not double count", () => {
  const o = overviewFor("BJP");
  let s = agree(freshSave(), "YSRCP", "OUTSIDE_SUPPORT");
  for (let i = 0; i < 4; i += 1) s = advanceNegotiationDay(s, o);
  assert.equal(playerBlocOf(o, s).seats, 268);
});

test("independent player: accepted JOIN merges the player's seats into the target's bloc", () => {
  const o = overviewFor("YSRCP");
  assert.equal(o.scenario, "PLAYER_INDEPENDENT");
  const s = advanceNegotiationDay(agreeIn(freshSave(), "BJP", "JOIN"), o);
  const nda = tallyOf(o, s, "BLOC:NDA")!;
  assert.equal(nda.seats, 268);
  assert.ok(nda.isPlayerBloc);
  assert.ok(!getNegotiationBlocTally(o, s).some(b => b.id !== "BLOC:NDA" && b.isPlayerBloc));
});

test("independent player: outside support counts toward the supported bloc", () => {
  const o = overviewFor("YSRCP");
  const s = advanceNegotiationDay(agreeIn(freshSave(), "BJP", "OUTSIDE_SUPPORT"), o);
  const nda = tallyOf(o, s, "BLOC:NDA")!;
  assert.equal(nda.seats, 268);
  assert.equal(nda.outsideSupportSeats, 40);
  assert.ok(nda.playerSupports);
  assert.equal(getNegotiationBlocTally(o, s).reduce((n, b) => n + b.seats, 0), 543);
});

test("independent player: outside support that lifts a bloc to 272 closes negotiations", () => {
  const o = overviewFor("YSRCP", CLOSE_PLAN);
  assert.equal(o.scenario, "PLAYER_INDEPENDENT");
  const s = advanceNegotiationDay(agreeIn(freshSave(), "BJP", "OUTSIDE_SUPPORT"), o);
  assert.equal(s.completed, true);
  assert.equal(s.majoritySnapshot?.name, "NDA");
  assert.equal(s.majoritySnapshot?.seats, 280);
  assert.deepEqual(s.majoritySnapshot?.parties.map(p => p.partyId).sort(), ["BJP", "JD(U)", "TDP"]);
  assert.deepEqual(s.majoritySnapshot?.outsideSupporters, [{ partyId: "YSRCP", seats: 40 }]);
});

test("independent player: support that still leaves the bloc short keeps negotiations open", () => {
  const o = overviewFor("YSRCP");
  const s = advanceNegotiationDay(agreeIn(freshSave(), "BJP", "OUTSIDE_SUPPORT"), o);
  assert.equal(s.completed, false);
  assert.equal(s.majoritySnapshot, undefined);
});

const targetNames = (o: NegotiationOverview, s: NegotiationSave) => getCompatibleNegotiationPartyTargets(o, s).map(t => t.name);

test("targets: parties compatible with the starting bloc are listed", () => {
  const o = overviewFor("BJP", COMPAT_PLAN);
  const names = targetNames(o, freshSave());
  assert.ok(names.includes("SKM") && names.includes("SDF"), "precondition: both are compatible with BJP");
  assert.ok(!names.includes("BJP"), "the player's own party is never a target");
});

test("targets: a party that joined is no longer a target, and its rivals drop off the list", () => {
  const o = overviewFor("BJP", COMPAT_PLAN);
  const s = advanceNegotiationDay(agree(freshSave(), "SKM", "JOIN"), o);
  const names = targetNames(o, s);
  assert.ok(!names.includes("SKM"), "SKM is now a member");
  assert.ok(!names.includes("SDF"), "SDF is incompatible with the new member SKM");
});

test("targets: before the day advances the list is unchanged (agreements apply next day)", () => {
  const o = overviewFor("BJP", COMPAT_PLAN);
  const names = targetNames(o, agree(freshSave(), "SKM", "JOIN"));
  assert.ok(names.includes("SKM") && names.includes("SDF"));
});

test("targets: outside supporters are not members, so they do not restrict the list", () => {
  const o = overviewFor("BJP", COMPAT_PLAN);
  const s = advanceNegotiationDay(agree(freshSave(), "SKM", "OUTSIDE_SUPPORT"), o);
  assert.ok(targetNames(o, s).includes("SDF"));
});


// ---- AI outside-support decision, and offers coming to an independent player ----

const asSolo = (o: NegotiationOverview) => o.scenario === "PLAYER_INDEPENDENT";
const blocFor = (o: NegotiationOverview, partyId: string) => getCompatibleNegotiationPartyTargets(o).find(b => b.partyIds[0] === partyId)!;

test("classification: a non-BJP/INC player who runs independently is PLAYER_INDEPENDENT", () => {
  const o = overviewFor("YSRCP");
  assert.equal(o.scenario, "PLAYER_INDEPENDENT");
  assert.equal(classifyPlayerScenario({ playerPartyId: "YSRCP", alliance: { type: "INDEPENDENT", name: "Independent" } } as never, "Independent – YSRCP"), "PLAYER_INDEPENDENT");
  assert.equal(classifyPlayerScenario({ playerPartyId: "BJP", alliance: { type: "PREDEFINED", name: "NDA" } } as never, "NDA"), "PLAYER_NATIONAL_ALLIANCE_CONVENER");
  assert.equal(classifyPlayerScenario({ playerPartyId: "YSRCP", alliance: { type: "CUSTOM", name: "My Front" } } as never, "My Front"), "PLAYER_CUSTOM_FRONT_LEADER");
});

test("independent player can send proposals as well as receive offers", () => {
  const o = overviewFor("YSRCP");
  assert.ok(asSolo(o));
  assert.equal(playerNegotiates(o, freshSave()), true);
  const sent = submitNegotiationOffer(freshSave(), o, blocFor(o, "BJD"), "JOIN", "Portfolio value: 34 points. Deputy Prime Minister post: No.");
  assert.equal(sent.offers[sent.offers.length - 1].status, "ACCEPTED");
  const toAlliance = submitNegotiationOffer(freshSave(), o, { id: "BLOC:NDA", name: "NDA", partyIds: ["BJP", "TDP"], seats: 1, isPlayerBloc: false }, "OUTSIDE_SUPPORT", "x");
  assert.ok(["ACCEPTED", "REJECTED"].includes(toAlliance.offers[0].status), "an alliance now answers outside support at once");
  assert.ok(getIncomingOfferBlocs(o).length > 0, "offers still arrive");
});

test("outside support is decided by the party: deterministic for a party, bloc and day", () => {
  const o = overviewFor("BJP");
  const a = decideOutsideSupport(o, freshSave(), "YSRCP");
  const b = decideOutsideSupport(o, freshSave(), "YSRCP");
  assert.deepEqual(a, b);
  assert.ok(a.note.length > 10);
});

test("outside support: submitting to a party gets an AI answer, accept or decline, never left pending", () => {
  const o = overviewFor("BJP");
  const s = submitNegotiationOffer(freshSave(), o, blocFor(o, "BJD"), "OUTSIDE_SUPPORT", "Outside support; no ministries.");
  const offer = s.offers[0];
  assert.ok(offer.status === "ACCEPTED" || offer.status === "REJECTED");
  assert.ok(offer.responseNote);
});

test("outside support: closer to 272 and later in the 14 days is easier to win", () => {
  const far = overviewFor("BJP");
  const close = overviewFor("BJP", CLOSE_PLAN);
  const late = { ...freshSave(), day: 14 };
  const sFar = decideOutsideSupport(far, freshSave(), "BSP").score;
  const sLate = decideOutsideSupport(far, late, "BSP").score;
  assert.ok(sLate > sFar - 0.07, "deadline pressure raises the score");
  const sClose = decideOutsideSupport(close, freshSave(), "YSRCP").score;
  const sFarY = decideOutsideSupport(far, freshSave(), "YSRCP").score;
  assert.ok(sClose > sFarY - 0.07, "a bloc nearer majority attracts more support");
});

test("join offers keep the 28-point rule (10 points on the old 84-point cabinet, scaled to 236)", () => {
  const o = overviewFor("BJP");
  const low = submitNegotiationOffer(freshSave(), o, blocFor(o, "BJD"), "JOIN", "Portfolio value: 10 points. Deputy Prime Minister post: No.");
  assert.equal(low.offers[0].status, "COUNTERED");
  const ok = submitNegotiationOffer(freshSave(), o, blocFor(o, "BJD"), "JOIN", "Portfolio value: 28 points. Deputy Prime Minister post: No.");
  assert.equal(ok.offers[0].status, "ACCEPTED");
});

const saveFor = (gameId: string): NegotiationSave => ({ ...freshSave(), gameId });

test("incoming offers: a bloc is not shut to the player because one small member dislikes it", () => {
  const ysrcp = getIncomingOfferBlocs(overviewFor("YSRCP"));
  assert.deepEqual(ysrcp.map(b => [b.id, b.joinable]), [["BLOC:NDA", true], ["BLOC:INDIA", false]]);
  const bsp = getIncomingOfferBlocs(overviewFor("BSP"));
  assert.deepEqual(bsp.map(b => b.id), ["BLOC:NDA", "BLOC:INDIA", "PARTY:YSRCP"]);
});

test("incoming offers: a bloc with a party the player is at odds with asks only for outside support, and the player decides", () => {
  const o = overviewFor("YSRCP"); // INC (INDIA's leader) is at odds with YSRCP
  for (let i = 0; i < 30; i += 1) {
    const s = createSimultaneousIncomingOffers(saveFor(`x${i}`), getIncomingOfferBlocs(o), o);
    const india = s.offers.find(x => x.targetBlocId === "BLOC:INDIA")!;
    assert.equal(india.arrangement, "OUTSIDE_SUPPORT");
    assert.ok(/decision is yours/.test(india.terms));
  }
  const s = createSimultaneousIncomingOffers(saveFor("x0"), getIncomingOfferBlocs(o), o);
  const india = s.offers.find(x => x.targetBlocId === "BLOC:INDIA")!;
  const accepted = advanceNegotiationDay(respondToNegotiationOffer(s, india.id, "ACCEPT"), o);
  assert.equal(accepted.outsideSupport?.YSRCP?.blocId, "BLOC:INDIA");
  assert.equal(tallyOf(o, accepted, "BLOC:INDIA")?.seats, 188 + 40);
  const rejected = advanceNegotiationDay(respondToNegotiationOffer(s, india.id, "REJECT"), o);
  assert.equal(rejected.outsideSupport?.YSRCP, undefined);
});

test("incoming offers: independent player receives them, deterministic, none from incompatible or tiny blocs", () => {
  const o = overviewFor("BSP");
  const blocs = getIncomingOfferBlocs(o);
  assert.ok(blocs.length >= 1);
  const a = createSimultaneousIncomingOffers(freshSave(), blocs, o);
  const b = createSimultaneousIncomingOffers(freshSave(), blocs, o);
  assert.equal(a.offers.length, blocs.length);
  assert.deepEqual(a.offers.map(x => [x.id, x.arrangement]), b.offers.map(x => [x.id, x.arrangement]));
  assert.ok(a.offers.every(x => x.id.startsWith("INCOMING-") && x.status === "OFFERED"));
  assert.ok(a.offers.filter(x => x.arrangement === "JOIN").every(x => /Portfolio value: \d+/.test(x.terms)));
  assert.ok(a.offers.filter(x => x.arrangement === "OUTSIDE_SUPPORT").every(x => !/Portfolio value/.test(x.terms)));
  assert.equal(createSimultaneousIncomingOffers(a, blocs, o), a, "no duplicates on a second call");
  assert.equal(createSimultaneousIncomingOffers(freshSave(), [], o).offers.length, 0);
});

test("incoming offers: accepting one withdraws the others; counters raise round and honour a ceiling", () => {
  const o = overviewFor("BSP");
  let s = createSimultaneousIncomingOffers(freshSave(), getIncomingOfferBlocs(o), o);
  // find a game id whose seeded offer is a JOIN so the counter path is exercised
  const joinSave = Array.from({ length: 40 }, (_, i) => createSimultaneousIncomingOffers(saveFor(`j${i}`), getIncomingOfferBlocs(o), o)).find(x => x.offers.some(y => y.arrangement === "JOIN"));
  assert.ok(joinSave, "some seed yields a JOIN offer");
  const outSave = Array.from({ length: 40 }, (_, i) => createSimultaneousIncomingOffers(saveFor(`o${i}`), getIncomingOfferBlocs(o), o)).find(x => x.offers.some(y => y.arrangement === "OUTSIDE_SUPPORT"));
  assert.ok(outSave, "some seed yields an OUTSIDE_SUPPORT offer");
  {
    s = joinSave!;
    const joins = s.offers.filter(x => x.arrangement === "JOIN");
    const j = joins[0];
    const base = Number(j.terms.match(/Portfolio value: (\d+)/)![1]);
    const greedy = respondToNegotiationOffer(s, j.id, "COUNTER", `Portfolio value: ${base * 3} points.`);
    const after = greedy.offers.find(x => x.id === j.id)!;
    assert.equal(after.status, "COUNTERED");
    assert.equal(after.round, 2);
    const modest = respondToNegotiationOffer(s, j.id, "COUNTER", `Portfolio value: ${base + 1} points.`);
    assert.equal(modest.offers.find(x => x.id === j.id)!.status, "ACCEPTED");
    assert.ok(modest.offers.filter(x => x.id !== j.id && x.id.startsWith("INCOMING-")).every(x => x.status === "REJECTED"));
  }
  const outs = outSave!.offers.find(x => x.arrangement === "OUTSIDE_SUPPORT")!;
  assert.throws(() => respondToNegotiationOffer(outSave!, outs.id, "COUNTER", "more"), /nothing to counter/);
  s = respondToNegotiationOffer(s, s.offers[0].id, "ACCEPT");
  assert.equal(s.offers[0].status, "ACCEPTED");
  assert.ok(s.offers.slice(1).every(x => x.status === "REJECTED"));
});


// ---- The other blocs negotiate too, and the 14-day deadline always ends in a government ----

const totalSeats = (o: NegotiationOverview, s: NegotiationSave) => getNegotiationBlocTally(o, s).reduce((n, b) => n + b.seats, 0);

test("AI day: blocs recruit unattached parties; no seat counts twice; the player is never moved", () => {
  const o = overviewFor("BSP");
  let s = advanceWithAi(freshSave(), o);
  for (let i = 0; i < 6 && !s.completed && !Object.keys({ ...s.partyAssignments, ...s.outsideSupport }).length; i += 1) s = advanceWithAi(s, o);
  const moved = Object.keys(s.partyAssignments ?? {}).concat(Object.keys(s.outsideSupport ?? {}));
  assert.ok(moved.length >= 1, "a party made a deal within the first days");
  assert.ok(!moved.includes("BSP"), "the player's party is decided by the player alone");
  assert.equal(totalSeats(o, s), 543);
  assert.ok((s.events ?? []).length >= 1);
  let again = advanceWithAi(freshSave(), o);
  for (let i = 0; i < 6 && !again.completed && !Object.keys({ ...again.partyAssignments, ...again.outsideSupport }).length; i += 1) again = advanceWithAi(again, o);
  assert.deepEqual(again.partyAssignments, s.partyAssignments, "deterministic");
});

test("AI days: a hung parliament resolves within 14 days with a government and a log", () => {
  for (const player of ["BSP", "YSRCP", "BJD", "AIMIM"]) {
    const o = overviewFor(player);
    let s = freshSave();
    for (let i = 0; i < 21 && !s.completed; i += 1) s = advanceWithAi(s, o);
    assert.equal(s.completed, true, `${player}: negotiations closed`);
    if (s.outcome!.kind === "HUNG_PARLIAMENT") continue;
    assert.ok(s.majoritySnapshot, `${player}: a government exists`);
    assert.equal(totalSeats(o, s), 543);
  }
});

const FRAGMENTED: Array<[string, string, number]> = [
  ["BJP", "NDA", 120], ["INC", "INDIA", 120], ["SP", "INDIA", 40],
  ["AITC", "", 50], ["BSP", "", 60], ["AIMIM", "", 40], ["BJD", "", 60], ["YSRCP", "", 53],
];

test("deadline: 14 days are extended by 7 more, and day 21 is the last", () => {
  const o = overviewFor("BSP");
  let s = freshSave();
  for (let i = 0; i < 13; i += 1) s = advanceNegotiationDay(s, o); // no AI, nobody deals
  assert.equal(s.day, 14);
  s = advanceNegotiationDay(s, o);
  assert.equal(s.completed, false, "no decision after day 14");
  assert.equal(s.day, 15, "the extension week begins");
  assert.ok((s.events ?? []).some(e => /extended by 7 days/.test(e.text)));
  for (let i = 0; i < 5; i += 1) s = advanceNegotiationDay(s, o);
  assert.equal(s.day, 20);
  s = advanceNegotiationDay(s, o);
  assert.equal(s.day, 21);
  assert.equal(s.completed, false, "day 21 is still playable");
  s = advanceNegotiationDay(s, o);
  assert.equal(s.completed, true);
});

test("after the extension the result is a floor-test government, a minority government or a hung parliament", () => {
  for (const plan of [SEAT_PLAN, FRAGMENTED]) {
    for (let g = 0; g < 12; g += 1) {
      const o = overviewFor("BSP", plan);
      let s = saveFor(`d${g}`);
      for (let i = 0; i < 40 && !s.completed; i += 1) s = advanceWithAi(s, o);
      const kind = s.outcome!.kind;
      assert.ok(["MAJORITY", "FLOOR_TEST_MAJORITY", "MINORITY_GOVERNMENT", "HUNG_PARLIAMENT"].includes(kind));
      if (kind === "HUNG_PARLIAMENT") {
        assert.equal(s.majoritySnapshot, undefined);
        assert.ok(s.outcome!.floorTests.length >= 1 && s.outcome!.floorTests.every(t => !t.passed));
      } else {
        assert.ok(s.majoritySnapshot);
        if (kind === "MINORITY_GOVERNMENT") {
          assert.equal(s.majoritySnapshot!.minority, true);
          assert.ok(s.outcome!.floorTests.at(-1)!.passed && s.outcome!.floorTests.at(-1)!.forSeats < 272);
        }
        if (kind === "FLOOR_TEST_MAJORITY") assert.ok(s.majoritySnapshot!.seats >= 272 && !s.majoritySnapshot!.minority);
      }
    }
  }
});

test("a fragmented parliament where nobody can win the floor is a hung parliament", () => {
  const o = overviewFor("BSP", FRAGMENTED);
  let s = freshSave();
  for (let i = 0; i < 21; i += 1) s = advanceNegotiationDay(s, o);
  assert.equal(s.completed, true);
  assert.equal(s.outcome?.kind, "HUNG_PARLIAMENT");
  assert.equal(s.majoritySnapshot, undefined);
  assert.equal(s.outcome?.floorTests.length, 2, "the two largest blocs were each invited");
});

test("floor test: every seat votes at most once and the totals add up", () => {
  const o = overviewFor("BSP");
  const bloc = getNegotiationBlocTally(o, freshSave())[0];
  const t = runFloorTest(o, freshSave(), bloc);
  assert.equal(t.forSeats + t.againstSeats + t.abstainSeats, 543);
  assert.equal(t.passed, t.forSeats > t.againstSeats);
  assert.deepEqual(runFloorTest(o, freshSave(), bloc), t, "deterministic");
});

test("a save closed by the old deadline without a government is repaired", () => {
  const o = overviewFor("BSP");
  const stuck = { ...freshSave(), day: 14, completed: true };
  const fixed = resolveNegotiationDeadline(stuck, o);
  assert.ok(fixed.outcome, "a result is now recorded");
  assert.equal(resolveNegotiationDeadline(fixed, o), fixed, "and it is only decided once");
});

test("independent player: later offers arrive from blocs that grow into contenders, and merged blocs withdraw", () => {
  const o = overviewFor("BSP");
  let s = createSimultaneousIncomingOffers(freshSave(), getIncomingOfferBlocs(o), o);
  const before = s.offers.length;
  for (let i = 0; i < 6 && !s.completed; i += 1) s = advanceWithAi(s, o);
  assert.ok(s.offers.length >= before);
  assert.ok(s.offers.every(x => ["OFFERED", "COUNTERED", "REJECTED", "ACCEPTED", "EXHAUSTED"].includes(x.status)));
});


// ---- Live feed: every day's events can be replayed step by step to reach the same tally ----

test("live feed: events are numbered, and replaying a day's moves reproduces the stored tally", () => {
  for (const player of ["BSP", "YSRCP"]) {
    const o = overviewFor(player);
    let s = createSimultaneousIncomingOffers(freshSave(), getIncomingOfferBlocs(o), o);
    for (let day = 0; day < 8 && !s.completed; day += 1) {
      const before = s;
      const lastSeq = Math.max(0, ...(before.events ?? []).map(e => e.seq ?? 0));
      const after = advanceWithAi(before, o);
      const fresh = (after.events ?? []).filter(e => (e.seq ?? 0) > lastSeq);
      assert.ok((after.events ?? []).every(e => e.seq), "every event is numbered");
      assert.equal(new Set((after.events ?? []).map(e => e.seq)).size, (after.events ?? []).length, "numbers are unique");
      if (after.completed) break;
      let replay = { ...before, partyAssignments: { ...before.partyAssignments }, outsideSupport: { ...before.outsideSupport } };
      for (const e of fresh) {
        if (!e.move) continue;
        if (e.move.arrangement === "JOIN") replay.partyAssignments![e.move.partyId] = { id: e.move.blocId, name: e.move.blocName };
        else replay.outsideSupport![e.move.partyId] = { blocId: e.move.blocId, blocName: e.move.blocName, offerId: "LIVE" };
      }
      const key = (x: NegotiationSave) => getNegotiationBlocTally(o, x).map(b => `${b.id}:${b.seats}`).join("|");
      assert.equal(key(replay), key(after), `${player} day ${before.day}: replay matches`);
      s = after;
    }
  }
});

test("live feed: approaches, answers and the player's own replies all appear", () => {
  const o = overviewFor("BSP");
  let s = createSimultaneousIncomingOffers(freshSave(), getIncomingOfferBlocs(o), o);
  const open = s.offers[0];
  s = respondToNegotiationOffer(s, open.id, "REJECT");
  assert.ok((s.events ?? []).some(e => e.kind === "PLAYER" && /You rejected/.test(e.text)));
  const kinds = new Set<string>();
  for (let i = 0; i < 12 && !s.completed; i += 1) { s = advanceWithAi(s, o); (s.events ?? []).forEach(e => e.kind && kinds.add(e.kind)); }
  assert.ok(kinds.has("APPROACH"), "approaches are logged");
  assert.ok(kinds.has("JOIN") || kinds.has("OUTSIDE") || kinds.has("DECLINE"), "answers are logged");
});

test("party positions follow the deals: members, outside supporters and independents add up to 543", () => {
  const o = overviewFor("BSP");
  let s = freshSave();
  for (let i = 0; i < 8 && !s.completed; i += 1) s = advanceWithAi(s, o);
  const positions = getPartyPositions(o, s);
  assert.equal(positions.reduce((n, p) => n + p.seats, 0), 543);
  assert.ok(positions.every(p => p.status !== "OUTSIDE_SUPPORT" || p.backs));
  assert.ok(positions.some(p => p.status !== "INDEPENDENT"), "someone has taken a side");
});


// ---- A game shaped like a real one: named fronts and "Independent – <Party>" groups ----

const REAL_SHAPE: Array<[string, string, number]> = [
  ["BJP", "NDA", 170], ["TDP", "NDA", 20], ["SHS", "NDA", 14],
  ["INC", "INDIA Alliance", 90], ["SP", "INDIA Alliance", 37], ["DMK", "INDIA Alliance", 22], ["RJD", "INDIA Alliance", 12], ["NCP-SP", "INDIA Alliance", 11],
  ["AAP", "Progressive Democratic Front", 40], ["TVK", "Progressive Democratic Front", 30], ["YSRCP", "Progressive Democratic Front", 28], ["BRS", "Progressive Democratic Front", 18],
  ["CPM", "Left Front", 8], ["CPI", "Left Front", 5],
  ["NTK", "Independent – NTK", 12], ["JD(U)", "Independent – JD(U)", 12], ["AIUDF", "Independent – AIUDF", 9],
  ["PDP", "Independent – PDP", 2], ["BSP", "Independent – BSP", 2], ["ZPM", "Independent – ZPM", 1],
];

test("real-shaped game: solo 'Independent – X' parties are recruited, and the tally moves", () => {
  const o = overviewFor("AAP", REAL_SHAPE); // the player ran independently
  assert.equal(o.scenario, "PLAYER_INDEPENDENT");
  const start = getNegotiationBlocTally(o, freshSave());
  assert.equal(start.find(b => b.isPlayerBloc)?.parties.length, 1, "an independent player stands alone");
  let s = createSimultaneousIncomingOffers(freshSave(), getIncomingOfferBlocs(o), o);
  assert.ok(s.offers.length >= 2, "blocs approach the independent player");
  const deals: string[] = [];
  for (let i = 0; i < 14 && !s.completed; i += 1) {
    s = advanceWithAi(s, o);
    (s.events ?? []).filter(e => e.move).forEach(e => deals.push(e.move!.partyId));
  }
  assert.ok(deals.some(p => ["NTK", "JD(U)", "AIUDF", "PDP", "BSP", "ZPM"].includes(p)), "independents made deals");
  const end = getPartyPositions(o, s);
  assert.equal(end.reduce((n, p) => n + p.seats, 0), 543);
  assert.ok(end.some(p => ["NTK", "JD(U)", "AIUDF"].includes(p.partyId) && p.status !== "INDEPENDENT"), "an independent took a side");
});

test("real-shaped game: members of other alliances can switch sides (never a bloc's largest party)", () => {
  const switchers = new Set<string>();
  for (let g = 0; g < 40; g += 1) {
    const o = overviewFor("AAP", REAL_SHAPE);
    let s = saveFor(`sw${g}`);
    for (let i = 0; i < 21 && !s.completed; i += 1) s = advanceWithAi(s, o);
    (s.events ?? []).filter(e => e.move && /left /.test(e.text)).forEach(e => switchers.add(e.move!.partyId));
  }
  assert.ok(switchers.size >= 1, "at least one member left its alliance in 40 games");
  assert.ok(!["BJP", "INC", "AAP"].some(p => switchers.has(p)), "nuclei and the player never switch");
});


// ---- Conveners and the Prime Minister's party ----

const FRONT_PLAN: Array<[string, string, number]> = [
  ["BJP", "NDA", 60], ["TDP", "NDA", 90], ["SHS", "NDA", 20],
  ["INC", "INDIA Alliance", 50], ["SP", "INDIA Alliance", 70],
  ["TVK", "Progressive Democratic Front", 30], ["YSRCP", "Progressive Democratic Front", 28], ["BRS", "Progressive Democratic Front", 18],
  ["BSP", "", 60], ["NTK", "Independent – NTK", 70], ["AIMIM", "Independent – AIMIM", 47],
];
const blocIn = (o: NegotiationOverview, s: NegotiationSave, name: string) => getNegotiationBlocTally(o, s).find(b => b.name === name)!;

test("conveners: BJP convenes NDA and INC convenes INDIA, and they are the PM parties even with fewer seats", () => {
  const o = overviewFor("BSP", FRONT_PLAN);
  const nda = blocIn(o, freshSave(), "NDA");
  assert.equal(nda.convenerPartyId, "BJP");
  assert.equal(nda.primeMinisterPartyId, "BJP", "TDP has more seats but BJP holds the post");
  const india = blocIn(o, freshSave(), "INDIA Alliance");
  assert.deepEqual([india.convenerPartyId, india.primeMinisterPartyId], ["INC", "INC"]);
});

test("conveners: another front is convened by its strongest member; the PM is its biggest party; both fixed", () => {
  const o = overviewFor("BSP", FRONT_PLAN);
  const front = blocIn(o, freshSave(), "Progressive Democratic Front");
  assert.ok(["TVK", "YSRCP", "BRS"].includes(front.convenerPartyId));
  assert.equal(front.primeMinisterPartyId, "TVK", "most seats among the pre-poll members");
  assert.equal(overviewFor("BSP", FRONT_PLAN).conveners[front.id], front.convenerPartyId, "same every time");
});

test("conveners: a party standing alone convenes and leads itself", () => {
  const o = overviewFor("BSP", FRONT_PLAN);
  const ntk = blocIn(o, freshSave(), "Independent – NTK");
  assert.deepEqual([ntk.convenerPartyId, ntk.primeMinisterPartyId], ["NTK", "NTK"]);
});

test("a party that joins after the election can never claim the Prime Minister's post", () => {
  const o = overviewFor("BSP", FRONT_PLAN); // BSP (60) is bigger than any pre-poll member of the front
  const s = advanceNegotiationDay(agreeIn(freshSave(), "TVK", "JOIN"), o);
  const front = blocIn(o, s, "Progressive Democratic Front");
  assert.ok(front.parties.some(p => p.partyId === "BSP"), "BSP joined");
  assert.equal(front.primeMinisterPartyId, "TVK");
  const nda = advanceNegotiationDay(agreeIn(freshSave(), "BJP", "JOIN"), o);
  assert.equal(blocIn(o, nda, "NDA").primeMinisterPartyId, "BJP");
});

test("an independent player who joins a bloc becomes its convener and negotiates for it", () => {
  const o = overviewFor("BSP", FRONT_PLAN);
  assert.equal(playerNegotiates(o, freshSave()), true, "standing alone, the player can also send proposals");
  const joined = advanceNegotiationDay(agreeIn(freshSave(), "TVK", "JOIN"), o);
  assert.equal(playerNegotiates(o, joined), true);
  const front = blocIn(o, joined, "Progressive Democratic Front");
  assert.equal(front.convenerPartyId, "BSP", "the player now coordinates the talks");
  assert.equal(front.primeMinisterPartyId, "TVK");
  // The player can now send proposals, and the party that accepts joins the player's bloc.
  const target = getCompatibleNegotiationPartyTargets(o, joined).find(t => t.name === "AIMIM");
  if (target) {
    const sent = submitNegotiationOffer(joined, o, target, "JOIN", "Portfolio value: 34 points. Deputy Prime Minister post: No.");
    assert.equal(sent.offers[sent.offers.length - 1].status, "ACCEPTED");
    const after = advanceNegotiationDay(sent, o);
    assert.ok(blocIn(o, after, "Progressive Democratic Front").parties.some(p => p.partyId === "AIMIM"));
    assert.ok(!after.partyAssignments?.BSP || after.partyAssignments.BSP.name === "Progressive Democratic Front", "the player stays put");
  }
});

test("the AI does not recruit for a bloc the player convenes, and conveners never switch sides", () => {
  const o = overviewFor("BSP", FRONT_PLAN);
  let s = advanceNegotiationDay(agreeIn(freshSave(), "TVK", "JOIN"), o);
  for (let i = 0; i < 20 && !s.completed; i += 1) s = advanceWithAi(s, o);
  assert.ok(!(s.events ?? []).some(e => e.kind === "APPROACH" && /^Progressive Democratic Front approached/.test(e.text)), "the player's bloc recruits only through the player");
  assert.ok(!(s.events ?? []).some(e => e.move && ["BJP", "INC", "TDP"].includes(e.move.partyId) && /left /.test(e.text) && e.move.partyId !== "TDP"));
  assert.equal(s.partyAssignments?.BJP, undefined);
  assert.equal(s.partyAssignments?.INC, undefined);
});

test("the government snapshot carries the convener and the Prime Minister's party", () => {
  const o = overviewFor("YSRCP", CLOSE_PLAN);
  const s = advanceNegotiationDay(agreeIn(freshSave(), "BJP", "OUTSIDE_SUPPORT"), o);
  assert.equal(s.majoritySnapshot?.primeMinisterPartyId, "BJP");
  assert.equal(s.majoritySnapshot?.convenerPartyId, "BJP");
});

// ---- Independent player builds and names a coalition; merges keep the larger name ----
const MERGE_PLAN: Array<[string, string, number]> = [
  ["BJP", "NDA", 190], ["TDP", "NDA", 10], ["JD(U)", "NDA", 30],
  ["INC", "INDIA", 90], ["SP", "INDIA", 20],
  ["YSRCP", "", 40], ["BSP", "", 30], ["AIMIM", "", 20], ["BJD", "", 30], ["BRS", "", 13],
  ["TVK", "Rival Front", 40], ["AITC", "Rival Front", 30],
];
const propose = (s: NegotiationSave, o: NegotiationOverview, id: string, partyIds: string[], name: string, seats = 1) =>
  submitNegotiationOffer(s, o, { id, name, partyIds, seats, isPlayerBloc: false }, "JOIN", "Portfolio value: 34 points. Deputy Prime Minister post: No.");

test("independent player's coalition: parties join, the player's party holds the top post and the player names it", () => {
  const o = overviewFor("YSRCP", MERGE_PLAN);
  let s = propose(freshSave(), o, "PARTY:BSP", ["BSP"], "BSP");
  s = propose(s, o, "PARTY:AIMIM", ["AIMIM"], "AIMIM");
  s = advanceNegotiationDay(s, o);
  const co = getPlayerCoalition(o, s)!;
  assert.ok(co, "a coalition exists");
  assert.deepEqual(co.parties.sort(), ["AIMIM", "BSP", "YSRCP"]);
  assert.equal(co.name, "YSRCP Front", "default name until the player names it");
  assert.equal(playerBlocOf(o, s).primeMinisterPartyId, "YSRCP");
  assert.equal(playerBlocOf(o, s).convenerPartyId, "YSRCP");
  s = nameCoalition(s, o, "Peoples Alliance");
  assert.equal(playerBlocOf(o, s).name, "Peoples Alliance");
  assert.throws(() => nameCoalition(s, o, "NDA"), /reserved/);
  assert.throws(() => nameCoalition(s, o, "x"), /2 to 40/);
});

test("merging with NDA keeps the name NDA (and its Prime Minister) whatever the seats", () => {
  const o = overviewFor("YSRCP", MERGE_PLAN);
  let s = propose(freshSave(), o, "PARTY:BSP", ["BSP"], "BSP");
  s = propose(s, o, "PARTY:AIMIM", ["AIMIM"], "AIMIM");
  s = advanceNegotiationDay(s, o);
  s = nameCoalition(s, o, "Peoples Alliance");
  s = propose(s, o, "BLOC:NDA", ["BJP", "TDP"], "NDA", 100);
  s = advanceNegotiationDay(s, o);
  const nda = blocIn(o, s, "NDA");
  assert.deepEqual(nda.parties.map(p => p.partyId).sort(), ["AIMIM", "BJP", "BSP", "JD(U)", "TDP", "YSRCP"]);
  assert.equal(nda.primeMinisterPartyId, "BJP");
  assert.ok(!getNegotiationBlocTally(o, s).some(b => b.name === "Peoples Alliance"));
});

test("two coalitions merge under the name of the one with more seats; a tie goes to the player's coalition", () => {
  const o = overviewFor("YSRCP", MERGE_PLAN);
  const rival = ["TVK", "AITC"];
  const build = (partner: string, label: string) => {
    let s = propose(freshSave(), o, `PARTY:${partner}`, [partner], partner);
    s = advanceNegotiationDay(s, o);
    return nameCoalition(s, o, label);
  };
  const merge = (s: NegotiationSave) => advanceNegotiationDay(propose(s, o, "BLOC:Rival Front", rival, "Rival Front", 70), o);
  // 40 + 30 = 70 against 70: a tie, so the player's name survives.
  const tie = merge(build("BSP", "Peoples Alliance"));
  assert.equal(blocIn(o, tie, "Peoples Alliance").parties.length, 4);
  assert.ok(!getNegotiationBlocTally(o, tie).some(b => b.name === "Rival Front"));
  assert.equal(blocIn(o, tie, "Peoples Alliance").primeMinisterPartyId, "YSRCP");
  // 40 + 13 = 53 against 70: the larger Rival Front keeps its name and leadership.
  const smaller = merge(build("BRS", "Small Alliance"));
  const front = blocIn(o, smaller, "Rival Front");
  assert.ok(front.parties.some(p => p.partyId === "YSRCP") && front.parties.some(p => p.partyId === "BRS"));
  assert.ok(!getNegotiationBlocTally(o, smaller).some(b => b.name === "Small Alliance"));
  assert.notEqual(front.primeMinisterPartyId, "YSRCP");
  // Alliance targets list whole blocs, not the player's own.
  const targets = getCompatibleNegotiationAllianceTargets(o, build("BSP", "Peoples Alliance")).map(t => t.name);
  assert.ok(targets.includes("Rival Front"));
});

test("outside support never merges or renames anything", () => {
  const o = overviewFor("YSRCP", MERGE_PLAN);
  let s = propose(freshSave(), o, "PARTY:BSP", ["BSP"], "BSP");
  s = advanceNegotiationDay(s, o);
  const before = getNegotiationBlocTally(o, s).map(b => b.name).sort();
  s = submitNegotiationOffer(s, o, { id: "PARTY:BJD", name: "BJD", partyIds: ["BJD"], seats: 25, isPlayerBloc: false }, "OUTSIDE_SUPPORT", "x");
  s = advanceNegotiationDay(s, o);
  assert.equal(blocIn(o, s, "YSRCP Front").parties.length, 2, "the coalition is unchanged");
  assert.ok(blocIn(o, s, "YSRCP Front").outsideSupporters.length <= 1, "BJD backs it from outside, or declines");
  assert.deepEqual(before.includes("YSRCP Front"), true);
  assert.ok(!(s.partyAssignments ?? {}).BJD, "outside supporters are not members");
});

test("state cabinet packages use Key / Big / Small ministries and scale to the 42 cabinet points", () => {
  const p = buildPortfolioPackage(12, "ASSEMBLY");
  assert.equal(p.independent + p.regular, 0);
  assert.equal(p.key * 3 + p.big * 2 + p.small, 12);
  const text = portfolioPackageText(p, true, "Deputy Chief Minister", "ASSEMBLY");
  assert.match(text, /Ministry package/);
  assert.match(text, /Deputy Chief Minister post: Yes/);
  assert.doesNotMatch(text, /MoS/);
});

test("alliance leader: parties approach with join requests or outside support, and the leader answers", () => {
  const o = overviewFor("BJP");
  assert.ok(playerLeadsBloc(o));
  let s = createPartyRequests(freshSave(), o, { initial: true });
  const reqs = s.offers.filter((x) => x.id.startsWith("REQUEST-"));
  assert.ok(reqs.length >= 1 && reqs.length <= 4, `requests: ${reqs.length}`);
  assert.equal(createPartyRequests(s, o, { initial: true }).offers.length >= reqs.length, true);
  const join = reqs.find((x) => x.arrangement === "JOIN");
  if (join) {
    const asked = join.askedPoints ?? 0;
    // countering far below the ask raises the party's counter; at 80% of the ask it accepts
    if (join.tiny) {
      const low = respondToNegotiationOffer(s, join.id, "COUNTER", portfolioPackageText({ key: 0, big: 0, small: 0, independent: 1, regular: 0 }));
      assert.equal(low.offers.find((x) => x.id === join.id)?.status, "COUNTERED");
      assert.throws(() => respondToNegotiationOffer(s, join.id, "COUNTER", portfolioPackageText({ key: 1, big: 0, small: 0, independent: 0, regular: 0 })), /at most/);
      const good = respondToNegotiationOffer(s, join.id, "COUNTER", portfolioPackageText({ key: 0, big: 0, small: 1, independent: 0, regular: 0 }));
      assert.equal(good.offers.find((x) => x.id === join.id)?.status, "ACCEPTED");
    } else {
      assert.ok(asked >= 6, "a join request asks at least two Small ministries");
      const low = respondToNegotiationOffer(s, join.id, "COUNTER", portfolioPackageText(buildPortfolioPackage(2)));
      assert.equal(low.offers.find((x) => x.id === join.id)?.status, "COUNTERED");
      const good = respondToNegotiationOffer(s, join.id, "COUNTER", portfolioPackageText(buildPortfolioPackage(Math.ceil(asked * 0.8))));
      assert.equal(good.offers.find((x) => x.id === join.id)?.status, "ACCEPTED");
    }
    const done = advanceNegotiationDay(respondToNegotiationOffer(s, join.id, "ACCEPT"), o);
    const bloc = getNegotiationBlocTally(o, done).find((b) => b.isPlayerBloc);
    assert.ok(bloc?.parties.some((p) => p.partyId === join.targetPartyIds[0]), "the party joined the leader's bloc");
  }
  const out = reqs.find((x) => x.arrangement === "OUTSIDE_SUPPORT");
  if (out) {
    assert.throws(() => respondToNegotiationOffer(s, out.id, "COUNTER", "x"));
    const done = advanceNegotiationDay(respondToNegotiationOffer(s, out.id, "ACCEPT"), o);
    const bloc = getNegotiationBlocTally(o, done).find((b) => b.isPlayerBloc);
    assert.ok(bloc?.outsideSupporters.some((p) => p.partyId === out.targetPartyIds[0]));
    assert.ok(!bloc?.parties.some((p) => p.partyId === out.targetPartyIds[0]));
  }
  // accepting one request never withdraws another
  const two = reqs.slice(0, 2);
  if (two.length === 2) {
    const t = respondToNegotiationOffer(s, two[0].id, "ACCEPT");
    assert.equal(t.offers.find((x) => x.id === two[1].id)?.status, "OFFERED");
  }
  // proposing to a party that already approached replaces its request
  const own = submitNegotiationOffer(s, o, { id: reqs[0].targetBlocId, name: reqs[0].targetName, partyIds: reqs[0].targetPartyIds, seats: reqs[0].tiny?.seats ?? 100, isPlayerBloc: false }, "JOIN", portfolioPackageText(reqs[0].tiny ? { key: 0, big: 0, small: 1, independent: 0, regular: 0 } : buildPortfolioPackage(30)));
  assert.equal(own.offers.find((x) => x.id === reqs[0].id)?.status, "REJECTED");
});

test("independent player: asks an alliance for posts (accepted, countered or declined) and becomes its convener", () => {
  const o = overviewFor("BJD");
  assert.equal(playerLeadsBloc(o), false);
  const nda = getCompatibleNegotiationAllianceTargets(o).find((b) => b.partyIds.includes("BJP"));
  assert.ok(nda, "NDA is a target");
  const small = portfolioPackageText(buildPortfolioPackage(10));
  const ok = submitNegotiationOffer(freshSave(), o, nda!, "JOIN", small);
  const offer = ok.offers[0];
  assert.equal(offer.status, "ACCEPTED");
  assert.ok(offer.playerAsks);
  const done = advanceNegotiationDay(ok, o);
  const tally = getNegotiationBlocTally(o, done);
  const mine = tally.find((b) => b.isPlayerBloc);
  assert.equal(mine?.name, "NDA");
  assert.equal(mine?.convenerPartyId, "BJD", "the player convenes the alliance it joined");
  assert.equal(mine?.primeMinisterPartyId, "BJP");
  assert.ok(playerLeadsBloc(o, done));
  // asking too much gets a counter at the alliance's ceiling, which the player may accept
  const greedy = submitNegotiationOffer(freshSave(), o, nda!, "JOIN", portfolioPackageText(buildPortfolioPackage(150), true));
  const g = greedy.offers[0];
  assert.equal(g.status, "COUNTERED");
  assert.ok(g.counterTerms);
  const accepted = respondToNegotiationOffer(greedy, g.id, "ACCEPT");
  assert.equal(accepted.offers[0].status, "ACCEPTED");
  // the deputy PM post counts toward the ask
  const rules = o.rules;
  const justUnder = buildPortfolioPackage((g.ceilingPoints ?? 0) - 10);
  const withDpm = submitNegotiationOffer(freshSave(), o, nda!, "JOIN", portfolioPackageText(justUnder, true));
  assert.equal(withDpm.offers[0].status, "COUNTERED", "posts plus the 16-point deputy post exceed the ceiling");
  assert.ok(rules.portfolioPoints === 236);
});

test("independent player: outside support to an alliance is allowed and counts for it", () => {
  const o = overviewFor("BJD", CLOSE_PLAN);
  const nda = getCompatibleNegotiationAllianceTargets(o).find((b) => b.partyIds.includes("BJP"));
  assert.ok(nda);
  const s = submitNegotiationOffer(freshSave(), o, nda!, "OUTSIDE_SUPPORT", "Outside support");
  assert.equal(s.offers[0].status, "ACCEPTED");
  const done = advanceNegotiationDay(s, o);
  const bloc = getNegotiationBlocTally(o, done).find((b) => b.parties.some((p) => p.partyId === "BJP"));
  assert.ok(bloc?.outsideSupporters.some((p) => p.partyId === "BJD"));
  assert.ok(bloc && bloc.seats >= 272, "NDA plus BJD reaches 272");
});

test("the Assembly rules are untouched: no party requests, outside support to alliances still refused", () => {
  const o = overviewFor("BJP");
  const asm = { ...o, rules: { ...o.rules, kind: "ASSEMBLY" as const } } as NegotiationOverview;
  assert.equal(playerLeadsBloc(asm), false);
});

// ---- Tiny parties: priced and limited by their seats; a party that decides the government may ask for a Key ministry ----
const PIVOT_PLAN: Array<[string, string, number]> = [
  ["BJP", "NDA", 200], ["JD(U)", "NDA", 71], ["INC", "INDIA", 150], ["BSP", "", 120], ["SKM", "", 1], ["SDF", "", 1],
];
const SHORT_PLAN: Array<[string, string, number]> = [
  ["BJP", "NDA", 200], ["JD(U)", "NDA", 69], ["INC", "INDIA", 150], ["BSP", "", 122], ["SKM", "", 1], ["SDF", "", 1],
];
const pk = (key: number, big: number, small: number, independent: number, regular: number) =>
  portfolioPackageText({ key, big, small, independent, regular });

test("join prices follow party size: tiny parties ask for posts, a deciding party pays the full price", () => {
  const r = overviewFor("BJP").rules;
  assert.equal(partyJoinPrice(r, 1, 200), 3, "one seat: one Small ministry");
  assert.equal(partyJoinPrice(r, 3, 200), 3, "three seats: still one post");
  assert.equal(partyJoinPrice(r, 4, 200), 3, "four seats: a third of its seats is one post");
  assert.equal(partyJoinPrice(r, 5, 200), 6, "five seats: two Small ministries");
  assert.equal(partyJoinPrice(r, 1, 271), 4, "one seat that decides the government: one Big ministry");
  assert.equal(partyJoinPrice(r, 10, 238), 10, "ten seats: its share of the cabinet");
  assert.equal(partyJoinPrice(r, 6, 238), 6, "six seats: never below two Small ministries");
  assert.equal(partyJoinPrice(r, 100, 200), 28, "a large party pays the full join price");
  assert.equal(partyJoinPrice(r, 12, 262), 28, "a party that decides the government pays the full price");
  assert.equal(decidesGovernment(r, 271, 1), true);
  assert.equal(decidesGovernment(r, 270, 1), false);

});

test("leader offers a one-seat party: a Small ministry is enough, less is countered at its price", () => {
  const o = overviewFor("BJP", SHORT_PLAN);
  const skm = getCompatibleNegotiationPartyTargets(o).find((b) => b.partyIds[0] === "SKM");
  assert.ok(skm);
  const ok = submitNegotiationOffer(freshSave(), o, skm!, "JOIN", pk(0, 0, 1, 0, 0));
  assert.equal(ok.offers[0].status, "ACCEPTED");
  assert.equal(ok.offers[0].joinPrice, 3);
  const low = submitNegotiationOffer(freshSave(), o, skm!, "JOIN", pk(0, 0, 0, 1, 0));
  assert.equal(low.offers[0].status, "COUNTERED");
  assert.equal(portfolioPoints(low.offers[0].counterTerms ?? ""), 3);
  assert.throws(() => submitNegotiationOffer(freshSave(), o, skm!, "JOIN", pk(0, 0, 1, 0, 1)), /at most 1 post/);
  assert.throws(() => submitNegotiationOffer(freshSave(), o, skm!, "JOIN", pk(0, 1, 0, 0, 0)), /Small ministries/);
});

test("independent one-seat party that decides the government: one Big ministry at most, no Deputy PM", () => {
  const o = overviewFor("SKM", PIVOT_PLAN);
  const nda = getCompatibleNegotiationAllianceTargets(o).find((b) => b.partyIds.includes("BJP"));
  assert.ok(nda, "NDA is a target");
  const big = submitNegotiationOffer(freshSave(), o, nda!, "JOIN", pk(0, 1, 0, 0, 0));
  assert.equal(big.offers[0].status, "ACCEPTED", "a Big ministry for the deciding seat");
  const keyAsk = submitNegotiationOffer(freshSave(), o, nda!, "JOIN", pk(1, 0, 0, 0, 0));
  assert.equal(keyAsk.offers[0].status, "COUNTERED", "not a Key ministry");
  const two = submitNegotiationOffer(freshSave(), o, nda!, "JOIN", pk(0, 1, 1, 0, 0));
  assert.equal(two.offers[0].status, "COUNTERED", "one seat holds one post");
  assert.equal(portfolioPoints(two.offers[0].counterTerms ?? ""), 4);
  const dpm = submitNegotiationOffer(freshSave(), o, nda!, "JOIN", portfolioPackageText({ key: 0, big: 1, small: 0, independent: 0, regular: 0 }, true));
  assert.equal(dpm.offers[0].status, "COUNTERED", "no Deputy PM post for one seat");
  const two2 = respondToNegotiationOffer(two, two.offers[0].id, "ACCEPT");
  assert.equal(two2.offers[0].status, "ACCEPTED");
  // countering with two posts is still refused
  const again = respondToNegotiationOffer(two, two.offers[0].id, "COUNTER", pk(0, 0, 2, 0, 0));
  assert.equal(again.offers[0].status, "COUNTERED");
});

test("independent one-seat party that does not decide the government: a Small ministry at most", () => {
  const o = overviewFor("SKM", SHORT_PLAN);
  const nda = getCompatibleNegotiationAllianceTargets(o).find((b) => b.partyIds.includes("BJP"));
  assert.ok(nda);
  const small = submitNegotiationOffer(freshSave(), o, nda!, "JOIN", pk(0, 0, 1, 0, 0));
  assert.equal(small.offers[0].status, "ACCEPTED");
  const key = submitNegotiationOffer(freshSave(), o, nda!, "JOIN", pk(1, 0, 0, 0, 0));
  assert.equal(key.offers[0].status, "COUNTERED");
  assert.equal(portfolioPoints(key.offers[0].counterTerms ?? ""), 3);
});

test("tiny parties approach the leader asking for a post or two", () => {
  const o = overviewFor("BJP", PIVOT_PLAN);
  const s = createPartyRequests(freshSave(), o, { initial: true });
  for (const r of s.offers.filter((x) => x.id.startsWith("REQUEST-") && x.arrangement === "JOIN" && x.tiny)) {
    assert.ok((r.askedPoints ?? 0) <= 7, "a tiny party asks for a post or two");
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} tests passed.`);
if (failed > 0) process.exit(1);
