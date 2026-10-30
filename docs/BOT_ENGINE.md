# Bot execution engine

The engine turns a bot's trading signals into orders on each subscriber's own Hyperliquid account. Code: `src/lib/engine/`.

## Status
- `BOT_ENGINE_ENABLED=true` turns it on. On mainnet it also needs `MAINNET_TRADING_ENABLED=true`, so either flag alone stops every bot order.
- **Mainnet enabled on 2026-10-29 at the user's explicit request.** This skipped the testnet trial run and the security review recommended in MASTER_PROMPT Phase 3; the user accepted that risk.
- Mainnet bot orders pass the gate's per-order mainnet confirmation on the strength of the subscription consent plus the amount per trade the subscriber set. Subscriptions from before the engine have no amount, so they never trade until the subscriber sets one.
- Works with two execution modes:
  - **External signal webhook** (`WEBHOOK_SIGNAL`), for example TradingView alerts from a Pine Script.
  - **Platform template, Trend Following**: an EMA(9)/EMA(21) crossover on closed candles of the bot's timeframe.
- Not automated yet: the Grid, Martingale and TP Trading templates and verified strategy packages. Those bots show a warning to the owner and place no orders.

## Signals
A signal names a **target position** (`LONG`, `SHORT` or `FLAT`) for one coin of the bot. It is stored once in `bot_signals`, deduplicated by `(bot, network, dedupe_key)`.

**Webhook**
- Endpoint: `POST /api/bots/{botId}/signal`.
- Body: `{"token":"ctc_…","action":"long|short|close","coin":"BTC","id":"{{timenow}}"}`. `buy`, `sell`, `flat` and `exit` also work, and TradingView tickers like `BTCUSDT.P` are accepted.
- The token is in the body because TradingView can't set headers.
- Without `id`, signals are deduplicated per action, coin and minute.
- The endpoint answers `202` at once. Orders are placed after the response (`after()`, `maxDuration` 60s).

**Template**
- Runs on the engine tick (every minute).
- The dedupe key is the crossover candle, so each crossover acts once.
- New subscribers wait for the next crossover.

**Bot direction:** a LONG-only bot turns `SHORT` into `FLAT`, and a SHORT-only bot turns `LONG` into `FLAT`.

## What happens for each subscriber
Each subscriber runs at most once per signal (`bot_executions`, unique `(signal, subscription)`). Signals of one bot run one at a time (`engine_locks`).

1. **Reconcile.** The engine only ever trades the position **it opened** (`bot_positions`), capped at what is still open on Hyperliquid. If the stop fired or the user closed the position, the engine forgets it. Manual positions in the same coin are never closed beyond the bot's own size.
2. **Repeat signal:** if the bot already holds the target side, nothing happens.
3. **Close** the opposite position with a reduce-only market order, and cancel its stop. Only what actually closed counts: if the close fills partly, the rest stays tracked with its stop and nothing new opens.
4. **Open** a market position of the subscriber's **amount per trade**. The amount must be at least 11 USDC and is capped at the bot's max order.
   - Before opening, cross leverage is set to the bot's max leverage (best effort).
   - Opening is skipped once today's (UTC) realized PnL minus fees of this subscription's orders reaches the bot's daily loss limit.
   - Opening is skipped while any position of the subscription has no stop loss (see Safety).
   - Opening is skipped if the account would reach Hyperliquid's maintenance margin before the stop triggers (cross margin: equity − loss at the stop < 1.5 × maintenance margin, with maintenance = half the initial margin at the market's max leverage). The stop-loss % is a price move from entry, not a share of the margin.
5. **Stop loss.** A reduce-only `STOP_MARKET` trigger order rests on Hyperliquid at entry ± the bot's stop-loss %. If it can't be placed, the new position is closed immediately (fail closed), and the close is checked on Hyperliquid. Whatever is still open is tracked **without a stop**, recorded as a CRITICAL `UNPROTECTED_POSITION` risk event, and handled by the guard.

## Safety
- **Lost order responses.** If Hyperliquid doesn't answer (timeout, network), the order may still have reached it. The gate looks the order up by cloid (`orderStatus`) a few times. If found, the order row gets Hyperliquid's result (`ORDER_RESPONSE_LOST`, WARN). If not, the row is `UNKNOWN` (`ORDER_RESULT_UNKNOWN`, CRITICAL) and the engine reads the position on Hyperliquid to see what the order did. An answer with an error (`HlRejectedError`) is `REJECTED`: nothing was placed.
- **Every minute** (`runSafetyTick`, after the strategies): `reconcileOrders` asks Hyperliquid again about `UNKNOWN`/`PENDING` orders (after 10 minutes an unknown cloid is `ERROR`: it never reached Hyperliquid). `guardPositions` checks every tracked position under its bot's lock: closed on Hyperliquid → forgotten; still open but its stop isn't resting (it failed, or was canceled) → the stop is placed again at entry ± stop-loss %, or the position is closed.
- **Admin → System → Engine health** shows the last engine run, the last signal, bot orders of the last 24 hours by result (including "result unknown"), open bot positions and how many have no stop, the last settlement sync, and critical risk events.

**The order gate.** Every order goes through `placeOrder` with `source: "BOT"`, so all of its checks apply:
- the subscription is active and the bot is LIVE;
- the fee is the subscriber's accepted fee, within the caps;
- trading permission (agent wallet) is active;
- the Builder Fee approval is checked live on Hyperliquid;
- the market is one of the bot's markets;
- max order size and Hyperliquid's minimums are respected.

**Position cap:** there is no pyramiding, so a bot position is never larger than one order, which is at most `maxOrderUsd` (≤ `maxPositionUsd`).

## Copy trading
A lead trader registers a bot with the **Copy trading** strategy type, which uses the execution mode **Copy my Hyperliquid trades** (`COPY_TRADE`). It goes through the same review as any bot: submit, admin approves, then the leader publishes it (LIVE). The leader's fee is the bot fee: each follower consents to it, and it is charged as the Builder Fee on every copied order. The leader earns the bot-owner share of the settled Builder Fee.

- **Source:** the leader trades on their own Hyperliquid account, the bot owner's verified wallet, either on Hyperliquid or on `/trade`. Only the bot's listed markets are copied.
- **Detection** (`lib/engine/copy.ts#runCopyTick`, every minute from the same cron):
  - The engine reads the leader's positions and account value. A change in a market's position size since the last look becomes a `COPY` signal, whose payload holds the previous and new size, the leader's account value and leverage.
  - The first look at a market records only a baseline (`IGNORED`). Positions already open then are not copied.
- **Sizing (proportional):**
  - Follower size = leader size × follower allocation ÷ leader account value, at the leader's leverage. This is capped by the bot's max position and max leverage, and each order is capped by its max order.
  - The allocation is stored in `bot_subscriptions.order_usd`: 20 to 1,000,000 USDC.
  - A trade under Hyperliquid's 10 USDC minimum at the follower's allocation is skipped.
- **What followers copy** (`planCopy`):
  - A new leader position or a flip: opened, closing the opposite side first.
  - Adds and reductions: applied to the follower's copied position.
  - Closes: closed.
  - A follower who joins while the leader already holds a position starts with the leader's next new position.
- **Protection:**
  - Each copied position keeps one reduce-only stop at the bot's stop-loss % from the average entry. After an add or a reduction, the new stop is placed before the old one is canceled.
  - If no stop can be placed, the position is closed (fail closed).
  - The daily loss limit blocks opening or growing positions, but not reducing or closing them.
- **Latency:** followers trade up to about a minute after the leader, at their own fill prices.

## Running it
**Vercel (production)**
- `vercel.json` cron calls `/api/cron/engine` every minute. It runs the template tick and the copy-trading tick, and retries signals left `RECEIVED` for more than 2 minutes.
- `/api/cron/settlement` runs every 5 minutes and pulls fills, so performance and Builder Fee events update.
- Both cron routes require `Authorization: Bearer $CRON_SECRET`; Vercel sends this automatically when `CRON_SECRET` is set.
- Webhook signals don't wait for cron.

**Other hosts:** `npm run worker:bots` runs the same tick in a loop. It is safe to run alongside cron, because signals and executions are idempotent.

**Scale limit:** 200 subscribers per signal, handled sequentially within one function run. Beyond that a queue worker is needed.

## What a subscriber must do
The bot page lists every condition with ✓/✗ ("Bot trading for you"):
- subscribe and set an amount per trade;
- approve trading permission and the Builder Fee on `/trade`;
- have USDC in their Hyperliquid account (testnet faucet: app.hyperliquid-testnet.xyz/drip).

Owners can't subscribe to their own bot, so testing needs a second wallet.

## Kill switches
| Switch | Effect |
|---|---|
| Owner pauses the bot | No new orders. Open positions keep their stops. |
| Subscriber unsubscribes | No new orders for them. |
| `BOT_ENGINE_ENABLED` or (mainnet) `MAINNET_TRADING_ENABLED` unset | The whole engine stops. Signals are recorded as IGNORED. |
| Rotate the webhook token | The old alerts stop. |
