/** Party colours and symbol files. Symbols live in public/symbols/<key>.png. */
const COLORS: Record<string, string> = {
  "aap": "#1A2891",
  "agp": "#7B1FA2",
  "aiadmk": "#138808",
  "aimim": "#074423",
  "ainrc": "#F2C300",
  "aitc": "#20C646",
  "aiudf": "#00B050",
  "ajsu": "#008F45",
  "bjd": "#38B628",
  "bjp": "#FF9933",
  "brs": "#F84797",
  "bsp": "#22409A",
  "cpi": "#FF0000",
  "cpm": "#FF5252",
  "dmk": "#E91E8C",
  "inc": "#0078D4",
  "iuml": "#006600",
  "jd-s": "#00913F",
  "jd-u": "#238C23",
  "jknc": "#FF0000",
  "jmm": "#20B04A",
  "jsp": "#E31E24",
  "ljp": "#00B8A9",
  "mnf": "#6A4C93",
  "ncp": "#00B2B2",
  "ncp-sp": "#0C5B31",
  "npf": "#1D3FBB",
  "npp": "#69B82D",
  "ntk": "#C40000",
  "pdp": "#016138",
  "pmk": "#FFCC00",
  "rjd": "#008000",
  "rld": "#3D8D2F",
  "sad": "#F79A33",
  "sdf": "#FFD500",
  "shs": "#D96A00",
  "skm": "#00A859",
  "sp": "#FF2222",
  "ssubt": "#F4511E",
  "tdp": "#FFE600",
  "tipra": "#FFD100",
  "ysrcp": "#1569C7",
  "zpm": "#FFD700",
};

export function partyKey(partyId: string) {
  return partyId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function partyColor(partyId: string) {
  return COLORS[partyKey(partyId)] ?? "#64748B";
}

export function partySymbolSrc(partyId: string) {
  return `/symbols/${partyKey(partyId)}.png`;
}

/**
 * Colour of an alliance or front. A colour the player chose wins; otherwise BJP or INC
 * (whichever has more seats if both are present) lends its colour, otherwise the colour
 * of the member party with the most seats.
 */
export function allianceColor(parties: Array<{ name: string; seats: number }>, chosen?: string | null) {
  if (chosen) return chosen;
  const anchors = parties.filter((p) => ["bjp", "inc"].includes(partyKey(p.name))).sort((a, b) => b.seats - a.seats);
  const lead = anchors[0] ?? [...parties].sort((a, b) => b.seats - a.seats)[0];
  return lead ? partyColor(lead.name) : "#64748B";
}

/** "Independent – BRS" (older saves) shown as plain "BRS". */
export function plainGroupName(name: string) {
  return name.replace(/^Independent\s*[–-]\s*/, "");
}

/** JSON.parse reviver that applies plainGroupName to every string in a saved game. */
export function plainNamesReviver(_key: string, value: unknown) {
  return typeof value === "string" ? plainGroupName(value) : value;
}

/** How an alliance is written on screen: "NDA" is N.D.A and "INDIA Alliance" is I.N.D.I.A. Stored names never change. */
export function allianceShort(name: string): string {
  const plain = plainGroupName(name);
  const key = plain.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  if (key === "nda" || key === "national democratic alliance") return "N.D.A";
  if (["india", "india alliance", "indian national developmental inclusive alliance", "indian national development inclusive alliance"].includes(key)) return "I.N.D.I.A";
  return plain;
}
/** The full form shown under the short name of the two national alliances, or "" for any other group. */
export function allianceFull(name: string): string {
  const short = allianceShort(name);
  return short === "N.D.A" ? "National Democratic Alliance" : short === "I.N.D.I.A" ? "Indian National Developmental Inclusive Alliance" : "";
}
/** Writes N.D.A / I.N.D.I.A inside a sentence (notices, offers, summaries). */
export function allianceText(text: string): string {
  return text.replace(/\bINDIA Alliance\b/g, "I.N.D.I.A").replace(/\bNDA\b/g, "N.D.A");
}
