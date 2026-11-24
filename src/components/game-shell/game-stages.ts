export type ElectionKind = "lok-sabha" | "assembly";

export interface GameStage {
  id: string;
  label: string;
  /** Where the tab takes the player. */
  href: string;
  /** A route belongs to this stage when it equals, or starts with, one of these. */
  match: string[];
  /** Routes that start with one of these never belong to this stage (they belong to a later one). */
  exclude?: string[];
}

/** `hung` adds the Negotiation tab to an Assembly election whose result is hung. */
export function getStages(kind: ElectionKind, hung = false): GameStage[] {
  const base = `/elections/${kind}`;
  const stages: GameStage[] = [
    { id: "home", label: "Home", href: "/", match: ["/"] },
    {
      id: "setup",
      label: "Setup",
      href: "/elections/setup",
      match: ["/elections/setup", base, `${base}/new-game`, `${base}/game`, `${base}/seat-allocation`],
      exclude: [`${base}/campaign`, `${base}/voting`, `${base}/counting`, `${base}/results`, `${base}/government-formation`],
    },
    { id: "campaign", label: "Campaign", href: `${base}/campaign`, match: [`${base}/campaign`] },
    { id: "voting", label: "Voting", href: `${base}/voting`, match: [`${base}/voting`] },
    { id: "counting", label: "Counting", href: `${base}/counting`, match: [`${base}/counting`] },
    { id: "results", label: "Results", href: `${base}/results`, match: [`${base}/results`] },
  ];
  if (kind === "lok-sabha" || hung) {
    stages.push({
      id: "negotiation",
      label: "Negotiation",
      href: `${base}/government-formation`,
      match: [`${base}/government-formation`],
      exclude: [`${base}/government-formation/cabinet`],
    });
    stages.push({
      id: "government",
      label: "Government & cabinet",
      href: `${base}/government-formation/cabinet`,
      match: [`${base}/government-formation/cabinet`],
    });
  } else {
    stages.push({
      id: "government",
      label: "Government & cabinet",
      href: `${base}/government-formation`,
      match: [`${base}/government-formation`],
    });
  }
  return stages;
}

function matches(path: string, prefix: string) {
  if (prefix === "/") return path === "/";
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Index of the stage the current route belongs to (0 when none matches). */
export function stageIndexForPath(stages: GameStage[], path: string): number {
  const found = stages.findIndex(
    (stage) =>
      stage.match.some((prefix) => matches(path, prefix)) &&
      !(stage.exclude ?? []).some((prefix) => matches(path, prefix)),
  );
  return found < 0 ? 0 : found;
}
