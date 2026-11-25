"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadLokSabhaGame } from "@/engine/lok-sabha-game-engine";
import { getVotingSchedule, LOK_SABHA_VOTING_SAVE_KEY } from "@/engine/lok-sabha-voting-engine";
import type { LokSabhaGameSave } from "@/types/lok-sabha-game";
import type { LokSabhaVotingSave, VotingConstituencyResult } from "@/types/lok-sabha-voting";
import { ResultsMaps } from "@/components/results/results-maps";
import { allianceColor, allianceShort, plainGroupName } from "@/lib/party-style";
import { AllianceName } from "@/components/alliance-name";
import { PartyMark } from "@/components/party-mark";
import { ResultsOverview, StatBox } from "@/components/results/results-overview";
import { Button } from "@/components/ui/button";
import partiesData from "@/data/parties.json";

const parties = partiesData.parties as Array<{ id: string; name: string }>;
const partyNames = Object.fromEntries(parties.map(p => [p.id, p.name]));
const palette = ["#f97316", "#38bdf8", "#22c55e", "#a78bfa", "#f43f5e", "#eab308", "#14b8a6", "#c084fc", "#fb7185", "#94a3b8"];
const schedule = getVotingSchedule();
type Tab = "Overview" | "Party Results" | "Alliance Results" | "Maps" | "Constituency Results" | "State Results" | "Voter Turnout";
type ResultRow = VotingConstituencyResult & { name: string; winnerName: string; winnerVotes: number; runnerUpName: string; runnerUpVotes: number; margin: number; allianceName: string };
const fmt = (n: number) => n.toLocaleString("en-IN");
const pct = (n: number) => `${n.toFixed(2)}%`;

export default function LokSabhaResultsPage() {
  const [ready, setReady] = useState(false);
  const [game, setGame] = useState<LokSabhaGameSave | null>(null);
  const [voting, setVoting] = useState<LokSabhaVotingSave | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("All states / UTs");
  const [partyFilter, setPartyFilter] = useState("All parties");
  const [sortBy, setSortBy] = useState("Constituency");
  const [allianceTab, setAllianceTab] = useState<"overview"|"tally">("overview");

  useEffect(() => {
    const activeGame = loadLokSabhaGame();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates client-only saved state after mount (localStorage is unavailable during SSR)
    setGame(activeGame);
    try {
      const raw = localStorage.getItem(LOK_SABHA_VOTING_SAVE_KEY);
      if (raw) setVoting(JSON.parse(raw) as LokSabhaVotingSave);
    } catch { /* Invalid local save is handled by the unavailable-state panel. */ }
    setReady(true);
  }, []);

  const allResults = useMemo<ResultRow[]>(() => {
    if (!game || !voting) return [];
    const flat = voting.phaseResults.flatMap(p => p.constituencyResults);
    return flat.map(result => {
      const c = game.constituencies.find(x => x.constituencyId === result.constituencyId);
      const ranking = Object.entries(result.partyVotes).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
      const winner = ranking[0];
      const runner = ranking[1];
      const winnerAllocation = c?.allocations.find(a => a.partyId === result.winnerPartyId);
      return {
        ...result,
        name: c?.name ?? result.constituencyId,
        winnerName: partyNames[result.winnerPartyId] ?? result.winnerPartyId,
        winnerVotes: winner?.[1] ?? 0,
        runnerUpName: runner ? (partyNames[runner[0]] ?? runner[0]) : "—",
        runnerUpVotes: runner?.[1] ?? 0,
        margin: (winner?.[1] ?? 0) - (runner?.[1] ?? 0),
        allianceName: winnerAllocation?.allianceName ?? "Independent",
      };
    });
  }, [game, voting]);

  const summary = useMemo(() => {
    const registered = allResults.reduce((n,r)=>n+r.registeredElectors,0);
    const votes = allResults.reduce((n,r)=>n+r.totalVotes,0);
    const nota = allResults.reduce((n,r)=>n+r.notaVotes,0);
    const valid = votes-nota;
    const seats:Record<string,number> = {};
    const contested:Record<string,number> = {};
    const votesByParty:Record<string,number> = {};
    const votesByAlliance:Record<string,{seats:number;contested:number;votes:number;parties:Set<string>}> = {};
    const states:Record<string,{seats:number;registered:number;votes:number;nota:number;constituencies:number}> = {};
    allResults.forEach(r=>{
      seats[r.winnerPartyId]=(seats[r.winnerPartyId]??0)+1;
      Object.entries(r.partyVotes).forEach(([id,count])=>{votesByParty[id]=(votesByParty[id]??0)+count;});
      const constituency=game?.constituencies.find(x=>x.constituencyId===r.constituencyId);
      (constituency?.allocations??[]).forEach(allocation=>{contested[allocation.partyId]=(contested[allocation.partyId]??0)+1;});
      const winnerAlliance=r.allianceName;
      const winningGroup=votesByAlliance[winnerAlliance]??{seats:0,contested:0,votes:0,parties:new Set<string>()};
      winningGroup.seats++; winningGroup.parties.add(r.winnerPartyId); votesByAlliance[winnerAlliance]=winningGroup;
      const countedAlliances=new Set<string>();
      (constituency?.allocations??[]).forEach(allocation=>{const alliance=allocation.allianceName;if(!countedAlliances.has(alliance)){const group=votesByAlliance[alliance]??{seats:0,contested:0,votes:0,parties:new Set<string>()};group.contested++;votesByAlliance[alliance]=group;countedAlliances.add(alliance);}});
      Object.entries(r.partyVotes).forEach(([partyId,count])=>{
        const alliance=constituency?.allocations.find(a=>a.partyId===partyId)?.allianceName??"Independent";
        const group=votesByAlliance[alliance]??{seats:0,contested:0,votes:0,parties:new Set<string>()};
        group.votes+=count;group.parties.add(partyId);votesByAlliance[alliance]=group;
      });
      const s=states[r.state]??{seats:0,registered:0,votes:0,nota:0,constituencies:0};
      s.seats++;s.registered+=r.registeredElectors;s.votes+=r.totalVotes;s.nota+=r.notaVotes;s.constituencies++;states[r.state]=s;
    });
    const partyRows=Object.entries(votesByParty).map(([id,voteCount])=>({id,name:partyNames[id]??id,seats:seats[id]??0,seatsWon:seats[id]??0,seatsContested:contested[id]??0,votes:voteCount,voteShare:valid?voteCount/valid*100:0})).sort((a,b)=>b.seats-a.seats||b.votes-a.votes);
    const allianceRows=Object.entries(votesByAlliance).map(([name,v])=>({name,seats:v.seats,seatsWon:v.seats,seatsContested:v.contested,votes:v.votes,voteShare:valid?v.votes/valid*100:0,parties:[...v.parties]})).sort((a,b)=>b.seats-a.seats||b.votes-a.votes);
    const stateRows=Object.entries(states).map(([name,v])=>({name,...v,turnout:v.registered?v.votes/v.registered*100:0})).sort((a,b)=>b.turnout-a.turnout);
    return {registered,votes,valid,nota,turnout:registered?votes/registered*100:0,notaShare:votes?nota/votes*100:0,partyRows,allianceRows,stateRows,seats};
  }, [allResults, game]);

  const filtered = useMemo(() => {
    let rows=allResults.filter(r=>(stateFilter==="All states / UTs"||r.state===stateFilter)&&(partyFilter==="All parties"||r.winnerPartyId===partyFilter)&&(`${r.name} ${r.state} ${r.winnerName}`.toLowerCase().includes(query.toLowerCase())));
    if(sortBy==="Margin") rows=[...rows].sort((a,b)=>b.margin-a.margin);
    else if(sortBy==="Turnout") rows=[...rows].sort((a,b)=>b.turnoutRate-a.turnoutRate);
    else if(sortBy==="Votes polled") rows=[...rows].sort((a,b)=>b.totalVotes-a.totalVotes);
    else rows=[...rows].sort((a,b)=>a.state.localeCompare(b.state)||a.name.localeCompare(b.name));
    return rows;
  },[allResults,stateFilter,partyFilter,query,sortBy]);

  if(!ready) return <p className="p-8 text-muted-foreground">Loading election results…</p>;
  if(!game) return <Gate title="No active Lok Sabha game" message="Start or load a Lok Sabha game before opening its result report." href="/elections/lok-sabha/new-game" link="Start a game"/>;
  if(!voting || voting.gameId!==game.gameId || voting.status!=="COMPLETED" || allResults.length!==schedule.totalConstituencies) return <Gate title="Results are still sealed" message={`The final result report unlocks only after all ${schedule.totalConstituencies} constituencies complete all ${schedule.phaseCount} voting phases. Current completed count: ${allResults.length}.`} href="/elections/lok-sabha/voting" link="Return to voting"/>;

  const tabs:Tab[]=["Overview","Party Results","Alliance Results","Maps","Constituency Results","State Results","Voter Turnout"];
  const playerSeats=summary.seats[game.playerPartyId]??0;
  const majority=Math.floor(schedule.totalConstituencies/2)+1;
  const topParty=summary.partyRows[0];
  const topAlliance=summary.allianceRows[0];
  const groupList=summary.allianceRows.map(a=>{const parties=a.parties.map(id=>({name:partyNames[id]??id,seats:summary.seats[id]??0})).sort((x,y)=>y.seats-x.seats);return {name:a.name,seats:a.seatsWon,parties,color:allianceColor(parties,a.name===game.alliance.name?game.alliance.color:undefined)};});
  // The alliance each party most often won under, shown beside it in the party-map legend.
  const partyAlliance=new Map<string,string>();
  {const tally=new Map<string,Map<string,number>>();allResults.forEach(r=>{const m=tally.get(r.winnerPartyId)??new Map<string,number>();m.set(r.allianceName,(m.get(r.allianceName)??0)+1);tally.set(r.winnerPartyId,m);});tally.forEach((m,id)=>{partyAlliance.set(id,[...m.entries()].sort((a,b)=>b[1]-a[1])[0][0]);});}
  const hung=!topAlliance||topAlliance.seatsWon<majority;
  const statesAZ=[...summary.stateRows].sort((a,b)=>a.name.localeCompare(b.name));
  const highTurnout=summary.stateRows[0];
  const lowTurnout=summary.stateRows[summary.stateRows.length-1];

  return <main className="mx-auto max-w-[1280px] px-6 py-8"><div>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="font-heading text-2xl font-semibold">Results</h1><p className="mt-1 text-sm text-muted-foreground">Final counts for every constituency · {game.electionYear} · All 543 declared</p></div><div className="flex gap-2"><Button asChild variant="outline"><Link href="/elections/lok-sabha/voting">Voting summary</Link></Button><Button asChild><Link href="/elections/lok-sabha/government-formation">Government formation →</Link></Button></div></header>
    <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Constituencies declared" value="543 / 543" detail="All seven phases complete"/><Metric label="Registered electors" value={fmt(summary.registered)} detail="Across all constituencies"/><Metric label="Votes polled" value={fmt(summary.votes)} detail={`${pct(summary.turnout)} turnout`}/><Metric label="Majority mark" value={`${majority} seats`} detail="272 seats required to form a majority"/></section>
    <div className="mt-6 flex gap-2 overflow-x-auto border-b border-border pb-2">{tabs.map(t=><button key={t} onClick={()=>setTab(t)} className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold ${tab===t?"bg-brand text-brand-foreground":"text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{t}</button>)}</div>
    {tab==="Overview"&&<div className="mt-6"><ResultsOverview
      total={schedule.totalConstituencies}
      majority={majority}
      groups={groupList}
      outcome={hung?{hung:true,title:"Hung result",text:`No alliance reached ${majority}. The largest, ${topAlliance?.name??"—"}, won ${topAlliance?.seatsWon??0}.`}:{hung:false,title:`${topAlliance.name} won a majority`,text:`${topAlliance.seatsWon} seats · ${pct(topAlliance.voteShare)} of valid votes · ${topAlliance.seatsWon-majority} above the mark.`}}
      nextHint={hung?`No bloc has ${majority} seats, so the Negotiation tab unlocks next.`:"A bloc has a majority: go straight to Government."}
      partyRows={summary.partyRows.map(p=>({name:p.name,seats:p.seatsWon,share:p.voteShare,votes:p.votes}))}
      mapCaption=""
      compact
      performance={<div className="grid grid-cols-2 gap-3"><StatBox label={`Your party · ${game.playerPartyId}`} value={playerSeats} note={`of ${summary.partyRows.find(p=>p.id===game.playerPartyId)?.seatsContested??0} contested`}/><StatBox label="Parliament position" value={playerSeats>=majority?"Majority":playerSeats>0?"Seats won":"No seats"} note="Player party only"/></div>}
    /></div>}
    {tab==="Party Results"&&<div className="mt-6"><Panel title="Party-wise national performance"><DataTable headers={["Rank","Party","Seats contested","Seats won","Total votes","Valid vote share"]} rows={summary.partyRows.map((p,i)=>[String(i+1),p.name,fmt(p.seatsContested),fmt(p.seatsWon),fmt(p.votes),pct(p.voteShare)])}/></Panel></div>}
    {tab==="Alliance Results"&&<div className="mt-6 space-y-5"><div role="group" aria-label="Alliance views" className="inline-flex gap-1 rounded-lg bg-muted p-1 text-sm font-semibold">{([["overview","Seats Overview"],["tally","Seat Tally"]] as Array<["overview"|"tally",string]>).map(([k,label])=><button key={k} type="button" aria-pressed={allianceTab===k} onClick={()=>setAllianceTab(k)} className={`rounded-md px-4 py-2 ${allianceTab===k?"bg-background text-foreground shadow-sm":"text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div>{allianceTab==="overview"&&<Panel title="Alliance seats"><div className="-mt-2 mb-3 text-right text-sm text-muted-foreground">Majority mark: {majority}</div><div className="space-y-4">{groupList.filter(g=>g.seats>0).map(g=><div key={g.name} className="space-y-1.5"><div className="flex justify-between text-sm"><AllianceName name={g.name} className="font-semibold" /><span className="text-muted-foreground">{g.seats} seats</span></div><div className="relative h-6 rounded-md bg-muted"><div className="h-full rounded-md" style={{width:`${g.seats/schedule.totalConstituencies*100}%`,background:g.color}}/><div className="absolute -bottom-1 -top-1 w-0.5 bg-foreground/70" style={{left:`${majority/schedule.totalConstituencies*100}%`}}/></div><div className="flex flex-wrap gap-1.5">{g.parties.filter(p=>p.seats>0).map(p=><span key={p.name} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs"><PartyMark id={p.name} size={14}/>{p.name} {p.seats}</span>)}</div></div>)}</div><p className="mt-3 text-xs text-muted-foreground">Every bar uses the same scale; member parties are listed under each front. The line marks the majority.</p></Panel>}{allianceTab==="tally"&&<Panel title="Alliance-wise seat tally"><p className="mb-4 text-sm text-muted-foreground">Party votes are grouped using each party’s constituency allocation, preserving state-level front names. Seats are credited to the alliance of the constituency winner.</p><DataTable headers={["Alliance / group","Seats contested","Seats won","Total votes","Valid vote share","Parties"]} rows={summary.allianceRows.map(a=>[allianceShort(a.name),fmt(a.seatsContested),fmt(a.seatsWon),fmt(a.votes),pct(a.voteShare),a.parties.map(id=>partyNames[id]??id).join(", ")])}/></Panel>}</div>}
    {tab==="Maps"&&<div className="mt-6"><ResultsMaps
      seats={allResults.map(r=>({constituencyId:r.constituencyId,name:r.name,winnerPartyId:r.winnerPartyId,winnerName:r.winnerName,allianceName:r.allianceName,margin:r.margin}))}
      groups={groupList.map(g=>({name:g.name,seats:g.seats,color:g.color}))}
      parties={summary.partyRows.filter(p=>p.seatsWon>0).map(p=>({id:p.id,name:p.name,seats:p.seatsWon,alliance:allianceShort(partyAlliance.get(p.id)??"Independent")}))}
    /></div>}
    {tab==="Constituency Results"&&<div className="mt-6"><Panel title="Constituency-wise declared results"><div className="mb-4 grid gap-3 md:grid-cols-4"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search constituency, state or winner" className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm md:col-span-2"/><select value={stateFilter} onChange={e=>setStateFilter(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm"><option>All states / UTs</option>{[...new Set(allResults.map(r=>r.state))].sort().map(s=><option key={s}>{s}</option>)}</select><select value={partyFilter} onChange={e=>setPartyFilter(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm"><option>All parties</option>{summary.partyRows.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm"><option>Constituency</option><option>Margin</option><option>Turnout</option><option>Votes polled</option></select></div><p className="mb-3 text-xs text-muted-foreground">Showing {filtered.length} of {allResults.length} constituencies</p><DataTable headers={["Constituency","State / UT","Winner","Winner votes","Runner-up","Margin","Turnout"]} rows={filtered.map(r=>[r.name,r.state,r.winnerName,fmt(r.winnerVotes),r.runnerUpName,fmt(r.margin),pct(r.turnoutRate*100)])}/></Panel></div>}
    {tab==="State Results"&&<div className="mt-6"><Panel title="State and Union Territory summary"><DataTable headers={["State / UT","Constituencies","Seats won by leading party","Registered electors","Votes polled","Turnout"]} rows={statesAZ.map(s=>{const top=Object.entries(allResults.filter(r=>r.state===s.name).reduce((a,r)=>{a[r.winnerPartyId]=(a[r.winnerPartyId]??0)+1;return a;},{} as Record<string,number>)).sort((a,b)=>b[1]-a[1])[0];return [s.name,String(s.constituencies),top?`${partyNames[top[0]]??top[0]} (${top[1]})`:"—",fmt(s.registered),fmt(s.votes),pct(s.turnout)];})}/></Panel></div>}
    {tab==="Voter Turnout"&&<div className="mt-6 space-y-5"><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Overall turnout" value={pct(summary.turnout)} detail="Votes polled / registered electors"/><Metric label="Valid votes" value={fmt(summary.valid)} detail="Party votes only"/><Metric label="NOTA votes" value={fmt(summary.nota)} detail={`${pct(summary.notaShare)} of votes polled`}/><Metric label="Non-voters" value={fmt(summary.registered-summary.votes)} detail="Registered electors who did not vote"/></section><Panel title="Turnout by state / Union Territory"><DataTable headers={["State / UT","Turnout","Votes polled","Registered electors","NOTA votes"]} rows={statesAZ.map(s=>[s.name,pct(s.turnout),fmt(s.votes),fmt(s.registered),fmt(s.nota)])}/></Panel><div className="grid gap-4 md:grid-cols-2"><Metric label="Highest turnout" value={highTurnout?.name??"—"} detail={highTurnout?pct(highTurnout.turnout):"—"}/><Metric label="Lowest turnout" value={lowTurnout?.name??"—"} detail={lowTurnout?pct(lowTurnout.turnout):"—"}/></div></div>}
    <footer className="mt-8 flex flex-wrap justify-between gap-3 border-t border-border pt-5 text-xs text-muted-foreground"><span>Result data is calculated from the saved constituency voting records.</span><Link href="/elections/lok-sabha" className="underline underline-offset-4">Lok Sabha dashboard</Link></footer>
  </div></main>;
}

function Gate({title,message,href,link}:{title:string;message:string;href:string;link:string}){return <main className="grid min-h-screen place-items-center p-6 text-foreground"><section className="max-w-xl rounded-2xl border border-border bg-card p-8 text-center"><h1 className="text-2xl font-black">{title}</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p><Link className="mt-5 inline-flex rounded-xl bg-brand text-brand-foreground px-5 py-3 font-bold" href={href}>{link}</Link></section></main>}
function Metric({label,value,detail}:{label:string;value:string;detail:string}){return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 break-words text-2xl font-black">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>}
function Panel({title,children}:{title:string;children:import("react").ReactNode}){return <section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><h2 className="mb-4 text-lg font-bold">{title}</h2>{children}</section>}
function DataTable({headers,rows}:{headers:string[];rows:string[][]}){return <div className="overflow-x-auto"><table className="w-full min-w-[680px] border-collapse text-left text-sm"><thead><tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">{headers.map(h=><th key={h} className="px-3 py-3 font-semibold">{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/50">{row.map((cell,j)=><td key={j} className="px-3 py-3 text-foreground/80">{cell}</td>)}</tr>)}</tbody></table>{rows.length===0&&<p className="py-8 text-center text-sm text-muted-foreground">No matching records.</p>}</div>}
