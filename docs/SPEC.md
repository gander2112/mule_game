# M.U.L.E. Reborn — Design Spec (v0.4)

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
  building a contiguous bloc rather than scattering.
  - **+10% production per same-resource adjacent neighbor** (up to 4
    neighbors, one per side of the grid tile).
  - **+5% extra kicker when the bloc is 3 or more tiles**, i.e. once a
    plot's cluster of mutually-adjacent same-resource plots reaches size
    3+, every plot in that cluster gets the base +10%/neighbor *plus* a
    flat +5%. This rewards committing to a bloc over just pairing up two
    plots.
  - Example: a plot with 2 same-resource neighbors in a bloc of 3+ gets
    +10%×2 + 5% = +25% total; the same plot in an isolated pair (bloc
    size 2) gets +10%×2 = +20%, no kicker.

## 4. Round structure

Each round represents one month; a full game is **12 rounds = one year**,
matching the original. Round count is a per-room config value with 12 as
the default, not hardcoded — opens the door to later variants (a 6-round
"blitz" tournament format, a 20+ round "reach stasis" long game) without
touching the round-resolution logic, but every game still has a defined,
finite end (no open-ended/endless mode).

The 5 phases each round:

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
   **10-second window**, a **1st choice** and **2nd choice** plot from
   the unclaimed map. Players see the map and all terrain/adjacency info
   while choosing, but not each other's picks. 10s is enough to register
   two picks without being a reflex test; a player who times out is
   auto-submitted with no picks and falls straight to the Fallback step
   below.
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

- Turn order within the Turns phase is **always current wealth
  descending** (wealthiest acts first, poorest acts last) — confirmed,
  no catch-up reversal.
- On their turn, a player may, in any order, spend their turn budget on:
  - Buy a Mule (costs money + Smithore, scales with how many already
    exist in the colony).
  - Outfit a Mule for Food / Energy / Smithore / Crystite production and
    place it on one of their claimed plots.
  - Re-outfit or move a Mule they already own.
  - **Visit the Assay Office** to assay one plot — *any* plot on the map,
    claimed by anyone or still unclaimed, not just the player's own. Free
    in money, but costs one action from the turn budget. Reveals that
    plot's Crystite deposit level — **None / Low / Medium / High** — to
    the assaying player only; the result is permanent (the plot's
    deposit is fixed at map generation) and private (other players don't
    learn it unless they assay the same plot themselves). See §6 for why
    this matters for Crystite production.
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
- The **Store** is buyer-of-last-resort and seller-of-last-resort, and it
  holds **real, tracked stock** per resource rather than being an
  abstract infinite counterparty — see §6.1 for starting stock and the
  price-vs-stock relationship.
- **Crystite is sell-only at the Store.** Nobody ever needs to buy
  Crystite back (it has no production use — see §5), so the Store is a
  pure cash sink for it: it always buys, at a published price, but never
  offers it for sale and doesn't carry a "stock" of it in the supply
  sense §6.1 describes for the other three.
- Implementation: a simple continuous double auction — standing bids/asks
  matched by price-time priority within the auction's time window, same
  concept as the original's cartoon-y shouting marketplace but resolved
  as order matching rather than live haggling animation (keeps it
  latency-tolerant).

### 4.5 Events & Scoring

- **Spoilage check** (runs first, right after the Auction — this is the
  player's last chance to sell before losing it): any player holding
  more than their **free storage cap** of a resource loses a portion of
  the excess. Applies to all four resources (Food, Energy, Smithore,
  Crystite) — uniform rule, including Crystite, so there's no "safe"
  hoard even of the pure-money resource; it has to keep moving through
  the economy.
  - **Free storage cap:** placeholder **20 units per resource per
    player**, flat (not scaled by plot/Mule count yet — revisit once
    production numbers exist from playtesting).
  - **Spoilage rate:** placeholder **25% of the amount over the cap**,
    lost (not sold — it just disappears) at round end.
  - Both numbers are tuning items, not final — the mechanic (a cap +
    partial loss above it) is the locked-in part; the specific
    percentages will move during balance passes.
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
| Smithore | Mountain-adjacent plots | Store's raw material for manufacturing new Mules (see §6.1) — also a **monopoly play**: a player can buy up and hoard Smithore (from the Store and from other players) to starve the Store's own Smithore stock, which throttles Mule restocking *and* drives the Mule price up (§6). Selfish and bad for the colony's overall growth, but a legitimate strategy — e.g. to deny rivals Mules, or to resell hoarded Smithore later at an inflated price. |
| Crystite | Hidden deposits (difficulty setting) | Pure money — sell only |

## 6. Mules & store economy

### 6.1 Store starting stock & pricing

The Store holds real, tracked inventory — not an abstract infinite
counterparty — for Food, Energy, and Smithore. Starting stock:

| Resource | Starting stock |
|---|---|
| Food | 50 |
| Energy | 100 |
| Smithore | 100 |

(Round numbers to start balancing from, not derived from a formula yet —
tune once production numbers exist. Crystite has no Store stock — see
§4.4.)

- Selling to the Store increases its stock of that resource; buying from
  the Store decreases it.
- Store **prices float with its own stock level**, same principle as the
  Mule price rule below: low Store stock of a resource → higher price
  (both to buy and to sell back, since the Store badly wants more of it);
  high stock → lower price. Exact curve is a tuning item.
- If Store stock of Food or Energy hits 0, it simply can't sell more
  until restocked by players selling in — it does not go negative or
  print infinite supply.

- **Mule stock:** 12 Mules available at game start (colony-wide supply,
  not per-player). The Store **manufactures new Mules by consuming
  Smithore from its own stock** (a placeholder ratio of **1 Smithore per
  Mule** — tune later) each time its Mule count drops below some target;
  if the Store's Smithore stock runs low or hits 0, restocking slows or
  stops entirely. This is what makes hoarding Smithore a real colony-wide
  threat rather than just a personal inconvenience: it doesn't just make
  existing Mules pricier (§6.2), it can stop new ones from being built at
  all.
- **Starting money** (per player, set by difficulty):
  | Difficulty | Starting cash |
  |---|---|
  | Easy | $1,200 |
  | Normal | $1,000 |
  | Hard | $1,000 |

  **Confirmed:** Hard is the "difficult setting" — Crystite and the
  Assay Office are in play only on Hard. Easy/Normal play
  Food/Energy/Smithore only.

### 6.2 Mule pricing & outfitting

- **Mule price:** base price **$125**, bought for cash only (no Smithore
  cost to buy — Smithore is what a player *produces to sell*, not a
  purchase currency, consistent with §5's resource table). The price
  floats with colony-wide Smithore supply: more Smithore in the
  market/store stockpile pushes the Mule price down (ore is cheap and
  plentiful, Mules are cheap to build); a Smithore shortage pushes the
  price up. Exact curve and min/max bounds are a tuning item — $125 is
  the starting/reference price, not a fixed price.
- **Outfitting cost** (one-time cost to configure a Mule for a resource,
  paid when outfitting or re-outfitting). Smithore mining and Crystite
  mining are **separate outfit types** with separate prices — confirmed
  from the original's store screen, which lists Crystite as its own
  leftmost icon distinct from the ore-mining outfit:
  | Outfit for | Cost |
  |---|---|
  | Food | $25 |
  | Energy | $50 |
  | Smithore mining | $100 |
  | Crystite mining | $175 *(placeholder in the $150–200 range you gave — tune during balance pass)* |
- Placed on a plot the player owns; one Mule per plot.
- Lost to a meteor strike (rare) or can be sold back to the store.
- **Crystite production is a two-step, sequential process** (the
  original's time-crunch, reframed as an action-budget cost rather than
  a clock):
  1. **Assay** the target plot (see §4.2) — free, costs one turn-budget
     action, tells the assaying player whether that plot is
     None/Low/Medium/High for Crystite. This can happen on an earlier
     turn or round than step 2, including before the plot is even
     claimed.
  2. **Place a Crystite-outfitted Mule** on that plot. A Crystite Mule
     placed on an unassayed or zero-deposit plot produces **nothing** —
     there's no production without first confirming the plot is worth
     it, which is the risk/reward the original was going for.
  - Because assaying is private information, a player can scout several
    plots over a few rounds before committing, or may be forced to
    gamble on an un-assayed plot if time/turns are short — this is
    intentional strategic tension, not a bug to smooth away.

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

- Whether to show a live "who's claimed what" feed during Land Grant
  resolution vs. a single end reveal — see §4.1.
- **Mule price curve:** $125 base, floats with colony Smithore supply —
  exact formula and min/max bounds still to be set; will draft in a
  balance pass once M1 is underway.
- **Store Mule restock:** 12 in stock at game start; restock
  rate/trigger once sold out is still open (fixed trickle vs. tied to
  Smithore production).
- **Crystite outfit price:** using $175 as a placeholder within your
  $150–200 range; exact number TBD during balance pass.
- **Assay turn-budget cost:** assumed to cost exactly 1 action, same unit
  as any other turn action (buy, outfit, saloon visit). Confirm this is
  the right weight, or whether assaying should be cheaper/free of the
  action budget entirely given the original framed it as "costs nothing
  but time" rather than a store transaction.
