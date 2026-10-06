import Phaser from "phaser";
import { DEFAULT_COLUMNS, DEFAULT_ROWS, type GameState, type Plot } from "@mule/shared";
import { bus, EVENTS } from "./events.js";

export const CELL_SIZE = 64;
export const BOARD_WIDTH = DEFAULT_COLUMNS * CELL_SIZE;
export const BOARD_HEIGHT = DEFAULT_ROWS * CELL_SIZE;

const TERRAIN_COLOR: Record<Plot["terrain"], number> = {
  river: 0x3f7fd6,
  mountain: 0x8a7260,
  plain: 0xcdbd85,
  store: 0xf2c744,
};

export const PLAYER_COLORS = [0xe63946, 0x2a9d8f, 0xf4a261, 0x9b6bd1];

const OUTFIT_COLOR: Record<string, number> = {
  food: 0x4caf50,
  energy: 0xffd54f,
  smithore: 0x9e9e9e,
};

const OUTFIT_LETTER: Record<string, string> = {
  food: "F",
  energy: "E",
  smithore: "S",
};

interface CellVisual {
  rect: Phaser.GameObjects.Rectangle;
  border: Phaser.GameObjects.Rectangle;
  highlight: Phaser.GameObjects.Rectangle;
  muleIcon: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
}

export class BoardScene extends Phaser.Scene {
  private cells = new Map<string, CellVisual>();
  private playerColorIndex = new Map<string, number>();

  constructor() {
    super("board");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#0c0d10");
    for (let y = 0; y < DEFAULT_ROWS; y++) {
      for (let x = 0; x < DEFAULT_COLUMNS; x++) {
        this.buildCell(x, y);
      }
    }
    bus.emit(EVENTS.SCENE_READY, this);
  }

  private buildCell(x: number, y: number): void {
    const id = `${x}-${y}`;
    const cx = x * CELL_SIZE + CELL_SIZE / 2;
    const cy = y * CELL_SIZE + CELL_SIZE / 2;

    const rect = this.add.rectangle(cx, cy, CELL_SIZE - 4, CELL_SIZE - 4, 0x333333);
    rect.setInteractive({ useHandCursor: true });
    rect.on("pointerdown", () => bus.emit(EVENTS.PLOT_CLICK, id));

    const border = this.add.rectangle(cx, cy, CELL_SIZE - 4, CELL_SIZE - 4);
    border.setStrokeStyle(3, 0x000000, 0);
    border.setFillStyle(undefined, 0);

    const highlight = this.add.rectangle(cx, cy, CELL_SIZE - 4, CELL_SIZE - 4);
    highlight.setStrokeStyle(3, 0xffffff, 0);
    highlight.setFillStyle(undefined, 0);

    const muleIcon = this.add.text(cx, cy, "", {
      fontSize: "20px",
      fontStyle: "bold",
      color: "#111111",
    });
    muleIcon.setOrigin(0.5);

    const label = this.add.text(cx - CELL_SIZE / 2 + 4, cy + CELL_SIZE / 2 - 14, "", {
      fontSize: "9px",
      color: "#ffffff",
    });

    this.cells.set(id, { rect, border, highlight, muleIcon, label });
  }

  private colorForPlayer(playerId: string, state: GameState): number {
    if (!this.playerColorIndex.has(playerId)) {
      const index = state.players.findIndex((p) => p.id === playerId);
      this.playerColorIndex.set(playerId, index >= 0 ? index : 0);
    }
    const idx = this.playerColorIndex.get(playerId)!;
    return PLAYER_COLORS[idx % PLAYER_COLORS.length]!;
  }

  redraw(state: GameState, highlightedPlotIds: ReadonlySet<string> = new Set()): void {
    for (const plot of state.plots) {
      const visual = this.cells.get(plot.id);
      if (!visual) continue;

      visual.rect.setFillStyle(TERRAIN_COLOR[plot.terrain]);

      if (plot.ownerId) {
        const color = this.colorForPlayer(plot.ownerId, state);
        visual.border.setStrokeStyle(3, color, 1);
        const ownerIndex = state.players.findIndex((p) => p.id === plot.ownerId);
        visual.label.setText(ownerIndex >= 0 ? `P${ownerIndex + 1}` : "");
      } else {
        visual.border.setStrokeStyle(3, 0x000000, 0);
        visual.label.setText("");
      }

      if (plot.muleId) {
        const mule = state.mules[plot.muleId];
        if (mule?.outfit) {
          visual.muleIcon.setText(OUTFIT_LETTER[mule.outfit] ?? "?");
          visual.muleIcon.setColor("#111111");
          visual.muleIcon.setBackgroundColor(
            `#${(OUTFIT_COLOR[mule.outfit] ?? 0xffffff).toString(16).padStart(6, "0")}`
          );
          visual.muleIcon.setPadding(4, 2, 4, 2);
        } else {
          visual.muleIcon.setText("M");
          visual.muleIcon.setColor("#eeeeee");
          visual.muleIcon.setBackgroundColor("#555555");
          visual.muleIcon.setPadding(4, 2, 4, 2);
        }
      } else {
        visual.muleIcon.setText("");
        visual.muleIcon.setBackgroundColor("");
      }

      const isHighlighted = highlightedPlotIds.has(plot.id);
      visual.highlight.setStrokeStyle(3, 0xffffff, isHighlighted ? 1 : 0);
    }
  }
}
