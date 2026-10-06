import { mulberry32, randInt } from "./rng.js";
import type { Plot, Terrain } from "./types.js";

export const DEFAULT_COLUMNS = 10;
export const DEFAULT_ROWS = 6;

export function generateMap(
  columns: number = DEFAULT_COLUMNS,
  rows: number = DEFAULT_ROWS,
  seed: number = 1
): Plot[] {
  const rand = mulberry32(seed);
  const storeX = Math.floor(columns / 2);
  const storeY = Math.floor(rows / 2);
  const riverX = randInt(rand, 1, columns - 2);

  const terrainOf = (x: number, y: number): Terrain => {
    if (x === storeX && y === storeY) return "store";
    if (x === riverX) return "river";
    return "plain";
  };

  const plots: Plot[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      plots.push({
        id: `${x}-${y}`,
        x,
        y,
        terrain: terrainOf(x, y),
        ownerId: null,
        muleId: null,
      });
    }
  }

  const mountainCandidates = plots.filter((p) => p.terrain === "plain");
  const mountainCount = Math.round(mountainCandidates.length * 0.25);
  const shuffled = mountainCandidates.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  for (let i = 0; i < mountainCount; i++) {
    shuffled[i]!.terrain = "mountain";
  }

  return plots;
}
