export * from "./types.js";

export { generateMap, DEFAULT_COLUMNS, DEFAULT_ROWS } from "./map.js";

export {
  STARTING_CASH,
  STORE_STARTING_STOCK,
  BASE_PRICES,
  OUTFIT_COST,
  MULE_BASE_PRICE,
  MULE_STARTING_STOCK,
  MULE_STOCK_TARGET,
  SMITHORE_PER_MULE,
  STORAGE_CAP,
  SPOILAGE_RATE,
  BASE_TURN_BUDGET,
  SHORTAGE_TURN_PENALTY,
  MIN_TURN_BUDGET,
  FOOD_CONSUMPTION_PER_PLAYER,
  priceMultiplier,
  storePricesFor,
  mulePrice,
  createStore,
  refreshStorePrices,
  playerWealth,
  computeTurnBudget,
} from "./economy.js";
export type { TradeResult, SpoilageResult } from "./economy.js";

export { BASE_YIELD, TERRAIN_MATCH_MULTIPLIER, baseYieldFor, computeRoundProduction } from "./production.js";
export type { PlayerProductionResult } from "./production.js";

export {
  createGame,
  activePlayerId,
  buyMule,
  outfitAndPlaceMule,
  sellToStore,
  buyFromStore,
  endPlayerTurn,
  claimPlot,
  currentLandGrantPlayerId,
  availablePlots,
} from "./game.js";
