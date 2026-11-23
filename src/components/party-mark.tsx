"use client";

import { useState } from "react";
import { partyColor, partySymbolSrc } from "@/lib/party-style";

/** Party symbol with a coloured-initials fallback if the image is missing. */
export function PartyMark({ id, size = 24, className = "" }: { id: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        aria-hidden
        className={`inline-grid shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${className}`}
        style={{ width: size, height: size, background: partyColor(id) }}
      >
        {id.slice(0, 2)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- small static symbols, no optimisation needed
  return <img src={partySymbolSrc(id)} alt="" width={size} height={size} onError={() => setFailed(true)} className={`inline-block shrink-0 object-contain ${className}`} />;
}
