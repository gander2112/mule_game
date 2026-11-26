import Phaser from "phaser";
import {
  activePlayerId,
  availablePlots,
  buyFromStore,
  buyMule,
  createGame,
  endPlayerTurn,
  nextLandGrantSubmitter,
  outfitAndPlaceMule,
  sellToStore,
  submitLandGrantPicks,
  type GameState,
} from "@mule/shared";
import { BoardScene, BOARD_WIDTH, BOARD_HEIGHT } from "./board-scene.js";
import { bus, EVENTS } from "./events.js";
import { renderGame, renderSetup, type LandGrantUiState, type Selection } from "./ui.js";

const gameContainer = document.getElementById("game")!;
const uiContainer = document.getElementById("ui")!;

let state: GameState | null = null;
let boardScene: BoardScene | null = null;
let selection: Selection = null;
let errorTimeout: ReturnType<typeof setTimeout> | null = null;

function freshLandGrantUiState(): LandGrantUiState {
  return { ready: false, draft: { first: null, second: null }, reveal: false, revealLog: [] };
}

let landGrant: LandGrantUiState = freshLandGrantUiState();

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
  if (state.phase === "land-grant" && landGrant.ready && !landGrant.reveal) {
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

function selectedPlotMarks(): Record<string, string> {
  if (!state || state.phase !== "land-grant" || !landGrant.ready) return {};
  const marks: Record<string, string> = {};
  if (landGrant.draft.first) marks[landGrant.draft.first] = "1st";
  if (landGrant.draft.second) marks[landGrant.draft.second] = "2nd";
  return marks;
}

function render(): void {
  if (!state) return;
  renderGame(uiContainer, state, selection, landGrant, handlers);
  boardScene?.redraw(state, highlightedPlots(), selectedPlotMarks());
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
  onLandGrantReady(): void {
    landGrant.ready = true;
    landGrant.draft = { first: null, second: null };
    render();
  },
  onLandGrantReset(): void {
    landGrant.draft = { first: null, second: null };
    render();
  },
  onLandGrantSubmit(): void {
    if (!state) return;
    const playerId = nextLandGrantSubmitter(state);
    const { first, second } = landGrant.draft;
    if (!playerId || !first || !second) return;

    const logLengthBefore = state.log.length;
    try {
      submitLandGrantPicks(state, playerId, first, second);
      landGrant.ready = false;
      landGrant.draft = { first: null, second: null };
      if (state.phase === "turns") {
        // The last pick just triggered resolution — show what happened
        // before dropping straight into the Turns UI.
        landGrant.reveal = true;
        landGrant.revealLog = state.log
          .slice(logLengthBefore)
          .map((e) => e.message)
          .filter((msg) => !msg.includes("locked in their Land Grant picks"));
      }
    } catch (err) {
      showError((err as Error).message);
    }
    render();
  },
  onLandGrantContinue(): void {
    landGrant.reveal = false;
    landGrant.revealLog = [];
    render();
  },
};

function onPlotClick(plotId: string): void {
  if (!state) return;

  if (state.phase === "land-grant" && !landGrant.reveal) {
    if (!landGrant.ready) return; // must acknowledge the "pass the device" screen first
    if (!availablePlots(state).includes(plotId)) return;

    const { first, second } = landGrant.draft;
    if (first === plotId) {
      landGrant.draft = { first: second, second: null };
    } else if (second === plotId) {
      landGrant.draft = { first, second: null };
    } else if (!first) {
      landGrant.draft = { first: plotId, second: null };
    } else if (!second) {
      landGrant.draft = { first, second: plotId };
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
  landGrant = freshLandGrantUiState();
  selection = null;

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
