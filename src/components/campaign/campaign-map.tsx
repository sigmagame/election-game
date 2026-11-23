"use client";

import { useMemo, type ReactNode } from "react";
import { ElectionMap } from "@/components/map/election-map";
import { partyColor } from "@/lib/party-style";
import type { ConstituencyPartySupport } from "@/types/lok-sabha-campaign";

export type CampaignMapView = "leader" | "mine";

/**
 * Opinion-poll map. "leader" colours each seat by the party leading there; "mine" shades each
 * seat by how strong the player's own party is.
 */
export function CampaignMap({
  kind,
  state,
  support,
  names,
  playerPartyId,
  highlightState,
  title,
  subtitle,
  view = "leader",
  toolbar,
  overlay,
  footer,
  belowHeader,
  zoomable = false,
  fillHeight = false,
  masked = false,
  onSelectState,
  highlightIds,
  onSelectSeat,
}: {
  kind: "lok-sabha" | "assembly";
  state?: string;
  support: ConstituencyPartySupport[];
  names: Record<string, string>;
  playerPartyId: string;
  /** Lok Sabha only: fade every seat outside this state ("ALL" shows everything). */
  highlightState?: string;
  title: string;
  subtitle?: string;
  view?: CampaignMapView;
  toolbar?: ReactNode;
  overlay?: ReactNode;
  footer?: ReactNode;
  belowHeader?: ReactNode;
  zoomable?: boolean;
  fillHeight?: boolean;
  /** Draws only the constituency outlines in a neutral colour, with no legend or numbers (no spoilers). */
  masked?: boolean;
  /** Clicking a seat reports the state it belongs to. */
  onSelectState?: (state: string) => void;
  /** Assembly: only these seats are coloured; the rest fade (used for a chosen region). */
  highlightIds?: Set<string>;
  /** Clicking a seat reports the seat id. */
  onSelectSeat?: (id: string) => void;
}) {
  const { leader, colors, legend } = useMemo(() => {
    const wins = new Map<string, number>();
    const leader = new Map<string, { party: string; ranked: Array<[string, number]>; state: string; mine: number }>();
    for (const item of support) {
      if (highlightIds && !highlightIds.has(item.constituencyId)) continue;
      const ranked = Object.entries(item.partySupport).sort((a, b) => b[1] - a[1]);
      if (!ranked.length) continue;
      leader.set(item.constituencyId, { party: ranked[0][0], ranked: ranked.slice(0, 3), state: item.state, mine: item.partySupport[playerPartyId] ?? 0 });
      wins.set(ranked[0][0], (wins.get(ranked[0][0]) ?? 0) + 1);
    }
    const order = [...wins.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
    const colors = new Map(order.map((p) => [p, partyColor(p)]));
    const legend =
      view === "mine"
        ? [
            { color: shade(playerPartyId, 0.18), label: "Under 15%" },
            { color: shade(playerPartyId, 0.45), label: "15–30%" },
            { color: shade(playerPartyId, 0.72), label: "30–45%" },
            { color: shade(playerPartyId, 1), label: "Over 45%" },
          ]
        : order.slice(0, 8).map((p) => ({ color: colors.get(p)!, label: `${p} · ${wins.get(p) ?? 0}` }));
    return { leader, colors, legend };
  }, [support, playerPartyId, view, highlightIds]);

  return (
    <ElectionMap
      kind={kind}
      state={state}
      title={title}
      subtitle={subtitle}
      toolbar={toolbar}
      overlay={overlay}
      footer={footer}
      belowHeader={belowHeader}
      zoomable={zoomable}
      fillHeight={fillHeight}
      onSelect={onSelectState || onSelectSeat ? (id) => { onSelectSeat?.(id); const l = leader.get(id); if (l) onSelectState?.(l.state); } : undefined}
      legend={masked ? undefined : legend}
      fill={(id) => {
        const l = leader.get(id);
        if (highlightIds && !highlightIds.has(id)) return "var(--muted)";
        if (masked) {
          if (highlightIds || (highlightState && highlightState !== "ALL" && l?.state === highlightState)) return "color-mix(in srgb, var(--brand) 35%, var(--muted))";
          return "var(--muted)";
        }
        if (!l) return "var(--muted)";
        if (highlightState && highlightState !== "ALL" && l.state !== highlightState) return "var(--muted)";
        if (view === "mine") return shade(playerPartyId, Math.min(1, 0.12 + l.mine / 50));
        return colors.get(l.party)!;
      }}
      label={(id) => {
        const l = leader.get(id);
        const name = names[id] ?? id;
        if (!l || masked) return name;
        return `${name}: ${l.ranked.map(([p, v]) => `${p} ${v.toFixed(1)}%`).join(" · ")}`;
      }}
    />
  );
}

/** The party colour mixed towards the neutral map colour: 1 is the full colour. */
function shade(partyId: string, strength: number) {
  return `color-mix(in srgb, ${partyColor(partyId)} ${Math.round(strength * 100)}%, var(--muted))`;
}
