"use client";

import { useState } from "react";
import { ElectionMap } from "@/components/map/election-map";
import { PartyMark } from "@/components/party-mark";
import { partyColor } from "@/lib/party-style";
import { AllianceName } from "@/components/alliance-name";
import { allianceShort } from "@/lib/party-style";

export type MapSeat = { constituencyId: string; name: string; winnerPartyId: string; winnerName: string; allianceName: string; margin: number };
export type MapGroup = { name: string; seats: number; color: string };
export type MapParty = { id: string; name: string; seats: number; alliance: string };

type Sub = "alliance" | "party";

/**
 * Maps tab: winner by seat, either by alliance colour or by each party's own colour.
 * The map card keeps one fixed height; a long legend scrolls inside its own box.
 */
export function ResultsMaps({
  seats,
  groups,
  parties,
  kind = "lok-sabha",
  state,
  playerGroupName,
}: {
  seats: MapSeat[];
  groups: MapGroup[];
  parties: MapParty[];
  kind?: "lok-sabha" | "assembly";
  state?: string;
  /** Assembly: the player's own group, shown exactly as typed. */
  playerGroupName?: string;
}) {
  const alliedName = (name: string) => (name === playerGroupName ? name : allianceShort(name));
  const [sub, setSub] = useState<Sub>("alliance");
  const byId = new Map(seats.map((r) => [r.constituencyId, r]));
  const groupColor = new Map(groups.map((g) => [g.name, g.color]));
  const winners = parties.filter((p) => p.seats > 0);

  const fill = (id: string) => {
    const r = byId.get(id);
    if (!r) return "var(--muted-foreground)";
    return sub === "alliance" ? groupColor.get(r.allianceName) ?? "var(--muted-foreground)" : partyColor(r.winnerPartyId);
  };
  const label = (id: string) => {
    const r = byId.get(id);
    return r ? `${r.name}: ${r.winnerName} (${alliedName(r.allianceName)}) won by ${r.margin.toLocaleString("en-IN")} votes` : id;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {sub === "alliance"
            ? "Each seat takes the colour of the alliance its winner belongs to."
            : "Each seat takes the colour of the party that won it."}{" "}
          Hover a seat for the winner and margin.
        </p>
        <div role="group" aria-label="Map type" className="inline-flex gap-1 rounded-lg bg-muted p-1 text-sm font-semibold">
          {([["alliance", "Alliance map"], ["party", "Party map"]] as Array<[Sub, string]>).map(([k, text]) => (
            <button key={k} type="button" aria-pressed={sub === k} onClick={() => setSub(k)} className={`rounded-md px-4 py-2 ${sub === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{text}</button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:h-[720px] lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)]">
        <ElectionMap kind={kind} state={state} title="Winner by seat" fill={fill} label={label} zoomable fillHeight />
        <aside className="flex min-h-[320px] min-w-0 flex-col rounded-xl border border-border bg-card p-4 lg:min-h-0">
          <h3 className="shrink-0 text-sm font-semibold">Legend · seats won</h3>
          <ul className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {sub === "alliance"
              ? groups.filter((g) => g.seats > 0).map((g) => (
                  <li key={g.name} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
                    <span className="size-3.5 shrink-0 rounded" style={{ background: g.color }} />
                    {g.name === playerGroupName ? <span className="flex-1 font-semibold">{g.name}</span> : <AllianceName name={g.name} className="flex-1 font-semibold" />}
                    <span className="font-bold tabular-nums">{g.seats}</span>
                  </li>
                ))
              : winners.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    <span className="size-3.5 shrink-0 rounded" style={{ background: partyColor(p.id) }} />
                    <PartyMark id={p.id} size={20} />
                    <span className="min-w-0 flex-1 truncate font-semibold" title={p.name}>{p.name}</span>
                    <span className="max-w-[90px] shrink-0 truncate text-xs text-muted-foreground" title={p.alliance}>{p.alliance}</span>
                    <span className="w-9 shrink-0 text-right font-bold tabular-nums">{p.seats}</span>
                  </li>
                ))}
          </ul>
          <p className="mt-3 shrink-0 text-xs text-muted-foreground">
            {sub === "alliance" ? "Every party in an alliance shares that alliance's colour." : "Every party that won a seat has its own colour. Scroll the list to see them all."}
          </p>
        </aside>
      </div>
    </div>
  );
}
