
import fs from "node:fs";
import path from "node:path";
import alignmentRulesData from "../src/data/party-alignment-rules.json" with { type: "json" };

const dataFolder = path.join(process.cwd(), "src", "data");

function loadJSON(filename) {
  const filePath = path.join(dataFolder, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filename}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }

  console.log(`PASS: ${message}`);
}

try {
  console.log("\n--- ELECTION GAME DATA VALIDATION ---\n");

  // 1. Parties
  const partyData = loadJSON("parties.json");
  const partyIds = partyData.parties.map((party) => party.id);
  const uniquePartyIds = new Set(partyIds);

  check(
    partyData.totalParties === 43,
    "Party total is 43"
  );

  check(
    partyIds.length === 43 && uniquePartyIds.size === 43,
    "All 43 party IDs are unique"
  );

  // 2. Alliances
  const allianceData = loadJSON("alliances.json");
  const allianceIds = new Set();
  const membershipIds = [];

  check(
    allianceData.alliances.length === 2,
    "Exactly two predefined alliances exist"
  );

  for (const alliance of allianceData.alliances) {
    allianceIds.add(alliance.id);

    check(
      alliance.corePartyIds.length === 11,
      `${alliance.name} contains 11 core parties`
    );

    for (const partyId of alliance.corePartyIds) {
      check(
        uniquePartyIds.has(partyId),
        `${partyId} exists in the master party list`
      );

      membershipIds.push(partyId);
    }
  }

  check(
    allianceIds.has("NDA") && allianceIds.has("INDIA"),
    "NDA and INDIA alliance IDs exist"
  );

  check(
    new Set(membershipIds).size === membershipIds.length,
    "No party belongs to both predefined alliances"
  );

  // 3. Union ministries
  const unionData = loadJSON("union-ministries.json");
  const unionMinistries = unionData.categories.flatMap(
    (category) => category.ministries
  );

  // Cabinet ministries carry no explicit role; MoS entries are tagged.
  const cabinetMinistries = unionMinistries.filter((item) => !item.role || item.role === "CABINET");
  const regularMoS = unionMinistries.filter((item) => item.role === "REGULAR_MOS");
  const independentChargeMoS = unionMinistries.filter((item) => item.role === "MOS_INDEPENDENT_CHARGE");

  check(
    cabinetMinistries.length === 46 &&
      unionData.totalMinistries === 46,
    "Union Government contains 46 Cabinet ministries"
  );

  check(
    regularMoS.length === 8 && independentChargeMoS.length === 8,
    "Union Government contains 8 regular MoS and 8 MoS (Independent Charge)"
  );

  check(
    unionMinistries.length === 62 &&
      unionData.totalPortfolioPositions === 62,
    "Union Government contains 62 total portfolio positions"
  );

  check(
    new Set(unionMinistries.map((item) => item.id)).size === 62,
    "Union ministry IDs are unique"
  );

  // 4. State ministries
  const stateData = loadJSON("state-ministries.json");
  const stateMinistries = stateData.categories.flatMap(
    (category) => category.ministries
  );

  check(
    stateMinistries.length === 26 &&
      stateData.totalMinistries === 26,
    "State Government contains 26 ministries"
  );

  check(
    new Set(stateMinistries.map((item) => item.id)).size === 26,
    "State ministry IDs are unique"
  );

  // Validate party alignment rules
const validAlignments = ["NDA", "INDIA", "INDEPENDENT", "CUSTOM"];

const alignmentRules = alignmentRulesData.rules;

if (!Array.isArray(alignmentRules)) {
  throw new Error("Alignment rules must be an array.");
}

const alignmentPartyIds = alignmentRules.flatMap(rule => rule.partyIds);

if (new Set(alignmentPartyIds).size !== alignmentPartyIds.length) {
  throw new Error("Duplicate party IDs found in alignment rules.");
}

for (const rule of alignmentRules) {
  if (!Array.isArray(rule.partyIds) || !Array.isArray(rule.eligibleAlignments)) {
    throw new Error("Each alignment rule must contain partyIds and eligibleAlignments arrays.");
  }

  for (const partyId of rule.partyIds) {
    if (!partyData.parties.some(party => party.id === partyId)) {
      throw new Error(`Unknown party ID in alignment rules: ${partyId}`);
    }
  }

  for (const alignment of rule.eligibleAlignments) {
    if (!validAlignments.includes(alignment)) {
      throw new Error(`Invalid alignment "${alignment}" in party alignment rules.`);
    }
  }
}

const expectedGroupSizes = [11, 2, 8];
const actualGroupSizes = alignmentRules.map(rule => rule.partyIds.length);

if (JSON.stringify(actualGroupSizes) !== JSON.stringify(expectedGroupSizes)) {
  throw new Error(
    `Expected alignment group sizes ${expectedGroupSizes.join(", ")}, got ${actualGroupSizes.join(", ")}.`
  );
}

console.log("Party alignment rules: 21 parties validated.");

  console.log("\nALL VALIDATION CHECKS COMPLETED SUCCESSFULLY!");
} catch (error) {
  console.error("\nVALIDATION FAILED:");
  console.error(error.message);
  process.exitCode = 1;
}
