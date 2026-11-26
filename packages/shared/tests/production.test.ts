import { describe, expect, it } from "vitest";
import {
  BASE_YIELD,
  TERRAIN_MATCH_MULTIPLIER,
  DEVELOPED_PATCH_BONUS_PER_NEIGHBOR,
  SAME_RESOURCE_BONUS_PER_NEIGHBOR,
  SAME_RESOURCE_BLOC_KICKER,
  baseYieldFor,
  computeRoundProduction,
  miningConsumptionMultiplier,
} from "../src/production.js";
import type { GameState, Mule, Plot, Player } from "../src/types.js";

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: id,
    cash: 1000,
    inventory: { food: 0, energy: 0, smithore: 0 },
    muleIds: [],
    turnBudget: 5,
    actionsUsed: 0,
    ...overrides,
  };
}

function plot(id: string, terrain: Plot["terrain"]): Plot {
  return { id, x: 0, y: 0, terrain, ownerId: "p1", muleId: null };
}

/** Adjacency depends on real x/y grid coordinates (and the "x-y" id convention map.ts uses) unlike the flat `plot()` helper above. */
function plotAt(x: number, y: number, terrain: Plot["terrain"], ownerId = "p1"): Plot {
  return { id: `${x}-${y}`, x, y, terrain, ownerId, muleId: null };
}

function mule(id: string, ownerId: string, outfit: Mule["outfit"], plotId: string | null): Mule {
  return { id, ownerId, outfit, plotId };
}

function stateWith(players: Player[], plots: Plot[], mules: Record<string, Mule>): GameState {
  return {
    round: 1,
    maxRounds: 12,
    difficulty: "normal",
    phase: "production",
    players,
    plots,
    mules,
    store: {} as GameState["store"],
    turnOrder: players.map((p) => p.id),
    activePlayerIndex: 0,
    landGrantOrder: [],
    landGrantIndex: 0,
    colonyFoodShortfallLastRound: false,
    log: [],
    muleSeq: 0,
    seed: 1,
  };
}

describe("baseYieldFor", () => {
  it("doubles on the resource's ideal terrain", () => {
    expect(baseYieldFor("food", "river")).toBe(BASE_YIELD * TERRAIN_MATCH_MULTIPLIER);
    expect(baseYieldFor("energy", "plain")).toBe(BASE_YIELD * TERRAIN_MATCH_MULTIPLIER);
    expect(baseYieldFor("smithore", "mountain")).toBe(BASE_YIELD * TERRAIN_MATCH_MULTIPLIER);
  });

  it("produces at the unmultiplied base rate off-terrain", () => {
    expect(baseYieldFor("food", "mountain")).toBe(BASE_YIELD);
    expect(baseYieldFor("smithore", "river")).toBe(BASE_YIELD);
  });
});

describe("computeRoundProduction", () => {
  it("produces energy freely and adds it straight to inventory", () => {
    const p1 = player("p1", { muleIds: ["m1"] });
    const plots = [plot("plain-1", "plain")];
    const mules = { m1: mule("m1", "p1", "energy", "plain-1") };
    const state = stateWith([p1], plots, mules);

    const [result] = computeRoundProduction(state);
    expect(result!.rawOutput.energy).toBe(BASE_YIELD * TERRAIN_MATCH_MULTIPLIER);
    expect(result!.energyLimited).toBe(false);
    expect(p1.inventory.energy).toBe(BASE_YIELD * TERRAIN_MATCH_MULTIPLIER);
  });

  it("caps Food/Smithore output to available Energy and reports the shortfall", () => {
    const p1 = player("p1", { muleIds: ["m1"] });
    const plots = [plot("river-1", "river")];
    // A Food mule with no Energy mule and no stored Energy: raw demand is 20, available is 0.
    const mules = { m1: mule("m1", "p1", "food", "river-1") };
    const state = stateWith([p1], plots, mules);

    const [result] = computeRoundProduction(state);
    expect(result!.rawOutput.food).toBe(20);
    expect(result!.energyLimited).toBe(true);
    expect(result!.actualOutput.food).toBe(0);
    expect(p1.inventory.food).toBe(0);
  });

  it("scales Food/Smithore proportionally when Energy only partially covers demand", () => {
    const p1 = player("p1", { inventory: { food: 0, energy: 10, smithore: 0 }, muleIds: ["m1", "m2"] });
    // Food mule on river (raw 20) and Smithore mule on mountain (raw 20) -> demand 40, available 10.
    const plots = [plot("river-1", "river"), plot("mountain-1", "mountain")];
    plots[1]!.ownerId = "p1";
    const mules = {
      m1: mule("m1", "p1", "food", "river-1"),
      m2: mule("m2", "p1", "smithore", "mountain-1"),
    };
    const state = stateWith([p1], plots, mules);

    const [result] = computeRoundProduction(state);
    // scale = 10/40 = 0.25 -> 20*0.25 = 5 each
    expect(result!.actualOutput.food).toBe(5);
    expect(result!.actualOutput.smithore).toBe(5);
    expect(p1.inventory.energy).toBe(0);
  });

  it("lets stored Energy from a prior round carry over to cover this round's demand", () => {
    const p1 = player("p1", { inventory: { food: 0, energy: 20, smithore: 0 }, muleIds: ["m1"] });
    const plots = [plot("river-1", "river")];
    const mules = { m1: mule("m1", "p1", "food", "river-1") };
    const state = stateWith([p1], plots, mules);

    const [result] = computeRoundProduction(state);
    expect(result!.energyLimited).toBe(false);
    expect(result!.actualOutput.food).toBe(20);
    expect(p1.inventory.energy).toBe(0);
  });

  it("ignores mules that are unowned-plot, unoutfitted, or unplaced", () => {
    const p1 = player("p1", { muleIds: ["m1"] });
    const plots = [plot("plain-1", "plain")];
    const mules = { m1: mule("m1", "p1", null, null) };
    const state = stateWith([p1], plots, mules);

    const [result] = computeRoundProduction(state);
    expect(result!.rawOutput).toEqual({ food: 0, energy: 0, smithore: 0 });
  });
});

describe("miningConsumptionMultiplier", () => {
  it("is 1 for a single mining Mule (no penalty)", () => {
    expect(miningConsumptionMultiplier(0)).toBe(1);
    expect(miningConsumptionMultiplier(1)).toBe(1);
  });

  it("rises by 10% per additional mining Mule, compounding on the count not the output", () => {
    expect(miningConsumptionMultiplier(2)).toBeCloseTo(1.1);
    expect(miningConsumptionMultiplier(3)).toBeCloseTo(1.2);
    expect(miningConsumptionMultiplier(4)).toBeCloseTo(1.3);
  });
});

describe("computeRoundProduction — mining Energy consumption", () => {
  it("charges extra Energy per unit once a player runs more than one mining Mule", () => {
    // 2 Smithore mules on mountain (raw 20 each = 40 total). Multiplier at
    // count=2 is 1.1, so demand is 44, not a naive 40.
    const p1 = player("p1", { inventory: { food: 0, energy: 44, smithore: 0 }, muleIds: ["m1", "m2"] });
    const plots = [plot("mountain-1", "mountain"), plot("mountain-2", "mountain")];
    const mules = {
      m1: mule("m1", "p1", "smithore", "mountain-1"),
      m2: mule("m2", "p1", "smithore", "mountain-2"),
    };
    const state = stateWith([p1], plots, mules);

    const [result] = computeRoundProduction(state);
    expect(result!.rawOutput.smithore).toBe(40);
    expect(result!.energyLimited).toBe(false);
    expect(result!.actualOutput.smithore).toBe(40);
    expect(p1.inventory.energy).toBe(0);
  });

  it("is energy-limited at exactly the naive (unscaled) demand once mining has scaled up", () => {
    // Same 2-mule setup, but only 40 Energy on hand — enough for the naive
    // linear demand, not enough for the real (scaled) 44 demand.
    const p1 = player("p1", { inventory: { food: 0, energy: 40, smithore: 0 }, muleIds: ["m1", "m2"] });
    const plots = [plot("mountain-1", "mountain"), plot("mountain-2", "mountain")];
    const mules = {
      m1: mule("m1", "p1", "smithore", "mountain-1"),
      m2: mule("m2", "p1", "smithore", "mountain-2"),
    };
    const state = stateWith([p1], plots, mules);

    const [result] = computeRoundProduction(state);
    expect(result!.energyLimited).toBe(true);
    // scale = 40/44 -> floor(40 * 40/44) = 36
    expect(result!.actualOutput.smithore).toBe(36);
  });
});

describe("computeRoundProduction — adjacency", () => {
  it("applies no bonus to an isolated Mule", () => {
    const p1 = player("p1", { muleIds: ["m1"] });
    const plots = [plotAt(5, 5, "river")];
    plots[0]!.muleId = "m1";
    const mules = { m1: mule("m1", "p1", "food", "5-5") };
    const state = stateWith([p1], plots, mules);

    const [result] = computeRoundProduction(state);
    expect(result!.rawOutput.food).toBe(20); // river match, no adjacency bonus
  });

  it("gives the developed-patch bonus to adjacent plots even with different resources", () => {
    const p1 = player("p1", { inventory: { energy: 100, food: 0, smithore: 0 }, muleIds: ["m1", "m2"] });
    const plots = [plotAt(0, 0, "river"), plotAt(1, 0, "plain")];
    plots[0]!.muleId = "m1";
    plots[1]!.muleId = "m2";
    const mules = {
      m1: mule("m1", "p1", "food", "0-0"),
      m2: mule("m2", "p1", "energy", "1-0"),
    };
    const state = stateWith([p1], plots, mules);

    const [result] = computeRoundProduction(state);
    // Food mule on river: base 20 * (1 + 1*patchBonus), no same-resource neighbor.
    const expectedMultiplier = 1 + DEVELOPED_PATCH_BONUS_PER_NEIGHBOR;
    expect(result!.rawOutput.food).toBe(Math.floor(20 * expectedMultiplier));
  });

  it("stacks the same-resource bloc bonus on top of the patch bonus for matching neighbors", () => {
    const p1 = player("p1", { muleIds: ["m1", "m2"] });
    const plots = [plotAt(0, 0, "river"), plotAt(1, 0, "river")];
    plots[0]!.muleId = "m1";
    plots[1]!.muleId = "m2";
    const mules = {
      m1: mule("m1", "p1", "food", "0-0"),
      m2: mule("m2", "p1", "food", "1-0"),
    };
    const state = stateWith([p1], plots, mules);

    const [result] = computeRoundProduction(state);
    // Each plot: 1 patch neighbor + 1 same-resource neighbor, bloc size 2 (no 3+ kicker).
    const multiplier = 1 + DEVELOPED_PATCH_BONUS_PER_NEIGHBOR + SAME_RESOURCE_BONUS_PER_NEIGHBOR;
    expect(result!.rawOutput.food).toBe(2 * Math.floor(20 * multiplier));
  });

  it("adds the bloc kicker once a same-resource cluster reaches 3 tiles", () => {
    const p1 = player("p1", { muleIds: ["m1", "m2", "m3"] });
    const plots = [plotAt(0, 0, "river"), plotAt(1, 0, "river"), plotAt(2, 0, "river")];
    for (const p of plots) p.muleId = `m${p.x + 1}`;
    const mules = {
      m1: mule("m1", "p1", "food", "0-0"),
      m2: mule("m2", "p1", "food", "1-0"),
      m3: mule("m3", "p1", "food", "2-0"),
    };
    const state = stateWith([p1], plots, mules);

    const [result] = computeRoundProduction(state);
    // Middle plot (2 same-resource neighbors) + end plots (1 neighbor each), all bloc size 3.
    const middleMultiplier =
      1 + 2 * DEVELOPED_PATCH_BONUS_PER_NEIGHBOR + 2 * SAME_RESOURCE_BONUS_PER_NEIGHBOR + SAME_RESOURCE_BLOC_KICKER;
    const endMultiplier =
      1 + DEVELOPED_PATCH_BONUS_PER_NEIGHBOR + SAME_RESOURCE_BONUS_PER_NEIGHBOR + SAME_RESOURCE_BLOC_KICKER;
    const expected = Math.floor(20 * endMultiplier) * 2 + Math.floor(20 * middleMultiplier);
    expect(result!.rawOutput.food).toBe(expected);
  });

  it("applies across different players' adjacent plots, not just within one player's own cluster", () => {
    const p1 = player("p1", { muleIds: ["m1"] });
    const p2 = player("p2", { muleIds: ["m2"] });
    const plots = [plotAt(0, 0, "river", "p1"), plotAt(1, 0, "river", "p2")];
    plots[0]!.muleId = "m1";
    plots[1]!.muleId = "m2";
    const mules = {
      m1: mule("m1", "p1", "food", "0-0"),
      m2: mule("m2", "p2", "food", "1-0"),
    };
    const state = stateWith([p1, p2], plots, mules);

    const [p1Result, p2Result] = computeRoundProduction(state);
    const multiplier = 1 + DEVELOPED_PATCH_BONUS_PER_NEIGHBOR + SAME_RESOURCE_BONUS_PER_NEIGHBOR;
    expect(p1Result!.rawOutput.food).toBe(Math.floor(20 * multiplier));
    expect(p2Result!.rawOutput.food).toBe(Math.floor(20 * multiplier));
  });
});
