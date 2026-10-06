import { describe, expect, it } from "vitest";
import {
  BASE_PRICES,
  STORAGE_CAP,
  SPOILAGE_RATE,
  MULE_BASE_PRICE,
  MULE_STOCK_TARGET,
  SMITHORE_PER_MULE,
  applySpoilage,
  buyFromStore,
  computeTurnBudget,
  createStore,
  mulePrice,
  priceMultiplier,
  restockMules,
  sellToStore,
  storePricesFor,
  buyMule,
} from "../src/economy.js";
import type { Player, StoreState } from "../src/types.js";

function freshPlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1",
    name: "Alice",
    cash: 1000,
    inventory: { food: 0, energy: 0, smithore: 0 },
    muleIds: [],
    turnBudget: 5,
    actionsUsed: 0,
    ...overrides,
  };
}

describe("priceMultiplier", () => {
  it("is 1 when stock equals starting stock", () => {
    expect(priceMultiplier(100, 100)).toBe(1);
  });

  it("rises as stock drops below starting stock", () => {
    expect(priceMultiplier(50, 100)).toBe(2);
    expect(priceMultiplier(25, 100)).toBeCloseTo(2.5); // clamped to MAX
  });

  it("falls as stock rises above starting stock, clamped at the floor", () => {
    expect(priceMultiplier(200, 100)).toBe(0.5);
    expect(priceMultiplier(1000, 100)).toBe(0.5);
  });

  it("returns the out-of-stock multiplier when stock hits zero", () => {
    expect(priceMultiplier(0, 100)).toBe(3);
  });
});

describe("storePricesFor", () => {
  it("prices sell above buy (the store's spread) at any stock level", () => {
    const store = createStore();
    const { buy, sell } = storePricesFor(store, "food");
    expect(sell).toBeGreaterThan(buy);
    expect(buy).toBeCloseTo(BASE_PRICES.food * 0.9, 5);
    expect(sell).toBeCloseTo(BASE_PRICES.food * 1.1, 5);
  });

  it("gets more expensive, both ways, as stock depletes", () => {
    const store = createStore();
    const before = storePricesFor(store, "smithore");
    store.stock.smithore = 10; // well below starting stock of 100
    const after = storePricesFor(store, "smithore");
    expect(after.buy).toBeGreaterThan(before.buy);
    expect(after.sell).toBeGreaterThan(before.sell);
  });
});

describe("mulePrice", () => {
  it("equals the base price when Smithore stock is at its starting level", () => {
    const store = createStore();
    expect(mulePrice(store)).toBe(MULE_BASE_PRICE);
  });

  it("rises when the store's Smithore stock is hoarded down", () => {
    const store = createStore();
    store.stock.smithore = 10;
    expect(mulePrice(store)).toBeGreaterThan(MULE_BASE_PRICE);
  });

  it("falls when Smithore is plentiful", () => {
    const store = createStore();
    store.stock.smithore = 400;
    expect(mulePrice(store)).toBeLessThan(MULE_BASE_PRICE);
  });
});

describe("applySpoilage", () => {
  it("leaves stockpiles at or under the cap untouched", () => {
    const player = freshPlayer({ inventory: { food: STORAGE_CAP, energy: 5, smithore: 0 } });
    const result = applySpoilage(player);
    expect(result).toEqual([]);
    expect(player.inventory.food).toBe(STORAGE_CAP);
  });

  it("spoils a fraction of the excess above the cap", () => {
    const excess = 40;
    const player = freshPlayer({ inventory: { food: STORAGE_CAP + excess, energy: 0, smithore: 0 } });
    const result = applySpoilage(player);
    const expectedLoss = Math.floor(excess * SPOILAGE_RATE);
    expect(result).toEqual([{ resource: "food", lost: expectedLoss }]);
    expect(player.inventory.food).toBe(STORAGE_CAP + excess - expectedLoss);
  });

  it("applies independently per resource, Crystite-style uniformity across all three M1 resources", () => {
    const player = freshPlayer({
      inventory: { food: STORAGE_CAP + 4, energy: STORAGE_CAP + 20, smithore: STORAGE_CAP },
    });
    const result = applySpoilage(player);
    const resources = result.map((r) => r.resource).sort();
    expect(resources).toEqual(["energy", "food"]);
  });
});

describe("restockMules", () => {
  it("manufactures mules by consuming Smithore 1-for-1 until the target stock is hit", () => {
    const store = createStore();
    store.muleStock = MULE_STOCK_TARGET - 3;
    const startingSmithore = store.stock.smithore;
    const built = restockMules(store);
    expect(built).toBe(3);
    expect(store.muleStock).toBe(MULE_STOCK_TARGET);
    expect(store.stock.smithore).toBe(startingSmithore - 3 * SMITHORE_PER_MULE);
  });

  it("stops restocking once the store runs out of Smithore, even below target", () => {
    const store = createStore();
    store.muleStock = 0;
    store.stock.smithore = 2;
    const built = restockMules(store);
    expect(built).toBe(2);
    expect(store.muleStock).toBe(2);
    expect(store.stock.smithore).toBe(0);
  });
});

describe("store trading", () => {
  it("sellToStore pays the buy price and increases store stock", () => {
    const store = createStore();
    const player = freshPlayer({ inventory: { food: 10, energy: 0, smithore: 0 } });
    const { buy } = storePricesFor(store, "food");
    const result = sellToStore(store, player, "food", 10);
    expect(result.unitPrice).toBe(buy);
    expect(player.inventory.food).toBe(0);
    expect(player.cash).toBeCloseTo(1000 + buy * 10, 5);
    expect(store.stock.food).toBe(60);
  });

  it("buyFromStore charges the sell price and decreases store stock", () => {
    const store = createStore();
    const player = freshPlayer();
    const { sell } = storePricesFor(store, "energy");
    buyFromStore(store, player, "energy", 5);
    expect(player.inventory.energy).toBe(5);
    expect(player.cash).toBeCloseTo(1000 - sell * 5, 5);
    expect(store.stock.energy).toBe(95);
  });

  it("refuses to sell more than the player holds", () => {
    const store = createStore();
    const player = freshPlayer({ inventory: { food: 1, energy: 0, smithore: 0 } });
    expect(() => sellToStore(store, player, "food", 5)).toThrow();
  });

  it("refuses to buy more than the store has in stock", () => {
    const store = createStore();
    store.stock.food = 2;
    const player = freshPlayer({ cash: 100000 });
    expect(() => buyFromStore(store, player, "food", 5)).toThrow();
  });

  it("buyMule charges the current floating Mule price and decrements Mule stock", () => {
    const store = createStore();
    const player = freshPlayer();
    const price = buyMule(store, player);
    expect(price).toBe(MULE_BASE_PRICE);
    expect(player.cash).toBe(1000 - MULE_BASE_PRICE);
    expect(store.muleStock).toBe(11);
  });

  it("refuses to buy a Mule when the store has none in stock", () => {
    const store: StoreState = { ...createStore(), muleStock: 0 };
    const player = freshPlayer();
    expect(() => buyMule(store, player)).toThrow();
  });
});

describe("computeTurnBudget", () => {
  it("gives the full budget with no shortage", () => {
    expect(computeTurnBudget(false)).toBe(5);
  });

  it("reduces the budget after a colony food shortage, never below the floor", () => {
    expect(computeTurnBudget(true)).toBe(3);
  });
});
