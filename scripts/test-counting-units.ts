import { unitOf } from "../src/engine/counting-engine";
const ctx = { playerAllianceName: "Bharat Front", playerPartyId: "BF", groupsByState: { UP: [
  { name: "NDA", type: "PREDEFINED", memberPartyIds: ["BJP", "RLD"], isPlayerAlliance: false },
  { name: "Bharat Front", type: "PLAYER", memberPartyIds: ["BF", "SP"], isPlayerAlliance: true },
  { name: "Independent", type: "INDEPENDENT", memberPartyIds: ["BSP"], isPlayerAlliance: false } ] } };
let bad = 0; const t = (n: string, ok: boolean) => { if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", n); };
t("alliance member -> NDA bloc", unitOf(ctx, "UP", "RLD").id === "BLOC:nda" && unitOf(ctx, "UP", "RLD").alliance);
t("player alliance flagged, uses typed name", unitOf(ctx, "UP", "SP").isPlayer && unitOf(ctx, "UP", "SP").name === "Bharat Front");
t("lone party is not an alliance and shows its own name", !unitOf(ctx, "UP", "BSP").alliance && unitOf(ctx, "UP", "BSP").name === "BSP");
t("unknown state -> lone party", !unitOf(ctx, "ZZ", "BJP").alliance);
process.exit(bad ? 1 : 0);
