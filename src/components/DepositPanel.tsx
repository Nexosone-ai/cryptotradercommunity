"use client";

import Decimal from "decimal.js";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, erc20Abi, http, parseUnits } from "viem";
import { useI18n } from "./I18nProvider";
import { buttonClass, Notice } from "./ui";
import { ensureWalletChain, useWallet } from "./wallet/WalletProvider";
import { WALLET_CHAINS } from "@/lib/chains";
import { shortAddress, usd } from "@/lib/format";
import { hlErrorMessage } from "@/lib/hl-browser";
import { depositProblem, HL_DEPOSIT, MIN_DEPOSIT_USDC } from "@/lib/hl-deposit";

/**
 * Deposit USDC from Arbitrum into the user's own Hyperliquid account, signed in
 * MetaMask: an ordinary USDC transfer to Hyperliquid's bridge, which credits the
 * sending address. The platform never touches the funds.
 */
export function DepositPanel({ onDeposited }: { onDeposited?: () => void }) {
  const w = useWallet();
  const { L } = useI18n();
  const config = w.me?.config;
  const address = w.me?.user?.walletAddress as `0x${string}` | undefined;
  const dep = config ? HL_DEPOSIT[config.network] : null;
  const chain = dep ? WALLET_CHAINS[dep.chainId] : null;
  const [bal, setBal] = useState<{ usdc: Decimal; eth: Decimal } | null>(null);
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string; tx?: string } | null>(null);

  const fetchBalances = useCallback(async (): Promise<{ usdc: Decimal; eth: Decimal } | null> => {
    if (!dep || !chain || !address) return null;
    const client = createPublicClient({ transport: http(chain.rpcUrl, { timeout: 8_000 }) });
    try {
      const [usdc, eth] = await Promise.all([
        client.readContract({ address: dep.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
        client.getBalance({ address }),
      ]);
      return { usdc: new Decimal(usdc.toString()).div(1e6), eth: new Decimal(eth.toString()).div(1e18) };
    } catch {
      return null;
    }
  }, [dep, chain, address]);
  const readBalances = useCallback(() => fetchBalances().then(setBal), [fetchBalances]);
  useEffect(() => {
    fetchBalances().then(setBal);
  }, [fetchBalances]);

  if (!dep || !chain || !address || !config) return null;
  const problem = depositProblem(amount, bal?.usdc ?? null);
  const noGas = bal !== null && bal.eth.lte(0);

  async function deposit() {
    const provider = w.getProvider();
    if (!provider || !dep || !chain || !address || !config || problem) return;
    setBusy(true);
    setMsg(null);
    try {
      await ensureWalletChain(provider, chain);
      const wallet = createWalletClient({ account: address, transport: custom(provider) });
      const value = parseUnits(new Decimal(amount.trim()).toFixed(), 6);
      const hash = await wallet.sendTransaction({
        account: address,
        chain: null,
        to: dep.usdc,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [dep.bridge, value] }),
      });
      const client = createPublicClient({ transport: http(chain.rpcUrl, { timeout: 30_000 }) });
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error("The deposit transaction failed on Arbitrum; no USDC was moved.");
      setMsg({ tone: "info", text: `Deposited ${amount.trim()} USDC. Hyperliquid credits it to ${shortAddress(address)} within about a minute.`, tx: hash });
      setAmount("");
      setConfirming(false);
      void readBalances();
      // Hyperliquid credits within ~1 minute: refresh the account view after that.
      setTimeout(() => onDeposited?.(), 60_000);
      onDeposited?.();
      // Back to the chain the site signs on, so the next approval doesn't stop at a network prompt.
      await ensureWalletChain(provider, config.walletChain).catch(() => {});
    } catch (e) {
      setMsg({ tone: "down", text: L(hlErrorMessage(e)) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-panel p-4 text-sm" data-testid="deposit-panel">
      <h3 className="font-semibold">Deposit USDC to Hyperliquid</h3>
      <p className="mt-1 text-xs text-muted">
        From your wallet&apos;s {dep.usdcSymbol} on <b>{chain.name}</b> straight into your Hyperliquid trading account ({shortAddress(address)}).
        Signed in MetaMask; the platform never holds your funds.
      </p>
      <p className="mt-2 text-xs">
        On {chain.name}: <b className="num">{bal ? usd(bal.usdc.toFixed()) : "—"}</b> {dep.usdcSymbol} ·{" "}
        <span className={noGas ? "text-warn" : ""}>{bal ? `${bal.eth.toSignificantDigits(4).toFixed()} ETH for gas` : "—"}</span>
      </p>
      <div className="mt-3 flex gap-2">
        <input
          aria-label="Deposit amount (USDC)"
          inputMode="decimal"
          placeholder={`Amount (min ${MIN_DEPOSIT_USDC.toFixed()} USDC)`}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setConfirming(false);
          }}
          className="num min-w-0 flex-1"
        />
        <button
          type="button"
          className={buttonClass("ghost", "sm")}
          disabled={!bal || bal.usdc.lt(MIN_DEPOSIT_USDC)}
          onClick={() => {
            setAmount(bal!.usdc.toDecimalPlaces(6, Decimal.ROUND_DOWN).toFixed());
            setConfirming(false);
          }}
        >
          Max
        </button>
        {!confirming && (
          <button type="button" className={buttonClass("primary", "sm")} disabled={Boolean(problem) || noGas} onClick={() => setConfirming(true)}>
            Deposit
          </button>
        )}
      </div>
      {amount.trim() && problem && <p className="mt-2 text-xs text-warn">{problem}</p>}
      {noGas && <p className="mt-2 text-xs text-warn">You need a little ETH on {chain.name} to pay the network fee.</p>}
      {confirming && !problem && (
        <div className="mt-3 space-y-2 rounded-md border border-accent/50 bg-accent/10 p-3" data-testid="deposit-confirm">
          <p>
            Send <b className="num">{new Decimal(amount.trim()).toFixed()} {dep.usdcSymbol}</b> on {chain.name} to Hyperliquid&apos;s bridge{" "}
            <a href={`${chain.explorerUrl}/address/${dep.bridge}`} target="_blank" rel="noopener noreferrer" className="num underline">
              {shortAddress(dep.bridge)}
            </a>
            . It is credited to your Hyperliquid account {shortAddress(address)}.
          </p>
          <div className="flex gap-2">
            <button type="button" className={buttonClass("primary", "sm")} disabled={busy} onClick={deposit}>
              {busy ? "Confirm in MetaMask…" : "Confirm deposit in MetaMask"}
            </button>
            <button type="button" className={buttonClass("ghost", "sm")} disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && (
        <div className="mt-3">
          <Notice tone={msg.tone}>
            {msg.text}{" "}
            {msg.tx && (
              <a href={`${chain.explorerUrl}/tx/${msg.tx}`} target="_blank" rel="noopener noreferrer" className="underline">
                View transaction
              </a>
            )}
          </Notice>
        </div>
      )}
    </div>
  );
}
