import { describe, expect, it } from "vitest";
import {
  availablePlots,
  landGrantSubmittedCount,
  nextLandGrantSubmitter,
  submitLandGrantPicks,
} from "../src/landGrant.js";
import type { GameState, Plot, Player } from "../src/types.js";

function player(id: string): Player {
  return {
    id,
    name: id,
    cash: 1000,
    inventory: { food: 0, energy: 0, smithore: 0 },
    muleIds: [],
    turnBudget: 5,
    actionsUsed: 0,
  };
}

function plotAt(x: number, y: number, terrain: Plot["terrain"] = "plain"): Plot {
  return { id: `${x}-${y}`, x, y, terrain, ownerId: null, muleId: null };
}

function makeState(playerIds: string[], plots: Plot[], landGrantOrder = playerIds): GameState {
  return {
    round: 1,
    maxRounds: 12,
    difficulty: "normal",
    phase: "land-grant",
    players: playerIds.map(player),
    plots,
    mules: {},
    store: {} as GameState["store"],
    turnOrder: playerIds,
    activePlayerIndex: 0,
    landGrantOrder,
    landGrantPicks: {},
    colonyFoodShortfallLastRound: false,
    log: [],
    muleSeq: 0,
    seed: 1,
  };
}

describe("submitLandGrantPicks validation", () => {
  it("rejects a pick naming a plot that's already owned from a prior round", () => {
    const plots = [plotAt(0, 0), plotAt(1, 0)];
    plots[0]!.ownerId = "p2"; // claimed in an earlier round
    const state = makeState(["p1", "p2"], plots);
    expect(() => submitLandGrantPicks(state, "p1", "0-0", "1-0")).toThrow();
  });

  it("rejects the Store plot as a choice", () => {
    const plots = [{ ...plotAt(0, 0), terrain: "store" as const }, plotAt(1, 0)];
    const state = makeState(["p1", "p2"], plots);
    expect(() => submitLandGrantPicks(state, "p1", "0-0", "1-0")).toThrow();
  });

  it("rejects a player not in this round's landGrantOrder", () => {
    const plots = [plotAt(0, 0), plotAt(1, 0)];
    const state = makeState(["p1", "p2"], plots);
    expect(() => submitLandGrantPicks(state, "p3", "0-0", "1-0")).toThrow();
  });
});

describe("resolveLandGrant — Pass A (1st choices)", () => {
  it("grants every player their 1st choice when nobody's picks overlap", () => {
    const plots = [plotAt(0, 0), plotAt(1, 0), plotAt(2, 0), plotAt(3, 0)];
    const state = makeState(["p1", "p2"], plots, ["p1", "p2"]);

    submitLandGrantPicks(state, "p1", "0-0", "1-0");
    expect(state.phase).toBe("land-grant"); // not resolved until both submit
    submitLandGrantPicks(state, "p2", "2-0", "3-0");

    expect(state.phase).toBe("turns");
    expect(plots.find((p) => p.id === "0-0")!.ownerId).toBe("p1");
    expect(plots.find((p) => p.id === "2-0")!.ownerId).toBe("p2");
  });

  it("gives a contested 1st choice to the higher-priority player in landGrantOrder", () => {
    const plots = [plotAt(0, 0), plotAt(1, 0), plotAt(2, 0)];
    const state = makeState(["p1", "p2"], plots, ["p2", "p1"]); // p2 has priority

    submitLandGrantPicks(state, "p1", "0-0", "1-0");
    submitLandGrantPicks(state, "p2", "0-0", "2-0"); // same 1st choice as p1

    expect(plots.find((p) => p.id === "0-0")!.ownerId).toBe("p2"); // priority wins Pass A
    expect(plots.find((p) => p.id === "1-0")!.ownerId).toBe("p1"); // p1 falls through to their 2nd choice
  });
});

describe("resolveLandGrant — Pass B (2nd choices)", () => {
  it("falls through to a player's 2nd choice when their 1st choice loses to priority", () => {
    const plots = [plotAt(0, 0), plotAt(1, 0)];
    const state = makeState(["p1", "p2"], plots, ["p2", "p1"]);

    submitLandGrantPicks(state, "p1", "0-0", "1-0");
    submitLandGrantPicks(state, "p2", "0-0", "1-0"); // identical picks, p2 has priority

    expect(plots.find((p) => p.id === "0-0")!.ownerId).toBe("p2");
    expect(plots.find((p) => p.id === "1-0")!.ownerId).toBe("p1");
  });

  it("still uses landGrantOrder priority for Pass B when two players both fall through", () => {
    // Three players, all identical picks -> p3 (top priority) takes 1st choice in
    // Pass A; p2 and p1 both fall to their 2nd choice (same plot) in Pass B,
    // where priority order (p3, p2, p1) still applies, so p2 wins it.
    const plots = [plotAt(0, 0), plotAt(1, 0), plotAt(2, 0)];
    const state = makeState(["p1", "p2", "p3"], plots, ["p3", "p2", "p1"]);

    submitLandGrantPicks(state, "p1", "0-0", "1-0");
    submitLandGrantPicks(state, "p2", "0-0", "1-0");
    submitLandGrantPicks(state, "p3", "0-0", "1-0");

    expect(plots.find((p) => p.id === "0-0")!.ownerId).toBe("p3");
    expect(plots.find((p) => p.id === "1-0")!.ownerId).toBe("p2");
    // p1 missed both -> fallback assigns the only plot left.
    expect(plots.find((p) => p.id === "2-0")!.ownerId).toBe("p1");
  });
});

describe("resolveLandGrant — fallback", () => {
  it("auto-assigns the best remaining plot to a player who missed both choices", () => {
    // p1's two picks are each some *other* player's higher-priority 1st
    // choice, so both are gone by the time Pass B runs for p1 — only the
    // untouched "5-5" is left for the fallback pass.
    const plots = [plotAt(0, 0), plotAt(1, 0), plotAt(5, 5)];
    const state = makeState(["p1", "p2", "p3"], plots, ["p2", "p3", "p1"]);

    submitLandGrantPicks(state, "p2", "0-0", "5-5");
    submitLandGrantPicks(state, "p3", "1-0", "5-5");
    submitLandGrantPicks(state, "p1", "0-0", "1-0");

    expect(plots.find((p) => p.id === "0-0")!.ownerId).toBe("p2");
    expect(plots.find((p) => p.id === "1-0")!.ownerId).toBe("p3");
    expect(plots.find((p) => p.id === "5-5")!.ownerId).toBe("p1");
  });

  it("prefers a fallback plot adjacent to the player's existing plots", () => {
    // p1 already owns (0,0). Two untouched candidates sit at the end of
    // resolution: (1,0), adjacent to p1's existing plot, and (9,9), far
    // away. p1's own two picks both get taken by higher-priority players
    // in Pass A, so p1 falls all the way to the fallback heuristic.
    const plots = [plotAt(0, 0), plotAt(1, 0), plotAt(9, 9), plotAt(2, 0), plotAt(3, 0)];
    plots[0]!.ownerId = "p1";
    const state = makeState(["p1", "p2", "p3"], plots, ["p2", "p3", "p1"]);

    submitLandGrantPicks(state, "p2", "2-0", "9-9");
    submitLandGrantPicks(state, "p3", "3-0", "9-9");
    submitLandGrantPicks(state, "p1", "2-0", "3-0"); // both already lost to p2/p3 by the time Pass B runs

    expect(plots.find((p) => p.id === "2-0")!.ownerId).toBe("p2");
    expect(plots.find((p) => p.id === "3-0")!.ownerId).toBe("p3");
    expect(plots.find((p) => p.id === "1-0")!.ownerId).toBe("p1"); // fallback prefers the adjacent plot...
    expect(plots.find((p) => p.id === "9-9")!.ownerId).toBeNull(); // ...over the distant one
  });

  it("logs a fallback assignment distinctly from a 1st/2nd choice grant", () => {
    const plots = [plotAt(0, 0), plotAt(1, 0)];
    const state = makeState(["p1", "p2"], plots, ["p2", "p1"]);

    submitLandGrantPicks(state, "p1", "0-0", "1-0");
    submitLandGrantPicks(state, "p2", "0-0", "1-0");

    const messages = state.log.map((e) => e.message);
    expect(messages.some((m) => m.includes("1st choice"))).toBe(true);
    expect(messages.some((m) => m.includes("2nd"))).toBe(true);
  });
});

describe("nextLandGrantSubmitter / landGrantSubmittedCount", () => {
  it("tracks whose turn it is to submit without revealing picks", () => {
    const plots = [plotAt(0, 0), plotAt(1, 0), plotAt(2, 0), plotAt(3, 0)];
    const state = makeState(["p1", "p2"], plots, ["p1", "p2"]);

    expect(nextLandGrantSubmitter(state)).toBe("p1");
    expect(landGrantSubmittedCount(state)).toBe(0);

    submitLandGrantPicks(state, "p1", "0-0", "1-0");
    expect(nextLandGrantSubmitter(state)).toBe("p2");
    expect(landGrantSubmittedCount(state)).toBe(1);
  });

  it("returns null once everyone has submitted (phase has moved on)", () => {
    const plots = [plotAt(0, 0), plotAt(1, 0), plotAt(2, 0), plotAt(3, 0)];
    const state = makeState(["p1", "p2"], plots, ["p1", "p2"]);
    submitLandGrantPicks(state, "p1", "0-0", "1-0");
    submitLandGrantPicks(state, "p2", "2-0", "3-0");
    expect(nextLandGrantSubmitter(state)).toBeNull();
  });
});

describe("availablePlots", () => {
  it("excludes the Store and anything already owned", () => {
    const plots = [plotAt(0, 0), { ...plotAt(1, 0), terrain: "store" as const }, plotAt(2, 0)];
    plots[2]!.ownerId = "p1";
    const state = makeState(["p1"], plots, ["p1"]);
    expect(availablePlots(state)).toEqual(["0-0"]);
  });
});
