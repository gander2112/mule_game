# M.U.L.E. Reborn

A browser-based, 2–4 player reimagining of the 1983 Ozark Softscape /
Electronic Arts classic *M.U.L.E.* Same colony-economy core loop
(claim land, outfit Mules, produce, trade, survive random events) —
redesigned so multiplayer doesn't depend on split-second local-controller
reflexes.

See [`docs/SPEC.md`](docs/SPEC.md) for the full design spec: tech stack,
round structure, the land-grant mechanic, resources, and build milestones.

## Status

**M1 (core loop, hotseat, no networking) is done.** Food/Energy/Smithore
only — Crystite, the Assay Office, adjacency bonuses, the real auction,
and random events arrive in later milestones (see §9 of the spec).

## Getting started

```sh
npm install
npm run test -w @mule/shared   # simulation test suite (vitest)
npm run dev:client             # hotseat client at http://localhost:5173
```

`packages/shared` holds the pure game-rules simulation (map generation,
store economy, production math, round orchestration). `apps/client` is
the Vite + Phaser 3 hotseat UI that drives it — pass the keyboard/mouse
around for 2–4 players on one screen.
