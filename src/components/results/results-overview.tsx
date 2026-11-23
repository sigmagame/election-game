import type { ReactNode } from "react";
import { PartyMark } from "@/components/party-mark";
import { Badge } from "@/components/ui/badge";
import { allianceColor, partyColor } from "@/lib/party-style";
import { MapSlot } from "@/components/voting/voting-parts";
import { AllianceName } from "@/components/alliance-name";
import { allianceShort } from "@/lib/party-style";

export type TallyGroup = { name: string; seats: number; parties: Array<{ name: string; seats: number }>; color?: string };
export type PartyRow = { name: string; seats: number; share: number; votes: number };

const COLORS = ["#4f46e5", "#f97316", "#16a34a", "#0ea5e9", "#e11d48", "#a855f7", "#eab308", "#14b8a6", "#64748b"];
export const groupColor = (i: number) => COLORS[i % COLORS.length];
const fmt = (n: number) => n.toLocaleString("en-IN");

/** The wireframe Results overview: seat tally, outcome banner, alliance bars, party table, map slot, performance. */
export function ResultsOverview({
  total, majority, groups, outcome, partyRows, mapCaption, map, performance, nextHint, compact = false,
}: {
  total: number;
  majority: number;
  groups: TallyGroup[];
  outcome: { hung: boolean; title: string; text: string };
  partyRows: PartyRow[];
  mapCaption: string;
  /** The real map when one is available; otherwise the marked placeholder shows. */
  map?: ReactNode;
  performance: ReactNode;
  nextHint: string;
  /** Tally, result box and performance only (Lok Sabha). Alliance seats, the party table and the map live in their own tabs. */
  compact?: boolean;
}) {
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold">Seat tally</h2>
          <span className="text-sm text-muted-foreground">Majority mark: {majority}</span>
        </div>
        <div className="relative mt-3 flex h-9 gap-1 rounded-md bg-muted p-[3px]">
          {groups.filter((g) => g.seats > 0).map((g) => {
            const members = g.parties.filter((p) => p.seats > 0).sort((a, b) => b.seats - a.seats);
            const allied = members.length > 1;
            return (
              <div
                key={g.name}
                title={`${allianceShort(g.name)}: ${g.seats} seats`}
                className={`flex h-full min-w-0 overflow-hidden rounded-[5px] ${allied ? "outline outline-2 outline-offset-[1px] outline-foreground/70" : ""}`}
                style={{ width: `${(g.seats / total) * 100}%` }}
              >
                {members.map((p) => (
                  <div key={p.name} title={`${p.name}: ${p.seats}`} className="h-full" style={{ width: `${(p.seats / g.seats) * 100}%`, background: partyColor(p.name) }} />
                ))}
              </div>
            );
          })}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {groups.filter((g) => g.seats > 0).flatMap((g) => g.parties.filter((p) => p.seats > 0).map((p) => ({ ...p, group: g })))
            .sort((a, b) => b.seats - a.seats).map((p) => (
              <li key={p.name} className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2.5 rounded-sm" style={{ background: partyColor(p.name) }} />
                <span className="font-medium text-foreground">{p.name}</span> {p.seats}
              </li>
            ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Each party has its own bar. An outline marks parties in the same alliance; the majority mark is shown above.</p>
      </section>

      {compact ? (
        <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
          <section className={`flex flex-col justify-between gap-4 rounded-xl border-2 bg-card p-5 ${outcome.hung ? "border-brand" : "border-success"}`}>
            <div>
              <p className={`text-xs font-bold uppercase tracking-wider ${outcome.hung ? "text-brand" : "text-success"}`}>Result</p>
              <h2 className="mt-1 font-heading text-3xl font-semibold">{outcome.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{outcome.text}</p>
            </div>
            <Badge variant="outline" className="h-auto max-w-sm self-start whitespace-normal px-3 py-1.5 text-xs">{nextHint}</Badge>
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-heading text-base font-semibold">Your performance</h2>
            <div className="mt-3">{performance}</div>
          </section>
        </div>
      ) : (
      <section className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 bg-card p-4 ${outcome.hung ? "border-brand" : "border-success"}`}>
        <div>
          <h2 className="font-heading text-lg font-semibold">{outcome.title}</h2>
          <p className="text-sm text-muted-foreground">{outcome.text}</p>
        </div>
        <Badge variant="outline" className="h-auto max-w-sm whitespace-normal px-3 py-1.5 text-xs">{nextHint}</Badge>
      </section>
      )}

      {!compact && <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold">Alliance seats</h2>
          <span className="text-sm text-muted-foreground">Majority mark: {majority}</span>
        </div>
        <div className="mt-3 space-y-4">
          {groups.filter((g) => g.seats > 0).map((g, i) => (
            <div key={g.name} className="space-y-1.5">
              <div className="flex justify-between text-sm"><AllianceName name={g.name} className="font-semibold" /><span className="text-muted-foreground">{g.seats} seats</span></div>
              <div className="relative h-6 rounded-md bg-muted">
                <div className="h-full rounded-md" style={{ width: `${(g.seats / total) * 100}%`, background: g.color ?? allianceColor(g.parties) }} />
              </div>
              {g.parties.some((p) => p.seats > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {g.parties.filter((p) => p.seats > 0).map((p) => <Badge key={p.name} variant="secondary" className="gap-1"><PartyMark id={p.name} size={14} />{p.name} {p.seats}</Badge>)}
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Every bar uses the same scale; member parties are listed under each front.</p>
      </section>}

      {!compact && <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-heading text-base font-semibold">Party-wise results</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">Party</th><th className="px-3 font-medium">Seats</th><th className="px-3 font-medium">Vote %</th><th className="pl-3 font-medium">Votes</th></tr></thead>
              <tbody>
                {partyRows.slice(0, 10).map((p) => (
                  <tr key={p.name} className="border-b border-border/60 last:border-0"><td className="py-2 pr-3 font-medium"><span className="flex items-center gap-2"><PartyMark id={p.name} size={22} />{p.name}</span></td><td className="px-3">{p.seats}</td><td className="px-3">{p.share.toFixed(2)}%</td><td className="pl-3">{fmt(p.votes)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="space-y-5">
          {/* MAP SLOT: winner by seat (added in the map stage). */}
          {map ?? <MapSlot caption={mapCaption} />}
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-heading text-base font-semibold">Your performance</h2>
            <div className="mt-3">{performance}</div>
          </section>
        </div>
      </div>}
    </div>
  );
}

export function StatBox({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
