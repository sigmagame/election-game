"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Search } from "lucide-react";
import { PartyMark } from "@/components/party-mark";
import { partyColor } from "@/lib/party-style";
import { AllianceName } from "@/components/alliance-name";

export type GovParty = { partyId: string; name: string; seats: number };
export type GovMinistry = { id: number; name: string; kind: string; partyId: string };
export type GovLeader = { role: string; partyId: string; name: string; note: string };

/**
 * The finished government: leader card(s), the coalition's seat bar, and the council of
 * ministers with a party filter. Shared by the Lok Sabha and Assembly cabinet pages.
 */
export function GovernmentView({
  title, blocName, statusNote, totalSeats, majority, parties, leaders, ministries, ministriesTitle, ministriesNote, footer, highlightPartyId,
}: {
  title: string;
  blocName: string;
  statusNote?: string;
  totalSeats: number;
  majority: number;
  parties: GovParty[];
  leaders: GovLeader[];
  ministries: GovMinistry[];
  ministriesTitle: string;
  ministriesNote?: string;
  footer?: ReactNode;
  highlightPartyId?: string;
}) {
  const [filter, setFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const blocSeats = parties.reduce((n, p) => n + p.seats, 0);
  const sorted = useMemo(() => [...parties].sort((a, b) => b.seats - a.seats), [parties]);
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of ministries) map[m.partyId] = (map[m.partyId] ?? 0) + 1;
    return map;
  }, [ministries]);
  const nameOf = (id: string) => parties.find((p) => p.partyId === id)?.name ?? id;
  const visible = ministries.filter(
    (m) => (filter === "ALL" || m.partyId === filter) && (!query.trim() || m.name.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const majorityLeft = `${Math.min(100, (majority / totalSeats) * 100)}%`;

  return (
    <div>
      <header className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
            <CheckCircle2 className="size-4" /> Government formed
          </span>
          <span className="rounded-full border border-border bg-muted px-3 py-1.5 text-sm text-foreground/80">
            {blocSeats} of {totalSeats} seats · majority {majority}
          </span>
        </div>
        <h1 className="mt-5 font-heading text-3xl font-semibold sm:text-4xl">{title}</h1>
        <p className="mt-1 text-lg text-muted-foreground"><AllianceName name={blocName} /></p>
        {statusNote ? <p className="mt-1 text-sm text-muted-foreground">{statusNote}</p> : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {leaders.map((l) => (
            <div key={l.role} className="flex items-center gap-4 rounded-xl border border-border bg-background p-4" style={{ borderLeft: `4px solid ${partyColor(l.partyId)}` }}>
              <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-muted"><PartyMark id={l.partyId} size={48} /></span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground">{l.role}</p>
                <p className="truncate font-heading text-xl font-semibold">{l.name}</p>
                <p className="text-sm text-muted-foreground">{l.note}</p>
              </div>
            </div>
          ))}
        </div>
      </header>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Coalition</h2>
          <span className="text-sm text-muted-foreground">{blocSeats} seats</span>
        </div>
        <div className="relative mt-4 flex h-7 overflow-hidden rounded-md bg-muted">
          {sorted.map((p) => (
            <div key={p.partyId} title={`${p.name}: ${p.seats}`} style={{ width: `${(p.seats / totalSeats) * 100}%`, background: partyColor(p.partyId) }} className="h-full border-r border-background/60 last:border-r-0" />
          ))}
          <div className="absolute inset-y-0 w-[3px] bg-foreground/80" style={{ left: majorityLeft }} aria-hidden />
        </div>
        <p className="mt-1 text-right text-xs text-muted-foreground">Black line: majority mark ({majority})</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {sorted.map((p) => (
            <li key={p.partyId} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${p.partyId === highlightPartyId ? "border-brand bg-brand/10" : "border-border bg-background"}`}>
              <PartyMark id={p.partyId} size={20} />
              <span className="font-medium">{p.name}</span>
              <span className="tabular-nums text-muted-foreground">{p.seats}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-semibold">{ministriesTitle}</h2>
            {ministriesNote ? <p className="mt-1 text-sm text-muted-foreground">{ministriesNote}</p> : null}
          </div>
          <label className="relative block">
            <span className="sr-only">Search ministries</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ministries" className="w-64 rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-brand" />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by party">
          <button onClick={() => setFilter("ALL")} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${filter === "ALL" ? "border-brand bg-brand text-brand-foreground" : "border-border bg-card hover:bg-muted"}`}>
            All · {ministries.length}
          </button>
          {sorted.filter((p) => counts[p.partyId]).map((p) => (
            <button key={p.partyId} onClick={() => setFilter(filter === p.partyId ? "ALL" : p.partyId)} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium ${filter === p.partyId ? "border-brand bg-brand/10" : "border-border bg-card hover:bg-muted"}`}>
              <PartyMark id={p.partyId} size={16} /> {p.name} · {counts[p.partyId]}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((m) => (
            <article key={m.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4" style={{ borderLeft: `4px solid ${partyColor(m.partyId)}` }}>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold leading-snug">{m.name}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{m.kind}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                <PartyMark id={m.partyId} size={16} /> {nameOf(m.partyId)}
              </span>
            </article>
          ))}
          {visible.length === 0 ? <p className="col-span-full rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No ministries match.</p> : null}
        </div>
      </section>

      {footer ? <div className="mt-8">{footer}</div> : null}
    </div>
  );
}
