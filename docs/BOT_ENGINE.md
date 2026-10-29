# Bot execution engine

The engine turns a bot's trading signals into orders on each subscriber's own Hyperliquid account. Code: `src/lib/engine/`.

## Status
- **Testnet only.** `BOT_ENGINE_ENABLED=true` turns it on, and it only runs when `HL_NETWORK=testnet`. Mainnet bot orders stay impossible until the engine has been audited (MASTER_PROMPT Phase 3).
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
3. **Close** the opposite position with a reduce-only market order, and cancel its stop.
4. **Open** a market position of the subscriber's **amount per trade**. The amount must be at least 11 USDC and is capped at the bot's max order.
   - Before opening, cross leverage is set to the bot's max leverage (best effort).
   - Opening is skipped once today's (UTC) realized PnL minus fees of this subscription's orders reaches the bot's daily loss limit.
5. **Stop loss.** A reduce-only `STOP_MARKET` trigger order rests on Hyperliquid at entry ± the bot's stop-loss %. If it can't be placed, the new position is closed immediately (fail closed).

**The order gate.** Every order goes through `placeOrder` with `source: "BOT"`, so all of its checks apply:
- the subscription is active and the bot is LIVE;
- the fee is the subscriber's accepted fee, within the caps;
- trading permission (agent wallet) is active;
- the Builder Fee approval is checked live on Hyperliquid;
- the market is one of the bot's markets;
- max order size and Hyperliquid's minimums are respected.

**Position cap:** there is no pyramiding, so a bot position is never larger than one order, which is at most `maxOrderUsd` (≤ `maxPositionUsd`).

## Running it
**Vercel (production)**
- `vercel.json` cron calls `/api/cron/engine` every minute, which runs the template tick and retries signals left `RECEIVED` for more than 2 minutes.
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
| `BOT_ENGINE_ENABLED` unset | The whole engine stops. Signals are recorded as IGNORED. |
| Rotate the webhook token | The old alerts stop. |
