import { allianceFull, allianceShort } from "@/lib/party-style";

/** An alliance's short name, with the full form of N.D.A and I.N.D.I.A written small underneath. */
export function AllianceName({ name, className = "", block = true }: { name: string; className?: string; block?: boolean }) {
  const full = block ? allianceFull(name) : "";
  return (
    <span className={className}>
      {allianceShort(name)}
      {full ? <span className="block text-xs font-normal text-muted-foreground">{full}</span> : null}
    </span>
  );
}
