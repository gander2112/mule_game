import { describe, expect, it } from "vitest";
import { BASE_YIELD, TERRAIN_MATCH_MULTIPLIER, baseYieldFor, computeRoundProduction } from "../src/production.js";
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
