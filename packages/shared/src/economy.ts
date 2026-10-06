import type { Inventory, Player, Resource, StoreState } from "./types.js";
import { RESOURCES } from "./types.js";

/**
 * All numbers in this file are M1 placeholders explicitly called out in
 * docs/SPEC.md as needing a real balance pass once the game is playable.
 * They exist to make the economy loop (buy/sell/spoil/restock) internally
 * consistent and testable, not to be the final tuning.
 */

export const STARTING_CASH: Record<"easy" | "normal", number> = {
  easy: 1200,
  normal: 1000,
};

export const STORE_STARTING_STOCK: Inventory = {
  food: 50,
  energy: 100,
  smithore: 100,
};

export const BASE_PRICES: Record<Resource, number> = {
  food: 3,
  energy: 2,
  smithore: 5,
};

export const OUTFIT_COST: Record<Resource, number> = {
  food: 25,
  energy: 50,
  smithore: 100,
};

export const MULE_BASE_PRICE = 125;
export const MULE_STARTING_STOCK = 12;
export const MULE_STOCK_TARGET = 12;
export const SMITHORE_PER_MULE = 1;

export const STORAGE_CAP = 20;
export const SPOILAGE_RATE = 0.25;

export const BASE_TURN_BUDGET = 5;
export const SHORTAGE_TURN_PENALTY = 2;
export const MIN_TURN_BUDGET = 1;

export const FOOD_CONSUMPTION_PER_PLAYER = 5;

const MIN_PRICE_MULTIPLIER = 0.5;
const MAX_PRICE_MULTIPLIER = 2.5;
const OUT_OF_STOCK_MULTIPLIER = 3;

/**
 * Store prices float with the store's own stock, same principle used for
 * every floating price in the economy (resources and Mules alike): low
 * stock -> scarce -> expensive; high stock -> plentiful -> cheap.
 */
export function priceMultiplier(stock: number, startingStock: number): number {
  if (stock <= 0) return OUT_OF_STOCK_MULTIPLIER;
  const raw = startingStock / stock;
  return Math.min(MAX_PRICE_MULTIPLIER, Math.max(MIN_PRICE_MULTIPLIER, raw));
}

export function storePricesFor(store: StoreState, resource: Resource): { buy: number; sell: number } {
  const multiplier = priceMultiplier(store.stock[resource], store.startingStock[resource]);
  const base = BASE_PRICES[resource] * multiplier;
  return {
    sell: round2(base * 1.1),
    buy: round2(base * 0.9),
  };
}

export function mulePrice(store: StoreState): number {
  const multiplier = priceMultiplier(store.stock.smithore, store.startingStock.smithore);
  return Math.round((MULE_BASE_PRICE * multiplier) / 5) * 5;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function createStore(): StoreState {
  return {
    stock: { ...STORE_STARTING_STOCK },
    startingStock: { ...STORE_STARTING_STOCK },
    mulePrice: MULE_BASE_PRICE,
    muleStock: MULE_STARTING_STOCK,
    muleStockTarget: MULE_STOCK_TARGET,
  };
}

export function refreshStorePrices(store: StoreState): void {
  store.mulePrice = mulePrice(store);
}

/** Store manufactures new Mules by consuming its own Smithore stock. */
export function restockMules(store: StoreState): number {
  let built = 0;
  while (store.muleStock < store.muleStockTarget && store.stock.smithore >= SMITHORE_PER_MULE) {
    store.stock.smithore -= SMITHORE_PER_MULE;
    store.muleStock += 1;
    built += 1;
  }
  refreshStorePrices(store);
  return built;
}

export interface TradeResult {
  cashDelta: number;
  inventoryDelta: number;
  unitPrice: number;
}

export function sellToStore(store: StoreState, player: Player, resource: Resource, amount: number): TradeResult {
  if (amount <= 0) throw new Error("amount must be positive");
  if (player.inventory[resource] < amount) throw new Error(`insufficient ${resource} to sell`);
  const { buy } = storePricesFor(store, resource);
  const proceeds = round2(buy * amount);
  player.inventory[resource] -= amount;
  player.cash += proceeds;
  store.stock[resource] += amount;
  refreshStorePrices(store);
  return { cashDelta: proceeds, inventoryDelta: -amount, unitPrice: buy };
}

export function buyFromStore(store: StoreState, player: Player, resource: Resource, amount: number): TradeResult {
  if (amount <= 0) throw new Error("amount must be positive");
  if (store.stock[resource] < amount) throw new Error(`store is out of ${resource}`);
  const { sell } = storePricesFor(store, resource);
  const cost = round2(sell * amount);
  if (player.cash < cost) throw new Error("insufficient cash");
  player.cash -= cost;
  player.inventory[resource] += amount;
  store.stock[resource] -= amount;
  refreshStorePrices(store);
  return { cashDelta: -cost, inventoryDelta: amount, unitPrice: sell };
}

export function buyMule(store: StoreState, player: Player): number {
  if (store.muleStock <= 0) throw new Error("store has no mules in stock");
  const price = store.mulePrice;
  if (player.cash < price) throw new Error("insufficient cash");
  player.cash -= price;
  store.muleStock -= 1;
  return price;
}

export interface SpoilageResult {
  resource: Resource;
  lost: number;
}

/** Excess inventory above the free storage cap partially spoils at round end. */
export function applySpoilage(player: Player): SpoilageResult[] {
  const results: SpoilageResult[] = [];
  for (const resource of RESOURCES) {
    const amount = player.inventory[resource];
    const excess = amount - STORAGE_CAP;
    if (excess > 0) {
      const lost = Math.floor(excess * SPOILAGE_RATE);
      if (lost > 0) {
        player.inventory[resource] -= lost;
        results.push({ resource, lost });
      }
    }
  }
  return results;
}

export function computeTurnBudget(colonyFoodShortfallLastRound: boolean): number {
  const budget = colonyFoodShortfallLastRound
    ? BASE_TURN_BUDGET - SHORTAGE_TURN_PENALTY
    : BASE_TURN_BUDGET;
  return Math.max(MIN_TURN_BUDGET, budget);
}

export function playerWealth(player: Player, store: StoreState): number {
  let value = player.cash;
  for (const resource of RESOURCES) {
    value += storePricesFor(store, resource).buy * player.inventory[resource];
  }
  value += player.muleIds.length * store.mulePrice;
  return round2(value);
}
