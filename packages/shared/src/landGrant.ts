import type { GameState } from "./types.js";

/**
 * M1 simplification: sequential claim-one-plot-per-player, in turn order,
 * no timer and no 1st/2nd-choice draft. The real ranked-choice land grant
 * from docs/SPEC.md §4.1 is scheduled for M2, once there's a client that
 * can run a real-time simultaneous pick window.
 */
export function availablePlots(state: GameState): string[] {
  return state.plots.filter((p) => p.ownerId === null && p.terrain !== "store").map((p) => p.id);
}

export function currentLandGrantPlayerId(state: GameState): string | null {
  if (state.phase !== "land-grant") return null;
  return state.landGrantOrder[state.landGrantIndex] ?? null;
}

export function claimPlot(state: GameState, playerId: string, plotId: string): void {
  if (state.phase !== "land-grant") throw new Error("not in land-grant phase");
  const expected = currentLandGrantPlayerId(state);
  if (expected !== playerId) throw new Error(`it is not ${playerId}'s turn to claim land`);

  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot) throw new Error("no such plot");
  if (plot.terrain === "store") throw new Error("cannot claim the store plot");
  if (plot.ownerId !== null) throw new Error("plot already claimed");

  plot.ownerId = playerId;
  state.landGrantIndex += 1;

  if (state.landGrantIndex >= state.landGrantOrder.length) {
    state.phase = "turns";
    state.activePlayerIndex = 0;
  }
}
