"use client";

import Decimal from "decimal.js";
import { useState } from "react";
import { useI18n } from "./I18nProvider";
import { buttonClass, Notice, Stat } from "./ui";
import { useWallet } from "./wallet/WalletProvider";
import { DepositPanel } from "./DepositPanel";
import { usd } from "@/lib/format";
import { hlErrorMessage, userExchange } from "@/lib/hl-browser";
import { tradingBalance, type AccountMode } from "@/lib/hyperliquid/balance";

export interface UsdcBalancesView {
  /** Perps (trading) account: value and what can be moved out. */
  perpsValue: string | null;
  perpsWithdrawable: string | null;
  /** Hyperliquid account mode; unified/portfolio-margin accounts keep one balance, reported in spot. */
  mode: AccountMode | null;
  spot: { usdcTotal: string; usdcHold: string } | null;
  hyperEvm: { usdc: string | null; hype: string } | null;
}

const dec = (v: string | null | undefined) => {
  try {
    return new Decimal(v ?? "0");
  } catch {
    return new Decimal(0);
  }
};

/**
 * Where the user's USDC is on Hyperliquid, and a Spot ⇄ Perps transfer
 * (Hyperliquid's usdClassTransfer, signed by the user's own wallet in MetaMask).
 * Only USDC in Perps can be used for trading and bot orders.
 */
export function UsdcBalances({
  view,
  onChange,
}: {
  view: UsdcBalancesView;
  onChange: () => void;
}) {
  const w = useWallet();
  const { L } = useI18n();
  const [toPerp, setToPerp] = useState(true);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{
    tone: "info" | "down";
    text: string;
  } | null>(null);

  const spotAvailable = Decimal.max(
    dec(view.spot?.usdcTotal).minus(dec(view.spot?.usdcHold)),
    0,
  );
  const perpsAvailable = Decimal.max(dec(view.perpsWithdrawable), 0);
  const max = toPerp ? spotAvailable : perpsAvailable;
  const evmUsdc = dec(view.hyperEvm?.usdc);
  const trading = tradingBalance({
    mode: view.mode,
    perpsValue: view.perpsValue,
    perpsWithdrawable: view.perpsWithdrawable,
    spotUsdcTotal: view.spot?.usdcTotal,
    spotUsdcHold: view.spot?.usdcHold,
  });

  let parsed: Decimal | null = null;
  try {
    parsed = amount.trim() ? new Decimal(amount.trim()) : null;
  } catch {
    parsed = null;
  }
  const invalid =
    !parsed ||
    !parsed.isFinite() ||
    parsed.lte(0) ||
    parsed.gt(max) ||
    parsed.decimalPlaces() > 6;

  async function transfer() {
    const provider = w.getProvider();
    const address = w.me?.user?.walletAddress;
    const config = w.me?.config;
    if (!provider || !address || !config || invalid || !parsed) return;
    setBusy(true);
    setMsg(null);
    try {
      const ex = await userExchange(
        provider,
        address,
        config.network,
        config.walletChain,
      );
      await ex.usdClassTransfer({ amount: parsed.toFixed(), toPerp });
      setMsg({
        tone: "info",
        text: `Moved ${parsed.toFixed()} USDC ${toPerp ? "Spot → Perps" : "Perps → Spot"}.`,
      });
      setAmount("");
      onChange();
    } catch (e) {
      setMsg({ tone: "down", text: L(hlErrorMessage(e)) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="usdc-balances">
      {trading.unified ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Stat
            label={
              view.mode === "portfolioMargin"
                ? "Hyperliquid balance (Portfolio margin)"
                : "Hyperliquid balance (Unified account)"
            }
            value={usd(trading.value)}
            hint={`Available to trade ${usd(trading.available)} · one balance for spot and perps`}
            tone="up"
          />
          <Stat
            label="HyperEVM USDC (not tradable)"
            value={
              view.hyperEvm?.usdc === null || !view.hyperEvm
                ? "—"
                : usd(view.hyperEvm.usdc)
            }
            hint="Hyperliquid's EVM chain"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="HyperEVM USDC (not tradable)"
            value={
              view.hyperEvm?.usdc === null || !view.hyperEvm
                ? "—"
                : usd(view.hyperEvm.usdc)
            }
            hint="Hyperliquid's EVM chain"
          />
          <Stat
            label="Hyperliquid Spot USDC"
            value={view.spot ? usd(spotAvailable.toFixed()) : "—"}
            hint={
              dec(view.spot?.usdcHold).gt(0)
                ? `${usd(view.spot!.usdcHold)} on hold`
                : "Move to Perps to trade"
            }
          />
          <Stat
            label="Hyperliquid Perps (trading)"
            value={usd(view.perpsValue)}
            hint={`Withdrawable ${usd(view.perpsWithdrawable)}`}
            tone="up"
          />
        </div>
      )}

      <DepositPanel onDeposited={onChange} />

      {evmUsdc.gt(0) && (
        <Notice tone="warn">
          {usd(evmUsdc.toFixed())} of USDC is on HyperEVM, where it can&apos;t
          be traded. Move it to Hyperliquid on{" "}
          <a
            href="https://app.hyperliquid.xyz/portfolio"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            app.hyperliquid.xyz
          </a>{" "}
          (Balances → transfer USDC from EVM to Core). That needs a little HYPE
          on HyperEVM for gas
          {dec(view.hyperEvm?.hype).lte(0) ? " — this wallet has none yet" : ""}
          . It then appears here in your Hyperliquid balance.
        </Notice>
      )}

      {!trading.unified && (
        <div className="rounded-xl border border-line bg-panel p-4">
          <h3 className="text-sm font-semibold">
            Move USDC between Spot and Perps
          </h3>
          <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
            <div
              role="group"
              aria-label="Direction"
              className="flex overflow-hidden rounded-md border border-line-strong"
            >
              {[
                [true, "Spot → Perps"],
                [false, "Perps → Spot"],
              ].map(([dir, label]) => (
                <button
                  key={String(dir)}
                  type="button"
                  aria-pressed={toPerp === dir}
                  onClick={() => {
                    setToPerp(dir as boolean);
                    setMsg(null);
                  }}
                  className={`px-3 py-1.5 ${toPerp === dir ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}
                >
                  {label as string}
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 gap-2">
              <input
                aria-label="Amount (USDC)"
                inputMode="decimal"
                placeholder="Amount (USDC)"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="num min-w-0 flex-1"
              />
              <button
                type="button"
                className={buttonClass("ghost", "sm")}
                onClick={() =>
                  setAmount(
                    max.toDecimalPlaces(6, Decimal.ROUND_DOWN).toFixed(),
                  )
                }
                disabled={max.lte(0)}
              >
                Max
              </button>
            </div>
            <button
              type="button"
              className={buttonClass("primary", "sm")}
              disabled={busy || invalid}
              onClick={transfer}
            >
              {busy ? "Confirm in MetaMask…" : "Transfer"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Available to move from {toPerp ? "Spot" : "Perps"}:{" "}
            <b className="num text-text">{usd(max.toFixed())}</b>.
            {parsed && parsed.gt(max) ? " That's more than is available." : ""}{" "}
            Signed in MetaMask with your own wallet; the platform never holds
            your funds.
          </p>
          {msg && (
            <div className="mt-2">
              <Notice tone={msg.tone}>{msg.text}</Notice>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
