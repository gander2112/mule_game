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
  FOOD_UPKEEP_PER_MULE,
  priceMultiplier,
  storePricesFor,
  mulePrice,
  createStore,
  refreshStorePrices,
  playerWealth,
  computeTurnBudget,
  colonyFoodRequirement,
} from "./economy.js";
export type { TradeResult, SpoilageResult } from "./economy.js";

export {
  BASE_YIELD,
  TERRAIN_MATCH_MULTIPLIER,
  MINING_RESOURCES,
  MINING_CONSUMPTION_GROWTH,
  DEVELOPED_PATCH_BONUS_PER_NEIGHBOR,
  SAME_RESOURCE_BONUS_PER_NEIGHBOR,
  SAME_RESOURCE_BLOC_KICKER,
  SAME_RESOURCE_BLOC_MIN_SIZE,
  baseYieldFor,
  miningConsumptionMultiplier,
  computeRoundProduction,
  previewPlayerProduction,
  buildAdjacencyContext,
} from "./production.js";
export type { PlayerProductionResult, ActivePlot } from "./production.js";

export {
  createGame,
  activePlayerId,
  buyMule,
  outfitAndPlaceMule,
  sellToStore,
  buyFromStore,
  endPlayerTurn,
  submitLandGrantPicks,
  nextLandGrantSubmitter,
  landGrantSubmittedCount,
  availablePlots,
} from "./game.js";
