import { beforeEach, describe, expect, it } from "vitest";
import {
  STARTING_CASH,
  MULE_BASE_PRICE,
  OUTFIT_COST,
  MULE_STOCK_TARGET,
  activePlayerId,
  availablePlots,
  buyMule,
  createGame,
  nextLandGrantSubmitter,
  endPlayerTurn,
  outfitAndPlaceMule,
  submitLandGrantPicks,
} from "../src/index.js";
import type { GameState } from "../src/index.js";

/** Gives each player a distinct, non-overlapping pair of picks so nobody's choices are contested — exercises the happy path, not Pass B/fallback (see landGrant.test.ts for those). */
function claimAllLand(state: GameState): void {
  let offset = 0;
  while (state.phase === "land-grant") {
    const playerId = nextLandGrantSubmitter(state)!;
    const open = availablePlots(state);
    const first = open[offset]!;
    const second = open[offset + 1]!;
    submitLandGrantPicks(state, playerId, first, second);
    offset += 2;
  }
}

describe("createGame", () => {
  it("sets up starting cash, store stock, and the land-grant phase", () => {
    const state = createGame({ playerNames: ["Alice", "Bob"], difficulty: "normal", seed: 1 });
    expect(state.phase).toBe("land-grant");
    expect(state.players).toHaveLength(2);
    for (const p of state.players) {
      expect(p.cash).toBe(STARTING_CASH.normal);
    }
    expect(state.store.muleStock).toBe(12);
    expect(state.store.stock).toEqual({ food: 50, energy: 100, smithore: 100 });
  });

  it("gives Easy players more starting cash than Normal", () => {
    const easy = createGame({ playerNames: ["Alice"], difficulty: "easy", seed: 1 });
    expect(easy.players[0]!.cash).toBe(1200);
  });
});

describe("land grant (ranked-choice draft)", () => {
  it("lets each player end up with exactly one new plot per round, then advances to turns", () => {
    const state = createGame({ playerNames: ["Alice", "Bob", "Carol"], difficulty: "normal", seed: 7 });
    claimAllLand(state);
    expect(state.phase).toBe("turns");
    for (const p of state.players) {
      const owned = state.plots.filter((plot) => plot.ownerId === p.id);
      expect(owned).toHaveLength(1);
    }
  });

  it("refuses a second submission from the same player in one round", () => {
    const state = createGame({ playerNames: ["Alice", "Bob"], difficulty: "normal", seed: 3 });
    const playerId = nextLandGrantSubmitter(state)!;
    const [first, second, third] = availablePlots(state);
    submitLandGrantPicks(state, playerId, first!, second!);
    expect(() => submitLandGrantPicks(state, playerId, second!, third!)).toThrow();
  });

  it("refuses identical 1st and 2nd choices", () => {
    const state = createGame({ playerNames: ["Alice", "Bob"], difficulty: "normal", seed: 3 });
    const playerId = nextLandGrantSubmitter(state)!;
    const plotId = availablePlots(state)[0]!;
    expect(() => submitLandGrantPicks(state, playerId, plotId, plotId)).toThrow();
  });
});

describe("a full round (integration)", () => {
  let state: GameState;

  beforeEach(() => {
    state = createGame({ playerNames: ["Alice", "Bob"], difficulty: "normal", maxRounds: 1, seed: 99 });
    claimAllLand(state);
  });

  it("runs turns -> production -> trade -> scoring and ends the game at maxRounds", () => {
    for (const playerId of [...state.turnOrder]) {
      const player = state.players.find((p) => p.id === playerId)!;
      const ownPlot = state.plots.find((p) => p.ownerId === playerId)!;
      const muleId = buyMule(state, playerId);
      outfitAndPlaceMule(state, playerId, muleId, "energy", ownPlot.id);
      expect(player.cash).toBe(
        STARTING_CASH.normal - MULE_BASE_PRICE - OUTFIT_COST.energy
      );
      endPlayerTurn(state, playerId);
    }

    // Production ran automatically when the last player ended their turns-phase turn.
    expect(state.phase).toBe("trade");
    for (const p of state.players) {
      expect(p.inventory.energy).toBeGreaterThan(0);
    }

    // Nobody trades; ending both trade turns finishes the round.
    for (const playerId of [...state.turnOrder]) {
      endPlayerTurn(state, playerId);
    }

    expect(state.phase).toBe("game-over");
    expect(state.log.some((e) => e.message.includes("Game over!"))).toBe(true);
    // Two mules were bought (store 12 -> 10); the round-end restock should
    // rebuild them from the store's own Smithore stock back up to target.
    expect(state.store.muleStock).toBe(MULE_STOCK_TARGET);
    expect(state.store.stock.smithore).toBe(98);
  });

  it("rejects an action from a player who isn't currently active", () => {
    const [first, second] = state.turnOrder;
    expect(() => buyMule(state, second!)).toThrow();
    expect(activePlayerId(state)).toBe(first);
  });
});

describe("turn budget enforcement", () => {
  it("stops a player from acting past their per-round action budget", () => {
    const state = createGame({ playerNames: ["Solo"], difficulty: "easy", seed: 5 });
    claimAllLand(state);
    const playerId = state.turnOrder[0]!;

    for (let i = 0; i < 5; i++) {
      buyMule(state, playerId);
    }
    expect(() => buyMule(state, playerId)).toThrow(/no turn actions remaining/);
  });
});
