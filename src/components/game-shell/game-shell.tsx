"use client";

import { Lock } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getStages, stageIndexForPath, type ElectionKind } from "./game-stages";
import { ThemeToggle } from "./theme-toggle";
import { useGameProgress } from "./use-game-progress";

export function GameShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  const router = useRouter();
  const onSetup = path.startsWith("/elections/setup");
  const kind: ElectionKind = path.startsWith("/elections/assembly") ? "assembly" : "lok-sabha";
  const { reachedId, partyName, hung } = useGameProgress(kind, path);
  const stages = useMemo(() => getStages(kind, hung), [kind, hung]);
  const current = stageIndexForPath(stages, path);
  const savedReach = Math.max(1, stages.findIndex((stage) => stage.id === reachedId));
  // The stage you are on is always open, so a save the shell cannot read never traps a player.
  // While a new game is being set up, only the Setup tab is open.
  const reached = onSetup ? current : Math.max(savedReach, current);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40">
        <div className="flex flex-wrap items-center gap-4 bg-[#1b2a6b] px-6 py-3 text-white">
          <div className="flex items-center gap-3">
            <span className="rounded-sm bg-brand px-2 py-0.5 text-xs font-bold tracking-wider text-brand-foreground">
              LIVE
            </span>
            <span className="font-heading text-xl font-semibold">Indian Election Simulator</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-md border border-white/30 px-3 py-1">
              {onSetup ? "New game" : kind === "lok-sabha" ? "Lok Sabha" : "State Assembly"}
            </span>
            {partyName && !onSetup ? (
              <span className="rounded-md border border-white/30 px-3 py-1">Party: {partyName}</span>
            ) : null}
            <span className="text-emerald-300">● Autosaved</span>
            <ThemeToggle />
          </div>
        </div>
        <div
          aria-hidden="true"
          className="h-1.5"
          style={{ background: "linear-gradient(90deg,#ff9933 0 33.3%,#ffffff 33.3% 66.6%,#138808 66.6% 100%)" }}
        />
        <nav aria-label="Game stages" className="overflow-x-auto border-b bg-card px-6">
          <Tabs value={stages[current].id}>
            <TabsList variant="line" className="h-auto gap-1 p-0">
              {stages.map((stage, index) => {
                const locked = index > reached;
                return (
                  <TabsTrigger
                    key={stage.id}
                    value={stage.id}
                    disabled={locked}
                    onClick={() => router.push(stage.href)}
                    className="h-12 flex-none px-4 font-heading text-[15px] data-active:text-foreground data-active:after:bg-brand"
                  >
                    <span className="text-xs opacity-60">{index + 1}</span>
                    {stage.label}
                    {locked ? <Lock aria-label="Locked" className="size-3.5" /> : null}
                    {!locked && index < reached && index !== current ? (
                      <span aria-label="Completed" className="text-xs text-success">
                        ✓
                      </span>
                    ) : null}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </nav>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
