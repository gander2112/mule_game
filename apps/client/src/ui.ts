import {
  OUTFIT_COST,
  RESOURCES,
  STORAGE_CAP,
  activePlayerId,
  availablePlots,
  buildAdjacencyContext,
  colonyFoodRequirement,
  nextLandGrantSubmitter,
  landGrantSubmittedCount,
  previewPlayerProduction,
  storePricesFor,
  type Difficulty,
  type GameState,
  type Player,
  type PlayerProductionResult,
  type Resource,
} from "@mule/shared";

export interface SetupOptions {
  playerNames: string[];
  difficulty: Difficulty;
}

export interface GameHandlers {
  onBuyMule: () => void;
  onOutfitStart: (muleId: string, resource: Resource) => void;
  onCancelSelection: () => void;
  onSell: (resource: Resource, amount: number) => void;
  onBuy: (resource: Resource, amount: number) => void;
  onEndTurn: () => void;
  onLandGrantReady: () => void;
  onLandGrantReset: () => void;
  onLandGrantSubmit: () => void;
  onLandGrantContinue: () => void;
}

export type Selection = { kind: "place-mule"; muleId: string; resource: Resource } | null;

export interface LandGrantUiState {
  /** Has the current submitter clicked past the "pass the device" cover screen? */
  ready: boolean;
  draft: { first: string | null; second: string | null };
  /** Showing the post-resolution reveal screen (phase has already moved to "turns"). */
  reveal: boolean;
  revealLog: string[];
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { text?: string } = {},
  children: (Node | null)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { text, ...rest } = props;
  Object.assign(node, rest);
  if (text !== undefined) node.textContent = text;
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

export function renderSetup(container: HTMLElement, onStart: (opts: SetupOptions) => void): void {
  container.innerHTML = "";
  const title = el("h1", { text: "M.U.L.E. Reborn" });

  const panel = el("div", { className: "panel" });
  const countField = el("div", { className: "field" }, [
    el("label", { text: "Players (2-4)" }),
    el("select", { id: "player-count" }, [2, 3, 4].map((n) => el("option", { value: String(n), text: String(n) }))),
  ]);
  panel.appendChild(countField);

  const namesContainer = el("div", { id: "names-container" });
  panel.appendChild(namesContainer);

  const difficultyField = el("div", { className: "field" }, [
    el("label", { text: "Difficulty" }),
    el("select", { id: "difficulty" }, [
      el("option", { value: "easy", text: "Easy ($1,200 start)" }),
      el("option", { value: "normal", text: "Normal ($1,000 start)" }),
    ]),
  ]);
  panel.appendChild(difficultyField);

  const countSelect = countField.querySelector("select") as HTMLSelectElement;
  const renderNameFields = () => {
    namesContainer.innerHTML = "";
    const n = Number(countSelect.value);
    for (let i = 0; i < n; i++) {
      namesContainer.appendChild(
        el("div", { className: "field" }, [
          el("label", { text: `Player ${i + 1} name` }),
          el("input", { id: `name-${i}`, value: `Player ${i + 1}` }),
        ])
      );
    }
  };
  countSelect.addEventListener("change", renderNameFields);
  renderNameFields();

  const startBtn = el("button", { className: "primary", text: "Start Game" });
  startBtn.addEventListener("click", () => {
    const n = Number(countSelect.value);
    const playerNames: string[] = [];
    for (let i = 0; i < n; i++) {
      const input = document.getElementById(`name-${i}`) as HTMLInputElement;
      playerNames.push(input.value.trim() || `Player ${i + 1}`);
    }
    const difficulty = (document.getElementById("difficulty") as HTMLSelectElement).value as Difficulty;
    onStart({ playerNames, difficulty });
  });
  panel.appendChild(startBtn);

  container.appendChild(title);
  container.appendChild(panel);
}

function phaseLabel(state: GameState): string {
  switch (state.phase) {
    case "land-grant":
      return "Land Grant";
    case "turns":
      return "Turns";
    case "production":
      return "Production";
    case "trade":
      return "Trade";
    case "scoring":
      return "Scoring";
    case "game-over":
      return "Game Over";
  }
}

function renderInventoryRows(player: Player): HTMLElement {
  return el(
    "div",
    {},
    RESOURCES.map((resource) =>
      el("div", { className: "row" }, [
        el("span", { className: "label", text: resource }),
        el("span", {
          text: `${player.inventory[resource]}${player.inventory[resource] > STORAGE_CAP ? " (spoiling!)" : ""}`,
        }),
      ])
    )
  );
}

function renderProductionPreview(preview: PlayerProductionResult, player: Player): HTMLElement {
  const available = round1(player.inventory.energy + preview.rawOutput.energy);
  const rows = [
    el("div", { className: "row" }, [
      el("span", { className: "label", text: "Predicted Food / Energy / Smithore" }),
      el("span", {
        text: `${preview.actualOutput.food} / ${preview.rawOutput.energy} / ${preview.actualOutput.smithore}`,
      }),
    ]),
    el("div", { className: "row" }, [
      el("span", { className: "label", text: "Energy needed / available" }),
      el("span", { text: `${round1(preview.energyConsumed)} / ${available}` }),
    ]),
  ];
  const children: (Node | null)[] = [el("h2", { text: "This round's production (preview)" }), ...rows];
  if (preview.energyLimited) {
    children.push(
      el("div", {
        className: "hint",
        text: "Energy-limited — Food/Smithore output above will be capped unless you add more Energy production.",
      })
    );
  }
  return el("div", { className: "panel" }, children);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function renderStorePanel(state: GameState): HTMLElement {
  const rows = RESOURCES.map((resource) => {
    const { buy, sell } = storePricesFor(state.store, resource);
    return el("div", { className: "row" }, [
      el("span", { className: "label", text: resource }),
      el("span", {
        text: `stock ${state.store.stock[resource]} · buy $${sell.toFixed(2)} / sell $${buy.toFixed(2)}`,
      }),
    ]);
  });
  rows.push(
    el("div", { className: "row" }, [
      el("span", { className: "label", text: "mules" }),
      el("span", { text: `stock ${state.store.muleStock} · $${state.store.mulePrice}` }),
    ])
  );
  return el("div", { className: "panel" }, [el("h2", { text: "Store" }), ...rows]);
}

function renderLog(state: GameState): HTMLElement {
  const entries = state.log
    .slice(-40)
    .map((e) => el("div", { text: `R${e.round} · ${e.message}` }));
  return el("div", { className: "panel" }, [el("h2", { text: "Log" }), el("div", { id: "log" }, entries)]);
}

function tradeControls(state: GameState, handlers: GameHandlers): HTMLElement {
  const resourceSelect = el(
    "select",
    {},
    RESOURCES.map((r) => el("option", { value: r, text: r }))
  ) as HTMLSelectElement;
  const amountInput = el("input", { type: "number", value: "5", min: "1" }) as HTMLInputElement;

  const sellBtn = el("button", { text: "Sell to Store" });
  sellBtn.addEventListener("click", () => {
    handlers.onSell(resourceSelect.value as Resource, Number(amountInput.value));
  });
  const buyBtn = el("button", { text: "Buy from Store" });
  buyBtn.addEventListener("click", () => {
    handlers.onBuy(resourceSelect.value as Resource, Number(amountInput.value));
  });

  return el("div", { className: "panel" }, [
    el("h2", { text: "Trade" }),
    el("div", { className: "field" }, [el("label", { text: "Resource / amount" }), resourceSelect, amountInput]),
    el("div", { className: "action-group" }, [sellBtn, buyBtn]),
  ]);
}

function renderTurnsControls(
  state: GameState,
  player: Player,
  selection: Selection,
  handlers: GameHandlers
): HTMLElement {
  const actionsLeft = player.turnBudget - player.actionsUsed;

  const buyMuleBtn = el("button", {
    className: "primary",
    text: `Buy Mule ($${state.store.mulePrice})`,
    disabled: actionsLeft <= 0 || player.cash < state.store.mulePrice || state.store.muleStock <= 0,
  });
  buyMuleBtn.addEventListener("click", handlers.onBuyMule);

  const unplacedMules = player.muleIds
    .map((id) => state.mules[id])
    .filter((m): m is NonNullable<typeof m> => !!m && m.outfit === null);

  const muleRows = unplacedMules.map((mule) => {
    const row = el("div", { className: "mule-item" }, [el("span", { text: mule.id })]);
    const btnGroup = el("div", { className: "action-group" });
    for (const resource of RESOURCES) {
      const btn = el("button", {
        text: `${resource} ($${OUTFIT_COST[resource]})`,
        disabled: actionsLeft <= 0 || player.cash < OUTFIT_COST[resource],
      });
      btn.addEventListener("click", () => handlers.onOutfitStart(mule.id, resource));
      btnGroup.appendChild(btn);
    }
    row.appendChild(btnGroup);
    return row;
  });

  const endTurnBtn = el("button", { className: "primary", text: "End Turn" });
  endTurnBtn.addEventListener("click", handlers.onEndTurn);

  const pieces: (Node | null)[] = [
    el("h2", { text: `Actions (${actionsLeft}/${player.turnBudget} left)` }),
    buyMuleBtn,
  ];

  if (selection?.kind === "place-mule") {
    const cancelBtn = el("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", handlers.onCancelSelection);
    pieces.push(
      el("div", { className: "hint" }, [
        el(
          "span",
          { text: `Click one of your empty plots to place the ${selection.resource} Mule...` }
        ),
      ])
    );
    pieces.push(cancelBtn);
  } else if (unplacedMules.length > 0) {
    pieces.push(el("h2", { text: "Outfit & Place a Mule" }));
    pieces.push(...muleRows);
  }

  pieces.push(endTurnBtn);
  return el("div", { className: "panel" }, pieces);
}

function renderLandGrantHandoff(state: GameState, handlers: GameHandlers): HTMLElement {
  const playerId = nextLandGrantSubmitter(state);
  const player = state.players.find((p) => p.id === playerId);
  const submitted = landGrantSubmittedCount(state);
  const total = state.landGrantOrder.length;

  const readyBtn = el("button", { className: "primary", text: player ? `I'm ${player.name} — Ready` : "Ready" });
  readyBtn.addEventListener("click", handlers.onLandGrantReady);

  return el("div", { className: "panel" }, [
    el("h2", { text: "Land Grant — pass the device" }),
    el("div", { text: `This round's picks are blind: everyone else, look away until it's your turn.` }),
    el("div", { className: "hint", text: `${submitted}/${total} players have locked in their picks.` }),
    readyBtn,
  ]);
}

function renderLandGrantPicking(state: GameState, landGrant: LandGrantUiState, handlers: GameHandlers): HTMLElement {
  const playerId = nextLandGrantSubmitter(state);
  const player = state.players.find((p) => p.id === playerId);
  const { first, second } = landGrant.draft;

  let instruction: string;
  if (!first) instruction = "Click your 1st-choice plot on the board (any open, non-gold tile).";
  else if (!second) instruction = "Click your 2nd-choice plot — a different one.";
  else instruction = "Both picks are in. Submit when ready, or reset to change them.";

  const resetBtn = el("button", { text: "Reset picks" });
  resetBtn.addEventListener("click", handlers.onLandGrantReset);
  const submitBtn = el("button", {
    className: "primary",
    text: "Submit Picks",
    disabled: !first || !second,
  });
  submitBtn.addEventListener("click", handlers.onLandGrantSubmit);

  return el("div", { className: "panel" }, [
    el("h2", { text: `${player?.name ?? "Your"}'s picks` }),
    el("div", { text: instruction }),
    el("div", { className: "row" }, [
      el("span", { className: "label", text: "1st choice" }),
      el("span", { text: first ?? "—" }),
    ]),
    el("div", { className: "row" }, [
      el("span", { className: "label", text: "2nd choice" }),
      el("span", { text: second ?? "—" }),
    ]),
    el("div", { className: "action-group" }, [resetBtn, submitBtn]),
  ]);
}

function renderLandGrantReveal(landGrant: LandGrantUiState, handlers: GameHandlers): HTMLElement {
  const continueBtn = el("button", { className: "primary", text: "Continue to Turns" });
  continueBtn.addEventListener("click", handlers.onLandGrantContinue);

  return el("div", { className: "panel" }, [
    el("h2", { text: "Land Grant resolved" }),
    ...landGrant.revealLog.map((msg) => el("div", { text: msg })),
    continueBtn,
  ]);
}

export function renderGame(
  container: HTMLElement,
  state: GameState,
  selection: Selection,
  landGrant: LandGrantUiState,
  handlers: GameHandlers
): void {
  container.innerHTML = "";
  container.appendChild(el("h1", { text: "M.U.L.E. Reborn" }));

  const statusPanel = el("div", { className: "panel" }, [
    el("div", { className: "row" }, [
      el("span", { className: "label", text: "Round" }),
      el("span", { text: `${state.round} / ${state.maxRounds}` }),
    ]),
    el("div", { className: "row" }, [
      el("span", { className: "label", text: "Phase" }),
      el("span", { text: phaseLabel(state) }),
    ]),
    el("div", { className: "row" }, [
      el("span", { className: "label", text: "Colony Food needed this round" }),
      el("span", { text: String(colonyFoodRequirement(state.players, state.mules)) }),
    ]),
  ]);
  container.appendChild(statusPanel);

  if (landGrant.reveal) {
    container.appendChild(renderLandGrantReveal(landGrant, handlers));
    container.appendChild(renderStorePanel(state));
    container.appendChild(renderLog(state));
    return;
  }

  if (state.phase === "land-grant") {
    container.appendChild(
      landGrant.ready ? renderLandGrantPicking(state, landGrant, handlers) : renderLandGrantHandoff(state, handlers)
    );
    container.appendChild(el("div", { className: "hint", text: `${availablePlots(state).length} plots remain unclaimed.` }));
    container.appendChild(renderStorePanel(state));
    container.appendChild(renderLog(state));
    return;
  }

  if (state.phase === "game-over") {
    const standings = state.players
      .slice()
      .sort((a, b) => b.cash - a.cash)
      .map((p, i) =>
        el("div", { className: "row" }, [
          el("span", { text: `${i + 1}. ${p.name}` }),
          el("span", { text: `$${p.cash.toFixed(0)} cash` }),
        ])
      );
    container.appendChild(el("div", { className: "panel" }, [el("h2", { text: "Final Standings" }), ...standings]));
    container.appendChild(renderLog(state));
    return;
  }

  const playerId = activePlayerId(state);
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;

  container.appendChild(
    el("div", { className: "panel" }, [
      el("h2", { text: `${player.name}'s turn` }),
      el("div", { className: "row" }, [el("span", { className: "label", text: "Cash" }), el("span", { text: `$${player.cash.toFixed(2)}` })]),
      renderInventoryRows(player),
      el("div", { className: "row" }, [
        el("span", { className: "label", text: "Mules owned" }),
        el("span", { text: String(player.muleIds.length) }),
      ]),
    ])
  );

  if (state.phase === "turns") {
    const { active, blocSizes } = buildAdjacencyContext(state);
    const preview = previewPlayerProduction(state, player, active, blocSizes);
    container.appendChild(renderProductionPreview(preview, player));
    container.appendChild(renderTurnsControls(state, player, selection, handlers));
  } else if (state.phase === "trade") {
    const panel = el("div", { className: "panel" }, [el("h2", { text: "Trade window" })]);
    const endTurnBtn = el("button", { className: "primary", text: "End Trade Turn" });
    endTurnBtn.addEventListener("click", handlers.onEndTurn);
    panel.appendChild(endTurnBtn);
    container.appendChild(panel);
  }

  container.appendChild(tradeControls(state, handlers));
  container.appendChild(renderStorePanel(state));
  container.appendChild(renderLog(state));
}
