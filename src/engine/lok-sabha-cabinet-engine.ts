import type { NegotiationSave } from "@/engine/lok-sabha-negotiation-engine";

export const LOK_SABHA_CABINET_SAVE_KEY = "indian-election-game-lok-sabha-cabinet-save";
export const MINISTRY_POINTS = { KEY: 8, BIG: 4, SMALL: 3, REGULAR_MOS: 1, MOS_INDEPENDENT_CHARGE: 2 } as const;
/** 10 Key, 24 Big and 12 Small ministries, 8 MoS (Independent Charge) and 8 Ministers of State. */
export const TOTAL_UNION_POINTS = 10 * 8 + 24 * 4 + 12 * 3 + 8 * 2 + 8;
/** The points the main cabinet list shares out: everything except the 8 regular Ministers of State, who are added afterwards. */
export const CABINET_POINTS = TOTAL_UNION_POINTS - 8 * MINISTRY_POINTS.REGULAR_MOS;
/** Posts come in steps of 2, 3, 4 and 8 points, and small parties cannot take more than their post cap, so a party may finish up to this many points over its entitlement. */
export const POINT_TOLERANCE = 4;
/** Share of its seats a party may hold in posts once regular Ministers of State are added (parties with up to five seats keep their half-of-seats limit). */
export const MOS_SEAT_SHARE = 0.36;
/** Every party with seats is guaranteed this many points: the price of the cheapest cabinet ministry. */
export const MIN_PARTY_POINTS = MINISTRY_POINTS.SMALL;
/** The Deputy Prime Minister post is worth two Key ministries. It sits outside the cabinet's point total. */
export const DEPUTY_PM_POINTS = 2 * MINISTRY_POINTS.KEY;
export interface CabinetMinistry { id:number; name:string; categoryId:string; categoryName:string; points:number; role:"CABINET"|"REGULAR_MOS"|"MOS_INDEPENDENT_CHARGE"; parentMinistryId?:number; }
/** How many posts of each kind a party holds or was promised. */
export interface PostCounts { key:number; big:number; small:number; independent:number; regular:number; }
export const POST_TIERS=["key","big","small","independent","regular"] as const;
export const POST_TIER_LABEL:Record<keyof PostCounts,string>={key:"Key",big:"Big",small:"Small",independent:"MoS (Independent Charge)",regular:"Minister of State"};
/** negotiatedPosts: the exact posts a negotiated deal promised this party (it gets those posts, not just a points total). */
export interface CabinetParty { partyId:string; seats:number; entitlement:number; negotiatedPoints:number; negotiatedPosts?:PostCounts; }
/** The kind of post a ministry is, for counting. */
export function postTier(m:{role:string;points:number}):keyof PostCounts{
 return m.role==="REGULAR_MOS"?"regular":m.role==="MOS_INDEPENDENT_CHARGE"?"independent":m.points>=MINISTRY_POINTS.KEY?"key":m.points>=MINISTRY_POINTS.BIG?"big":"small";
}
export const totalPosts=(c:PostCounts)=>c.key+c.big+c.small+c.independent+c.regular;
/** Parties with up to this many seats hold at most half as many posts as seats (at least one). */
export const TINY_PARTY_SEATS=5;
/** The most posts a party may hold: exactly its negotiated posts, else (up to five seats) half its seats, at least one. */
export function maxPostsFor(p:{seats:number;negotiatedPosts?:PostCounts}):number{
 if(p.negotiatedPosts)return totalPosts(p.negotiatedPosts);
 return p.seats<=TINY_PARTY_SEATS?Math.max(1,Math.floor(p.seats*0.5)):Infinity;
}
/** Most posts a party may hold in total once regular Ministers of State are added. */
export function maxPostsWithMos(p:{seats:number;negotiatedPosts?:PostCounts}):number{
 if(p.negotiatedPosts||p.seats<=TINY_PARTY_SEATS)return maxPostsFor(p);
 return Math.max(1,Math.round(p.seats*MOS_SEAT_SHARE));
}
export interface CabinetAssignment { ministryId:number; partyId:string; ministerName:string; }
export interface CabinetSave { schemaVersion:1; gameId:string; blocName:string; blocSeats:number; /** The party that holds the Prime Minister's post. */ primeMinisterPartyId?:string; totalPoints:number; hasDeputyPrimeMinister:boolean; deputyPrimeMinisterPartyId?:string; parties:CabinetParty[]; assignments:CabinetAssignment[]; enabledRegularMosByMinistry?:Record<number,number>; confirmed:boolean; updatedAt:string; }

export function buildCabinetMinistries(data:{categories:Array<{id:string;name:string;ministries:Array<{id:number;name:string;tier?:string;role?:string;parentMinistryId?:number}>}>}):CabinetMinistry[]{
 return data.categories.flatMap(c=>c.ministries.map(m=>{
  const role=m.role==="REGULAR_MOS"?"REGULAR_MOS":m.role==="MOS_INDEPENDENT_CHARGE"?"MOS_INDEPENDENT_CHARGE":"CABINET";
  const points=role==="REGULAR_MOS"?MINISTRY_POINTS.REGULAR_MOS:role==="MOS_INDEPENDENT_CHARGE"?MINISTRY_POINTS.MOS_INDEPENDENT_CHARGE:m.tier==="KEY"?MINISTRY_POINTS.KEY:m.tier==="BIG"?MINISTRY_POINTS.BIG:MINISTRY_POINTS.SMALL;
  return {id:m.id,name:m.name,categoryId:c.id,categoryName:c.name,role,parentMinistryId:m.parentMinistryId,points} as CabinetMinistry;
 }));
}
function largestRemainder(total:number,weights:Array<{partyId:string;seats:number}>){
 const sum=weights.reduce((n,p)=>n+p.seats,0); if(!sum||!total)return Object.fromEntries(weights.map(p=>[p.partyId,0]));
 const raw=weights.map(p=>({partyId:p.partyId,value:total*p.seats/sum,base:Math.floor(total*p.seats/sum)}));
 let left=total-raw.reduce((n,p)=>n+p.base,0); raw.slice().sort((a,b)=>(b.value-b.base)-(a.value-a.base)).forEach(p=>{if(left>0){raw.find(x=>x.partyId===p.partyId)!.base++;left--;}});
 return Object.fromEntries(raw.map(p=>[p.partyId,p.base]));
}
export function negotiatedCabinetTerms(save:NegotiationSave,playerPartyId:string){
 const accepted=save.offers.filter(o=>o.status==="ACCEPTED"&&o.arrangement==="JOIN");
 const reserved:Record<string,{points:number;dpm:boolean;posts?:PostCounts}>={};
 for(const offer of accepted){
  const recipient=(offer.id.startsWith("INCOMING-")||offer.playerAsks)?playerPartyId:(offer.targetPartyIds[0]??playerPartyId);
  const match=offer.terms.match(/Portfolio value:\s*(\d+)/i)??offer.terms.match(/Ministry value(?: requested)?:\s*(\d+)/i)??offer.terms.match(/Ministry posts requested:\s*(\d+)/i);
  const points=match?Math.max(0,Math.min(TOTAL_UNION_POINTS,Number(match[1]))):0;
  const dpm=/Deputy Prime Minister post:\s*Yes/i.test(offer.terms);
  const pk=offer.terms.match(/(\d+) Key Cabinet Ministry; (\d+) Big Cabinet Ministry; (\d+) Small Cabinet Ministry; (\d+) MoS \(Independent Charge\); (\d+) Regular MoS/i);
  const posts:PostCounts|undefined=pk?{key:+pk[1],big:+pk[2],small:+pk[3],independent:+pk[4],regular:+pk[5]}:undefined;
  const better=!reserved[recipient]||points>=reserved[recipient].points;
  reserved[recipient]={points:Math.max(reserved[recipient]?.points??0,points),dpm:reserved[recipient]?.dpm||dpm,posts:better?posts??reserved[recipient]?.posts:reserved[recipient]?.posts};
 }
 return reserved;
}
export function createCabinetSave(gameId:string,majority:{name:string;seats:number;primeMinisterPartyId?:string;parties:Array<{partyId:string;seats:number}>},negotiation:NegotiationSave,playerPartyId:string,createDpm:boolean):CabinetSave{
 const reserved=negotiatedCabinetTerms(negotiation,playerPartyId); const negotiatedDpmParty=Object.keys(reserved).find(id=>reserved[id].dpm);
 const hasDpm=Boolean(negotiatedDpmParty)||createDpm; const totalPoints=CABINET_POINTS;
 const parties=majority.parties.filter(p=>p.seats>0).map(p=>({partyId:p.partyId,seats:p.seats,entitlement:0,negotiatedPoints:reserved[p.partyId]?.points??0,negotiatedPosts:reserved[p.partyId]?.posts&&totalPosts(reserved[p.partyId]!.posts!)>0?reserved[p.partyId]!.posts:undefined}));
 const reservedTotal=parties.reduce((n,p)=>n+p.negotiatedPoints,0);
 const eligible=parties.filter(p=>p.negotiatedPoints===0);
 const available=Math.max(0,totalPoints-reservedTotal);
 // A party with up to five seats holds at most half as many posts as seats (one at least), each a Small
 // ministry's worth. Every other party is guaranteed the price of the cheapest ministry too, and the rest is shared by seats.
 let afterSingles=available;
 for(const p of eligible.filter(p=>p.seats<=TINY_PARTY_SEATS).sort((a,b)=>a.seats-b.seats||a.partyId.localeCompare(b.partyId))){
  const want=MIN_PARTY_POINTS*maxPostsFor(p);
  const give=Math.min(want,Math.floor(afterSingles/MIN_PARTY_POINTS)*MIN_PARTY_POINTS);
  p.entitlement=give; afterSingles-=give;
 }
 const others=eligible.filter(p=>p.seats>TINY_PARTY_SEATS);
 const guaranteedParties=Math.min(others.length,Math.floor(afterSingles/MIN_PARTY_POINTS));
 others.slice().sort((a,b)=>a.seats-b.seats||a.partyId.localeCompare(b.partyId)).slice(0,guaranteedParties).forEach(p=>{p.entitlement=MIN_PARTY_POINTS;});
 const shares=largestRemainder(afterSingles-guaranteedParties*MIN_PARTY_POINTS,others);
 parties.forEach(p=>{p.entitlement+=p.negotiatedPoints+(shares[p.partyId]??0);});
 return {schemaVersion:1,gameId,blocName:majority.name,blocSeats:majority.seats,primeMinisterPartyId:majority.primeMinisterPartyId&&majority.parties.some(p=>p.partyId===majority.primeMinisterPartyId)?majority.primeMinisterPartyId:[...majority.parties].sort((a,b)=>b.seats-a.seats||a.partyId.localeCompare(b.partyId))[0]?.partyId,totalPoints,hasDeputyPrimeMinister:hasDpm,deputyPrimeMinisterPartyId:negotiatedDpmParty,parties,assignments:[],enabledRegularMosByMinistry:{},confirmed:false,updatedAt:new Date().toISOString()};
}
export function saveCabinet(save:CabinetSave){const next={...save,updatedAt:new Date().toISOString()};localStorage.setItem(LOK_SABHA_CABINET_SAVE_KEY,JSON.stringify(next));return next;}

/**
 * The AI shares every position out between the parties of the ruling bloc.
 * 1. Negotiated deals come first: a party promised "1 Key, 1 Big, 1 Small, 1 MoS (IC), 1 MoS" gets exactly
 *    those posts, and nothing more.
 * 2. The remaining Cabinet ministries and MoS (Independent Charge) go to the other parties, most valuable
 *    first, within each party's point entitlement. A party with up to three seats holds no more posts than seats.
 * 3. Regular Ministers of State are not shared out: only the ones a negotiated deal promised are allocated.
   The player adds the rest by hand afterwards.
 * The result is a confirmed cabinet.
 */
export function autoAllocateCabinet(cabinet: CabinetSave, ministries: CabinetMinistry[]): CabinetSave {
  const seatsOf = Object.fromEntries(cabinet.parties.map((p) => [p.partyId, p.seats]));
  const allIds = cabinet.parties.map((p) => p.partyId);
  const promised = cabinet.parties.filter((p) => p.negotiatedPosts && totalPosts(p.negotiatedPosts) > 0);
  const promisedIds = new Set(promised.map((p) => p.partyId));
  const capOf = Object.fromEntries(cabinet.parties.map((p) => [p.partyId, maxPostsFor(p)]));
  // Parties that share out what is left; if every party was promised posts, they all do.
  const free = allIds.filter((id) => !promisedIds.has(id));
  const partyIds = free.length ? free : allIds;
  const main = ministries.filter((m) => m.role !== "REGULAR_MOS");
  const slots = new Map<number, CabinetMinistry[]>();
  for (const m of ministries.filter((x) => x.role === "REGULAR_MOS")) {
    const parent = m.parentMinistryId ?? 0;
    slots.set(parent, [...(slots.get(parent) ?? []), m]);
  }
  const allParents = [...slots.keys()].sort((a, b) => a - b);

  let seed = 1;
  for (const ch of [...allIds, cabinet.gameId].join("|")) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);

  // Step 1: the posts negotiated deals promised (the same in every attempt, so worked out once).
  const reservedMain: CabinetAssignment[] = [];
  const takenMain = new Set<number>();
  const promisedRegular: Array<{ partyId: string; count: number }> = [];
  for (const party of promised.slice().sort((a, b) => b.seats - a.seats || a.partyId.localeCompare(b.partyId))) {
    const want = party.negotiatedPosts!;
    for (const tier of ["key", "big", "small", "independent"] as const) {
      const pool = main.filter((m) => postTier(m) === tier && !takenMain.has(m.id));
      for (const m of pool.slice(0, want[tier])) {
        takenMain.add(m.id);
        reservedMain.push({ ministryId: m.id, partyId: party.partyId, ministerName: "" });
      }
    }
    if (want.regular > 0) promisedRegular.push({ partyId: party.partyId, count: want.regular });
  }
  const sharedMain = main.filter((m) => !takenMain.has(m.id));

  // Posts come in steps of 8, 4, 3, 2 and 1 points, so a plain largest-first pass can leave a party a
  // point short. Try a few hundred orderings (the first is the plain pass) and keep the best fit.
  const attempt = (mode: number) => {
    const remaining: Record<string, number> = Object.fromEntries(cabinet.parties.map((p) => [p.partyId, p.entitlement]));
    const count: Record<string, number> = Object.fromEntries(allIds.map((id) => [id, 0]));
    const holder = new Map<number, string>();
    const assignments: CabinetAssignment[] = [];
    const next: Record<number, number> = {};
    const hasFree = (parent: number) => (next[parent] ?? 0) < (slots.get(parent)?.length ?? 0);
    const takeSlot = (partyId: string, parent: number) => {
      const slot = slots.get(parent)![next[parent] ?? 0];
      next[parent] = (next[parent] ?? 0) + 1;
      remaining[partyId] -= slot.points;
      count[partyId] += 1;
      assignments.push({ ministryId: slot.id, partyId, ministerName: "" });
    };
    for (const r of reservedMain) {
      holder.set(r.ministryId, r.partyId);
      count[r.partyId] += 1;
      assignments.push(r);
    }
    // promised Ministers of State: under the party's own ministries first, otherwise anywhere free
    for (const { partyId, count: want } of promisedRegular) {
      for (let i = 0; i < want; i += 1) {
        const own = allParents.find((parent) => holder.get(parent) === partyId && hasFree(parent));
        const parent = own ?? allParents.find((candidate) => hasFree(candidate));
        if (parent === undefined) break;
        takeSlot(partyId, parent);
      }
    }
    for (const id of promisedIds) if (free.length) remaining[id] = 0;
    const order = (a: string, b: string) => remaining[b] - remaining[a] || seatsOf[b] - seatsOf[a] || a.localeCompare(b);
    const canTake = (id: string) => count[id] < capOf[id];
    let overflow = 0;
    const posts = sharedMain.slice().sort((a, b) => b.points - a.points || (mode === 0 ? a.id - b.id : rnd() - 0.5));
    for (const m of posts) {
      const fits = partyIds.filter((id) => remaining[id] + POINT_TOLERANCE >= m.points && canTake(id));
      let pick: string | undefined;
      if (fits.length) {
        const roll = mode === 0 ? 0 : rnd();
        pick = roll < 0.45 ? fits.slice().sort(order)[0] : roll < 0.8 ? fits.slice().sort((a, b) => remaining[a] - remaining[b] || a.localeCompare(b))[0] : fits[Math.floor(rnd() * fits.length)];
      } else {
        const open = partyIds.filter(canTake);
        pick = (open.length ? open : partyIds).slice().sort(order)[0];
        if (pick) overflow += Math.max(0, m.points - POINT_TOLERANCE - remaining[pick]) + (canTake(pick) ? 0 : 50);
      }
      if (!pick) break;
      remaining[pick] -= m.points;
      count[pick] += 1;
      holder.set(m.id, pick);
      assignments.push({ ministryId: m.id, partyId: pick, ministerName: "" });
    }
    const nothing = allIds.filter((id) => !assignments.some((a) => a.partyId === id)).length;
    const unspent = partyIds.reduce((n, id) => n + Math.max(0, Math.min(remaining[id], capOf[id] === Infinity ? remaining[id] : 0)), 0);
    return { assignments, next, score: overflow * 5 + nothing * 5 + unspent };
  };

  let best = attempt(0);
  for (let i = 1; i <= 400 && best.score > 0; i += 1) {
    const candidate = attempt(i);
    if (candidate.score < best.score) best = candidate;
  }
  return {
    ...cabinet,
    assignments: best.assignments,
    enabledRegularMosByMinistry: Object.fromEntries(allParents.map((parent) => [parent, best.next[parent] ?? 0])),
    confirmed: true,
  };
}

/** A confirmed cabinet shared out by the AI. Used when the player's party is not part of the ruling bloc. */
export function createAiCabinet(
  gameId: string,
  majority: { name: string; seats: number; parties: Array<{ partyId: string; seats: number }> },
  negotiation: NegotiationSave,
  playerPartyId: string,
  ministries: CabinetMinistry[],
): CabinetSave {
  return autoAllocateCabinet(createCabinetSave(gameId, majority, negotiation, playerPartyId, false), ministries);
}
