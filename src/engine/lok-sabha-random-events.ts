import type { CampaignEventCategory, CampaignEventPriority, CampaignEventScope, CampaignEventSentiment, CampaignEventRecord, LokSabhaCampaignSave } from "@/types/lok-sabha-campaign";
import type { CampaignElectionType, CampaignGame, CampaignProfile } from "@/types/campaign-profile";
import { LOK_SABHA_PROFILE } from "@/types/campaign-profile";
import { getPartyStrength } from "@/engine/lok-sabha-game-engine";
import { getPoliticalRelationship } from "@/engine/alliance-engine";

export interface CampaignEventDefinition {
  id: string;
  name: string;
  category: CampaignEventCategory;
  sentiment: CampaignEventSentiment;
  description: string;
  allowedScopes: CampaignEventScope[];
  priority: CampaignEventPriority;
}

// 36 authored events: six in each approved category; sentiment totals are
// balanced at 14 positive, 14 negative and 8 neutral.
export const CAMPAIGN_EVENT_LIBRARY: CampaignEventDefinition[] = [
  { id:"PC01", name:"Large Public Welfare Outreach", category:"PUBLIC_CAMPAIGN", sentiment:"POSITIVE", description:"A widely noticed public welfare outreach draws attention to delivery of local services.", allowedScopes:["CONSTITUENCY","STATE"], priority:"LOW" },
  { id:"PC02", name:"Successful Community Mobilisation", category:"PUBLIC_CAMPAIGN", sentiment:"POSITIVE", description:"A large community mobilisation creates a favourable public atmosphere for locally visible organisers.", allowedScopes:["CONSTITUENCY","STATE"], priority:"LOW" },
  { id:"PC03", name:"Popular Civic Initiative", category:"PUBLIC_CAMPAIGN", sentiment:"POSITIVE", description:"A civic initiative receives broad public appreciation and becomes a topic of local discussion.", allowedScopes:["CONSTITUENCY","STATE","NATIONAL"], priority:"INFORMATIONAL" },
  { id:"PC04", name:"Disrupted Public Gathering", category:"PUBLIC_CAMPAIGN", sentiment:"NEGATIVE", description:"A major public gathering is disrupted, creating criticism and questions about local organisation.", allowedScopes:["CONSTITUENCY","STATE"], priority:"MEDIUM" },
  { id:"PC05", name:"Campaign Conduct Controversy", category:"PUBLIC_CAMPAIGN", sentiment:"NEGATIVE", description:"A campaign conduct controversy attracts public criticism and weakens confidence in the parties most closely associated with it.", allowedScopes:["CONSTITUENCY","STATE","NATIONAL"], priority:"MEDIUM" },
  { id:"PC06", name:"Public Consultation Drive", category:"PUBLIC_CAMPAIGN", sentiment:"NEUTRAL", description:"A public consultation brings attention to local concerns without clearly favouring any party.", allowedScopes:["CONSTITUENCY","STATE"], priority:"INFORMATIONAL" },

  { id:"PL01", name:"Leadership Renewal", category:"POLITICAL", sentiment:"POSITIVE", description:"A leadership renewal is received positively by sections of the electorate and improves the party's public profile.", allowedScopes:["STATE","NATIONAL"], priority:"MEDIUM" },
  { id:"PL02", name:"Successful Political Reconciliation", category:"POLITICAL", sentiment:"POSITIVE", description:"A political reconciliation reduces internal friction and creates a more favourable political environment.", allowedScopes:["STATE","NATIONAL"], priority:"LOW" },
  { id:"PL03", name:"Internal Party Dispute", category:"POLITICAL", sentiment:"NEGATIVE", description:"An internal party dispute becomes public and raises questions about organisational unity.", allowedScopes:["STATE","NATIONAL"], priority:"MEDIUM" },
  { id:"PL04", name:"Senior Leader Resignation", category:"POLITICAL", sentiment:"NEGATIVE", description:"A senior leader's resignation triggers political uncertainty and public debate.", allowedScopes:["STATE","NATIONAL"], priority:"MEDIUM" },
  { id:"PL05", name:"Successful Alliance Coordination", category:"POLITICAL", sentiment:"POSITIVE", description:"A successful alliance coordination agreement creates a favourable impression of political cooperation among supporters and observers.", allowedScopes:["STATE","NATIONAL"], priority:"MEDIUM" },
  { id:"PL06", name:"Major Policy Debate", category:"POLITICAL", sentiment:"NEUTRAL", description:"A major policy debate receives attention, but public opinion remains divided and no party gains a clear advantage.", allowedScopes:["STATE","NATIONAL"], priority:"INFORMATIONAL" },

  { id:"EC01", name:"Improved Local Employment Outlook", category:"ECONOMIC_PUBLIC_ISSUES", sentiment:"POSITIVE", description:"A reported improvement in local employment prospects creates a more optimistic public mood.", allowedScopes:["STATE","NATIONAL"], priority:"LOW" },
  { id:"EC02", name:"Relief in Essential Commodity Prices", category:"ECONOMIC_PUBLIC_ISSUES", sentiment:"POSITIVE", description:"A reduction in the prices of selected essential commodities is welcomed by households.", allowedScopes:["STATE","NATIONAL"], priority:"LOW" },
  { id:"EC03", name:"Rising Cost of Living", category:"ECONOMIC_PUBLIC_ISSUES", sentiment:"NEGATIVE", description:"A rise in household living costs becomes a major public concern and prompts criticism of those seen as responsible.", allowedScopes:["STATE","NATIONAL"], priority:"MEDIUM" },
  { id:"EC04", name:"Local Industry Slowdown", category:"ECONOMIC_PUBLIC_ISSUES", sentiment:"NEGATIVE", description:"A slowdown in a major local industry raises concerns about jobs and household incomes.", allowedScopes:["CONSTITUENCY","STATE"], priority:"MEDIUM" },
  { id:"EC05", name:"Agricultural Input Cost Pressure", category:"ECONOMIC_PUBLIC_ISSUES", sentiment:"NEGATIVE", description:"Higher agricultural input costs create concern among farming communities.", allowedScopes:["CONSTITUENCY","STATE"], priority:"MEDIUM" },
  { id:"EC06", name:"Public Infrastructure Review", category:"ECONOMIC_PUBLIC_ISSUES", sentiment:"NEUTRAL", description:"A public review of infrastructure priorities draws attention without producing a clear immediate political advantage.", allowedScopes:["STATE","NATIONAL"], priority:"INFORMATIONAL" },

  { id:"MD01", name:"Favourable Issue-focused Coverage", category:"MEDIA_OPINION", sentiment:"POSITIVE", description:"Issue-focused media coverage highlights a policy proposal that resonates with part of the electorate.", allowedScopes:["STATE","NATIONAL"], priority:"LOW" },
  { id:"MD02", name:"Positive Public Performance Review", category:"MEDIA_OPINION", sentiment:"POSITIVE", description:"A widely discussed public performance review improves perceptions of the parties associated with the issue.", allowedScopes:["STATE","NATIONAL"], priority:"LOW" },
  { id:"MD03", name:"Investigative Media Controversy", category:"MEDIA_OPINION", sentiment:"NEGATIVE", description:"An investigative report triggers scrutiny and public criticism of the parties most closely connected to the issue.", allowedScopes:["STATE","NATIONAL"], priority:"MEDIUM" },
  { id:"MD04", name:"Viral Campaign Misstatement", category:"MEDIA_OPINION", sentiment:"NEGATIVE", description:"A campaign misstatement receives widespread attention and creates an unfavourable news cycle.", allowedScopes:["CONSTITUENCY","STATE","NATIONAL"], priority:"MEDIUM" },
  { id:"MD05", name:"Election Issue Explainer", category:"MEDIA_OPINION", sentiment:"NEUTRAL", description:"A broad explainer increases public understanding of an election issue without endorsing a party.", allowedScopes:["STATE","NATIONAL"], priority:"INFORMATIONAL" },
  { id:"MD06", name:"Public Debate Gains Attention", category:"MEDIA_OPINION", sentiment:"NEUTRAL", description:"A public debate becomes widely discussed, but reactions remain mixed across the electorate.", allowedScopes:["STATE","NATIONAL"], priority:"INFORMATIONAL" },

  { id:"NR01", name:"Favourable Monsoon Conditions", category:"NATURAL_REGIONAL", sentiment:"POSITIVE", description:"Favourable rainfall conditions improve expectations for agriculture and water availability.", allowedScopes:["STATE"], priority:"LOW" },
  { id:"NR02", name:"Successful Local Disaster Response", category:"NATURAL_REGIONAL", sentiment:"POSITIVE", description:"A well-received response to a local emergency improves public confidence in the organisations involved.", allowedScopes:["CONSTITUENCY","STATE"], priority:"LOW" },
  { id:"NR03", name:"Flooding in Affected Areas", category:"NATURAL_REGIONAL", sentiment:"NEGATIVE", description:"Flooding disrupts daily life, damages property and raises questions about preparedness and relief.", allowedScopes:["CONSTITUENCY","STATE"], priority:"CRITICAL" },
  { id:"NR04", name:"Drought and Water Stress", category:"NATURAL_REGIONAL", sentiment:"NEGATIVE", description:"Drought and water stress create serious concerns for households, farmers and local services.", allowedScopes:["CONSTITUENCY","STATE"], priority:"CRITICAL" },
  { id:"NR05", name:"Severe Weather Disruption", category:"NATURAL_REGIONAL", sentiment:"NEGATIVE", description:"Severe weather disrupts transport and public services across the affected region.", allowedScopes:["CONSTITUENCY","STATE"], priority:"MEDIUM" },
  { id:"NR06", name:"Seasonal Weather Advisory", category:"NATURAL_REGIONAL", sentiment:"NEUTRAL", description:"A seasonal weather advisory increases public awareness but has no clear immediate political effect.", allowedScopes:["STATE","NATIONAL"], priority:"INFORMATIONAL" },

  { id:"EA01", name:"Smooth Election Preparedness Review", category:"ELECTION_ADMINISTRATION", sentiment:"POSITIVE", description:"An election preparedness review reports that local arrangements are progressing smoothly.", allowedScopes:["STATE","NATIONAL"], priority:"LOW" },
  { id:"EA02", name:"Successful Voter Awareness Drive", category:"ELECTION_ADMINISTRATION", sentiment:"POSITIVE", description:"A voter awareness drive receives positive public feedback and encourages informed participation.", allowedScopes:["CONSTITUENCY","STATE","NATIONAL"], priority:"INFORMATIONAL" },
  { id:"EA03", name:"Administrative Coordination Failure", category:"ELECTION_ADMINISTRATION", sentiment:"NEGATIVE", description:"An administrative coordination failure raises concerns about election preparedness in the affected area.", allowedScopes:["CONSTITUENCY","STATE"], priority:"CRITICAL" },
  { id:"EA04", name:"Polling Logistics Disruption", category:"ELECTION_ADMINISTRATION", sentiment:"NEGATIVE", description:"A polling logistics disruption prompts questions about administrative readiness and service delivery.", allowedScopes:["CONSTITUENCY","STATE"], priority:"CRITICAL" },
  { id:"EA05", name:"Election Information Clarification", category:"ELECTION_ADMINISTRATION", sentiment:"NEUTRAL", description:"An official clarification answers common election-process questions without favouring any party.", allowedScopes:["STATE","NATIONAL"], priority:"INFORMATIONAL" },
  { id:"EA06", name:"Routine Electoral Roll Update", category:"ELECTION_ADMINISTRATION", sentiment:"NEUTRAL", description:"A routine electoral roll update is announced as part of normal election administration.", allowedScopes:["CONSTITUENCY","STATE","NATIONAL"], priority:"INFORMATIONAL" },
];

const CATEGORY_WEIGHTS: Array<[CampaignEventCategory, number]> = [
  ["PUBLIC_CAMPAIGN",20],["POLITICAL",20],["ECONOMIC_PUBLIC_ISSUES",20],["MEDIA_OPINION",15],["NATURAL_REGIONAL",15],["ELECTION_ADMINISTRATION",10],
];
const SCOPE_WEIGHTS: Array<[CampaignEventScope, number]> = [["CONSTITUENCY",50],["STATE",35],["NATIONAL",15]];
const randInt = (min:number,max:number,random:()=>number) => min + Math.floor(random()*(max-min+1));
function weightedPick<T>(items:Array<[T,number]>, random:()=>number):T { const roll=random()*items.reduce((s,x)=>s+x[1],0); let sum=0; for(const [value,weight] of items){sum+=weight;if(roll<sum)return value;} return items[items.length-1][0]; }

function contextualPartyEffects(electionType:CampaignElectionType, state:string, partyIds:string[], sentiment:CampaignEventSentiment, magnitude:number):Record<string,number>{
  if(sentiment==="NEUTRAL") return Object.fromEntries(partyIds.map(id=>[id,0]));
  const strength=partyIds.map(id=>({id,value:Math.max(0,getPartyStrength(id,state)??0)}));
  const max=Math.max(0,...strength.map(x=>x.value));
  const strongest=strength.filter(x=>x.value===max).map(x=>x.id);
  const result:Record<string,number>={};
  for(const partyId of partyIds){
    const share=max>0?(strength.find(x=>x.id===partyId)?.value??0)/max:0.5;
    const isStrongest=strongest.includes(partyId);
    const relationshipScore=partyIds.filter(other=>other!==partyId).reduce((sum,other)=>{
      const r=getPoliticalRelationship(partyId,other,{region:state,electionType}).relationship;
      return sum+(r==="STRONG_ALLY"?0.12:r==="FRIENDLY"?0.06:r==="RIVAL"?-0.08:r==="STRONG_RIVAL"?-0.12:0);
    },0)/Math.max(1,partyIds.length-1);
    const relevance=Math.max(0.35,Math.min(1.25,0.75+share*0.25+relationshipScore));
    const beneficiaryFactor=isStrongest?1:-0.55;
    result[partyId]=Number((magnitude*relevance*beneficiaryFactor*(sentiment==="POSITIVE"?1:-1)).toFixed(4));
  }
  return result;
}

export function generateWeeklyCampaignEvent(campaign:LokSabhaCampaignSave,game:CampaignGame,random:()=>number=Math.random,profile:CampaignProfile=LOK_SABHA_PROFILE):CampaignEventRecord|null{
  const week=campaign.currentWeek;
  if((campaign.eventGenerationByWeek??[]).includes(week)) return campaign.activeEvents.find(e=>e.week===week)??null;
  if(random()>=0.4) return null;
  const history=campaign.eventHistory??[];
  const recentIds=new Set(history.filter(item=>week-item.week<=3).map(item=>item.eventDefinitionId));
  const sentiment=weightedPick<CampaignEventSentiment>([["POSITIVE",40],["NEGATIVE",40],["NEUTRAL",20]],random);
  const sentimentCandidates=CAMPAIGN_EVENT_LIBRARY.filter(e=>e.sentiment===sentiment&&!recentIds.has(e.id));
  if(!sentimentCandidates.length) return null;
  const eligibleCategoryWeights=CATEGORY_WEIGHTS.filter(([category])=>sentimentCandidates.some(event=>event.category===category));
  const category=weightedPick(eligibleCategoryWeights,random);
  const candidates=sentimentCandidates.filter(e=>e.category===category);
  const definition=candidates[randInt(0,candidates.length-1,random)];
  // An Assembly election has no "national" scope: such events affect the whole state instead.
  const allowedScopes:CampaignEventScope[]=profile.electionType==="ASSEMBLY"?[...new Set(definition.allowedScopes.map(s=>s==="NATIONAL"?"STATE" as const:s))]:definition.allowedScopes;
  const availableScopes=SCOPE_WEIGHTS.filter(([scope])=>allowedScopes.includes(scope));
  const scope=weightedPick(availableScopes,random);
  const validStates=[...new Set(game.constituencies.map(c=>c.state))];
  let location="All India";
  let affected=game.constituencies;
  if(scope==="STATE"){
    location=validStates[randInt(0,validStates.length-1,random)];
    affected=game.constituencies.filter(c=>c.state===location);
  }else if(scope==="CONSTITUENCY"){
    const selected=game.constituencies[randInt(0,game.constituencies.length-1,random)];
    location=selected.name;
    affected=game.constituencies.filter(c=>c.constituencyId===selected.constituencyId);
  }
  const magnitude=randInt(25,75,random)/100;
  const partyEffectsByState:Record<string,Record<string,number>>={};
  for(const state of new Set(affected.map(c=>c.state))){
    const parties=[...new Set(affected.filter(c=>c.state===state).flatMap(c=>Object.keys(campaign.constituencySupport.find(s=>s.constituencyId===c.constituencyId)?.partySupport??{})))];
    partyEffectsByState[state]=contextualPartyEffects(profile.electionType,state,parties,definition.sentiment,magnitude);
  }
  const partyEffects:Record<string,number>={};
  for(const effects of Object.values(partyEffectsByState)) for(const [party,value] of Object.entries(effects)) partyEffects[party]=value;
  return {
    id:`event-${game.gameId}-${week}-${definition.id}`,eventDefinitionId:definition.id,name:definition.name,week,
    category:definition.category,sentiment:definition.sentiment,priority:definition.priority,scope,location,durationWeeks:2,
    description:definition.description,baseImpact:magnitude,affectedConstituencyIds:affected.map(c=>c.constituencyId),partyEffects,partyEffectsByState,
    acknowledged:definition.priority!=="CRITICAL",expiresAfterWeek:week+1,
  };
}

export function getEventSupportEffects(events:CampaignEventRecord[],week:number, constituencyStates:Record<string,string>={}):Record<string,Record<string,number>>{
  const result:Record<string,Record<string,number>>={};
  for(const event of events){
    const age=week-event.week;
    if(age<0||age>=event.durationWeeks)continue;
    const decay=age===0?1:0.5;
    const affected=new Set(event.affectedConstituencyIds);
    for(const constituencyId of affected){
      result[constituencyId]??={};
      const stateEffects=event.partyEffectsByState?.[constituencyStates[constituencyId]] ?? event.partyEffects;
      for(const [partyId,value] of Object.entries(stateEffects)) result[constituencyId][partyId]=(result[constituencyId][partyId]??0)+value*decay;
    }
  }
  return result;
}

export function getActiveEventsForWeek(events:CampaignEventRecord[],week:number):CampaignEventRecord[]{return events.filter(e=>week>=e.week&&week<e.week+e.durationWeeks);}
