"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ASSEMBLY_MINISTRIES,
  DEPUTY_CM_POINTS,
  DEPUTY_COUNT,
  DEPUTY_POSTS,
  DEPUTY_POINTS,
  MINISTER_COUNT,
  MINISTER_POINTS,
  MINISTER_POSTS,
  TOTAL_MINISTRY_POINTS,
  autoAllocateMinistries,
  autoAssignDeputies,
  cabinetPointsUsed,
  createAssemblyCabinet,
  deputyRoom,
  loadAssemblyCabinet,
  saveAssemblyCabinet,
  validateCabinet,
  type AssemblyCabinetSave,
  type AssemblyMinistry,
  type PostKind,
} from "@/engine/assembly-cabinet-engine";
import { loadAssemblyGame, type AssemblyGameSave } from "@/engine/assembly-game-engine";
import { getEffectiveAssemblyOutcome } from "@/engine/assembly-government";
import { loadAssemblyVoting, type AssemblyGovernmentOutcome } from "@/engine/assembly-voting-engine";
import { loadNegotiationSave } from "@/engine/lok-sabha-negotiation-engine";
import partiesData from "@/data/parties.json";
import { deleteGameData, markGameComplete } from "@/lib/game-progress";
import { allianceShort } from "@/lib/party-style";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PartyMark } from "@/components/party-mark";
import { GovernmentView } from "@/components/government/government-view";

const partyNames = Object.fromEntries(
  (partiesData.parties as Array<{ id: string; name: string }>).map((party) => [party.id, party.name]),
);
const nm = (id: string) => partyNames[id] ?? id;
const KIND_LABEL = { MINISTER: "Minister", DEPUTY: "Deputy Minister" } as const;
const TAB_LABEL: Record<PostKind, string> = { MINISTER: "Ministers", DEPUTY: "Deputy Ministers" };

/** The party that was promised the Deputy Chief Minister post in an accepted negotiation deal, if any. */
function negotiatedDeputyCm(gameId: string, playerPartyId: string): string | null {
  const save = loadNegotiationSave(gameId, "ASSEMBLY");
  for (const offer of save.offers) {
    if (offer.status !== "ACCEPTED" || offer.arrangement !== "JOIN") continue;
    if (!/Deputy Chief Minister post:\s*Yes/i.test(offer.terms)) continue;
    return offer.id.startsWith("INCOMING-") || offer.playerAsks ? playerPartyId : (offer.targetPartyIds[0] ?? playerPartyId);
  }
  return null;
}

export default function AssemblyCabinetPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [game, setGame] = useState<AssemblyGameSave | null>(null);
  const [outcome, setOutcome] = useState<AssemblyGovernmentOutcome | null>(null);
  const [cabinet, setCabinet] = useState<AssemblyCabinetSave | null>(null);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<PostKind>("MINISTER");
  const [filter, setFilter] = useState("");
  const [warnings, setWarnings] = useState<Record<number, string>>({});
  const [dcmPick, setDcmPick] = useState("");
  const [negotiatedDcm, setNegotiatedDcm] = useState(false);

  useEffect(() => {
    const saved = loadAssemblyGame();
    if (!saved) {
      router.replace("/elections/assembly/new-game");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates client-only saved state after mount (localStorage is unavailable during SSR)
    setGame(saved);
    const voting = loadAssemblyVoting(saved.gameId);
    if (voting && voting.results.length === saved.totalConstituencies) {
      const result = getEffectiveAssemblyOutcome(saved, voting);
      setOutcome(result);
      if (result.rulingGroup) {
        const dcm = negotiatedDeputyCm(saved.gameId, saved.playerPartyId);
        setNegotiatedDcm(Boolean(dcm));
        let existing = loadAssemblyCabinet(saved.gameId, result.rulingGroup.name);
        if (!existing) {
          existing = createAssemblyCabinet(saved.gameId, result, dcm);
          // When the player's group is in opposition there is nothing for the player to decide:
          // the ruling parties share the ministries among themselves.
          if (!result.playerInGovernment) {
            try {
              const ministers = autoAllocateMinistries(existing.parties);
              existing = {
                ...existing,
                assignments: autoAssignDeputies(existing.parties, ministers),
                autoAllocated: true,
                confirmed: true,
                deputyCmDecided: true,
              };
            } catch {
              // No exact split exists (only possible for an implausibly large coalition); the workspace opens instead.
            }
          }
          existing = saveAssemblyCabinet(existing);
        }
        setCabinet(existing);
      }
    }
    setReady(true);
  }, [router]);

  // The game is finished once its cabinet list is on screen.
  useEffect(() => {
    if (cabinet?.confirmed && cabinet.gameId) markGameComplete("assembly", cabinet.gameId);
  }, [cabinet]);

  const used = useMemo(() => (cabinet ? cabinetPointsUsed(cabinet) : {}), [cabinet]);
  const validation = useMemo(() => (cabinet ? validateCabinet(cabinet) : null), [cabinet]);
  const holderOf = useMemo(
    () => new Map((cabinet?.assignments ?? []).map((assignment) => [assignment.ministryId, assignment.partyId])),
    [cabinet],
  );
  const deputiesHeld = useMemo(() => {
    const held: Record<string, number> = {};
    for (const [id, partyId] of holderOf) if (id >= 100 && partyId) held[partyId] = (held[partyId] ?? 0) + 1;
    return held;
  }, [holderOf]);
  const ministersHeld = useMemo(() => {
    const held: Record<string, number> = {};
    for (const [id, partyId] of holderOf) if (id < 100 && partyId) held[partyId] = (held[partyId] ?? 0) + 1;
    return held;
  }, [holderOf]);

  if (!ready || !game) {
    return <main className="mx-auto max-w-[1280px] px-6 py-8 text-muted-foreground">Loading cabinet formation…</main>;
  }

  if (!outcome || !outcome.rulingGroup || !cabinet || !validation) {
    return (
      <Gate
        message={
          outcome && !outcome.rulingGroup
            ? "No group holds a majority, so there is no government to allocate ministries in yet. Settle the hung assembly first."
            : "Cabinet formation opens once the election results are declared."
        }
        href="/elections/assembly/government-formation"
      />
    );
  }

  const ruling = outcome.rulingGroup;
  const rulingLabel = outcome.playerInGovernment && ruling.name === outcome.playerGroupName ? ruling.name : allianceShort(ruling.name);
  const needsDcmAnswer = !cabinet.deputyCmDecided && outcome.playerInGovernment && !cabinet.confirmed;
  const roomOf = (partyId: string) => deputyRoom(cabinet.parties.find((party) => party.partyId === partyId)?.entitlement ?? 0);

  function update(next: AssemblyCabinetSave) {
    setCabinet(saveAssemblyCabinet(next));
  }

  /** Why a party cannot take this post, or null when it can. */
  function blockReason(post: AssemblyMinistry, partyId: string): string | null {
    if (!cabinet) return null;
    const party = cabinet.parties.find((item) => item.partyId === partyId);
    if (!party) return null;
    const current = holderOf.get(post.id) === partyId;
    if (post.kind === "MINISTER") {
      const left = party.entitlement - ((used[partyId] ?? 0) - (current ? post.points : 0));
      return left < post.points ? `${nm(partyId)} has ${left} of its ${party.entitlement} points left, but ${post.name} costs ${post.points}.` : null;
    }
    const held = (deputiesHeld[partyId] ?? 0) - (current ? 1 : 0);
    const room = deputyRoom(party.entitlement);
    return held >= room ? `${nm(partyId)} may hold at most ${room} deputy minister${room === 1 ? "" : "s"} and already holds ${held}.` : null;
  }

  function assign(post: AssemblyMinistry, partyId: string) {
    if (!cabinet) return;
    if (partyId) {
      const reason = blockReason(post, partyId);
      if (reason) {
        setWarnings((current) => ({ ...current, [post.id]: reason }));
        return;
      }
    }
    setWarnings((current) => {
      const copy = { ...current };
      delete copy[post.id];
      return copy;
    });
    setNotice("");
    const rest = cabinet.assignments.filter((item) => item.ministryId !== post.id);
    update({ ...cabinet, assignments: partyId ? [...rest, { ministryId: post.id, partyId }] : rest, confirmed: false });
  }

  function toggleDeputy(post: AssemblyMinistry) {
    if (!cabinet) return;
    if (holderOf.get(post.id)) {
      assign(post, "");
      return;
    }
    const parentParty = holderOf.get(post.ministryId) ?? "";
    const pick = [parentParty, ...cabinet.parties.map((party) => party.partyId)].find((id) => id && !blockReason(post, id));
    if (pick) assign(post, pick);
    else setWarnings((current) => ({ ...current, [post.id]: "No party has room for another deputy minister." }));
  }

  function autoAllocate() {
    if (!cabinet) return;
    try {
      const ministers = autoAllocateMinistries(cabinet.parties);
      const deputies = cabinet.assignments.filter((item) => item.ministryId >= 100);
      setWarnings({});
      setNotice("The ministers are shared out by seat strength. Add deputy ministers in their tab, and change anything before confirming.");
      update({ ...cabinet, assignments: [...ministers, ...deputies], confirmed: false });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Unable to allocate ministries automatically.");
    }
  }

  function clearAll() {
    if (!cabinet) return;
    setWarnings({});
    setNotice("All allocations cleared.");
    update({ ...cabinet, assignments: [], confirmed: false });
  }

  function confirm() {
    if (!cabinet || !validation?.ok) return;
    setNotice("");
    update({ ...cabinet, confirmed: true });
  }

  function answerDcm(partyId: string | null) {
    if (!cabinet) return;
    update({ ...cabinet, deputyChiefMinisterPartyId: partyId, deputyCmDecided: true });
  }

  const header = (
    <Link href="/elections/assembly/government-formation" className="text-sm text-muted-foreground hover:text-foreground">
      ← Government formation
    </Link>
  );

  // ---- Confirmed: the finished council of ministers ----
  if (cabinet.confirmed) {
    const rows = ASSEMBLY_MINISTRIES.flatMap((ministry) => {
      const partyId = holderOf.get(ministry.id);
      return partyId ? [{ id: ministry.id, name: ministry.name, kind: KIND_LABEL[ministry.kind], partyId }] : [];
    });
    const deputyRows = rows.filter((row) => row.id >= 100).length;
    return (
      <main className="mx-auto max-w-[1280px] px-6 py-8">
        {header}
        <div className="mt-4">
          <GovernmentView
            title={`Government of ${game.state}`}
            blocName={ruling.name}
            statusNote={cabinet.autoAllocated ? "The ruling parties shared the ministries by seat strength." : "Your ministry list is confirmed."}
            totalSeats={game.totalConstituencies}
            majority={Math.floor(game.totalConstituencies / 2) + 1}
            highlightPartyId={game.playerPartyId}
            parties={cabinet.parties.map((party) => ({ partyId: party.partyId, name: nm(party.partyId), seats: party.seats }))}
            leaders={[
              { role: "Chief Minister", partyId: cabinet.chiefMinisterPartyId, name: nm(cabinet.chiefMinisterPartyId), note: "Leader of the Government" },
              ...(cabinet.deputyChiefMinisterPartyId ? [{ role: "Deputy Chief Minister", partyId: cabinet.deputyChiefMinisterPartyId, name: nm(cabinet.deputyChiefMinisterPartyId), note: "Second Position in the Government" }] : []),
            ]}
            ministries={rows}
            ministriesTitle={`${game.state} Council of Ministers`}
            ministriesNote={`${rows.length - deputyRows} ministers and ${deputyRows} deputy minister${deputyRows === 1 ? "" : "s"} shared between the ruling parties`}
            footer={
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-brand/30 bg-brand/5 p-5">
                <div>
                  <p className="font-bold">The election is complete</p>
                  <p className="mt-1 text-sm text-muted-foreground">Review the results again, Opening the Assembly menu or Home clears this finished game so you can start a new one.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href="/elections/assembly/results" className="rounded-xl border border-border px-5 py-3 text-sm font-semibold hover:bg-muted">
                    Election results
                  </Link>
                  <Link href="/elections/assembly" onClick={() => deleteGameData("assembly")} className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-bold text-brand-foreground hover:opacity-90">
                    ⌂ Assembly menu
                  </Link>
                  <Link href="/" onClick={() => deleteGameData("assembly")} className="inline-flex rounded-xl border border-border px-5 py-3 text-sm font-semibold hover:bg-muted">
                    Home
                  </Link>
                </div>
              </div>
            }
          />
        </div>
      </main>
    );
  }

  // ---- Allocation workspace (same layout as the Lok Sabha council of ministers) ----
  const mainDone = MINISTER_POSTS.filter((post) => holderOf.get(post.id)).length;
  const deputyDone = DEPUTY_POSTS.filter((post) => holderOf.get(post.id)).length;
  const posts = (tab === "MINISTER" ? MINISTER_POSTS : DEPUTY_POSTS).filter((post) => !filter || holderOf.get(post.id) === filter);
  const parentName = (post: AssemblyMinistry) => post.ministryName;

  const checks = [
    ...(validation.unassignedMinistryIds.length ? [{ ok: false, text: `Assign the ${validation.unassignedMinistryIds.length} remaining minister post${validation.unassignedMinistryIds.length === 1 ? "" : "s"}.` }] : []),
    ...validation.partiesWithoutMinistry.map((id) => ({ ok: false, text: `${nm(id)} still needs a minister post.` })),
    ...validation.overBudgetPartyIds.map((id) => ({ ok: false, text: `${nm(id)} is over its points.` })),
    ...validation.overDeputyRoomPartyIds.map((id) => ({ ok: false, text: `${nm(id)} holds more deputy ministers than it may.` })),
  ];

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-8">
      <Dialog open={needsDcmAnswer}>
        <DialogContent showCloseButton={false} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Appoint a Deputy Chief Minister?</DialogTitle>
            <DialogDescription>
              The Deputy Chief Minister is not one of the ministry posts, so it costs no cabinet points. You can give it to any party in {rulingLabel}.
            </DialogDescription>
          </DialogHeader>
          <select
            aria-label="Party for Deputy Chief Minister"
            value={dcmPick}
            onChange={(event) => setDcmPick(event.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm"
          >
            <option value="">Choose a party…</option>
            {cabinet.parties.map((party) => <option key={party.partyId} value={party.partyId}>{nm(party.partyId)}{party.partyId === game.playerPartyId ? " (you)" : ""}</option>)}
          </select>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => answerDcm(null)}>No Deputy Chief Minister</Button>
            <Button disabled={!dcmPick} onClick={() => answerDcm(dcmPick)}>Appoint</Button>
          </div>
        </DialogContent>
      </Dialog>

      <header>
        {header}
        <h1 className="mt-4 font-heading text-2xl font-semibold">Council of Ministers</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {rulingLabel} · {ruling.seats} seats · Share {TOTAL_MINISTRY_POINTS} points across {MINISTER_COUNT} ministers. Deputy ministers are added afterwards in the last tab.
        </p>
      </header>

      <section aria-label="Parties in government" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cabinet.parties.map((party) => {
          const pts = used[party.partyId] ?? 0;
          const ministers = ministersHeld[party.partyId] ?? 0;
          const deputies = deputiesHeld[party.partyId] ?? 0;
          const bad = pts > party.entitlement || deputies > roomOf(party.partyId);
          const ok = !bad && pts >= party.entitlement && ministers > 0;
          const pct = Math.min(100, party.entitlement ? (pts / party.entitlement) * 100 : 0);
          return (
            <button
              key={party.partyId}
              type="button"
              onClick={() => setFilter((current) => (current === party.partyId ? "" : party.partyId))}
              aria-pressed={filter === party.partyId}
              className={`flex flex-col gap-1.5 rounded-xl border p-3 text-left transition hover:opacity-90 ${bad ? "border-destructive/60 bg-destructive/10" : ok ? "border-success/50 bg-success/10" : "border-border bg-card"} ${filter === party.partyId ? "ring-2 ring-brand" : ""}`}
            >
              <span className="flex items-center gap-2">
                <PartyMark id={party.partyId} size={22} />
                <b className="truncate text-sm">{nm(party.partyId)}</b>
                <span className="ml-auto text-xs text-muted-foreground">{party.seats} seats</span>
              </span>
              <span className="text-xs text-muted-foreground">Deputies allowed: {roomOf(party.partyId)}</span>
              <span className="h-1.5 w-full rounded-full bg-muted"><span className={`block h-full rounded-full ${bad ? "bg-destructive" : ok ? "bg-success" : "bg-brand"}`} style={{ width: `${pct}%` }} /></span>
              <span className="flex justify-between text-xs">
                <span className={`font-semibold ${bad ? "text-destructive" : ok ? "text-success" : ""}`}>{pts} / {party.entitlement} pts</span>
                <span className="text-muted-foreground">{ministers} minister{ministers === 1 ? "" : "s"}{deputies ? ` · ${deputies} deputy` : ""}</span>
              </span>
            </button>
          );
        })}
      </section>
      {filter && (
        <p className="mt-3 text-sm text-muted-foreground">
          Showing only the posts held by <b className="text-foreground">{nm(filter)}</b>.{" "}
          <button type="button" onClick={() => setFilter("")} className="font-semibold text-brand underline">Show all</button>
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-start gap-5">
        <section className="min-w-0 flex-[999_1_620px] rounded-2xl border border-border bg-card p-5">
          <div role="tablist" className="flex gap-2 overflow-x-auto border-b border-border pb-3">
            {(["MINISTER", "DEPUTY"] as const).map((kind) => {
              const on = tab === kind;
              const total = kind === "MINISTER" ? MINISTER_COUNT : DEPUTY_COUNT;
              const done = kind === "MINISTER" ? mainDone : deputyDone;
              return (
                <button key={kind} role="tab" aria-selected={on} type="button" onClick={() => setTab(kind)} className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold ${on ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                  {TAB_LABEL[kind]} {done}/{total}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {tab === "MINISTER"
              ? `Ministers · ${MINISTER_POINTS} points each. Every party that won a seat is guaranteed one; the rest are shared by seat strength.`
              : `Deputy ministers · optional extras you hand out after the main cabinet, outside the ${TOTAL_MINISTRY_POINTS} points. Each party may hold only as many as its share of the cabinet allows. (${DEPUTY_POINTS} points in negotiation value.)`}
          </p>
          {tab === "DEPUTY" && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {cabinet.parties.map((party) => (
                <span key={party.partyId} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1">
                  <PartyMark id={party.partyId} size={14} />
                  {nm(party.partyId)} · room for {Math.max(0, roomOf(party.partyId) - (deputiesHeld[party.partyId] ?? 0))} more
                </span>
              ))}
            </div>
          )}
          <div className="mt-3">
            {posts.length === 0 && <p className="py-6 text-sm text-muted-foreground">No posts to show here{filter ? ` for ${nm(filter)}` : ""}.</p>}
            {posts.map((post) => {
              const current = holderOf.get(post.id) ?? "";
              return (
                <div key={post.id} className="border-t border-border py-2.5">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-[1_1_220px]">
                      <p className="text-sm font-semibold">{post.name}</p>
                      <p className="text-xs text-muted-foreground">{post.kind === "DEPUTY" ? `Attached to ${parentName(post)}` : "Minister"}</p>
                    </div>
                    <span className="w-14 text-xs font-bold text-brand">{post.kind === "MINISTER" ? `${post.points} pts` : "extra"}</span>
                    <span className="flex items-center gap-2">
                      {current ? <PartyMark id={current} size={24} /> : <span className="size-6 shrink-0 rounded-full border border-dashed border-border" />}
                      <select
                        aria-label={`Party for ${post.name}`}
                        value={current}
                        onChange={(event) => assign(post, event.target.value)}
                        className="w-44 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      >
                        <option value="">Assign party</option>
                        {cabinet.parties.map((party) => {
                          const blocked = party.partyId !== current && Boolean(blockReason(post, party.partyId));
                          return <option key={party.partyId} value={party.partyId} disabled={blocked}>{nm(party.partyId)}{blocked ? " · at limit" : ""}</option>;
                        })}
                      </select>
                    </span>
                    {post.kind === "DEPUTY" && (
                      <button type="button" role="switch" aria-checked={Boolean(current)} onClick={() => toggleDeputy(post)} className="inline-flex min-w-[76px] items-center gap-2 text-xs text-muted-foreground">
                        <span className={`relative inline-block h-5 w-9 rounded-full ${current ? "bg-success" : "bg-muted"}`}>
                          <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${current ? "left-[18px]" : "left-0.5"}`} />
                        </span>
                        {current ? "On" : "Off"}
                      </button>
                    )}
                  </div>
                  {warnings[post.id] && <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{warnings[post.id]}</p>}
                </div>
              );
            })}
          </div>
        </section>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap gap-2">
              <button onClick={confirm} disabled={!validation.ok} className="min-h-11 flex-[1_1_140px] rounded-lg bg-success px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Confirm cabinet</button>
              <button onClick={autoAllocate} className="min-h-11 flex-[1_1_110px] rounded-lg border border-brand px-4 text-sm font-semibold text-brand hover:bg-brand/10">Auto-allocate</button>
              <button onClick={clearAll} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted">Clear</button>
            </div>
            <div className="mt-4">
              <p className="flex items-baseline justify-between">
                <b className="text-2xl font-black">{mainDone}<span className="text-sm font-medium text-muted-foreground"> / {MINISTER_COUNT} ministers</span></b>
                <span className="text-xs text-muted-foreground">{MINISTER_COUNT - mainDone > 0 ? `${MINISTER_COUNT - mainDone} left to assign` : "all assigned"}</span>
              </p>
              <div className="mt-2 h-2.5 rounded-full bg-muted"><div className="h-full rounded-full bg-brand" style={{ width: `${(mainDone / MINISTER_COUNT) * 100}%` }} /></div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="w-24 text-foreground/80">Deputies</span>
              <span className="h-1.5 flex-1 rounded-full bg-muted"><span className="block h-full rounded-full bg-brand" style={{ width: `${(deputyDone / DEPUTY_COUNT) * 100}%` }} /></span>
              <b className="w-12 text-right">{deputyDone} / {DEPUTY_COUNT}</b>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-heading text-base font-semibold">Before you can confirm</h2>
            <ul className="mt-3 space-y-2 text-xs">
              {checks.length === 0 ? (
                <li className="flex gap-2 text-success"><span aria-hidden="true">✓</span>Everything is in order. You can confirm.</li>
              ) : (
                checks.map((check, index) => (
                  <li key={index} className="flex gap-2 text-foreground/80"><span aria-hidden="true" className="text-destructive">✕</span>{check.text}</li>
                ))
              )}
            </ul>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-heading text-base font-semibold">Deputy Chief Minister</h2>
              <span className="text-xs font-bold text-brand">{DEPUTY_CM_POINTS} pts · outside the {TOTAL_MINISTRY_POINTS}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Worth two ministers in negotiation. Give it to any government party.</p>
            <label className="mt-3 block">
              <span className="sr-only">Deputy Chief Minister party</span>
              <select
                value={cabinet.deputyChiefMinisterPartyId ?? ""}
                disabled={negotiatedDcm}
                onChange={(event) => answerDcm(event.target.value || null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground disabled:opacity-60"
              >
                <option value="">No Deputy Chief Minister</option>
                {cabinet.parties.map((party) => <option key={party.partyId} value={party.partyId}>{nm(party.partyId)} · {party.seats} seats</option>)}
              </select>
            </label>
            {negotiatedDcm && <p className="mt-2 text-xs text-success">Agreed in negotiation, locked.</p>}
          </section>
        </aside>
      </div>

      {notice && <p role="status" className="mt-4 rounded-lg border border-brand/30 bg-brand/5 p-3 text-sm text-foreground">{notice}</p>}
    </main>
  );
}

function Gate({ message, href }: { message: string; href: string }) {
  return (
    <main className="mx-auto max-w-[1280px] px-6 py-8">
      <section className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-8 text-center">
        <h1 className="text-2xl font-black">Cabinet formation locked</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Link href={href} className="mt-5 inline-flex rounded-xl bg-brand px-5 py-3 font-bold text-brand-foreground hover:opacity-90">Back</Link>
      </section>
    </main>
  );
}
