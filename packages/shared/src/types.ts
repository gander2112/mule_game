export type Resource = "food" | "energy" | "smithore";

export const RESOURCES: readonly Resource[] = ["food", "energy", "smithore"];

export type Terrain = "river" | "mountain" | "plain" | "store";

export type Difficulty = "easy" | "normal";

export type Phase =
  | "land-grant"
  | "turns"
  | "production"
  | "trade"
  | "scoring"
  | "game-over";

export interface Plot {
  id: string;
  x: number;
  y: number;
  terrain: Terrain;
  ownerId: string | null;
  muleId: string | null;
}

export interface Mule {
  id: string;
  ownerId: string;
  outfit: Resource | null;
  plotId: string | null;
}

export type Inventory = Record<Resource, number>;

export interface Player {
  id: string;
  name: string;
  cash: number;
  inventory: Inventory;
  muleIds: string[];
  turnBudget: number;
  actionsUsed: number;
}

export interface StorePrices {
  buy: number;
  sell: number;
}

export interface StoreState {
  stock: Inventory;
  startingStock: Inventory;
  mulePrice: number;
  muleStock: number;
  muleStockTarget: number;
}

export interface GameEvent {
  round: number;
  message: string;
}

export interface GameState {
  round: number;
  maxRounds: number;
  difficulty: Difficulty;
  phase: Phase;
  players: Player[];
  plots: Plot[];
  mules: Record<string, Mule>;
  store: StoreState;
  turnOrder: string[];
  activePlayerIndex: number;
  landGrantOrder: string[];
  landGrantIndex: number;
  colonyFoodShortfallLastRound: boolean;
  log: GameEvent[];
  muleSeq: number;
  seed: number;
}

export interface CreateGameOptions {
  playerNames: string[];
  difficulty: Difficulty;
  maxRounds?: number;
  seed?: number;
  columns?: number;
  rows?: number;
}
