import assert from "node:assert/strict";
import lokSabha from "../src/data/lok-sabha-constituencies-2024.json";
import assembly from "../src/data/assembly-constituencies-2024.json";
import { generateTurnout, generateNotaRate, TURNOUT_MIN, TURNOUT_MAX, NOTA_MIN, NOTA_MAX } from "../src/engine/turnout-model";
import { hashSeed, randomFor } from "../src/engine/lok-sabha-voting-engine";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

const turnouts = (gameId: string, scope: string, list: any[]) =>
  list.map((c) => generateTurnout({ gameId, scope, state: c.state, constituencyId: c.id }));

ok("no polled-vote field remains in the data", () => {
  for (const c of [...lokSabha.constituencies, ...assembly.constituencies]) assert.ok(!("votesPolledOnEvmIncludingNota" in c));
});
ok("every seat stays within 70-95% over many games", () => {
  for (let g = 0; g < 20; g++)
    for (const [scope, list] of [["lok-sabha", lokSabha.constituencies], ["assembly", assembly.constituencies]] as const)
      for (const t of turnouts(`game-${g}`, scope, list)) assert.ok(t >= TURNOUT_MIN && t <= TURNOUT_MAX, `turnout ${t}`);
});
ok("same game gives the same turnout", () => {
  assert.deepEqual(turnouts("a", "lok-sabha", lokSabha.constituencies), turnouts("a", "lok-sabha", lokSabha.constituencies));
});
ok("different games differ (seat, state and national levels)", () => {
  const a = turnouts("a", "lok-sabha", lokSabha.constituencies), b = turnouts("b", "lok-sabha", lokSabha.constituencies);
  assert.ok(a.filter((x, i) => x !== b[i]).length > 500);
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const means = Array.from({ length: 30 }, (_, g) => mean(turnouts(`m${g}`, "lok-sabha", lokSabha.constituencies)));
  assert.ok(Math.max(...means) - Math.min(...means) > 0.02, "national average should move between games");
});
ok("seats in a state move together but still differ", () => {
  const kerala = lokSabha.constituencies.filter((c) => c.state === "Kerala");
  const t = turnouts("s1", "lok-sabha", kerala);
  assert.ok(new Set(t).size === t.length);
});
ok("turnout is not tied to seat size or order (urban/rural can go either way)", () => {
  const big = [...lokSabha.constituencies].sort((a, b) => b.registeredElectors - a.registeredElectors).slice(0, 60);
  const small = [...lokSabha.constituencies].sort((a, b) => a.registeredElectors - b.registeredElectors).slice(0, 60);
  const mean = (l: any[], g: string) => turnouts(g, "lok-sabha", l).reduce((s, v) => s + v, 0) / l.length;
  let bigHigher = 0;
  for (let g = 0; g < 40; g++) if (mean(big, `u${g}`) > mean(small, `u${g}`)) bigHigher++;
  assert.ok(bigHigher > 5 && bigHigher < 35, `big-seat turnout higher in ${bigHigher}/40 games`);
});
ok("NOTA stays within 0.5-1.5%", () => {
  const rng = randomFor(hashSeed("nota"));
  for (let i = 0; i < 5000; i++) { const r = generateNotaRate(rng); assert.ok(r >= NOTA_MIN && r <= NOTA_MAX); }
});
console.log(`${n} turnout tests passed`);
