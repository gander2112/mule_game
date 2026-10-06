import {
  OUTFIT_COST,
  RESOURCES,
  STORAGE_CAP,
  activePlayerId,
  availablePlots,
  currentLandGrantPlayerId,
  storePricesFor,
  type Difficulty,
  type GameState,
  type Player,
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
}

export type Selection = { kind: "place-mule"; muleId: string; resource: Resource } | null;

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

export function renderGame(
  container: HTMLElement,
  state: GameState,
  selection: Selection,
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
  ]);
  container.appendChild(statusPanel);

  if (state.phase === "land-grant") {
    const playerId = currentLandGrantPlayerId(state);
    const player = state.players.find((p) => p.id === playerId);
    container.appendChild(
      el("div", { className: "panel" }, [
        el("h2", { text: "Land Grant" }),
        el("div", {
          text: player
            ? `${player.name}'s turn to claim a plot — click an open (non-gold) plot on the board.`
            : "",
        }),
        el("div", { className: "hint", text: `${availablePlots(state).length} plots remain unclaimed.` }),
      ])
    );
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
