"use client";

import { ArrowLeft, ArrowRight, Check, Flag, Landmark, Map as MapIcon, Search, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import alignmentRulesData from "@/data/party-alignment-rules.json";
import allianceData from "@/data/alliances.json";
import partiesData from "@/data/parties.json";
import strengthData from "@/data/party-strength-by-region.json";
import { getPoliticalRelationship } from "@/engine/alliance-engine";
import {
  createLokSabhaGame,
  getEligiblePartyIdsForState,
  getPartyStrength,
  loadLokSabhaGame,
  normalizeElectionRegion,
  partyCanContestInState,
  saveLokSabhaGame,
} from "@/engine/lok-sabha-game-engine";
import regionsData from "@/data/assembly-regions-2024.json";
import { partyColor } from "@/lib/party-style";
import { PartyFlag } from "@/components/party-flag";
import { GAME_KEYS, deleteGameData, isGameComplete } from "@/lib/game-progress";
import { AssemblySeatStep } from "./assembly-seat-step";
import { LokSabhaSeatStep } from "./lok-sabha-seat-step";

type Kind = "lok-sabha" | "assembly";
type AllianceKey = "NDA" | "INDIA" | "Independent" | "Create New Alliance";

const parties = partiesData.parties as Array<{ id: string; name: string }>;
const partyName = (id: string) => parties.find((p) => p.id === id)?.name ?? id;
const strengthRegions = (strengthData as unknown as { regions: Record<string, Record<string, number>> }).regions;

const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi", "Jammu and Kashmir", "Puducherry",
];

/** Strength of a party, as 0-1: the best of its states for a national view, or that state's value. */
function strengthOf(partyId: string, state: string): number {
  if (state) return getPartyStrength(partyId, state) ?? 0.5;
  const values = Object.values(strengthRegions)
    .map((region) => region[partyId])
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => b - a)
    .slice(0, 5);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function strongRegionsOf(partyId: string): string[] {
  return Object.entries(strengthRegions)
    .map(([region, map]) => [region, map[partyId]] as const)
    .filter((entry): entry is readonly [string, number] => typeof entry[1] === "number" && entry[1] >= 0.75)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([region]) => region);
}

function pairCompatibility(a: string, b: string, kind: Kind, region: string) {
  const result = getPoliticalRelationship(a, b, {
    electionType: kind === "assembly" ? "ASSEMBLY" : "LOK_SABHA",
    region: kind === "assembly" ? region || undefined : undefined,
    activateConditionalRules: true,
  });
  if (result.relationship === "STRONG_RIVAL") return { allowed: false, warning: `${a} and ${b} are strong rivals.` };
  if (result.relationship === "RIVAL" && !result.conditional)
    return { allowed: false, warning: `${a} and ${b} are political rivals in this context.` };
  if (result.relationship === "RIVAL" && result.conditional)
    return { allowed: true, warning: `${a} and ${b} have a conditional rivalry; an agreement is required.` };
  return { allowed: true, warning: "" };
}

function predefinedCompatibility(partyId: string, allianceId: string) {
  const alliance = allianceData.alliances.find((item) => item.id === allianceId);
  if (alliance?.corePartyIds.includes(partyId)) return { allowed: true, warning: "" };
  const eligible = alignmentRulesData.rules.some(
    (rule) => rule.partyIds.includes(partyId) && rule.eligibleAlignments.includes(allianceId),
  );
  return eligible
    ? { allowed: true, warning: "The AI will evaluate this party and all other potential members separately in each state." }
    : { allowed: false, warning: `${partyId} is not configured as eligible to join ${allianceId}.` };
}

function Dots({ value }: { value: number }) {
  const filled = Math.max(1, Math.min(5, Math.ceil(value * 5)));
  return (
    <span aria-label={`Strength ${filled} of 5`} className="tracking-widest text-brand">
      {"●".repeat(filled)}
      <span className="text-muted-foreground/40">{"●".repeat(5 - filled)}</span>
    </span>
  );
}

/** Total seats of a state's Assembly, from the regional constituency data (null until a state is chosen). */
function assemblySeats(state: string): number | null {
  if (!state) return null;
  const target = normalizeElectionRegion(state);
  const found = (regionsData as { states: Array<{ state: string; regions: Array<{ constituencyIds: string[] }> }> }).states.find(
    (item) => normalizeElectionRegion(item.state) === target,
  );
  return found ? found.regions.reduce((sum, region) => sum + region.constituencyIds.length, 0) : null;
}

const KIND_LABEL: Record<Kind, string> = { "lok-sabha": "Lok Sabha", assembly: "State Assembly" };

function gamesInProgress(): Kind[] {
  try {
    return (Object.keys(GAME_KEYS) as Kind[]).filter((k) => {
      const raw = localStorage.getItem(GAME_KEYS[k].started);
      if (raw === null) return false;
      try {
        return !isGameComplete(k, (JSON.parse(raw) as { gameId?: string }).gameId);
      } catch {
        return true;
      }
    });
  } catch {
    return [];
  }
}

const STEPS = ["Election type", "Your party", "Alliance & seats"];

export function SetupPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [running, setRunning] = useState<Kind[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Kind | null>(null);
  const [guardOpen, setGuardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<Kind | null>(null);
  const [state, setState] = useState("");
  const [party, setParty] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"strength" | "name">("strength");
  const [alliance, setAlliance] = useState<AllianceKey | "">("");
  const [customName, setCustomName] = useState("");
  const [colorMode, setColorMode] = useState<"party" | "custom">("party");
  const [customColor, setCustomColor] = useState("#4F46E5");
  const [others, setOthers] = useState<string[]>([]);
  const [seatsReady, setSeatsReady] = useState(false);
  const [error, setError] = useState("");

  // A game that has already left seat allocation must not be overwritten by accident.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads saved games after mount (localStorage is unavailable during SSR)
    setRunning(gamesInProgress());
  }, []);

  function deleteGame(k: Kind) {
    deleteGameData(k);
    setConfirmDelete(null);
    const left = gamesInProgress();
    setRunning(left);
    // Nothing left to protect: carry on to the party step the player was heading for.
    if (guardOpen && left.length === 0) {
      setGuardOpen(false);
      setStep(2);
    }
  }

  // Arriving from an old link: preselect the election type and jump to the seat step of a saved game.
  useEffect(() => {
    const type = params.get("type");
    if (type !== "lok-sabha" && type !== "assembly") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the link once after mount
    setKind(type);
    if (params.get("step") !== "3") return;
    try {
      if (type === "lok-sabha") {
        const saved = loadLokSabhaGame();
        if (!saved) return;
        setParty(saved.playerPartyId);
      } else {
        const raw = sessionStorage.getItem("assemblyGameSetup");
        if (!raw) return;
        const saved = JSON.parse(raw) as { state: string; playerPartyId: string };
        setState(saved.state);
        setParty(saved.playerPartyId);
      }
      setStep(3);
      setSeatsReady(true);
    } catch {
      /* start from the beginning */
    }
  }, [params]);

  const available = useMemo(() => {
    const ids = kind === "assembly" ? (state ? getEligiblePartyIdsForState(state) : []) : parties.map((p) => p.id);
    const q = query.trim().toLowerCase();
    return ids
      .filter((id) => !q || id.toLowerCase().includes(q) || partyName(id).toLowerCase().includes(q))
      .sort((a, b) =>
        sort === "name" ? a.localeCompare(b) : strengthOf(b, kind === "assembly" ? state : "") - strengthOf(a, kind === "assembly" ? state : ""),
      );
  }, [kind, state, query, sort]);

  const step1Done = kind === "lok-sabha" || (kind === "assembly" && state !== "");
  const isCustom = alliance === "Create New Alliance";
  const predefined = alliance === "NDA" || alliance === "INDIA" ? alliance : "";
  const predefinedCheck = party && predefined ? predefinedCompatibility(party, predefined) : { allowed: true, warning: "" };
  const customNeeds = isCustom ? (customName.trim() === "" ? "Enter an alliance name" : others.length === 0 ? "Select at least one partner party" : "") : "";
  const canConfirm = alliance !== "" && predefinedCheck.allowed && !customNeeds;

  function chooseKind(next: Kind) {
    setKind(next);
    setState("");
    setParty("");
    setAlliance("");
    setOthers([]);
    setSeatsReady(false);
  }

  function togglePartner(id: string) {
    if (others.includes(id)) return setOthers((current) => current.filter((item) => item !== id));
    if (!pairCompatibility(party, id, kind ?? "lok-sabha", state).allowed) return;
    if (others.some((existing) => !pairCompatibility(id, existing, kind ?? "lok-sabha", state).allowed)) return;
    setOthers((current) => [...current, id]);
  }

  const chosenColor = colorMode === "party" ? partyColor(party) : customColor;

  function confirmAlliance() {
    setError("");
    try {
      if (kind === "lok-sabha") {
        const choice = isCustom ? "CUSTOM" : predefined || "Independent";
        const game = createLokSabhaGame({
          playerPartyId: party,
          allianceChoice: choice as "NDA" | "INDIA" | "Independent" | "CUSTOM",
          customAllianceName: customName,
          customAllianceColor: isCustom ? chosenColor : undefined,
          customPartnerPartyIds: isCustom ? others : [],
        });
        saveLokSabhaGame(game);
      } else {
        sessionStorage.setItem(
          "assemblyGameSetup",
          JSON.stringify({
            state,
            playerPartyId: party,
            allianceType: isCustom ? "alliance" : "independent",
            allianceName: isCustom ? customName.trim() : "Independent",
            partyIds: [party, ...(isCustom ? others : [])],
            ...(isCustom ? { allianceColor: chosenColor } : {}),
          }),
        );
      }
      setSeatsReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to initialise the game.");
    }
  }

  const partnerPool = (kind === "assembly" ? getEligiblePartyIdsForState(state) : parties.map((p) => p.id)).filter((id) => id !== party);

  if (running === null) return <main className="mx-auto max-w-[1280px] px-6 py-8 text-muted-foreground">Loading…</main>;
  // Leaving step 1 would start a new game, so a game that is already running is raised first.
  function goStep(n: number) {
    if (step === 1 && n >= 2 && (running?.length ?? 0) > 0) {
      setGuardOpen(true);
      return;
    }
    setStep(n);
  }

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-8">
      <Dialog
        open={guardOpen && (running?.length ?? 0) > 0}
        onOpenChange={(open) => {
          setGuardOpen(open);
          if (!open) setConfirmDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>A game is already in progress</DialogTitle>
            <DialogDescription>
              Setting up a new game replaces the one you have running, with its campaign, votes and results. Continue it, or delete it first to start again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
          {running.map((k) => (
            <div key={k} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-heading text-lg font-semibold">{KIND_LABEL[k]} election</h2>
                  <p className="text-sm text-muted-foreground">Saved game under way</p>
                </div>
                {confirmDelete === k ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-destructive">This permanently deletes the game.</span>
                    <Button variant="destructive" onClick={() => deleteGame(k)}>
                      Yes, delete it
                    </Button>
                    <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => router.push(`/elections/${k}/campaign`)}>Continue game</Button>
                    <Button variant="outline" onClick={() => setConfirmDelete(k)}>
                      Delete and start new
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        </DialogContent>
      </Dialog>
      {/* Stepper */}
      <ol className="mb-8 flex flex-wrap items-center gap-3" aria-label="Setup steps">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const reachable = n === 1 || (n === 2 && step1Done) || (n === 3 && step1Done && party !== "");
          const done = n < step;
          return (
            <li key={label} className="flex items-center gap-3">
              <button
                type="button"
                disabled={!reachable || seatsReady}
                onClick={() => goStep(n)}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${
                  step === n ? "border-brand bg-brand/10 text-foreground" : "border-border text-muted-foreground"
                }`}
              >
                <span className={`grid size-6 place-items-center rounded-full text-xs ${step === n ? "bg-brand text-brand-foreground" : "bg-muted"}`}>
                  {done ? <Check className="size-3.5" /> : n}
                </span>
                {label}
              </button>
              {n < STEPS.length ? <span className="h-px w-6 bg-border" /> : null}
            </li>
          );
        })}
        {step === 3 && seatsReady ? (
          <li className="ml-auto"><div id="setup-start-slot" /></li>
        ) : step === 2 ? (
          <li className="ml-auto">
            <Button size="lg" disabled={!party} onClick={() => setStep(3)} className="rounded-full">
              Next: alliance &amp; seats <ArrowRight />
            </Button>
          </li>
        ) : (
          <li className="ml-auto text-sm text-muted-foreground">Finish each step to unlock the next</li>
        )}
      </ol>
      {step === 2 || (step === 3 && seatsReady) ? <p className="-mt-2 text-xs text-muted-foreground">Finish each step to unlock the next</p> : null}

      {/* Step 1 */}
      {step === 1 && (
        <section className="space-y-6">
          <div>
            <h1 className="font-heading text-2xl font-semibold">Step 1 · Choose the election</h1>
            <p className="mt-1 text-muted-foreground">Pick the election you want to contest. You can change this only before the campaign starts.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <ElectionCard
              selected={kind === "lok-sabha"}
              onSelect={() => chooseKind("lok-sabha")}
              icon={<Landmark className="size-5" />}
              title="Lok Sabha · General election"
              stats={[["543", "Seats"], ["272", "Majority"], ["7", "Polling phases"]]}
              note="Includes government negotiation, floor test and the Union Cabinet."
            />
            <ElectionCard
              selected={kind === "assembly"}
              onSelect={() => chooseKind("assembly")}
              icon={<Flag className="size-5" />}
              title="State Assembly election"
              stats={[
                [String(assemblySeats(state) ?? "—"), state ? `Seats in ${state}` : "Seats"],
                [String(assemblySeats(state) ? Math.floor(assemblySeats(state)! / 2) + 1 : "—"), "Majority to reach"],
                ["1", "Polling phase"],
              ]}
              note="Includes negotiation when the result is hung, floor test and the state cabinet."
            >
              <label className="mt-1 block text-sm font-medium" htmlFor="state">
                State or Union Territory
              </label>
              <select
                id="state"
                value={state}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  setKind("assembly");
                  setState(e.target.value);
                  setParty("");
                  setAlliance("");
                  setOthers([]);
                }}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-brand"
              >
                <option value="">Choose a state / UT</option>
                {STATES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              {state ? (
                <p className="mt-2 flex items-center gap-2 text-sm text-brand">
                  <MapIcon className="size-4" /> {getEligiblePartyIdsForState(state).length} parties can contest here
                </p>
              ) : null}
            </ElectionCard>
          </div>
          <div className="flex justify-end">
            <Button size="lg" disabled={!step1Done} onClick={() => goStep(2)}>
              Next: choose your party <ArrowRight />
            </Button>
          </div>
        </section>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <section className="space-y-5">
          <div>
            <h1 className="font-heading text-2xl font-semibold">Step 2 · Select your party</h1>
            <p className="mt-1 text-muted-foreground">
              {kind === "assembly" ? `Parties that can contest in ${state}.` : "All parties in the Lok Sabha election."} Compare strength and relations before choosing.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-64 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search party…"
                className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as "strength" | "name")}
              className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
              aria-label="Sort parties"
            >
              <option value="strength">Sort: Strength</option>
              <option value="name">Sort: Name</option>
            </select>
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-[2fr_1fr]">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {available.map((id) => {
                const strength = strengthOf(id, kind === "assembly" ? state : "");
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setParty(id);
                      setAlliance("");
                      setOthers([]);
                    }}
                    className={`rounded-xl border bg-card p-4 text-left transition hover:border-brand/60 ${party === id ? "border-brand ring-2 ring-brand/30" : "border-border"}`}
                  >
                    <PartyFlag id={id} className="mb-3" />
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold leading-tight">{partyName(id)}</h3>
                      {party === id ? <Badge>Selected</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Strength <Dots value={strength} />
                    </p>
                  </button>
                );
              })}
              {available.length === 0 ? <p className="text-muted-foreground">No party matches your search.</p> : null}
            </div>
            <PartyDetails party={party} kind={kind ?? "lok-sabha"} state={state} />
          </div>
          <div className="flex justify-between">
            <Button variant="outline" size="lg" onClick={() => setStep(1)}>
              <ArrowLeft /> Back
            </Button>
            <Button size="lg" disabled={!party} onClick={() => setStep(3)}>
              Next: alliance &amp; seats <ArrowRight />
            </Button>
          </div>
        </section>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <section className="space-y-6">
          <div>
            <h1 className="font-heading text-2xl font-semibold">Step 3 · Alliance and seat allocation</h1>
            <p className="mt-1 text-muted-foreground">
              Confirm {party ? partyName(party) : "your"} alliance, then divide the seats among its members.
            </p>
          </div>

          {!seatsReady ? (
            <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.4fr]">
              <div className="space-y-3">
                {(kind === "lok-sabha"
                  ? (["NDA", "INDIA", "Create New Alliance", "Independent"] as AllianceKey[])
                  : (["Create New Alliance", "Independent"] as AllianceKey[])
                ).map((key) => {
                  const check = key === "NDA" || key === "INDIA" ? predefinedCompatibility(party, key) : { allowed: true, warning: "" };
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!check.allowed}
                      onClick={() => {
                        setAlliance(key);
                        setOthers([]);
                      }}
                      className={`w-full rounded-xl border bg-card p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${alliance === key ? "border-brand ring-2 ring-brand/30" : "border-border hover:border-brand/60"} ${key === "Independent" ? "border-dashed" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">
                          {key === "Create New Alliance" ? (kind === "assembly" ? "Form a state alliance" : "Create a new front") : key === "Independent" ? "Stay independent" : key === "NDA" ? "N.D.A" : key === "INDIA" ? "I.N.D.I.A" : key}
                        </h3>
                        {alliance === key ? <Badge>Your alliance</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {key === "NDA" ? "National Democratic Alliance" : key === "INDIA" ? "Indian National Developmental Inclusive Alliance" : key === "Independent" ? "Contest without an alliance" : "Name it, then invite compatible parties"}
                      </p>
                      {!check.allowed ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{check.warning}</p> : null}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-4 rounded-xl border border-border bg-card p-5">
                {alliance === "" && <p className="text-muted-foreground">Choose an alliance on the left.</p>}
                {predefined && (
                  <p className="text-sm text-muted-foreground">
                    {partyName(party)} joins {predefined}. {predefinedCheck.warning || "The AI evaluates the alliance's core members and eligible outside parties separately in every state."}
                  </p>
                )}
                {alliance === "Independent" && <p className="text-sm text-muted-foreground">{partyName(party)} contests on its own. Other parties may approach you after the results.</p>}
                {isCustom && (
                  <>
                    <label className="block text-sm font-medium" htmlFor="alliance-name">
                      Alliance name
                    </label>
                    <input
                      id="alliance-name"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Enter your alliance name"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-brand"
                    />
                    <fieldset>
                      <legend className="mb-2 text-sm font-medium">Alliance colour</legend>
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="button" onClick={() => setColorMode("party")} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${colorMode === "party" ? "border-brand bg-brand/10" : "border-border hover:border-brand/60"}`}>
                          <span className="size-4 rounded-full" style={{ background: partyColor(party) }} /> Use {partyName(party)}&apos;s colour
                        </button>
                        <button type="button" onClick={() => setColorMode("custom")} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${colorMode === "custom" ? "border-brand bg-brand/10" : "border-border hover:border-brand/60"}`}>
                          <span className="size-4 rounded-full" style={{ background: customColor }} /> Choose a new colour
                        </button>
                        {colorMode === "custom" && (
                          <input type="color" aria-label="Alliance colour" value={customColor} onChange={(e) => setCustomColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-border bg-background p-1" />
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">Used for your alliance on seat bars and maps.</p>
                    </fieldset>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium">Invite partner parties</span>
                        <span className="text-muted-foreground">{others.length} selected</span>
                      </div>
                      <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                        {partnerPool.map((id) => {
                          const picked = others.includes(id);
                          const withMe = pairCompatibility(party, id, kind ?? "lok-sabha", state);
                          const clash = !picked && others.some((existing) => !pairCompatibility(id, existing, kind ?? "lok-sabha", state).allowed);
                          const blocked = !picked && (!withMe.allowed || clash);
                          return (
                            <button
                              key={id}
                              type="button"
                              disabled={blocked}
                              onClick={() => togglePartner(id)}
                              title={blocked ? (!withMe.allowed ? withMe.warning : "Rival of an already selected partner") : withMe.warning}
                              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${picked ? "border-brand bg-brand/10" : "border-border hover:border-brand/60"}`}
                            >
                              <span className="truncate">{partyName(id)}</span>
                              {picked ? <Check className="size-4 text-brand" /> : null}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">Rivals of you or of an already selected partner cannot be added.</p>
                    </div>
                  </>
                )}
                {customNeeds && <p className="text-sm text-amber-700 dark:text-amber-300">{customNeeds}</p>}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="flex justify-between pt-2">
                  <Button variant="outline" size="lg" onClick={() => setStep(2)}>
                    <ArrowLeft /> Back
                  </Button>
                  <Button size="lg" disabled={!canConfirm} onClick={confirmAlliance}>
                    <Users /> Confirm alliance &amp; allocate seats
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3 text-sm">
                <span>
                  <b>{partyName(party)}</b> · {kind === "assembly" ? state : "Lok Sabha"} ·{" "}
                  {isCustom ? customName || "Your alliance" : predefined || (alliance === "Independent" ? "Independent" : "Saved game")}
                </span>
                <Button variant="outline" size="sm" onClick={() => setSeatsReady(false)}>
                  Change alliance
                </Button>
              </div>
              {kind === "lok-sabha" ? <LokSabhaSeatStep /> : <AssemblySeatStep />}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function ElectionCard({
  selected,
  onSelect,
  icon,
  title,
  stats,
  note,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  stats: Array<[string, string]>;
  note: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && onSelect()}
      className={`flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-6 transition hover:border-brand/60 ${selected ? "border-brand ring-2 ring-brand/30" : "border-border"}`}
    >
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
          {icon}
          {title}
        </h2>
        {selected ? <Badge>Selected</Badge> : <Badge variant="outline">Select</Badge>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {stats.map(([value, label]) => (
          <div key={label} className="rounded-lg border border-border bg-muted/40 p-3 text-center">
            <div className="font-heading text-xl font-semibold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{note}</p>
      {children}
    </div>
  );
}

function PartyDetails({ party, kind, state }: { party: string; kind: Kind; state: string }) {
  if (!party)
    return (
      <aside className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
        Select a party to see its strong regions, closest allies and rivals.
      </aside>
    );
  const pool = (kind === "assembly" ? getEligiblePartyIdsForState(state) : parties.map((p) => p.id)).filter((id) => id !== party);
  const relation = (id: string) =>
    getPoliticalRelationship(party, id, {
      electionType: kind === "assembly" ? "ASSEMBLY" : "LOK_SABHA",
      region: kind === "assembly" ? state : undefined,
      activateConditionalRules: true,
    }).relationship;
  const allies = pool.filter((id) => relation(id) === "STRONG_ALLY" || relation(id) === "FRIENDLY").slice(0, 8);
  const rivals = pool.filter((id) => relation(id) === "STRONG_RIVAL" || relation(id) === "RIVAL").slice(0, 8);
  const start = allianceData.alliances.find((a) => a.corePartyIds.includes(party))?.id;
  const regions = kind === "assembly" ? [] : strongRegionsOf(party);
  const inState = kind === "assembly" && partyCanContestInState(party, state) ? getPartyStrength(party, state) : null;
  return (
    <aside className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="font-heading text-lg font-semibold">{partyName(party)}</h3>
        <p className="text-sm text-muted-foreground">{party}</p>
      </div>
      {kind === "assembly" ? (
        <Section label={`Strength in ${state}`}>
          <Dots value={inState ?? 0.5} />
        </Section>
      ) : (
        <Section label="Strong regions">{regions.length ? regions.join(", ") : "No single stronghold"}</Section>
      )}
      <Section label="Closest allies">
        <Pills ids={allies} empty="None listed" />
      </Section>
      <Section label="Rivals">
        <Pills ids={rivals} empty="None listed" />
      </Section>
      <Section label="Starting alliance">{start ?? "None (contests independently unless you form one)"}</Section>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function Pills({ ids, empty }: { ids: string[]; empty: string }) {
  if (!ids.length) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <Badge key={id} variant="outline">
          {id}
        </Badge>
      ))}
    </span>
  );
}
