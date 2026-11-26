import type { GameState, Mule, Plot, Player, Resource } from "./types.js";

/** Placeholder, flagged for a balance pass like everything else in economy.ts. */
export const BASE_YIELD = 10;
export const TERRAIN_MATCH_MULTIPLIER = 2;

/** Resources considered "mining" for the non-linear Energy consumption curve (§4.3). Will grow to include Crystite in M4. */
export const MINING_RESOURCES: readonly Resource[] = ["smithore"];

/** Each mining Mule beyond a player's first makes mining less Energy-efficient for all of that player's mining Mules. Physical consumption, not a price. */
export const MINING_CONSUMPTION_GROWTH = 0.1;

export const DEVELOPED_PATCH_BONUS_PER_NEIGHBOR = 0.05;
export const SAME_RESOURCE_BONUS_PER_NEIGHBOR = 0.1;
export const SAME_RESOURCE_BLOC_KICKER = 0.05;
export const SAME_RESOURCE_BLOC_MIN_SIZE = 3;

const IDEAL_TERRAIN: Record<Resource, Plot["terrain"]> = {
  food: "river",
  energy: "plain",
  smithore: "mountain",
};

const NEIGHBOR_OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * M1 simplification: each player's Energy is their own, produced and spent
 * within their own inventory (not a shared colony grid / adjacency-routed
 * pool). Colony-wide power sharing is deferred to a future pass noted in
 * docs/SPEC.md.
 */
export interface PlayerProductionResult {
  playerId: string;
  rawOutput: Record<Resource, number>;
  actualOutput: Record<Resource, number>;
  energyConsumed: number;
  energyLimited: boolean;
}

export function baseYieldFor(resource: Resource, terrain: Plot["terrain"]): number {
  const matches = IDEAL_TERRAIN[resource] === terrain;
  return BASE_YIELD * (matches ? TERRAIN_MATCH_MULTIPLIER : 1);
}

export interface ActivePlot {
  plot: Plot;
  mule: Mule;
  outfit: Resource;
}

function activePlots(state: GameState): Map<string, ActivePlot> {
  const byPlotId = new Map<string, ActivePlot>();
  for (const plot of state.plots) {
    if (!plot.muleId) continue;
    const mule = state.mules[plot.muleId];
    if (!mule || !mule.outfit) continue;
    byPlotId.set(plot.id, { plot, mule, outfit: mule.outfit });
  }
  return byPlotId;
}

function neighborsOf(plot: Plot, active: Map<string, ActivePlot>): ActivePlot[] {
  const neighbors: ActivePlot[] = [];
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const neighbor = active.get(`${plot.x + dx}-${plot.y + dy}`);
    if (neighbor) neighbors.push(neighbor);
  }
  return neighbors;
}

/** Connected-component size for each plot, grouping only same-resource neighbors (the specialization bloc, not the general patch). */
function computeBlocSizes(active: Map<string, ActivePlot>): Map<string, number> {
  const blocSizeByPlotId = new Map<string, number>();
  const visited = new Set<string>();

  for (const start of active.values()) {
    if (visited.has(start.plot.id)) continue;
    const component: string[] = [];
    const queue = [start];
    visited.add(start.plot.id);

    while (queue.length > 0) {
      const current = queue.pop()!;
      component.push(current.plot.id);
      for (const neighbor of neighborsOf(current.plot, active)) {
        if (neighbor.outfit !== current.outfit || visited.has(neighbor.plot.id)) continue;
        visited.add(neighbor.plot.id);
        queue.push(neighbor);
      }
    }

    for (const plotId of component) blocSizeByPlotId.set(plotId, component.length);
  }

  return blocSizeByPlotId;
}

/**
 * Two stacking effects (docs/SPEC.md §3): a flat bonus for any adjacent
 * worked plot regardless of resource (agglomeration), plus a bigger bonus
 * for same-resource neighbors with an extra kicker once that bloc hits 3+
 * tiles (specialization). Returns a multiplier, e.g. 1.35 for +35%.
 */
export function adjacencyMultiplier(plot: Plot, active: Map<string, ActivePlot>, blocSizes: Map<string, number>): number {
  const neighbors = neighborsOf(plot, active);
  const self = active.get(plot.id);
  if (!self) return 1;

  const patchNeighbors = neighbors.length;
  const sameResourceNeighbors = neighbors.filter((n) => n.outfit === self.outfit).length;
  const blocSize = blocSizes.get(plot.id) ?? 1;
  const blocKicker = blocSize >= SAME_RESOURCE_BLOC_MIN_SIZE ? SAME_RESOURCE_BLOC_KICKER : 0;

  return (
    1 +
    patchNeighbors * DEVELOPED_PATCH_BONUS_PER_NEIGHBOR +
    sameResourceNeighbors * SAME_RESOURCE_BONUS_PER_NEIGHBOR +
    blocKicker
  );
}

/** Mining's per-unit Energy consumption rises with a player's own mining Mule count (§4.3) — a physical consumption curve, not a price. */
export function miningConsumptionMultiplier(miningMuleCount: number): number {
  if (miningMuleCount <= 1) return 1;
  return 1 + MINING_CONSUMPTION_GROWTH * (miningMuleCount - 1);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure, side-effect-free: computes what production *would* yield for one
 * player given the current board, without touching their inventory. This
 * is what both `computeRoundProduction` (which applies the result) and a
 * client-side "what will this round produce?" preview (e.g. a turn-budget
 * Food/Energy indicator) should call — single source of truth either way.
 */
export function previewPlayerProduction(
  state: GameState,
  player: Player,
  active: Map<string, ActivePlot>,
  blocSizes: Map<string, number>
): PlayerProductionResult {
  const rawOutput: Record<Resource, number> = { food: 0, energy: 0, smithore: 0 };
  let miningMuleCount = 0;

  for (const muleId of player.muleIds) {
    const mule = state.mules[muleId];
    if (!mule || !mule.outfit || !mule.plotId) continue;
    const plot = state.plots.find((p) => p.id === mule.plotId);
    if (!plot) continue;

    if (MINING_RESOURCES.includes(mule.outfit)) miningMuleCount += 1;

    const multiplier = adjacencyMultiplier(plot, active, blocSizes);
    rawOutput[mule.outfit] += Math.floor(baseYieldFor(mule.outfit, plot.terrain) * multiplier);
  }

  const miningMultiplier = miningConsumptionMultiplier(miningMuleCount);
  const demand = round2(rawOutput.food + rawOutput.smithore * miningMultiplier);
  const available = player.inventory.energy + rawOutput.energy;
  const energyLimited = demand > available;
  const scale = demand > 0 && energyLimited ? available / demand : 1;

  const actualOutput: Record<Resource, number> = {
    food: Math.floor(rawOutput.food * scale),
    smithore: Math.floor(rawOutput.smithore * scale),
    energy: rawOutput.energy,
  };
  const energyConsumed = round2(Math.min(demand, available));

  return {
    playerId: player.id,
    rawOutput,
    actualOutput,
    energyConsumed,
    energyLimited,
  };
}

/** Builds the shared adjacency context once per round/preview so repeated calls don't recompute it per player. */
export function buildAdjacencyContext(state: GameState): { active: Map<string, ActivePlot>; blocSizes: Map<string, number> } {
  const active = activePlots(state);
  const blocSizes = computeBlocSizes(active);
  return { active, blocSizes };
}

export function computeRoundProduction(state: GameState): PlayerProductionResult[] {
  const results: PlayerProductionResult[] = [];
  const { active, blocSizes } = buildAdjacencyContext(state);

  for (const player of state.players) {
    const result = previewPlayerProduction(state, player, active, blocSizes);

    player.inventory.food += result.actualOutput.food;
    player.inventory.smithore += result.actualOutput.smithore;
    player.inventory.energy = round2(player.inventory.energy + result.rawOutput.energy - result.energyConsumed);

    results.push(result);
  }

  return results;
}
