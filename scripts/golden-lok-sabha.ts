/**
 * Golden-master check for the Lok Sabha game and campaign engines.
 *
 * Runs a fully seeded game (fixed random numbers and clock): create game, allocate seats, then all
 * 12 campaign weeks with scripted player actions, and fingerprints every stage. Any refactor of the
 * shared engines must leave these fingerprints unchanged.
 *
 *   npx tsx scripts/golden-lok-sabha.ts            compare with scripts/golden/lok-sabha-campaign.json
 *   npx tsx scripts/golden-lok-sabha.ts --update   rewrite the golden file (only for intended changes)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createLokSabhaGame, randomlyAllocateSeats } from "@/engine/lok-sabha-game-engine";
import {
  acknowledgeCampaignEvent,
  completeCampaignWeek,
  continueToNextCampaignWeek,
  createLokSabhaCampaignSave,
  queuePlayerCampaignAction,
} from "@/engine/lok-sabha-campaign-engine";
import type { CampaignActionType } from "@/types/lok-sabha-campaign";

// ---- deterministic environment -------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(20260101);
const FIXED_TIME = Date.UTC(2026, 0, 1);
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(FIXED_TIME);
    else super(...(args as [number]));
  }
  static now() {
    return FIXED_TIME;
  }
}
globalThis.Date = FixedDate as DateConstructor;

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

// ---- scripted run --------------------------------------------------------------------------
const stages: Record<string, string> = {};
let game = createLokSabhaGame({ playerPartyId: "BJP", allianceChoice: "NDA" });
stages["game.created"] = fingerprint(game);
game = randomlyAllocateSeats(game);
stages["game.allocated"] = fingerprint(game);

let campaign = createLokSabhaCampaignSave(game, Math.random);
stages["campaign.created"] = fingerprint(campaign);

const script: Array<[CampaignActionType, string]> = [
  ["PUBLIC_RALLY", "Uttar Pradesh"],
  ["DOOR_TO_DOOR", "Bihar"],
  ["SOCIAL_MEDIA", "Maharashtra"],
  ["PUBLIC_RALLY", "Uttar Pradesh"],
];
for (let week = 1; week <= 12; week += 1) {
  for (const [action, state] of script) campaign = queuePlayerCampaignAction(campaign, game, action, state);
  campaign = completeCampaignWeek(campaign, game);
  stages[`week.${week}`] = fingerprint(campaign);
  if (week < 12) {
    for (const event of campaign.activeEvents) {
      if (event.priority === "CRITICAL" && !event.acknowledged) campaign = acknowledgeCampaignEvent(campaign, event.id);
    }
    campaign = continueToNextCampaignWeek(campaign);
  }
}
const report = campaign.finalReport!;
stages["finalReport"] = fingerprint(report);

const readable = {
  totalSeats: report.totalSeats,
  majorityMark: report.majorityMark,
  leadingBloc: report.leadingBlocName,
  leadingBlocSeats: report.leadingBlocSeats,
  topAlliances: report.allianceRankings.slice(0, 3).map(r => `${r.name}:${r.projectedSeats}`),
};

// ---- compare / update ----------------------------------------------------------------------
const goldenPath = path.join(process.cwd(), "scripts", "golden", "lok-sabha-campaign.json");
const current = { stages, readable };
if (process.argv.includes("--update") || !existsSync(goldenPath)) {
  writeFileSync(goldenPath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Golden file written: ${Object.keys(stages).length} stage fingerprints.`);
  console.log(readable);
} else {
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as typeof current;
  const changed = Object.keys({ ...golden.stages, ...stages }).filter(key => golden.stages[key] !== stages[key]);
  if (changed.length) {
    console.log(`FAIL: ${changed.length} stage(s) differ from the golden master: ${changed.slice(0, 6).join(", ")}`);
    process.exit(1);
  }
  console.log(`OK: all ${Object.keys(stages).length} stages match the golden master.`);
  console.log(readable);
}
