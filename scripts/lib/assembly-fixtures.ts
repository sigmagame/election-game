/** Shared fixtures for the Assembly tests: real datasets, a seeded generator and a full-campaign player. */
import regionData from "@/data/assembly-regions-2024.json";
import constituencyData from "@/data/assembly-constituencies-2024.json";
import { getPoliticalRelationship } from "@/engine/alliance-engine";
import {
  ASSEMBLY_CAMPAIGN_ACTIONS_PER_WEEK,
  ASSEMBLY_CAMPAIGN_WEEKS,
  acknowledgeCampaignEvent,
  CAMPAIGN_ACTIONS,
  completeAssemblyCampaignWeek,
  continueAssemblyCampaignWeek,
  createAssemblyCampaign,
  queueAssemblyCampaignAction,
} from "@/engine/assembly-campaign-engine";
import { createAssemblyGame, toCampaignGame, type AssemblyGameSave } from "@/engine/assembly-game-engine";
import type { AssemblyRegionState, AssemblySeatAllocation } from "@/engine/assembly-seat-allocation-engine";
import { distributeByStrength, getEligiblePartyIdsForState, getPartyStrength } from "@/engine/lok-sabha-game-engine";
import type { AssemblyConstituency } from "@/types/constituency";

export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const states = (regionData as unknown as { states: AssemblyRegionState[] }).states;
export const allConstituencies = (constituencyData as unknown as { constituencies: AssemblyConstituency[] }).constituencies;

// ---- helpers ---------------------------------------------------------------------------------
/** Splits every region's seats among the player's alliance by strength, as a confirmed allocation. */
export function allocationFor(stateData: AssemblyRegionState, partyIds: string[]): AssemblySeatAllocation {
  const regionalShares = stateData.regions.map((region) => {
    const plan = distributeByStrength(partyIds, stateData.state, region.constituencyIds.length);
    return {
      regionId: region.id,
      regionName: region.name,
      totalSeats: region.constituencyIds.length,
      partyShares: partyIds.map((partyId) => ({ partyId, seats: plan[partyId] ?? 0 })),
    };
  });
  return {
    state: stateData.state,
    stateId: stateData.stateId,
    partyIds,
    regionalShares,
    regionalAllocations: stateData.regions.map((region, index) => {
      let cursor = 0;
      return {
        regionId: region.id,
        selections: regionalShares[index].partyShares.map((share) => {
          const constituencyIds = region.constituencyIds.slice(cursor, cursor + share.seats);
          cursor += share.seats;
          return { partyId: share.partyId, constituencyIds };
        }),
      };
    }),
  };
}

export function strongestParty(state: string): string {
  return [...getEligiblePartyIdsForState(state)].sort((a, b) => (getPartyStrength(b, state) ?? 0) - (getPartyStrength(a, state) ?? 0))[0];
}

export function newGame(stateData: AssemblyRegionState, withPartner = false): AssemblyGameSave {
  const state = stateData.state;
  const player = strongestParty(state);
  const partners = withPartner
    ? getEligiblePartyIdsForState(state).filter((id) => {
        if (id === player) return false;
        const relation = getPoliticalRelationship(player, id, { region: state, electionType: "ASSEMBLY" }).relationship;
        return relation === "STRONG_ALLY" || relation === "FRIENDLY";
      }).slice(0, 1)
    : [];
  const partyIds = [player, ...partners];
  return createAssemblyGame({
    setup: {
      difficulty: "Normal",
      state,
      playerPartyId: player,
      allianceName: partners.length ? "Test Front" : "Independent",
      partyIds,
      allianceType: partners.length ? "alliance" : "independent",
    },
    allocation: allocationFor(stateData, partyIds),
    stateData,
    constituencies: allConstituencies.filter((item) => item.state === state),
  });
}

export const ACTIONS = CAMPAIGN_ACTIONS.map((item) => item.id);

/** Plays all 8 weeks, spreading the six weekly actions over the state's regions. */
export function playFullCampaign(game: AssemblyGameSave) {
  const regions = toCampaignGame(game).regions![game.state];
  let campaign = createAssemblyCampaign(game, Math.random);
  for (let week = 1; week <= ASSEMBLY_CAMPAIGN_WEEKS; week += 1) {
    for (let i = 0; i < ASSEMBLY_CAMPAIGN_ACTIONS_PER_WEEK; i += 1) {
      campaign = queueAssemblyCampaignAction(campaign, game, ACTIONS[(week + i) % ACTIONS.length], regions[(week + i) % regions.length].id);
    }
    campaign = completeAssemblyCampaignWeek(campaign, game);
    if (week < ASSEMBLY_CAMPAIGN_WEEKS) {
      for (const event of campaign.activeEvents) {
        if (event.priority === "CRITICAL" && !event.acknowledged) campaign = acknowledgeCampaignEvent(campaign, event.id);
      }
      campaign = continueAssemblyCampaignWeek(campaign);
    }
  }
  return campaign;
}

