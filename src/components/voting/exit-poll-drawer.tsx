"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { PartyMark } from "@/components/party-mark";
import { Button } from "@/components/ui/button";
import { EXIT_POLL_MARGIN, type ExitPoll, type ExitUnit } from "@/lib/exit-poll";
import { partyColor } from "@/lib/party-style";
import { rangeText } from "@/lib/seat-projection";
import { AllianceName } from "@/components/alliance-name";
import { allianceShort } from "@/lib/party-style";

type Tab = "share" | "alliances" | "state" | "statevote";
const TABS: Array<[Tab, string]> = [["share", "Vote share"], ["alliances", "Alliances"], ["state", "State projection"], ["statevote", "State vote share"]];
const pct = (v: number) => `${v.toFixed(1)}%`;

/** A seat bar: solid up to the low end of the range, faded up to the high end. */
function RangeBar({ lo, hi, max, color, thick = false }: { lo: number; hi: number; max: number; color: string; thick?: boolean }) {
  const m = max || 1;
  return (
    <div className={`flex overflow-hidden rounded-full bg-muted ${thick ? "h-3" : "h-2"}`}>
      <div className="h-full" style={{ width: `${(lo / m) * 100}%`, background: color }} />
      <div className="h-full opacity-45" style={{ width: `${((hi - lo) / m) * 100}%`, background: color }} />
    </div>
  );
}

function ShareList({ rows }: { rows: Array<[string, number]> }) {
  const top = rows[0]?.[1] || 1;
  return (
    <ul className="mt-3 space-y-3">
      {rows.map(([id, v]) => (
        <li key={id}>
          <div className="flex items-center gap-2 text-sm"><PartyMark id={id} size={22} /><span className="flex-1 font-semibold">{id}</span><span className="tabular-nums">{pct(v)}</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(v / top) * 100}%`, background: partyColor(id) }} /></div>
        </li>
      ))}
    </ul>
  );
}

function StateSelect({ value, states, onChange }: { value: string; states: string[]; onChange: (s: string) => void }) {
  return (
    <label className="block text-xs text-muted-foreground">State / union territory
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
        {states.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </label>
  );
}

const unitColor = (u: ExitUnit) => partyColor(u.members[0] ?? u.name);

/** The exit poll shown after the last phase: four tabs, drawn over the map card. */
export function ExitPollDrawer({ poll, states, onClose }: { poll: ExitPoll; states: string[]; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("alliances");
  const [state, setState] = useState(states[0] ?? "");
  const { total, majority } = poll;

  const lead = poll.national[0];
  const status = !lead ? "HUNG" : lead.lo >= majority ? "MAJORITY" : lead.hi >= majority ? "CLOSE" : "HUNG";
  const badge = status === "MAJORITY" ? ["Majority likely", "bg-success/10 text-success"] : status === "CLOSE" ? ["Too close to call", "bg-amber-500/15 text-amber-700 dark:text-amber-300"] : ["Hung parliament", "bg-amber-500/15 text-amber-700 dark:text-amber-300"];
  const headline = status === "HUNG" ? `No one reaches ${majority}` : status === "MAJORITY" ? `${lead.name} reaches ${majority}` : `${lead.name} is close to a majority`;
  const subline = !lead ? "" : status === "MAJORITY"
    ? `${lead.name} is projected at ${rangeText(lead)} seats, above the ${majority} majority mark.`
    : status === "CLOSE"
      ? `${lead.name} is projected at ${rangeText(lead)} seats. The ${majority} majority mark sits inside that range, so it could go either way.`
      : `${lead.name} is projected at ${rangeText(lead)} seats, below the ${majority} majority mark. Talks decide the government after results.`;

  const sp = poll.states[state];
  const units = sp?.units ?? [];
  const leaderUnit = units[0];
  const leaderClear = Boolean(leaderUnit) && (units.length === 1 || leaderUnit.lo > units[1].hi);
  const splitVerdict = !leaderClear && units.length >= 2 && units[0].lo === units[0].hi && units[1].lo === units[1].hi && units[0].seats === units[1].seats;
  const alliances = units.filter((u) => u.alliance);
  const loneNational = poll.national.filter((u) => !u.alliance);

  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-black/40" onClick={onClose}>
      <aside className="flex h-full w-full max-w-[600px] flex-col overflow-hidden border-l border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <h3 className="font-heading text-lg font-bold">Exit poll</h3>
            <p className="text-xs text-muted-foreground">Estimated from voters leaving the booths · seat figures are ±{Math.round(EXIT_POLL_MARGIN * 100)}% ranges. Real results can differ.</p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}><X /> Close</Button>
        </div>
        <div className="flex gap-0.5 overflow-x-auto border-b border-border px-3 pt-2">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-semibold ${tab === k ? "border-brand text-brand" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "share" ? (
            <div>
              <p className="text-xs text-muted-foreground">Estimated national vote share by party.</p>
              <ShareList rows={poll.voteShare.slice(0, 12)} />
            </div>
          ) : tab === "alliances" ? (
            <div className="space-y-4">
              <section className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-heading text-base font-semibold">Final projection</h4>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge[1]}`}>{badge[0]}</span>
                </div>
                <p className="mt-3 font-heading text-2xl font-semibold leading-tight">{headline}</p>
                <p className="mt-1.5 text-sm text-foreground/80">{subline}</p>
                <div className="relative mt-4">
                  <RangeBar lo={lead?.lo ?? 0} hi={lead?.hi ?? 0} max={total} color={lead ? unitColor(lead) : "var(--muted)"} thick />
                  <div className="absolute -top-1 h-6 w-0.5 bg-foreground" style={{ left: `${(majority / total) * 100}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>0</span><span>{majority} majority</span><span>{total}</span></div>
                <p className="mt-2 text-xs text-muted-foreground">Exit poll figures are estimates. Seat ranges are ±{Math.round(EXIT_POLL_MARGIN * 100)}%. The bar shows the leading alliance: solid is the low end, faded is the possible extra.</p>
              </section>
              <ul className="space-y-3">
                {poll.national.filter((u) => u.alliance).map((a, i) => (
                  <li key={a.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2"><span className="font-semibold">{i + 1}. <AllianceName name={a.name} className="inline-block align-top" /></span><span className="text-sm tabular-nums">{rangeText(a)} seats</span></div>
                    <div className="mt-2"><RangeBar lo={a.lo} hi={a.hi} max={total} color={unitColor(a)} thick /></div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">{a.members.map((m) => <span key={m} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"><PartyMark id={m} size={14} />{m}</span>)}</div>
                  </li>
                ))}
                {loneNational.length ? <li className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contesting alone</li> : null}
                {loneNational.slice(0, 12).map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-sm"><PartyMark id={p.id} size={20} /><span className="flex-1">{p.name}</span><span className="tabular-nums">{rangeText(p)} seats</span></li>
                ))}
              </ul>
            </div>
          ) : tab === "state" ? (
            <div>
              <StateSelect value={state} states={states} onChange={setState} />
              <div className="mt-4 rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Projected to lead</p>
                {leaderClear ? (
                  <>
                    {leaderUnit.alliance ? (
                      <>
                        <p className="mt-1 text-lg font-bold">{leaderUnit.name}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {leaderUnit.members.map((m) => <span key={m} className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-sm font-semibold"><PartyMark id={m} size={18} />{m}</span>)}
                        </div>
                      </>
                    ) : (
                      <div className="mt-1 flex items-center gap-2 text-lg font-bold"><PartyMark id={leaderUnit.members[0]} size={26} />{leaderUnit.name}</div>
                    )}
                    <p className="mt-1.5 text-xs text-muted-foreground">{rangeText(leaderUnit)} of {sp?.total ?? 0} seats</p>
                  </>
                ) : splitVerdict ? (
                  <>
                    <p className="mt-1 text-lg font-bold">Split verdict</p>
                    <p className="mt-1 text-xs text-muted-foreground">{units[0].name} and {units[1].name} hold {units[0].seats} seat{units[0].seats === 1 ? "" : "s"} each.</p>
                  </>
                ) : (
                  <p className="mt-1 text-lg font-bold">Too close to call</p>
                )}
              </div>
              {alliances.length ? (
                <>
                  <h4 className="mt-4 text-sm font-semibold">Alliance seats</h4>
                  <ul className="mt-2 space-y-1 text-sm">{alliances.map((g) => <li key={g.id} className="flex justify-between"><span>{allianceShort(g.name)}</span><span className="tabular-nums">{rangeText(g)}</span></li>)}</ul>
                </>
              ) : null}
              <h4 className="mt-4 text-sm font-semibold">Projected seats</h4>
              <p className="text-xs text-muted-foreground">Parties projected to win at least one seat.</p>
              <ul className="mt-2 space-y-2">
                {(sp?.parties ?? []).map((r) => (
                  <li key={r.id}>
                    <div className="flex items-center gap-2 text-sm"><PartyMark id={r.id} size={18} /><span className="flex-1">{r.id}</span><span className="tabular-nums">{rangeText(r)}</span></div>
                    <div className="mt-1"><RangeBar lo={r.lo} hi={r.hi} max={sp?.total ?? 1} color={partyColor(r.id)} /></div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <StateSelect value={state} states={states} onChange={setState} />
              <p className="mt-3 text-xs text-muted-foreground">Estimated vote share in {state}.</p>
              <ShareList rows={sp?.voteShare ?? []} />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
