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
    <div className="flex min-h-screen flex-col text-foreground">
      <header className="sticky top-0 z-40 pt-3">
        <div className="mx-auto max-w-[1280px] px-6">
        <div className="glass-nav overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- small static brand icon */}
              <img src="/brand-icon.svg" alt="" width={36} height={36} className="size-9 rounded-[10px]" />
              <div className="flex flex-col leading-tight">
                <span className="font-heading text-base font-semibold sm:text-lg">Indian Election Simulator</span>
                <span className="text-xs text-muted-foreground">
                  {onSetup ? "New game" : kind === "lok-sabha" ? "Lok Sabha" : "State Assembly"}
                  {partyName && !onSetup ? ` · ${partyName}` : ""}
                </span>
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
              <span className="flex items-center gap-1.5 text-success">
                <span aria-hidden="true" className="size-2 rounded-full bg-success" /> Autosaved
              </span>
              <ThemeToggle />
            </div>
          </div>
          <div
            aria-hidden="true"
            className="h-1"
            style={{ background: "linear-gradient(90deg,#ff9933 0 33.3%,#ffffff 33.3% 66.6%,#138808 66.6% 100%)" }}
          />
          <nav aria-label="Game stages" className="px-2 py-1.5 sm:px-3">
            <Tabs value={stages[current].id}>
              <TabsList variant="line" className="h-auto w-full flex-wrap gap-1 p-0 group-data-horizontal/tabs:h-auto">
                {stages.map((stage, index) => {
                  const locked = index > reached;
                  return (
                    <TabsTrigger
                      key={stage.id}
                      value={stage.id}
                      disabled={locked}
                      onClick={() => router.push(stage.href)}
                      className="h-11 min-w-0 flex-1 basis-auto justify-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-transparent px-2 font-heading text-[14px] after:hidden focus-visible:outline-none disabled:opacity-100 disabled:text-foreground/45 data-active:border-brand data-active:bg-brand/10 data-active:text-foreground dark:group-data-[variant=line]/tabs-list:data-active:border-brand dark:group-data-[variant=line]/tabs-list:data-active:bg-brand/15"
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
        </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
