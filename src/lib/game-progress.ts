/**
 * A game counts as finished once its cabinet list has been shown. Finished games are not
 * offered as "running" any more, so starting a new game does not ask to continue them.
 */
export type GameKind = "lok-sabha" | "assembly";
const key = (kind: GameKind) => `indian-election-game-${kind}-completed`;

export function markGameComplete(kind: GameKind, gameId: string) {
  try {
    localStorage.setItem(key(kind), gameId);
  } catch {
    /* storage unavailable */
  }
}

export function isGameComplete(kind: GameKind, gameId: string | undefined) {
  try {
    return Boolean(gameId) && localStorage.getItem(key(kind)) === gameId;
  } catch {
    return false;
  }
}

export function clearGameComplete(kind: GameKind) {
  try {
    localStorage.removeItem(key(kind));
  } catch {
    /* storage unavailable */
  }
}

/** Every save a running game writes, per election type. */
export const GAME_KEYS: Record<GameKind, { started: string; all: string[] }> = {
  "lok-sabha": {
    started: "indian-election-game-lok-sabha-campaign-save",
    all: [
      "indian-election-game-lok-sabha-save",
      "indian-election-game-lok-sabha-campaign-save",
      "indian-election-game-lok-sabha-voting-save",
      "indian-election-game-lok-sabha-negotiation-save",
      "indian-election-game-lok-sabha-cabinet-save",
    ],
  },
  assembly: {
    // An Assembly game is only saved when the campaign starts, so its existence means the game is under way.
    started: "indian-election-simulator:assembly-game",
    all: [
      "indian-election-simulator:assembly-game",
      "indian-election-simulator:assembly-campaign",
      "indian-election-simulator:assembly-voting",
      "indian-election-simulator:assembly-negotiation",
      "indian-election-simulator:assembly-cabinet",
    ],
  },
};

/** Removes every save of one election type, so the next game starts clean. */
export function deleteGameData(kind: GameKind) {
  try {
    for (const k of GAME_KEYS[kind].all) localStorage.removeItem(k);
    if (kind === "assembly") sessionStorage.removeItem("assemblyGameSetup");
  } catch {
    /* storage unavailable */
  }
  clearGameComplete(kind);
}
