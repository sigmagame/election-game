import * as ls from "../src/lib/lok-sabha-counting-rounds";
import * as ac from "../src/lib/assembly-counting-rounds";

let failed = 0;
const check = (name: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

check("2,000 voters is one station", ls.pollingStationsFor(2000) === 1 && ac.pollingStationsFor(2000) === 1);
check("2,001 voters needs two stations", ls.pollingStationsFor(2001) === 2);
check("rounds always round up (AC 211 stations -> 15)", ac.roundsFor(211) === 15 && ac.roundsFor(210) === 14);
check("rounds always round up (LS 41 stations -> 2)", ls.roundsFor(41) === 2 && ls.roundsFor(40) === 1);
check("LS capped at 40", ls.roundsFor(5000) === 40);
check("AC capped at 23", ac.roundsFor(5000) === 23);
check("Sahibabad: 528 stations, 23 rounds", ac.countingPlanFor(1054464).stations === 528 && ac.countingPlanFor(1054464).rounds === 23);

for (const [name, mod] of [["LS", ls], ["AC", ac]] as const) {
  const plans = mod.buildCountingPlans();
  const list = Object.values(plans);
  check(`${name}: every plan's rounds add up to its stations`, list.every((p) => p.stationsInRound.reduce((a, b) => a + b, 0) === p.stations && p.stationsInRound.length === p.rounds));
  check(`${name}: nothing over the cap, nothing under 1`, list.every((p) => p.rounds >= 1 && p.rounds <= mod.MAX_ROUNDS));
  const sorted = list.map((p) => p.rounds).sort((a, b) => a - b);
  console.log(`${name}: ${list.length} seats · rounds min ${sorted[0]} · median ${sorted[Math.floor(sorted.length / 2)]} · max ${mod.longestCount(plans)} · capped ${list.filter((p) => Math.ceil(p.stations / mod.STATIONS_PER_ROUND) > mod.MAX_ROUNDS).length}`);
}
process.exit(failed ? 1 : 0);
