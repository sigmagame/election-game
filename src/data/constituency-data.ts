import assemblyData from "@/data/assembly-constituencies-2024.json";
import lokSabhaData from "@/data/lok-sabha-constituencies-2024.json";
import type {
  AssemblyConstituency,
  ConstituencyDataset,
  LokSabhaConstituency,
} from "@/types/constituency";

const assemblyDataset =
  assemblyData as ConstituencyDataset<AssemblyConstituency>;

const lokSabhaDataset =
  lokSabhaData as ConstituencyDataset<LokSabhaConstituency>;

/**
 * 2024 Assembly Constituency data.
 * totalVoters is sourced from Registered Electors.
 */
export const assemblyConstituencies: AssemblyConstituency[] =
  assemblyDataset.constituencies;

/**
 * 2024 Lok Sabha Parliamentary Constituency data.
 * totalVoters is sourced from Registered Electors.
 */
export const lokSabhaConstituencies: LokSabhaConstituency[] =
  lokSabhaDataset.constituencies;

export const assemblyConstituencyMetadata = {
  dataset: assemblyDataset.dataset,
  sourceWorkbook: assemblyDataset.sourceWorkbook,
  electionYear: assemblyDataset.electionYear,
  voterCountField: assemblyDataset.voterCountField,
  voterCountSourceColumn: assemblyDataset.voterCountSourceColumn,
  recordCount: assemblyDataset.recordCount,
  missingTotalVotersCount: assemblyDataset.missingTotalVotersCount,
};

export const lokSabhaConstituencyMetadata = {
  dataset: lokSabhaDataset.dataset,
  sourceWorkbook: lokSabhaDataset.sourceWorkbook,
  electionYear: lokSabhaDataset.electionYear,
  voterCountField: lokSabhaDataset.voterCountField,
  voterCountSourceColumn: lokSabhaDataset.voterCountSourceColumn,
  recordCount: lokSabhaDataset.recordCount,
  missingTotalVotersCount: lokSabhaDataset.missingTotalVotersCount,
};

export function getAssemblyConstituenciesByState(
  state: string,
): AssemblyConstituency[] {
  return assemblyConstituencies.filter(
    (constituency) => constituency.state === state,
  );
}

export function getLokSabhaConstituenciesByState(
  state: string,
): LokSabhaConstituency[] {
  return lokSabhaConstituencies.filter(
    (constituency) => constituency.state === state,
  );
}

/**
 * Returns the Assembly segments mapped to a Parliamentary Constituency.
 * The state is included in the match to avoid collisions between states.
 */
export function getAssemblySegmentsForParliamentaryConstituency(
  state: string,
  parliamentaryConstituency: string,
): AssemblyConstituency[] {
  return assemblyConstituencies.filter(
    (constituency) =>
      constituency.state === state &&
      constituency.parentParliamentaryConstituency ===
        parliamentaryConstituency,
  );
}

export function getAssemblyConstituencyById(
  id: string,
): AssemblyConstituency | undefined {
  return assemblyConstituencies.find((constituency) => constituency.id === id);
}

export function getLokSabhaConstituencyById(
  id: string,
): LokSabhaConstituency | undefined {
  return lokSabhaConstituencies.find((constituency) => constituency.id === id);
}

/** Unique state/UT labels represented in the Assembly dataset. */
export const assemblyStates = Array.from(
  new Set(assemblyConstituencies.map((constituency) => constituency.state)),
).sort((a, b) => a.localeCompare(b));

/** Unique state/UT labels represented in the Lok Sabha dataset. */
export const lokSabhaStates = Array.from(
  new Set(lokSabhaConstituencies.map((constituency) => constituency.state)),
).sort((a, b) => a.localeCompare(b));
