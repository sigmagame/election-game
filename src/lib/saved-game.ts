import { getStages } from "@/components/game-shell/game-stages";
import { readGameProgress } from "@/components/game-shell/use-game-progress";
import { runningGames, type GameKind } from "@/lib/game-progress";

export interface SavedGame {
  kind: GameKind;
  /** Page of the last stage the saved game reached. */
  href: string;
  /** Short text such as "Lok Sabha · Campaign". */
  label: string;
}

const KIND_LABEL: Record<GameKind, string> = { "lok-sabha": "Lok Sabha", assembly: "State Assembly" };

/**
 * The game to continue from the home page, or null when there is none.
 * With one running game of each type, the one that has got furthest wins.
 * Browser only: it reads localStorage.
 */
export function findSavedGame(): SavedGame | null {
  let best: (SavedGame & { rank: number }) | null = null;
  for (const kind of runningGames()) {
    const progress = readGameProgress(kind);
    const stages = getStages(kind, progress.hung);
    // A running game has always started its campaign, so Setup is never the place to resume.
    const reachedId = progress.reachedId === "setup" ? "campaign" : progress.reachedId;
    const rank = Math.max(0, stages.findIndex((item) => item.id === reachedId));
    const stage = stages[rank];
    if (!best || rank > best.rank) {
      best = { kind, href: stage.href, label: `${KIND_LABEL[kind]} · ${stage.label}`, rank };
    }
  }
  return best ? { kind: best.kind, href: best.href, label: best.label } : null;
}
