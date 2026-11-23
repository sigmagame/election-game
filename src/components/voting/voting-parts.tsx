import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { Speed } from "./use-reveal";

export type PhaseCard = {
  id: number;
  name: string;
  seats: number;
  status: "pending" | "polling" | "done";
  detail?: string;
};

/** Title row: what the stage is, plus the Start voting / Next button. */
export function VotingHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

const STATUS_LABEL = { pending: "Pending", polling: "Polling", done: "Completed" } as const;

/** One card per polling phase: name, seats, a progress line and a status pill. */
export function PhaseStrip({ phases }: { phases: PhaseCard[] }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(phases.length, 7)}, minmax(0, 1fr))` }}>
      {phases.map((p) => (
        <div key={p.id} className="rounded-xl border border-border bg-card p-3">
          <p className="text-sm font-semibold">{p.name}</p>
          <p className="text-xs text-muted-foreground">{p.seats} seats</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${p.status === "done" ? "bg-success" : "bg-brand"}`}
              style={{ width: p.status === "done" ? "100%" : p.status === "polling" ? "50%" : "0%" }}
            />
          </div>
          <Badge
            variant={p.status === "pending" ? "outline" : "secondary"}
            className={`mt-2 ${p.status === "done" ? "text-success" : p.status === "polling" ? "text-brand" : ""}`}
          >
            {STATUS_LABEL[p.status]}
          </Badge>
          {p.detail ? <p className="mt-2 truncate text-xs text-muted-foreground" title={p.detail}>{p.detail}</p> : null}
        </div>
      ))}
    </div>
  );
}

/** Reserved space for the shared map (added in the map stage). */
export function MapSlot({ caption }: { caption: string }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-6 text-center">
      <p className="font-heading text-lg font-semibold">Map</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{caption}</p>
    </div>
  );
}

/** Right column: progress bar, turnout and seats polled. */
export function ProgressPanel({ polled, total, turnout }: { polled: number; total: number; turnout: number | null }) {
  const pct = total ? Math.round((polled / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-heading text-base font-semibold">Polling progress</h2>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Turnout</dt>
          <dd className="text-xl font-semibold">{turnout === null ? "—" : `${turnout.toFixed(1)}%`}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Seats polled</dt>
          <dd className="text-xl font-semibold">{polled} <span className="text-sm font-normal text-muted-foreground">/ {total}</span></dd>
        </div>
      </dl>
    </div>
  );
}

/** Running feed of what has happened during polling. */
export function UpdatesFeed({ items }: { items: string[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-heading text-base font-semibold">Polling updates</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Updates appear here once polling starts.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {items.map((t, i) => (
            <li key={i} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border p-4 text-sm ${tone === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-muted text-foreground"}`}>
      {children}
    </div>
  );
}

const SPEEDS: Array<{ id: Speed; label: string }> = [
  { id: "normal", label: "Normal" },
  { id: "fast", label: "Fast" },
  { id: "skip", label: "Skip" },
];

/** Playback speed for the polling animation. */
export function SpeedControl({ speed, onChange }: { speed: Speed; onChange: (s: Speed) => void }) {
  return (
    <div role="group" aria-label="Animation speed" className="inline-flex overflow-hidden rounded-lg border border-border text-sm">
      {SPEEDS.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={speed === s.id}
          onClick={() => onChange(s.id)}
          className={`px-3 py-1.5 font-medium transition ${speed === s.id ? "bg-brand text-brand-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
