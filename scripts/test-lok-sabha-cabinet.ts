/** AI cabinet allocation: run with  npx tsx scripts/test-lok-sabha-cabinet.ts */
import assert from "node:assert/strict";
import ministriesData from "@/data/union-ministries.json";
import { maxPostsWithMos, POINT_TOLERANCE, TOTAL_UNION_POINTS, buildCabinetMinistries, createAiCabinet, postTier, type PostCounts } from "@/engine/lok-sabha-cabinet-engine";
import { portfolioPackageText } from "@/engine/lok-sabha-negotiation-engine";

const ministries = buildCabinetMinistries(ministriesData);
const byId = new Map(ministries.map((m) => [m.id, m]));
const neg = {
  schemaVersion: 1,
  gameId: "g",
  day: 1,
  offers: [],
  completed: true,
  updatedAt: "",
} as never;

let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

function check(partySeats: number[], label: string) {
  const parties = partySeats.map((seats, i) => ({ partyId: `P${i}`, seats }));
  const total = partySeats.reduce((a, b) => a + b, 0);
  const cab = createAiCabinet(
    "g",
    { name: "Bloc", seats: total, parties },
    neg,
    "NONE",
    ministries,
  );
  const used: Record<string, number> = {};
  for (const a of cab.assignments)
    used[a.partyId] = (used[a.partyId] ?? 0) + byId.get(a.ministryId)!.points;
  const ids = new Set(cab.assignments.map((a) => a.ministryId));
  assert.equal(ids.size, cab.assignments.length, `${label}: a position was assigned twice`);
  assert.ok(
    ministries.filter((m) => m.role !== "REGULAR_MOS").every((m) => ids.has(m.id)),
    `${label}: a cabinet ministry is unassigned`,
  );
  for (const p of cab.parties) {
    assert.ok(
      (used[p.partyId] ?? 0) <= p.entitlement + POINT_TOLERANCE,
      `${label}: ${p.partyId} over budget ${used[p.partyId]}/${p.entitlement}`,
    );
    assert.ok((used[p.partyId] ?? 0) >= 1, `${label}: ${p.partyId} got nothing`);
  }
  assert.ok(
    Object.values(used).reduce((a, b) => a + b, 0) <= TOTAL_UNION_POINTS,
    `${label}: more than ${TOTAL_UNION_POINTS} points shared out`,
  );
  for (const p of cab.parties) {
    const posts = cab.assignments.filter((a) => a.partyId === p.partyId).length;
    if (p.seats <= 3) assert.ok(posts <= Math.max(1, p.seats), `${label}: ${p.partyId} (${p.seats} seats) holds ${posts} posts`);
  }
  for (const [parent, count] of Object.entries(cab.enabledRegularMosByMinistry ?? {})) {
    const slots = ministries
      .filter((m) => m.role === "REGULAR_MOS" && m.parentMinistryId === Number(parent))
      .slice(0, count);
    assert.ok(
      slots.every((s) => ids.has(s.id)),
      `${label}: MoS enabled count does not match assignments`,
    );
  }
  assert.equal(cab.confirmed, true);
  assert.ok(!cab.assignments.some((a) => byId.get(a.ministryId)!.role === "REGULAR_MOS"), `${label}: regular MoS were shared out without a deal`);
  assert.ok(cab.totalPoints === 228, `${label}: the cabinet pool is 228 points`);
}

/** A party promised exact posts gets exactly those posts. */
function promised(counts: PostCounts[], seats: number[], label: string) {
  const parties = seats.map((n, i) => ({ partyId: `P${i}`, seats: n }));
  const offers = counts.map((c, i) => ({
    id: `x${i}`, targetBlocId: `PARTY:P${i + 1}`, targetName: `P${i + 1}`, targetPartyIds: [`P${i + 1}`],
    arrangement: "JOIN", round: 1, status: "ACCEPTED", createdAt: "", updatedAt: "",
    terms: portfolioPackageText({ ...c }, false, "Deputy Prime Minister", "LOK_SABHA"),
  }));
  const negotiation = { schemaVersion: 1, gameId: "g", day: 1, offers, completed: true, updatedAt: "" } as never;
  const cab = createAiCabinet("g", { name: "Bloc", seats: seats.reduce((a, b) => a + b, 0), parties }, negotiation, "NONE", ministries);
  counts.forEach((c, i) => {
    const got: PostCounts = { key: 0, big: 0, small: 0, independent: 0, regular: 0 };
    for (const a of cab.assignments.filter((x) => x.partyId === `P${i + 1}`)) got[postTier(byId.get(a.ministryId)!)] += 1;
    assert.deepEqual(got, c, `${label}: P${i + 1} should hold exactly its negotiated posts`);
  });
  const ids = new Set(cab.assignments.map((a) => a.ministryId));
  assert.equal(ids.size, cab.assignments.length, `${label}: duplicate position`);
  assert.ok(ministries.filter((m) => m.role !== "REGULAR_MOS").every((m) => ids.has(m.id)), `${label}: a ministry is unassigned`);
}
promised([{ key: 1, big: 1, small: 1, independent: 1, regular: 1 }], [200, 1, 80], "one seat, five posts promised");
promised([{ key: 2, big: 0, small: 0, independent: 0, regular: 0 }, { key: 0, big: 2, small: 1, independent: 0, regular: 3 }], [150, 20, 14, 90], "two deals");
promised([{ key: 1, big: 1, small: 0, independent: 0, regular: 0 }, { key: 1, big: 0, small: 2, independent: 1, regular: 2 }, { key: 0, big: 1, small: 0, independent: 0, regular: 1 }], [120, 30, 25, 5, 100], "three deals");

{
  const pm = createAiCabinet(
    "g",
    {
      name: "Bloc",
      seats: 280,
      primeMinisterPartyId: "P1",
      parties: [
        { partyId: "P0", seats: 200 },
        { partyId: "P1", seats: 80 },
      ],
    },
    neg,
    "NONE",
    ministries,
  );
  assert.equal(
    pm.primeMinisterPartyId,
    "P1",
    "the Prime Minister's party is kept even with fewer seats",
  );
}
assert.equal(maxPostsWithMos({ seats: 36 }), 13, "36 seats: up to 13 posts in all");
assert.equal(maxPostsWithMos({ seats: 3 }), 1, "tiny parties keep half their seats");
assert.equal(maxPostsWithMos({ seats: 36, negotiatedPosts: { key: 1, big: 0, small: 0, independent: 0, regular: 1 } }), 2, "a deal gives exactly its posts");
check([274], "single party");
check([200, 40, 34], "NDA-like");
check([150, 60, 30, 20, 14], "five parties");
let failures = 0;
for (let n = 0; n < 3000; n += 1) {
  const count = 1 + Math.floor(rnd() * 14);
  const seats = Array.from(
    { length: count },
    () => 1 + Math.floor(rnd() * (rnd() < 0.3 ? 8 : 120)),
  );
  if (seats.reduce((a, b) => a + b, 0) < 272) seats[0] += 272 - seats.reduce((a, b) => a + b, 0);
  try {
    check(seats, JSON.stringify(seats));
  } catch (e) {
    failures += 1;
    if (failures <= 5) console.log("FAIL", (e as Error).message);
  }
}
console.log(
  failures
    ? `${failures} random cases failed`
    : "ok - AI cabinet: fixed cases and 3000 random blocs (1-14 parties) all valid",
);
process.exit(failures ? 1 : 0);
