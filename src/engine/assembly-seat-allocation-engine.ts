import type { AssemblyConstituency } from "@/types/constituency";

export interface AssemblyRegion {
  id: string;
  name: string;
  constituencyIds: string[];
  constituencyCount: number;
}

export interface AssemblyRegionState {
  state: string;
  stateId: string;
  regions: AssemblyRegion[];
}

export interface RegionalPartySeatShare {
  partyId: string;
  seats: number;
}

export interface RegionalSeatShare {
  regionId: string;
  regionName: string;
  totalSeats: number;
  partyShares: RegionalPartySeatShare[];
}

export interface PartyConstituencySelection {
  partyId: string;
  constituencyIds: string[];
}

export interface RegionalSeatAllocation {
  regionId: string;
  selections: PartyConstituencySelection[];
}

export interface AssemblySeatAllocation {
  state: string;
  stateId: string;
  partyIds: string[];
  regionalShares: RegionalSeatShare[];
  regionalAllocations: RegionalSeatAllocation[];
}

export interface AllocationIssue {
  code:
    | "UNKNOWN_REGION"
    | "UNKNOWN_PARTY"
    | "UNKNOWN_CONSTITUENCY"
    | "DUPLICATE_CONSTITUENCY"
    | "PARTY_SHARE_EXCEEDED"
    | "PARTY_SHARE_MISMATCH"
    | "REGION_INCOMPLETE";
  message: string;
  regionId?: string;
  partyId?: string;
  constituencyId?: string;
}

export interface AllocationValidation {
  valid: boolean;
  issues: AllocationIssue[];
  assignedSeats: number;
  totalSeats: number;
  unassignedSeats: number;
}

export function getAssemblyStateRegions(
  dataset: { states: AssemblyRegionState[] },
  stateName: string
): AssemblyRegionState | undefined {
  return dataset.states.find((item) => item.state === stateName);
}

export function getStateConstituencies(
  constituencies: AssemblyConstituency[],
  stateName: string
): AssemblyConstituency[] {
  return constituencies.filter((item) => item.state === stateName);
}

/**
 * Creates an empty allocation for one complete state election.
 * Seat shares are stored per region, but all regions belong to one election.
 */
export function createAssemblySeatAllocation(
  stateData: AssemblyRegionState,
  partyIds: string[],
  regionalShares: RegionalSeatShare[]
): AssemblySeatAllocation {
  return {
    state: stateData.state,
    stateId: stateData.stateId,
    partyIds: [...new Set(partyIds)],
    regionalShares: regionalShares.map((share) => ({ ...share, partyShares: share.partyShares.map((item) => ({ ...item })) })),
    regionalAllocations: stateData.regions.map((region) => ({
      regionId: region.id,
      selections: partyIds.map((partyId) => ({ partyId, constituencyIds: [] })),
    })),
  };
}

/**
 * Adds or removes a constituency from a party's regional selection.
 * The caller should validate the returned allocation before confirmation.
 */
export function toggleConstituencySelection(
  allocation: AssemblySeatAllocation,
  regionId: string,
  partyId: string,
  constituencyId: string
): AssemblySeatAllocation {
  return {
    ...allocation,
    regionalAllocations: allocation.regionalAllocations.map((region) => {
      if (region.regionId !== regionId) return region;
      return {
        ...region,
        selections: region.selections.map((selection) => {
          if (selection.partyId !== partyId) return selection;
          const alreadySelected = selection.constituencyIds.includes(constituencyId);
          return {
            ...selection,
            constituencyIds: alreadySelected
              ? selection.constituencyIds.filter((id) => id !== constituencyId)
              : [...selection.constituencyIds, constituencyId],
          };
        }),
      };
    }),
  };
}

/**
 * Validates the full-state allocation:
 * - every constituency belongs to exactly one region;
 * - only participating parties receive seats;
 * - no constituency is allocated twice;
 * - party seat counts do not exceed the agreed regional share;
 * - optionally, every agreed share must be filled before confirmation.
 */
export function validateAssemblySeatAllocation(args: {
  stateData: AssemblyRegionState;
  allocation: AssemblySeatAllocation;
  requireComplete?: boolean;
}): AllocationValidation {
  const { stateData, allocation, requireComplete = true } = args;
  const issues: AllocationIssue[] = [];
  const partyIds = new Set(allocation.partyIds);
  const regionById = new Map(stateData.regions.map((region) => [region.id, region]));
  const seen = new Set<string>();
  let assignedSeats = 0;
  const totalSeats = stateData.regions.reduce((sum, region) => sum + region.constituencyIds.length, 0);

  if (allocation.state !== stateData.state || allocation.stateId !== stateData.stateId) {
    issues.push({ code: "UNKNOWN_REGION", message: "The allocation does not match the selected state." });
  }

  for (const share of allocation.regionalShares) {
    const region = regionById.get(share.regionId);
    if (!region) {
      issues.push({ code: "UNKNOWN_REGION", message: `Unknown region in seat-share plan: ${share.regionId}.`, regionId: share.regionId });
      continue;
    }
    const shareTotal = share.partyShares.reduce((sum, item) => sum + item.seats, 0);
    if (shareTotal > region.constituencyIds.length) {
      issues.push({ code: "PARTY_SHARE_EXCEEDED", message: `${share.regionName}: party seat shares exceed the ${region.constituencyIds.length} available seats.`, regionId: share.regionId });
    }
    for (const item of share.partyShares) {
      if (!partyIds.has(item.partyId)) {
        issues.push({ code: "UNKNOWN_PARTY", message: `${item.partyId} is not part of this election.`, regionId: share.regionId, partyId: item.partyId });
      }
      if (!Number.isInteger(item.seats) || item.seats < 0) {
        issues.push({ code: "PARTY_SHARE_MISMATCH", message: `Invalid seat share for ${item.partyId} in ${share.regionName}.`, regionId: share.regionId, partyId: item.partyId });
      }
    }
  }

  for (const regionAllocation of allocation.regionalAllocations) {
    const region = regionById.get(regionAllocation.regionId);
    if (!region) {
      issues.push({ code: "UNKNOWN_REGION", message: `Unknown allocation region: ${regionAllocation.regionId}.`, regionId: regionAllocation.regionId });
      continue;
    }
    const validIds = new Set(region.constituencyIds);
    const share = allocation.regionalShares.find((item) => item.regionId === region.id);
    for (const selection of regionAllocation.selections) {
      if (!partyIds.has(selection.partyId)) {
        issues.push({ code: "UNKNOWN_PARTY", message: `${selection.partyId} is not part of this election.`, regionId: region.id, partyId: selection.partyId });
      }
      const allowedSeats = share?.partyShares.find((item) => item.partyId === selection.partyId)?.seats ?? 0;
      if (selection.constituencyIds.length > allowedSeats) {
        issues.push({ code: "PARTY_SHARE_EXCEEDED", message: `${selection.partyId} selected ${selection.constituencyIds.length} seats in ${region.name}, exceeding its share of ${allowedSeats}.`, regionId: region.id, partyId: selection.partyId });
      }
      if (requireComplete && selection.constituencyIds.length !== allowedSeats) {
        issues.push({ code: "PARTY_SHARE_MISMATCH", message: `${selection.partyId} must select exactly ${allowedSeats} seats in ${region.name}; currently selected ${selection.constituencyIds.length}.`, regionId: region.id, partyId: selection.partyId });
      }
      for (const id of selection.constituencyIds) {
        assignedSeats += 1;
        if (!validIds.has(id)) {
          issues.push({ code: "UNKNOWN_CONSTITUENCY", message: `${id} does not belong to ${region.name}.`, regionId: region.id, partyId: selection.partyId, constituencyId: id });
        }
        if (seen.has(id)) {
          issues.push({ code: "DUPLICATE_CONSTITUENCY", message: `${id} has been allocated more than once.`, regionId: region.id, partyId: selection.partyId, constituencyId: id });
        }
        seen.add(id);
      }
    }
  }

  if (requireComplete) {
    for (const region of stateData.regions) {
      const selected = allocation.regionalAllocations.find((item) => item.regionId === region.id);
      const allocatedCount = selected?.selections.reduce((sum, item) => sum + item.constituencyIds.length, 0) ?? 0;
      if (allocatedCount !== region.constituencyIds.length) {
        issues.push({ code: "REGION_INCOMPLETE", message: `${region.name} has ${allocatedCount} allocated seats out of ${region.constituencyIds.length}.`, regionId: region.id });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    assignedSeats,
    totalSeats,
    unassignedSeats: Math.max(0, totalSeats - seen.size),
  };
}

/** Resolve selected constituency IDs to records for the single full-state election. */
export function getAllocatedConstituencies(
  allocation: AssemblySeatAllocation,
  constituencies: AssemblyConstituency[]
): Array<AssemblyConstituency & { allocatedPartyId: string; regionId: string }> {
  const byId = new Map(constituencies.map((item) => [item.id, item]));
  return allocation.regionalAllocations.flatMap((region) =>
    region.selections.flatMap((selection) =>
      selection.constituencyIds.flatMap((id) => {
        const constituency = byId.get(id);
        return constituency
          ? [{ ...constituency, allocatedPartyId: selection.partyId, regionId: region.regionId }]
          : [];
      })
    )
  );
}
