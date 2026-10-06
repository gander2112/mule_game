import type { GameState, Plot, Resource } from "./types.js";

/** Placeholder, flagged for a balance pass like everything else in economy.ts. */
export const BASE_YIELD = 10;
export const TERRAIN_MATCH_MULTIPLIER = 2;

const IDEAL_TERRAIN: Record<Resource, Plot["terrain"]> = {
  food: "river",
  energy: "plain",
  smithore: "mountain",
};

/**
 * M1 simplification: each player's Energy is their own, produced and spent
 * within their own inventory (not a shared colony grid / adjacency-routed
 * pool). Colony-wide power sharing is deferred to the M2 adjacency pass
 * noted in docs/SPEC.md.
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

export function computeRoundProduction(state: GameState): PlayerProductionResult[] {
  const results: PlayerProductionResult[] = [];

  for (const player of state.players) {
    const rawOutput: Record<Resource, number> = { food: 0, energy: 0, smithore: 0 };

    for (const muleId of player.muleIds) {
      const mule = state.mules[muleId];
      if (!mule || !mule.outfit || !mule.plotId) continue;
      const plot = state.plots.find((p) => p.id === mule.plotId);
      if (!plot) continue;
      rawOutput[mule.outfit] += baseYieldFor(mule.outfit, plot.terrain);
    }

    const demand = rawOutput.food + rawOutput.smithore;
    const available = player.inventory.energy + rawOutput.energy;
    const energyLimited = demand > available;
    const scale = demand > 0 && energyLimited ? available / demand : 1;

    const actualOutput: Record<Resource, number> = {
      food: Math.floor(rawOutput.food * scale),
      smithore: Math.floor(rawOutput.smithore * scale),
      energy: rawOutput.energy,
    };
    const energyConsumed = Math.min(demand, available);

    player.inventory.food += actualOutput.food;
    player.inventory.smithore += actualOutput.smithore;
    player.inventory.energy = player.inventory.energy + rawOutput.energy - energyConsumed;

    results.push({
      playerId: player.id,
      rawOutput,
      actualOutput,
      energyConsumed,
      energyLimited,
    });
  }

  return results;
}
