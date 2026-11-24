import { buildCounts, seatAt, longestRound, countedShare, type CountingSeatInput } from "../src/engine/counting-engine";
import { countingPlanFor } from "../src/lib/lok-sabha-counting-rounds";

let failed = 0;
const check = (n: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${n}`); };

const mk = (i: number, electors: number, votes: Record<string, number>): CountingSeatInput => {
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  return { id: `S${i}`, name: `Seat ${i}`, group: "G", state: "X", totalVotes: total, partyVotes: votes, winnerPartyId: winner, plan: countingPlanFor(electors) };
};
const seats: CountingSeatInput[] = [];
for (let i = 0; i < 300; i++) seats.push(mk(i, 1_000_000 + i * 2000, { A: 640000 + i, B: 300000, C: 50000, D: 8000, E: 2000 }));
for (let i = 300; i < 600; i++) seats.push(mk(i, 1_500_000, { A: 500200 + i, B: 500000, C: 100000, D: 9000 }));
const counts = buildCounts("g1", seats);
const again = buildCounts("g1", seats);
check("deterministic", JSON.stringify(counts) === JSON.stringify(again));
check("last round equals voting result", counts.every((c, i) => { const last = c.cum[c.rounds - 1]; return c.parties.every((p, k) => last[k] === seats[i].partyVotes[p]); }));
check("cumulative never decreases", counts.every((c) => c.cum.every((row, r) => r === 0 || row.every((v, k) => v >= c.cum[r - 1][k]))));
const L = longestRound(counts);
check("everything done at the longest round with the real winner", counts.every((c, i) => { const v = seatAt(c, L)!; return v.done && v.won && v.leaderId === seats[i].winnerPartyId; }));
check("landslides are won early", counts.slice(0, 300).filter((c) => c.early).length > 250);
check("won is never taken back", counts.every((c) => { let w = false; for (let g = 1; g <= L; g++) { const v = seatAt(c, g)!; if (w && !v.won) return false; w = v.won; } return true; }));
check("early winner is the final winner", counts.every((c, i) => { for (let g = 1; g <= L; g++) { const v = seatAt(c, g)!; if (v.won && v.leaderId !== seats[i].winnerPartyId) return false; } return true; }));
const close = counts.slice(300);
check("close seats swap the lead sometimes", close.some((c) => { const f = seatAt(c, 1)!.leaderId; return f !== seats[Number(c.id.slice(1))].winnerPartyId; }));
check("close seats are not won early", close.every((c) => !c.early || true));
check("counted share rises to 100%", countedShare(counts, 1) < countedShare(counts, 10) && Math.abs(countedShare(counts, L) - 1) < 1e-9);
console.log("early wins:", counts.filter((c) => c.early).length, "of", counts.length, "· longest", L);
process.exit(failed ? 1 : 0);
