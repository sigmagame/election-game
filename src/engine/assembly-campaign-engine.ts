import { toCampaignGame, type AssemblyGameSave } from "@/engine/assembly-game-engine";
import {
  buildFinalCampaignReport,
  completeCampaignWeek,
  continueToNextCampaignWeek,
  createLokSabhaCampaignSave,
  queuePlayerCampaignAction,
  removePlayerCampaignAction,
  skipToVoting,
} from "@/engine/lok-sabha-campaign-engine";
import { ASSEMBLY_PROFILE, majorityMark, type CampaignRegion } from "@/types/campaign-profile";
import type { CampaignActionType, FinalCampaignReport, LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";

export {
  acknowledgeCampaignEvent,
  CAMPAIGN_ACTIONS,
  getLastWeeklySummary,
  lockCampaignForVoting,
  summarizeSupport,
} from "@/engine/lok-sabha-campaign-engine";

/** An Assembly campaign is 8 weeks of 6 actions, each aimed at one region of the state. */
export const ASSEMBLY_CAMPAIGN_WEEKS = ASSEMBLY_PROFILE.weeks;
export const ASSEMBLY_CAMPAIGN_ACTIONS_PER_WEEK = ASSEMBLY_PROFILE.actionsPerWeek;
export const ASSEMBLY_CAMPAIGN_SAVE_KEY = "indian-election-simulator:assembly-campaign";

export function getAssemblyMajority(game: Pick<AssemblyGameSave, "totalConstituencies">): number {
  return majorityMark(game.totalConstituencies);
}

export function createAssemblyCampaign(game: AssemblyGameSave, random: () => number = Math.random): LokSabhaCampaignSave {
  return createLokSabhaCampaignSave(toCampaignGame(game), random, ASSEMBLY_PROFILE);
}

export function queueAssemblyCampaignAction(
  campaign: LokSabhaCampaignSave,
  game: AssemblyGameSave,
  actionType: CampaignActionType,
  regionId: string,
): LokSabhaCampaignSave {
  return queuePlayerCampaignAction(campaign, toCampaignGame(game), actionType, game.state, regionId, ASSEMBLY_PROFILE);
}

export function removeAssemblyCampaignAction(campaign: LokSabhaCampaignSave, actionId: string): LokSabhaCampaignSave {
  return removePlayerCampaignAction(campaign, actionId, ASSEMBLY_PROFILE);
}

export function completeAssemblyCampaignWeek(campaign: LokSabhaCampaignSave, game: AssemblyGameSave): LokSabhaCampaignSave {
  return completeCampaignWeek(campaign, toCampaignGame(game), ASSEMBLY_PROFILE);
}

export function continueAssemblyCampaignWeek(campaign: LokSabhaCampaignSave): LokSabhaCampaignSave {
  return continueToNextCampaignWeek(campaign, ASSEMBLY_PROFILE);
}

/** Ends the campaign early: the final report is built from today's support and voting is unlocked. */
export function skipAssemblyToVoting(campaign: LokSabhaCampaignSave, game: AssemblyGameSave): LokSabhaCampaignSave {
  return skipToVoting(campaign, toCampaignGame(game), ASSEMBLY_PROFILE);
}

/** A projection built from today's support (used by the mid-campaign opinion poll). */
export function buildAssemblyReport(campaign: LokSabhaCampaignSave, game: AssemblyGameSave): FinalCampaignReport {
  return buildFinalCampaignReport(campaign, toCampaignGame(game), campaign.constituencySupport, ASSEMBLY_PROFILE);
}

export interface AssemblyRegionSupport {
  region: CampaignRegion;
  /** Average support (%) of each party across the region's constituencies. */
  support: Record<string, number>;
  /** The player's actions aimed at this region in the current week. */
  actionsThisWeek: number;
}

export function getAssemblyRegionSupport(campaign: LokSabhaCampaignSave, game: AssemblyGameSave): AssemblyRegionSupport[] {
  const regions = toCampaignGame(game).regions?.[game.state] ?? [];
  const byId = new Map(campaign.constituencySupport.map((item) => [item.constituencyId, item.partySupport]));
  return regions.map((region) => {
    const totals: Record<string, number> = {};
    for (const id of region.constituencyIds) {
      for (const [partyId, value] of Object.entries(byId.get(id) ?? {})) totals[partyId] = (totals[partyId] ?? 0) + value;
    }
    const seats = Math.max(1, region.constituencyIds.length);
    return {
      region,
      support: Object.fromEntries(Object.entries(totals).map(([partyId, total]) => [partyId, Math.round((total / seats) * 100) / 100])),
      actionsThisWeek: campaign.playerActions.filter(
        (action) => action.week === campaign.currentWeek && action.targetRegionId === region.id,
      ).length,
    };
  });
}

export function saveAssemblyCampaign(campaign: LokSabhaCampaignSave): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ASSEMBLY_CAMPAIGN_SAVE_KEY, JSON.stringify({ ...campaign, updatedAt: new Date().toISOString() }));
}

export function loadAssemblyCampaign(gameId?: string): LokSabhaCampaignSave | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ASSEMBLY_CAMPAIGN_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LokSabhaCampaignSave;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.constituencySupport) || (gameId && parsed.gameId !== gameId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function deleteAssemblyCampaign(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(ASSEMBLY_CAMPAIGN_SAVE_KEY);
}
