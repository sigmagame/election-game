"use client";

import { useState } from "react";
import { partyColor, partyKey } from "@/lib/party-style";
import { PartyMark } from "@/components/party-mark";

/**
 * Party flag in a 3:2 frame (public/flags/<party-key>.png, 480x320). Until a flag file exists
 * it shows the party symbol on a tint of the party colour, so flags can be added in batches.
 */
export function PartyFlag({ id, className = "" }: { id: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className={`grid aspect-[3/2] w-full place-items-center rounded-lg border border-border ${className}`}
        style={{ background: `color-mix(in srgb, ${partyColor(id)} 14%, var(--muted))` }}
      >
        <PartyMark id={id} size={44} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static flag images, no optimisation needed
    <img
      src={`/flags/${partyKey(id)}.png`}
      alt={`${id} flag`}
      width={480}
      height={320}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`aspect-[3/2] w-full rounded-lg border border-border object-cover ${className}`}
    />
  );
}
