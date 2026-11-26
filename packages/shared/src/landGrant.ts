import { NEIGHBOR_OFFSETS, plotIdAt } from "./grid.js";
import type { GameState, Plot } from "./types.js";

/**
 * The real ranked-choice Land Grant draft (docs/SPEC.md §4.1), replacing
 * M1's simplified sequential claim-one-plot logic:
 *
 * 1. Each round, `landGrantOrder` is freshly randomized in game.ts's
 *    beginRound() — independent of wealth, so nobody can bank on always
 *    going first or last.
 * 2. Every player blind-submits a 1st and 2nd choice plot via
 *    submitLandGrantPicks(). In a real networked client these arrive
 *    simultaneously from separate devices; in M2's hotseat client they
 *    arrive sequentially from one shared device, but the *data model*
 *    still treats them as blind — nothing is resolved, and no pick
 *    influences another, until every player has submitted. The UI is
 *    responsible for not letting players see each other's in-progress
 *    picks (a "pass the device" cover screen).
 * 3. Once the last pick arrives, resolveLandGrant() runs automatically:
 *    Pass A grants 1st choices in priority order, Pass B grants 2nd
 *    choices (in the same order) to anyone who missed their 1st, and a
 *    fallback auto-assigns the best remaining plot to anyone who missed
 *    both — nobody is ever left waiting on a pick that can't land.
 */

export function availablePlots(state: GameState): string[] {
  return state.plots.filter((p) => p.ownerId === null && p.terrain !== "store").map((p) => p.id);
}

/** Whichever player in `landGrantOrder` hasn't submitted picks yet — purely a hotseat "whose turn to hand the device to" helper, not a priority signal. */
export function nextLandGrantSubmitter(state: GameState): string | null {
  if (state.phase !== "land-grant") return null;
  return state.landGrantOrder.find((id) => !state.landGrantPicks[id]) ?? null;
}

export function landGrantSubmittedCount(state: GameState): number {
  return Object.keys(state.landGrantPicks).length;
}

function log(state: GameState, message: string): void {
  state.log.push({ round: state.round, message });
}

function assertClaimable(state: GameState, plotId: string): Plot {
  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot) throw new Error("no such plot");
  if (plot.terrain === "store") throw new Error("cannot pick the store plot");
  if (plot.ownerId !== null) throw new Error("plot already claimed");
  return plot;
}

export function submitLandGrantPicks(
  state: GameState,
  playerId: string,
  firstChoicePlotId: string,
  secondChoicePlotId: string
): void {
  if (state.phase !== "land-grant") throw new Error("not in land-grant phase");
  if (state.landGrantPicks[playerId]) throw new Error(`${playerId} already submitted picks this round`);
  if (!state.landGrantOrder.includes(playerId)) throw new Error(`${playerId} is not in this round's land-grant order`);
  if (firstChoicePlotId === secondChoicePlotId) {
    throw new Error("1st and 2nd choice must be different plots");
  }

  assertClaimable(state, firstChoicePlotId);
  assertClaimable(state, secondChoicePlotId);

  state.landGrantPicks[playerId] = { first: firstChoicePlotId, second: secondChoicePlotId };
  const playerName = state.players.find((p) => p.id === playerId)?.name ?? playerId;
  log(
    state,
    `${playerName} locked in their Land Grant picks (${landGrantSubmittedCount(state)}/${state.landGrantOrder.length}).`
  );

  if (landGrantSubmittedCount(state) >= state.landGrantOrder.length) {
    resolveLandGrant(state);
  }
}

/** Fallback heuristic (§4.1): adjacency to the player's own existing plots, then a mild preference for the scarcer, more specialized terrains. */
function scoreFallbackPlot(state: GameState, playerId: string, plot: Plot): number {
  let score = 0;
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const neighbor = state.plots.find((p) => p.id === plotIdAt(plot.x + dx, plot.y + dy));
    if (neighbor?.ownerId === playerId) score += 2;
  }
  if (plot.terrain === "river" || plot.terrain === "mountain") score += 1;
  return score;
}

function pickBestFallbackPlot(state: GameState, playerId: string, candidates: Plot[]): Plot | null {
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  let bestScore = scoreFallbackPlot(state, playerId, best);
  for (const candidate of candidates.slice(1)) {
    const score = scoreFallbackPlot(state, playerId, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function playerName(state: GameState, playerId: string): string {
  return state.players.find((p) => p.id === playerId)?.name ?? playerId;
}

function resolveLandGrant(state: GameState): void {
  const assigned = new Set<string>();
  log(state, `All picks are in — resolving the Land Grant (priority order: ${state.landGrantOrder.map((id) => playerName(state, id)).join(", ")}).`);

  // Pass A: 1st choices, in priority order.
  for (const playerId of state.landGrantOrder) {
    const pick = state.landGrantPicks[playerId];
    if (!pick) continue;
    const plot = state.plots.find((p) => p.id === pick.first);
    if (plot && plot.ownerId === null) {
      plot.ownerId = playerId;
      assigned.add(playerId);
      log(state, `${playerName(state, playerId)} got their 1st choice: plot ${plot.id}.`);
    }
  }

  // Pass B: 2nd choices, same order, only for players Pass A missed.
  for (const playerId of state.landGrantOrder) {
    if (assigned.has(playerId)) continue;
    const pick = state.landGrantPicks[playerId];
    if (!pick) continue;
    const plot = state.plots.find((p) => p.id === pick.second);
    if (plot && plot.ownerId === null) {
      plot.ownerId = playerId;
      assigned.add(playerId);
      log(state, `${playerName(state, playerId)} missed their 1st choice but got their 2nd: plot ${plot.id}.`);
    }
  }

  // Fallback: auto-assign the best remaining plot to anyone who missed both.
  for (const playerId of state.landGrantOrder) {
    if (assigned.has(playerId)) continue;
    const candidates = state.plots.filter((p) => p.ownerId === null && p.terrain !== "store");
    const best = pickBestFallbackPlot(state, playerId, candidates);
    if (best) {
      best.ownerId = playerId;
      assigned.add(playerId);
      log(state, `${playerName(state, playerId)} missed both picks and was auto-assigned plot ${best.id}.`);
    } else {
      log(state, `${playerName(state, playerId)} missed both picks and no land remains — they get no new plot this round.`);
    }
  }

  state.landGrantPicks = {};
  state.phase = "turns";
  state.activePlayerIndex = 0;
}
