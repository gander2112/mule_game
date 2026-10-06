import Phaser from "phaser";
import {
  activePlayerId,
  availablePlots,
  buyFromStore,
  buyMule,
  claimPlot,
  createGame,
  currentLandGrantPlayerId,
  endPlayerTurn,
  outfitAndPlaceMule,
  sellToStore,
  type GameState,
} from "@mule/shared";
import { BoardScene, BOARD_WIDTH, BOARD_HEIGHT } from "./board-scene.js";
import { bus, EVENTS } from "./events.js";
import { renderGame, renderSetup, type Selection } from "./ui.js";

const gameContainer = document.getElementById("game")!;
const uiContainer = document.getElementById("ui")!;

let state: GameState | null = null;
let boardScene: BoardScene | null = null;
let selection: Selection = null;
let errorTimeout: ReturnType<typeof setTimeout> | null = null;

function showError(message: string): void {
  console.warn(message);
  const existing = document.getElementById("error-banner");
  if (existing) existing.remove();
  const banner = document.createElement("div");
  banner.id = "error-banner";
  banner.textContent = message;
  banner.style.cssText =
    "background:#4a1f24;border:1px solid #c0384a;color:#ffb3bd;padding:8px 10px;border-radius:4px;margin-bottom:10px;font-size:0.85rem;";
  uiContainer.prepend(banner);
  if (errorTimeout) clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => banner.remove(), 4000);
}

function highlightedPlots(): Set<string> {
  if (!state) return new Set();
  if (state.phase === "land-grant") {
    return new Set(availablePlots(state));
  }
  if (selection?.kind === "place-mule") {
    const playerId = activePlayerId(state);
    return new Set(
      state.plots.filter((p) => p.ownerId === playerId && p.muleId === null).map((p) => p.id)
    );
  }
  return new Set();
}

function render(): void {
  if (!state) return;
  renderGame(uiContainer, state, selection, handlers);
  boardScene?.redraw(state, highlightedPlots());
}

const handlers = {
  onBuyMule(): void {
    if (!state) return;
    const playerId = activePlayerId(state);
    if (!playerId) return;
    try {
      buyMule(state, playerId);
    } catch (err) {
      showError((err as Error).message);
    }
    render();
  },
  onOutfitStart(muleId: string, resource: "food" | "energy" | "smithore"): void {
    selection = { kind: "place-mule", muleId, resource };
    render();
  },
  onCancelSelection(): void {
    selection = null;
    render();
  },
  onSell(resource: "food" | "energy" | "smithore", amount: number): void {
    if (!state || !Number.isFinite(amount) || amount <= 0) return;
    const playerId = activePlayerId(state);
    if (!playerId) return;
    try {
      sellToStore(state, playerId, resource, Math.floor(amount));
    } catch (err) {
      showError((err as Error).message);
    }
    render();
  },
  onBuy(resource: "food" | "energy" | "smithore", amount: number): void {
    if (!state || !Number.isFinite(amount) || amount <= 0) return;
    const playerId = activePlayerId(state);
    if (!playerId) return;
    try {
      buyFromStore(state, playerId, resource, Math.floor(amount));
    } catch (err) {
      showError((err as Error).message);
    }
    render();
  },
  onEndTurn(): void {
    if (!state) return;
    const playerId = activePlayerId(state);
    if (!playerId) return;
    selection = null;
    try {
      endPlayerTurn(state, playerId);
    } catch (err) {
      showError((err as Error).message);
    }
    render();
  },
};

function onPlotClick(plotId: string): void {
  if (!state) return;

  if (state.phase === "land-grant") {
    const playerId = currentLandGrantPlayerId(state);
    if (!playerId) return;
    try {
      claimPlot(state, playerId, plotId);
    } catch (err) {
      showError((err as Error).message);
    }
    render();
    return;
  }

  if (selection?.kind === "place-mule") {
    const playerId = activePlayerId(state);
    if (!playerId) return;
    try {
      outfitAndPlaceMule(state, playerId, selection.muleId, selection.resource, plotId);
      selection = null;
    } catch (err) {
      showError((err as Error).message);
    }
    render();
  }
}

bus.on(EVENTS.PLOT_CLICK, onPlotClick);
bus.once(EVENTS.SCENE_READY, (scene: BoardScene) => {
  boardScene = scene;
  render();
});

function startGame(playerNames: string[], difficulty: "easy" | "normal"): void {
  state = createGame({ playerNames, difficulty, seed: Date.now() });

  gameContainer.innerHTML = "";
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameContainer,
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    backgroundColor: "#0c0d10",
    scene: BoardScene,
  });
}

renderSetup(uiContainer, (opts) => startGame(opts.playerNames, opts.difficulty));
