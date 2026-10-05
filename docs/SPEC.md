# M.U.L.E. Reborn — Design Spec (v0.1)

A browser-based, 2–4 player reimagining of *M.U.L.E.* (Ozark Softscape /
Electronic Arts, 1983). Faithful to the original's economy and rhythm;
replaces the joystick-scramble land grab with a fairer, network-friendly
mechanic. Simple, legible graphics — the original's visual austerity was
part of what made it readable at a glance, and we're keeping that.

## 1. Tech stack

- **Client:** TypeScript + [Phaser 3](https://phaser.io/) for rendering,
  input, and the map/store/auction scenes.
- **Server:** Node.js + TypeScript, using [Colyseus](https://colyseus.io/)
  for authoritative room state, player session management, and real-time
  sync. Colyseus fits "real-time synchronous rooms" directly: a room per
  game, server-authoritative state, delta sync to clients, built-in
  reconnection handling (useful for a game explicitly designed to tolerate
  network delay rather than demand twitch reflexes).
- **Shared package:** game rules/state types and pure simulation logic
  (land resolution, production math, auction clearing, scoring) live in a
  `packages/shared` module imported by both client and server, so the
  server is the single source of truth but the client can predict/preview
  without duplicating logic.
- **Persistence:** in-memory per-room state is sufficient for v1 (a game
  is one sitting, ~30–45 min). A lightweight store (SQLite or Postgres)
  can be added later for match history / stats; not required for v1.
- **Monorepo layout:** npm workspaces, `apps/client`, `apps/server`,
  `packages/shared`.

## 2. Session & networking model

- 2–4 human players per game (no AI opponents in v1 — see §9).
- Players create or join a **room** via a short room code/link. One client
  acts as host (creates the room); others join with the code.
- All phases happen in real time inside the shared room — no play-by-mail
  async turns. "Real time" here means *synchronous*, not *twitchy*: every
  phase that used to reward reflexes is redesigned (see §4) to be
  decidable over a few seconds of thought, tolerant of normal internet
  latency (hundreds of ms, not frames).
- Disconnection handling: a disconnected player's turn is skipped after a
  grace timer; they can rejoin the room and resume on their next action.

## 3. Map & board

- Grid of plots (classic size: 9 columns × ~6 rows, store roughly
  centered) — exact dimensions tunable, but kept small enough that the
  whole board fits on one screen without scrolling/zooming.
- Terrain types, assigned at game setup (random but seeded so it's
  reproducible for debugging):
  - **River tiles** (runs top-to-bottom through the map): Food production
    bonus.
  - **Mountain tiles** (scattered): Smithore production bonus.
  - **Plain tiles** (no feature): Energy production bonus.
  - **Crystite deposits** (difficulty setting only, see §9): hidden value,
    revealed via the Assay Office.
- **Store** occupies a fixed central plot (or small central cluster): buy
  Mules, buy outfits, access the Saloon (gambling), access the Assay
  Office (Crystite games only).
- **Adjacency bonus:** a Mule's production is boosted when it sits next
  to other plots of players producing the *same* resource — rewards
  building a contiguous bloc rather than scattering. Exact bonus curve:
  start with +10% production per same-resource adjacent neighbor (max
  4 neighbors), tune after playtesting.

## 4. Round structure

Each round (12 rounds per game, matching the original's "one year"):

1. **Land Grant** (land selection — see below)
2. **Turns** (sequential per-player actions: buy/outfit/place Mules,
   visit Saloon, manage existing plots)
3. **Production** (server computes output for every placed Mule)
4. **Auction** (open market between players + store)
5. **Events & Scoring** (random event resolution, shortage check, wealth
   tally, leaderboard update)

### 4.1 Land Grant — ranked-choice draft (replaces the joystick race)

This is the core redesign requested: keep the *feel* of racing for good
land, lose the reflex requirement.

1. **Randomize priority order.** Each round, the server shuffles the 4
   players into a fresh random order. This is deliberately *not* tied to
   wealth standing — it's the "twist": nobody can bank on always going
   first or always going last, which keeps every round tense regardless
   of current rank.
2. **Simultaneous blind picks.** All players privately submit, within a
   short window (e.g. 20s, extendable if everyone's still deciding), a
   **1st choice** and **2nd choice** plot from the unclaimed map. Players
   see the map and all terrain/adjacency info while choosing, but not each
   other's picks.
3. **Resolution (Boston/immediate-acceptance mechanism):**
   - **Pass A:** walk the random priority order; each player is granted
     their 1st choice if it's still unclaimed at the moment their turn in
     the order comes up. (Two players can want the same tile — only the
     higher-priority one gets it.)
   - **Pass B:** players who didn't get a plot in Pass A try their 2nd
     choice, again walking the same priority order.
   - **Fallback:** anyone still unassigned after Pass B is auto-assigned
     the best remaining unclaimed plot (ranked by a simple heuristic —
     terrain bonus + adjacency to the player's existing plots), no further
     input required. This guarantees the round keeps moving and nobody is
     ever stuck waiting on a player who can't get either pick.
4. Result: every player ends the Land Grant with exactly one new plot for
   the round (plots from prior rounds are kept).

*Open point to confirm once this is playtested:* whether players should
be able to see a live "who's claimed what" feed during Pass A/B
resolution (more tension, more spectacle) vs. a single reveal at the end
(calmer, less snowbally). Defaulting to a short animated reveal.

### 4.2 Turns

- Turn order within the Turns phase is **current wealth descending**
  (wealthiest acts first), per the original's framing you described.
  *(Note: this is the opposite of some published descriptions of the
  original, which gave the poorest player first pick as a catch-up
  mechanic — flagging this in case you want to double check your memory
  against a rules reference before we lock it in. Easy to flip either way
  — it's a single comparator in the turn-order code.)*
- On their turn, a player may, in any order, spend their turn budget on:
  - Buy a Mule (costs money + Smithore, scales with how many already
    exist in the colony).
  - Outfit a Mule for Food / Energy / Smithore / Crystite production and
    place it on one of their claimed plots.
  - Re-outfit or move a Mule they already own.
  - Visit the Saloon: drink (costs money, has some benefit — original
    flavor was mostly social) or gamble (wager money against the house or
    another player for a simple stake).
  - End turn early (banking unused time has no mechanical effect in this
    version — see below).
- **Food replaces the hand-eye "time" mechanic.** In the original, Food
  shortage shrank your turn timer. Since we're removing timers as a
  reflex mechanic, colony-wide Food shortage instead shrinks the **turn
  budget** (number of actions, not seconds) for everyone next round, and
  below a severity threshold starts a Food-shortage penalty to production
  colony-wide. This preserves "Food matters because it gates how much you
  can do," without reintroducing a clock.

### 4.3 Production

- Each outfitted Mule produces its resource based on: base yield for that
  terrain/resource pairing, adjacency bonus (§3), and Energy availability
  (producing Food or ore consumes Energy; insufficient Energy caps
  output).
- Server computes all production simultaneously and reveals results to
  all players at once.

### 4.4 Auction

- One open auction per round. All players can simultaneously post sell
  offers or buy offers for Food/Energy/Smithore/Crystite.
- The **Store** is buyer-of-last-resort and seller-of-last-resort at a
  published, slowly-drifting price (so there's always liquidity, matching
  "sellers can always sell to the store").
- Implementation: a simple continuous double auction — standing bids/asks
  matched by price-time priority within the auction's time window, same
  concept as the original's cartoon-y shouting marketplace but resolved
  as order matching rather than live haggling animation (keeps it
  latency-tolerant).

### 4.5 Events & Scoring

- **Colony shortage check:** if total Food/Energy/Smithore production
  colony-wide falls short of consumption, apply the next round's penalty
  (see §4.2) and surface a clear warning banner.
- **Random events** (see §9 for which are in v1):
  - *Pirate ship* (once per game, difficulty setting only): confiscates
    all stored Smithore and Crystite.
  - *Sunspots*: temporary colony-wide Energy production boost.
  - *Meteor strike*: destroys one Mule at random but leaves a large
    Crystite deposit on that plot.
  - *Wealth-based swings*: the current wealth leader gets a randomized
    negative event (fine, bad bet at the Saloon); the current last-place
    player gets a randomized windfall (Food, Smithore, or cash). This is
    the rubber-band mechanic that keeps games close — important to keep
    even though it's "unfair" by design.
- **Scoring:** total wealth = cash + market value of stored
  commodities + assessed value of owned Mules/plots. Leaderboard updates
  every round; final ranking after round 12 (or a configurable game
  length) decides the winner.

## 5. Resources

| Resource | Produced via | Used for |
|---|---|---|
| Food | River-adjacent plots | Turn budget / avoiding shortage penalty |
| Energy | Plain plots | Powering all other production |
| Smithore | Mountain-adjacent plots | Building new Mules |
| Crystite | Hidden deposits (difficulty setting) | Pure money — sell only |

## 6. Mules

- Bought at the Store for money + Smithore.
- Outfitted for exactly one resource at a time; re-outfitting has a cost.
- Placed on a plot the player owns; one Mule per plot.
- Lost to a meteor strike (rare) or can be sold back to the store.

## 7. UI / visual direction

- Deliberately simple 2D top-down grid, flat colors, clear iconography per
  terrain/resource — closer to a modern boardgame-app aesthetic
  (Boardgame Arena-ish) than a graphically rich game. The original's charm
  came from legibility, not detail; we're not chasing a "bigger" look.
- Screens: Lobby/room join → Map (Land Grant + Turns + Production reveal)
  → Auction floor → Round summary/leaderboard.
- No sprite animation requirements beyond simple tweened moves (Mule
  placement, auction ticks, event banners).

## 8. Out of scope for v1

- AI/bot players (room requires 2–4 humans).
- Mobile-native apps (responsive web only).
- Persistent accounts/ranked ladder/match history.
- Voice/text chat (can rely on an external call if players want one).

## 9. v1 scope confirmation

Per your answer, v1 targets the **full ruleset**, including the
"difficult setting" resources/mechanics, rather than a cut-down MVP:

- All four resources, including Crystite + the Assay Office.
- Full random event set (pirate ship, sunspots, meteor strikes, wealth
  rubber-banding).
- Land blocs / adjacency bonuses.
- Open market auction phase.

Given that scope, I'd suggest sequencing the *build* (not the ruleset)
into milestones so we have a playable game early and layer on complexity,
rather than building everything before anything is testable:

1. **M1 — Core loop, no networking:** single local client, hotseat,
   Food/Energy/Smithore only, simplified land grant (no draft twist yet),
   manual turn passing. Validates the simulation math.
2. **M2 — Land Grant mechanic + adjacency + auction:** add the real
   ranked-choice draft, production adjacency bonuses, and the auction
   phase, still hotseat.
3. **M3 — Networking:** move state to the Colyseus server, add room
   join/lobby, real-time sync, disconnect handling.
4. **M4 — Difficulty layer:** Crystite, Assay Office, pirate ship, meteor
   strikes, sunspots, wealth rubber-banding.
5. **M5 — Polish:** UI pass, animations, balance tuning from playtests.

This is a sequencing suggestion, not a scope cut — happy to adjust order
(e.g., networking earlier if you want to playtest multiplayer sooner).

## 10. Repository layout (proposed)

```
mule_game/
  apps/
    client/        # Phaser + TS front end
    server/        # Colyseus room/game server
  packages/
    shared/         # game rules, state types, pure simulation functions
  docs/
    SPEC.md         # this file
```

## 11. Open questions / assumptions to confirm before M1

- Turn order direction (wealthiest-first vs poorest-first) — see §4.2.
- Land Grant pick timer length and whether to show live claims during
  resolution — see §4.1.
- Exact adjacency bonus curve (+10%/neighbor is a placeholder).
- Game length: locking at 12 rounds, or configurable per room?
- Starting resources/money and Mule pricing curve — needs a first pass of
  numbers, will draft in a balance doc once M1 is underway.
