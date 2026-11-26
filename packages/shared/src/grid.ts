/** Shared by production.ts (adjacency bonus) and landGrant.ts (fallback heuristic) — both need orthogonal-neighbor lookups on the same x/y + "x-y" id grid convention map.ts uses. */
export const NEIGHBOR_OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function plotIdAt(x: number, y: number): string {
  return `${x}-${y}`;
}
