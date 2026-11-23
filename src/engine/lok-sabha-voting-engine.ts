import { generateNotaRate, generateTurnout } from "@/engine/turnout-model";
import scheduleData from "@/data/lok-sabha-voting-phase-schedule.json";
import type { LokSabhaGameSave } from "@/types/lok-sabha-game";
import type { LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";
import type { LokSabhaVotingSave, VotingPhaseResult, VotingConstituencyResult } from "@/types/lok-sabha-voting";

export const LOK_SABHA_VOTING_SAVE_KEY = "indian-election-game-lok-sabha-voting-save";
const schedule = scheduleData as { scheduleId: string; totalConstituencies: number; phaseCount: number; phases: Array<{phase:number;day:number;constituencyCount:number;regions:Array<{name:string;constituencyIds:string[]}>}> };

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i=0;i<text.length;i++) { h ^= text.charCodeAt(i); h = Math.imul(h,16777619); }
  return h >>> 0;
}
export function randomFor(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x += 0x6D2B79F5; let t=x; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; };
}
function getSupport(campaign: LokSabhaCampaignSave, id: string): Record<string, number> {
  return campaign.constituencySupport.find(x=>x.constituencyId===id)?.partySupport ?? {};
}
export function allocateVotes(total: number, weights: Array<{id:string;weight:number}>): Record<string,number> {
  const sum=weights.reduce((a,x)=>a+Math.max(0,x.weight),0);
  if (!sum || total<=0) return {};
  const raw=weights.map(x=>({id:x.id,exact:total*Math.max(0,x.weight)/sum}));
  const out:Record<string,number>={}; let used=0;
  raw.forEach(x=>{out[x.id]=Math.floor(x.exact);used+=out[x.id];});
  raw.sort((a,b)=>(b.exact-Math.floor(b.exact))-(a.exact-Math.floor(a.exact)));
  for(let i=0;i<total-used;i++) out[raw[i%raw.length].id]+=1;
  return out;
}
export function createVotingSave(game: LokSabhaGameSave): LokSabhaVotingSave {
  return {schemaVersion:1,gameId:game.gameId,scheduleId:schedule.scheduleId,status:"IN_PROGRESS",currentPhase:1,completedPhases:[],phaseResults:[],updatedAt:new Date().toISOString()};
}
export function getVotingSchedule() { return schedule; }
export function runVotingPhase(game: LokSabhaGameSave, campaign: LokSabhaCampaignSave, save: LokSabhaVotingSave, phaseNumber=save.currentPhase): LokSabhaVotingSave {
  if (campaign.status !== "LOCKED") throw new Error("Voting can begin only after the campaign is locked.");
  if (save.gameId!==game.gameId) throw new Error("Voting save belongs to a different game.");
  if (save.completedPhases.includes(phaseNumber)) return save;
  if (phaseNumber!==save.currentPhase) throw new Error("Voting phases must be completed in order.");
  const phase=schedule.phases.find(p=>p.phase===phaseNumber);
  if(!phase) throw new Error("Voting phase was not found.");
  const constituencies=game.constituencies.filter(c=>phase.regions.some(r=>r.constituencyIds.includes(c.constituencyId)));
  if(constituencies.length!==phase.constituencyCount) throw new Error(`Phase ${phaseNumber} schedule does not match the active game constituencies.`);
  const results:VotingConstituencyResult[]=[];
  for(const c of constituencies) {
    const registered=c.registeredElectors || c.totalVoters;
    const rng=randomFor(hashSeed(`${game.gameId}:${phaseNumber}:${c.constituencyId}:votes`));
    const turnoutRate=generateTurnout({gameId:game.gameId,scope:"lok-sabha",state:c.state,constituencyId:c.constituencyId});
    const totalVotes=Math.min(registered,Math.round(registered*turnoutRate));
    const support=getSupport(campaign,c.constituencyId);
    const parties=Object.entries(support).filter(([id])=>c.allocations.some(a=>a.partyId===id));
    if(!parties.length) throw new Error(`No allocated candidates found for ${c.name}.`);
    const notaRate=generateNotaRate(rng);
    const notaVotes=Math.round(totalVotes*notaRate);
    const partyTotal=totalVotes-notaVotes;
    const partyVotes=allocateVotes(partyTotal,parties.map(([id,value])=>({id,weight:Math.max(0,value)})));
    const winnerPartyId=Object.entries(partyVotes).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0];
    if(!winnerPartyId) throw new Error(`Unable to determine winner for ${c.name}.`);
    results.push({constituencyId:c.constituencyId,state:c.state,registeredElectors:registered,turnoutRate,totalVotes,notaVotes,partyVotes,winnerPartyId});
  }
  const phaseResult:VotingPhaseResult={phase:phase.phase,day:phase.day,completedAt:new Date().toISOString(),constituencyResults:results};
  const phaseResults=[...save.phaseResults,phaseResult];
  const completedPhases=[...save.completedPhases,phaseNumber];
  const complete=completedPhases.length===schedule.phaseCount;
  return {...save,phaseResults,completedPhases,currentPhase:complete?phaseNumber:phaseNumber+1,status:complete?"COMPLETED":"IN_PROGRESS",updatedAt:new Date().toISOString()};
}
