"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

type MapItem = { d: string; c: [number, number]; tiny?: 1 };
type MapData = { viewBox: [number, number]; items: Record<string, MapItem> };

export type MapLegendItem = { color: string; label: string };

/** The data file name for a state's Assembly map, e.g. "Tamil Nadu" -> "tamil-nadu". */
export function stateMapSlug(state: string) {
  return state.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function loadMap(kind: "lok-sabha" | "assembly", state?: string): Promise<MapData> {
  if (kind === "lok-sabha") return (await import("@/data/maps/india-constituencies.json")).default as unknown as MapData;
  return (await import(`@/data/maps/assembly/${stateMapSlug(state ?? "")}.json`)).default as MapData;
}

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

/**
 * Constituency map for the Lok Sabha (all of India) or one state's Assembly.
 * The page decides each seat's colour and hover text; this component only draws.
 *
 * `zoomable` adds + / − buttons (the map fits its box at 100% and scrolls when zoomed in),
 * `fillHeight` makes the card stretch to its parent, `onSelect` makes seats clickable and
 * `overlay` draws a panel over the whole card.
 */
export function ElectionMap({
  kind,
  state,
  fill,
  label,
  legend,
  title,
  subtitle,
  toolbar,
  zoomable = false,
  fillHeight = false,
  onSelect,
  overlay,
  footer,
  belowHeader,
}: {
  kind: "lok-sabha" | "assembly";
  state?: string;
  fill: (id: string) => string;
  label: (id: string) => string;
  legend?: MapLegendItem[];
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
  zoomable?: boolean;
  fillHeight?: boolean;
  onSelect?: (id: string) => void;
  overlay?: ReactNode;
  footer?: ReactNode;
  /** A row drawn between the header and the map (e.g. state chips). */
  belowHeader?: ReactNode;
}) {
  const [data, setData] = useState<MapData | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const zoom = ZOOM_STEPS[zoomIndex];

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets before loading a different map
    setData(null);
    setFailed(false);
    loadMap(kind, state)
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [kind, state]);

  function move(e: React.MouseEvent, id: string) {
    const r = box.current?.getBoundingClientRect();
    if (r) setHover({ id, x: e.clientX - r.left, y: e.clientY - r.top });
  }

  const svg = data ? (
    <svg
      viewBox={`0 0 ${data.viewBox[0]} ${data.viewBox[1]}`}
      role="img"
      aria-label={title}
      className={zoomable ? "block h-full w-full" : "mx-auto block h-auto max-h-[620px] w-full"}
    >
      {Object.entries(data.items).map(([id, it]) => (
        <g key={id} onMouseMove={(e) => move(e, id)} onMouseEnter={(e) => move(e, id)} onClick={onSelect ? () => onSelect(id) : undefined} className={onSelect ? "cursor-pointer" : undefined}>
          <path d={it.d} fill={fill(id)} stroke="var(--background)" strokeWidth={0.6} strokeLinejoin="round" style={{ transition: "fill 0.4s" }} />
          {it.tiny ? <circle cx={it.c[0]} cy={it.c[1]} r={5} fill={fill(id)} stroke="var(--background)" strokeWidth={0.8} /> : null}
        </g>
      ))}
    </svg>
  ) : null;

  return (
    <div className={`relative rounded-xl border border-border bg-card p-4 ${fillHeight ? "flex h-full min-h-[640px] flex-col overflow-hidden" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {toolbar}
      </div>
      {belowHeader ? <div className="mt-3">{belowHeader}</div> : null}
      <div ref={box} className={`relative mt-3 ${fillHeight ? "flex min-h-0 flex-1 flex-col" : ""}`} onMouseLeave={() => setHover(null)}>
        {failed ? (
          <p className="grid min-h-[260px] place-items-center text-center text-sm text-muted-foreground">
            The map for {state ?? "this election"} has not been added yet.
          </p>
        ) : !data ? (
          <p className="grid min-h-[260px] place-items-center text-sm text-muted-foreground">Loading map…</p>
        ) : zoomable ? (
          <>
            <div className="relative min-h-[420px] flex-1 overflow-auto rounded-lg border border-border bg-muted/30">
              <div className="absolute left-0 top-0" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
                {svg}
              </div>
            </div>
            <div className="absolute right-3 top-3 z-[2] flex flex-col items-end gap-2">
              <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-md">
                <button type="button" aria-label="Zoom in" disabled={zoomIndex >= ZOOM_STEPS.length - 1} onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))} className="grid size-11 place-items-center hover:bg-muted disabled:opacity-35">
                  <Plus className="size-[18px]" />
                </button>
                <span className="border-y border-border py-1 text-center text-xs font-semibold text-muted-foreground">{Math.round(zoom * 100)}%</span>
                <button type="button" aria-label="Zoom out" disabled={zoomIndex <= 0} onClick={() => setZoomIndex((i) => Math.max(0, i - 1))} className="grid size-11 place-items-center hover:bg-muted disabled:opacity-35">
                  <Minus className="size-[18px]" />
                </button>
              </div>
              <button type="button" onClick={() => setZoomIndex(0)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted">
                Reset view
              </button>
            </div>
          </>
        ) : (
          svg
        )}
        {hover ? (
          <div
            className="pointer-events-none absolute z-10 max-w-[260px] rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground shadow-md"
            style={{ left: Math.min(hover.x + 12, (box.current?.clientWidth ?? 300) - 220), top: hover.y + 12 }}
          >
            {label(hover.id)}
          </div>
        ) : null}
      </div>
      {legend?.length ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: l.color }} /> {l.label}
            </li>
          ))}
        </ul>
      ) : null}
      {footer}
      {overlay}
    </div>
  );
}
