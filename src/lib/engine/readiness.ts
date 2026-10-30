import Decimal from "decimal.js";
import type { SessionUser } from "../auth/session";
import { isCopyBot, type BotConfig } from "../bots/schema";
import { getConfig } from "../config";
import type { Db } from "../db/client";
import type { botSubscriptions, bots } from "../db/schema";
import { feeLabel } from "../format";
import { tradingBalance } from "../hyperliquid/balance";
import type { HlGateway } from "../hyperliquid/gateway";
import { activeAgent } from "../trading/service";
import { engineAvailability } from "./execute";
import { usesTrendTemplate } from "./trend";

export interface ReadinessItem {
  key: string;
  ok: boolean;
  label: string;
  hint?: string;
  href?: string;
}

/** Everything that must be true before the engine can place this subscriber's bot orders. */
export async function subscriberReadiness(
  db: Db,
  hl: HlGateway,
  user: SessionUser,
  bot: typeof bots.$inferSelect,
  sub: typeof botSubscriptions.$inferSelect,
): Promise<ReadinessItem[]> {
  const cfg = getConfig();
  const config = bot.config as BotConfig;
  const engine = engineAvailability();
  const copy = isCopyBot(config);
  const items: ReadinessItem[] = [
    { key: "engine", ok: engine.enabled, label: "Bot engine running", hint: engine.reason ?? undefined },
    {
      key: "bot",
      ok: bot.status === "LIVE" && (copy || config.executionMode === "WEBHOOK_SIGNAL" || usesTrendTemplate(config)),
      label: copy ? "Lead trader is live and being copied" : "Bot is live and sends signals",
      hint:
        bot.status !== "LIVE"
          ? "The owner has paused this bot."
          : copy || config.executionMode === "WEBHOOK_SIGNAL"
            ? undefined
            : usesTrendTemplate(config)
              ? undefined
              : "This bot's strategy template isn't automated yet; only Trend Following templates and external signal bots trade.",
    },
    { key: "subscription", ok: sub.status === "ACTIVE", label: "Subscription active", hint: sub.status === "REQUIRES_RECONSENT" ? "Re-consent to the changed settings below." : undefined },
    copy
      ? {
          key: "amount",
          ok: Boolean(sub.orderUsd),
          label: sub.orderUsd ? `Copy allocation: ${sub.orderUsd} USDC` : "Copy allocation set",
          hint: sub.orderUsd ? undefined : "Set how many USDC copy the leader (below).",
        }
      : config.scenario
        ? {
            key: "amount",
            ok: Boolean(sub.orderUsd),
            label: sub.orderUsd ? `Strategy capital: ${sub.orderUsd} USDC` : "Strategy capital set",
            hint: sub.orderUsd ? undefined : "Set the capital the staged scenario sizes its entries from (below).",
          }
        : {
            key: "amount",
            ok: Boolean(sub.orderUsd),
            label: sub.orderUsd ? `Amount per trade: ${Math.min(sub.orderUsd, config.risk.maxOrderUsd)} USDC` : "Amount per trade set",
            hint: sub.orderUsd ? undefined : "Set how many USDC the bot opens per signal (below).",
          },
  ];

  const agent = await activeAgent(db, user.id, hl.network);
  items.push({
    key: "agent",
    ok: Boolean(agent),
    label: "Trading permission (agent wallet) approved",
    hint: agent ? `Valid until ${agent.validUntil.toISOString().slice(0, 10)}` : "Approve it on the Trade page.",
    href: agent ? undefined : "/trade",
  });

  if (sub.acceptedFeeTenthsBp > 0) {
    if (!cfg.builderAddress) {
      items.push({ key: "builder", ok: false, label: "Builder Fee approval", hint: "The operator hasn't set the platform Builder address yet." });
    } else {
      let approved: number | null = null;
      try {
        approved = await hl.maxBuilderFee(user.walletAddress, cfg.builderAddress);
      } catch {
        approved = null;
      }
      items.push({
        key: "builder",
        ok: approved !== null && approved >= sub.acceptedFeeTenthsBp,
        label: `Builder Fee approved up to at least ${feeLabel(sub.acceptedFeeTenthsBp)}`,
        hint: approved === null ? "Couldn't check Hyperliquid right now." : approved >= sub.acceptedFeeTenthsBp ? undefined : `Currently approved: ${feeLabel(approved)}. Approve on the Trade page.`,
        href: approved !== null && approved >= sub.acceptedFeeTenthsBp ? undefined : "/trade",
      });
    }
  }

  // Unified/portfolio-margin accounts report their USDC in spot, not perps (see hyperliquid/balance.ts).
  let accountValue: Decimal | null = null;
  try {
    const [mode, state, spot] = await Promise.all([
      hl.accountMode(user.walletAddress).catch(() => null),
      hl.clearinghouseState(user.walletAddress) as Promise<{ marginSummary?: { accountValue?: string }; withdrawable?: string }>,
      hl.spotBalances(user.walletAddress),
    ]);
    const usdc = spot.find((b) => b.coin === "USDC");
    accountValue = new Decimal(
      tradingBalance({ mode, perpsValue: state.marginSummary?.accountValue, perpsWithdrawable: state.withdrawable, spotUsdcTotal: usdc?.total, spotUsdcHold: usdc?.hold }).value,
    );
  } catch {
    accountValue = null;
  }
  // Copy trading: the allocation is capital the copied positions use, so the account should hold at least that much.
  // Staged scenario: the strategy capital is what the stages are sized from, so the account should hold it.
  const needed = copy || config.scenario ? new Decimal(sub.orderUsd ?? 1) : sub.orderUsd ? Decimal.min(sub.orderUsd, config.risk.maxOrderUsd).div(config.risk.maxLeverage) : new Decimal(1);
  items.push({
    key: "funds",
    ok: accountValue !== null && accountValue.gte(needed),
    label: accountValue === null ? "Hyperliquid account funded" : `Hyperliquid account value: ${accountValue.toFixed(2)} USDC`,
    hint:
      accountValue === null
        ? "Couldn't check Hyperliquid right now."
        : accountValue.lte(0)
          ? cfg.isMainnet
            ? "Deposit USDC to your Hyperliquid account."
            : "Get test USDC from the Hyperliquid testnet faucet (app.hyperliquid-testnet.xyz/drip)."
          : copy && accountValue.lt(needed)
            ? `Below your copy allocation (${needed.toFixed()} USDC): deposit more or lower the allocation, or copied trades may be rejected.`
            : config.scenario && accountValue.lt(needed)
              ? `Below your strategy capital (${needed.toFixed()} USDC): deposit more or lower the capital, or later stages may be rejected.`
              : undefined,
  });
  return items;
}
