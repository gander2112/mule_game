import { generateMap, DEFAULT_COLUMNS, DEFAULT_ROWS } from "./map.js";
import { mulberry32, shuffle } from "./rng.js";
import {
  STARTING_CASH,
  OUTFIT_COST,
  createStore,
  computeTurnBudget,
  applySpoilage,
  restockMules,
  playerWealth,
  sellToStore as economySellToStore,
  buyFromStore as economyBuyFromStore,
  buyMule as economyBuyMule,
  FOOD_CONSUMPTION_PER_PLAYER,
} from "./economy.js";
import { computeRoundProduction } from "./production.js";
import { claimPlot, currentLandGrantPlayerId, availablePlots } from "./landGrant.js";
import type { CreateGameOptions, GameState, Mule, Player, Resource } from "./types.js";

export { claimPlot, currentLandGrantPlayerId, availablePlots };

function freshPlayer(id: string, name: string, cash: number): Player {
  return {
    id,
    name,
    cash,
    inventory: { food: 0, energy: 0, smithore: 0 },
    muleIds: [],
    turnBudget: 0,
    actionsUsed: 0,
  };
}

export function createGame(options: CreateGameOptions): GameState {
  const seed = options.seed ?? Date.now();
  const columns = options.columns ?? DEFAULT_COLUMNS;
  const rows = options.rows ?? DEFAULT_ROWS;
  const plots = generateMap(columns, rows, seed);
  const cash = STARTING_CASH[options.difficulty];
  const players = options.playerNames.map((name, i) => freshPlayer(`p${i + 1}`, name, cash));

  const state: GameState = {
    round: 1,
    maxRounds: options.maxRounds ?? 12,
    difficulty: options.difficulty,
    phase: "land-grant",
    players,
    plots,
    mules: {},
    store: createStore(),
    turnOrder: players.map((p) => p.id),
    activePlayerIndex: 0,
    landGrantOrder: [],
    landGrantIndex: 0,
    colonyFoodShortfallLastRound: false,
    log: [],
    muleSeq: 0,
    seed,
  };

  beginRound(state);
  return state;
}

function log(state: GameState, message: string): void {
  state.log.push({ round: state.round, message });
}

function roundRand(state: GameState): () => number {
  return mulberry32((state.seed + state.round * 7919) >>> 0);
}

function beginRound(state: GameState): void {
  const order = state.players
    .slice()
    .sort((a, b) => playerWealth(b, state.store) - playerWealth(a, state.store))
    .map((p) => p.id);
  state.turnOrder = order;
  state.landGrantOrder = shuffle(order, roundRand(state));
  state.landGrantIndex = 0;
  state.activePlayerIndex = 0;
  state.phase = state.landGrantOrder.length > 0 && availablePlots(state).length > 0 ? "land-grant" : "turns";

  const budget = computeTurnBudget(state.colonyFoodShortfallLastRound);
  for (const player of state.players) {
    player.turnBudget = budget;
    player.actionsUsed = 0;
  }

  log(state, `Round ${state.round} begins. Turn order (wealth desc): ${order.join(", ")}.`);
  if (state.colonyFoodShortfallLastRound) {
    log(state, `Food shortage last round — everyone's turn budget is reduced to ${budget}.`);
  }
}

export function activePlayerId(state: GameState): string | null {
  return state.turnOrder[state.activePlayerIndex] ?? null;
}

function activePlayer(state: GameState): Player {
  const id = activePlayerId(state);
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new Error("no active player");
  return player;
}

function requireActivePlayer(state: GameState, playerId: string, phases: GameState["phase"][]): Player {
  if (!phases.includes(state.phase)) {
    throw new Error(`action not valid in phase ${state.phase}`);
  }
  const player = activePlayer(state);
  if (player.id !== playerId) throw new Error(`it is not ${playerId}'s turn`);
  return player;
}

function consumeAction(player: Player): void {
  if (player.actionsUsed >= player.turnBudget) {
    throw new Error(`${player.name} has no turn actions remaining`);
  }
  player.actionsUsed += 1;
}

export function buyMule(state: GameState, playerId: string): string {
  const player = requireActivePlayer(state, playerId, ["turns"]);
  if (player.actionsUsed >= player.turnBudget) {
    throw new Error(`${player.name} has no turn actions remaining`);
  }
  const price = economyBuyMule(state.store, player);
  player.actionsUsed += 1;
  const id = `mule-${++state.muleSeq}`;
  const mule: Mule = { id, ownerId: playerId, outfit: null, plotId: null };
  state.mules[id] = mule;
  player.muleIds.push(id);
  log(state, `${player.name} bought a Mule (${id}) for $${price}.`);
  return id;
}

export function outfitAndPlaceMule(
  state: GameState,
  playerId: string,
  muleId: string,
  outfit: Resource,
  plotId: string
): void {
  const player = requireActivePlayer(state, playerId, ["turns"]);
  const mule = state.mules[muleId];
  if (!mule || mule.ownerId !== playerId) throw new Error("player does not own that mule");
  if (mule.outfit !== null || mule.plotId !== null) throw new Error("mule is already outfitted and placed");

  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot) throw new Error("no such plot");
  if (plot.ownerId !== playerId) throw new Error("player does not own that plot");
  if (plot.muleId !== null) throw new Error("plot already has a mule");

  const cost = OUTFIT_COST[outfit];
  if (player.cash < cost) throw new Error("insufficient cash to outfit");

  consumeAction(player);
  player.cash -= cost;
  mule.outfit = outfit;
  mule.plotId = plotId;
  plot.muleId = muleId;
  log(state, `${player.name} outfitted ${muleId} for ${outfit} on plot ${plotId} ($${cost}).`);
}

export function sellToStore(state: GameState, playerId: string, resource: Resource, amount: number): void {
  const player = requireActivePlayer(state, playerId, ["turns", "trade"]);
  const result = economySellToStore(state.store, player, resource, amount);
  log(state, `${player.name} sold ${amount} ${resource} to the store for $${result.cashDelta}.`);
}

export function buyFromStore(state: GameState, playerId: string, resource: Resource, amount: number): void {
  const player = requireActivePlayer(state, playerId, ["turns", "trade"]);
  const result = economyBuyFromStore(state.store, player, resource, amount);
  log(state, `${player.name} bought ${amount} ${resource} from the store for $${-result.cashDelta}.`);
}

function runProductionPhase(state: GameState): void {
  const results = computeRoundProduction(state);
  let totalFood = 0;
  for (const result of results) {
    totalFood += result.actualOutput.food;
    const player = state.players.find((p) => p.id === result.playerId)!;
    log(
      state,
      `${player.name} produced food:${result.actualOutput.food} energy:${result.rawOutput.energy} smithore:${result.actualOutput.smithore}` +
        (result.energyLimited ? " (energy-limited!)" : "")
    );
  }
  const required = FOOD_CONSUMPTION_PER_PLAYER * state.players.length;
  state.colonyFoodShortfallLastRound = totalFood < required;
  if (state.colonyFoodShortfallLastRound) {
    log(state, `Colony food shortage: produced ${totalFood}, needed ${required}.`);
  }
}

function finishRound(state: GameState): void {
  for (const player of state.players) {
    const spoiled = applySpoilage(player);
    for (const s of spoiled) {
      log(state, `${player.name}'s stockpile spoiled: lost ${s.lost} ${s.resource}.`);
    }
  }
  const built = restockMules(state.store);
  if (built > 0) {
    log(state, `The store manufactured ${built} new Mule(s) (now ${state.store.muleStock} in stock).`);
  }

  if (state.round >= state.maxRounds) {
    state.phase = "game-over";
    const standings = state.players
      .slice()
      .sort((a, b) => playerWealth(b, state.store) - playerWealth(a, state.store))
      .map((p) => `${p.name}: $${playerWealth(p, state.store)}`);
    log(state, `Game over! Final standings: ${standings.join(", ")}.`);
    return;
  }

  state.round += 1;
  beginRound(state);
}

export function endPlayerTurn(state: GameState, playerId: string): void {
  requireActivePlayer(state, playerId, ["turns", "trade"]);
  state.activePlayerIndex += 1;

  if (state.activePlayerIndex >= state.turnOrder.length) {
    if (state.phase === "turns") {
      runProductionPhase(state);
      state.phase = "trade";
      state.activePlayerIndex = 0;
    } else if (state.phase === "trade") {
      finishRound(state);
    }
  }
}
