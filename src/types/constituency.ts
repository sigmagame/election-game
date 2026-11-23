import type { AssemblyConstituencyReservation } from "@/types/reservation-category-type";

export interface ConstituencyDataMetadata {
  dataset: "assembly-constituencies" | "lok-sabha-constituencies";
  sourceWorkbook: string;
  electionYear: number;
  voterCountField: "totalVoters";
  voterCountSourceColumn: "Registered Electors";
  recordCount: number;
  missingTotalVotersCount: number;
}

export interface AssemblyConstituency extends AssemblyConstituencyReservation {
  id: string;
  state: string;
  name: string;
  parentParliamentaryConstituency: string;
  /** Registered Electors. This is the simulation voter-count baseline. */
  totalVoters: number;
  registeredElectors: number;
  electionYear: number;
  dataStatus: string;
  sourceUrl: string | null;
  notes: string | null;
}

export interface LokSabhaConstituency {
  id: string;
  state: string;
  name: string;
  /** Registered Electors. This is the simulation voter-count baseline. */
  totalVoters: number;
  registeredElectors: number;
  electionYear: number;
  dataStatus: string;
  sourceUrl: string | null;
  notes: string | null;
}

export interface ConstituencyDataset<TConstituency> {
  dataset: string;
  sourceWorkbook: string;
  electionYear: number;
  voterCountField: string;
  voterCountSourceColumn: string;
  recordCount: number;
  missingTotalVotersCount: number;
  constituencies: TConstituency[];
}
