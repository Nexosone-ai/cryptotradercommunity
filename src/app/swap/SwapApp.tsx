"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAddress, zeroAddress, type Abi, type Address, type Hex } from "viem";
import { useI18n } from "@/components/I18nProvider";
import { Badge, buttonClass, Card, cx, EmptyState, Notice, SectionTitle } from "@/components/ui";
import { useWallet } from "@/components/wallet/WalletProvider";
import { apiFetch } from "@/lib/client-api";
import { dateTime, shortAddress } from "@/lib/format";
import { bi } from "@/lib/i18n";
import type { SwapChain } from "@/lib/swap/chains";
import { explorerAddress, explorerTx } from "@/lib/swap/chains";
import { ensureAllowance, swapClients, tokenBalance, walletErrorMessage } from "@/lib/swap/browser";
import { SWAP_FEE_NOTICE, SWAP_RESPONSIBILITY_NOTICE } from "@/lib/swap/notices";
import { fromUnits, ORDER_TYPES, orderPrice, sellAmountForPayment, swapDomain, toUnits, type SwapOrder } from "@/lib/swap/order";

interface ChainView extends SwapChain {
  contractAddress: string | null;
}
interface Config {
  network: "testnet" | "mainnet";
  abi: Abi;
  chains: ChainView[];
}
interface Token {
  id: string;
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  listed: boolean;
}
interface OrderView {
  id: string;
  orderHash: string;
  status: string;
  filledBuyAmount: string;
  remainingBuyAmount: string;
  createdAt: string;
  order: Record<keyof SwapOrder, string>;
  signature: Hex;
}

const EXPIRIES = [
  ["1 hour", "1시간", 3600],
  ["1 day", "1일", 86400],
  ["7 days", "7일", 7 * 86400],
  ["30 days", "30일", 30 * 86400],
] as const;

const nowMs = () => Date.now();

function toOrder(o: OrderView["order"]): SwapOrder {
  return {
    maker: getAddress(o.maker),
    sellToken: getAddress(o.sellToken),
    buyToken: getAddress(o.buyToken),
    sellAmount: BigInt(o.sellAmount),
    buyAmount: BigInt(o.buyAmount),
    taker: getAddress(o.taker),
    expiry: BigInt(o.expiry),
    nonce: BigInt(o.nonce),
  };
}

export function SwapApp() {
  const w = useWallet();
  const { t, L } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tokenA, setTokenA] = useState<string>("");
  const [tokenB, setTokenB] = useState<string>("");
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [mine, setMine] = useState<OrderView[]>([]);
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    apiFetch<Config>("/api/swap/config")
      .then((c) => {
        setConfig(c);
        setChainId((id) => id ?? c.chains[0]?.id ?? null);
      })
      .catch((e) => setMsg({ tone: "down", text: e.message }));
  }, []);

  const chain = config?.chains.find((c) => c.id === chainId) ?? null;

  useEffect(() => {
    if (!chainId) return;
    let alive = true;
    apiFetch<{ tokens: Token[] }>(`/api/swap/tokens?chainId=${chainId}`)
      .then((d) => alive && setTokens(d.tokens))
      .catch(() => alive && setTokens([]));
    return () => {
      alive = false;
    };
  }, [chainId, tick]);

  useEffect(() => {
    if (!chainId) return;
    let alive = true;
    const pair = tokenA && tokenB ? `&tokenA=${tokenA}&tokenB=${tokenB}` : "";
    apiFetch<{ orders: OrderView[] }>(`/api/swap/orders?chainId=${chainId}${pair}`)
      .then((d) => alive && setOrders(d.orders))
      .catch(() => alive && setOrders([]));
    if (w.me?.user) {
      apiFetch<{ orders: OrderView[] }>(`/api/swap/orders?chainId=${chainId}&mine=1`)
        .then((d) => alive && setMine(d.orders))
        .catch(() => alive && setMine([]));
    }
    return () => {
      alive = false;
    };
  }, [chainId, tokenA, tokenB, tick, w.me?.user]);

  const tokenOf = useMemo(() => new Map(tokens.map((tk) => [tk.address, tk])), [tokens]);

  if (!config) return <p className="text-sm text-muted">{t("Loading…", "불러오는 중…")}</p>;

  return (
    <div className="space-y-6">
      <SectionTitle
        title={t("P2P swap", "P2P 스왑")}
        desc={t(
          "Other users fill orders that a seller has priced and signed. A fill swaps both tokens at once in a single smart-contract transaction, and the platform never holds your tokens.",
          "판매자가 가격을 정해 서명한 주문을 다른 사용자가 체결합니다. 체결은 스마트 컨트랙트 한 번의 트랜잭션으로 양쪽 토큰이 동시에 교환되며, 플랫폼은 토큰을 보관하지 않습니다.",
        )}
      />
      <div className="rounded-lg border border-warn/50 bg-warn/10 px-4 py-3 text-sm text-warn" data-testid="swap-notices">
        <p className="font-semibold">{L(SWAP_FEE_NOTICE)}</p>
        <p className="mt-1 font-semibold">{L(SWAP_RESPONSIBILITY_NOTICE)}</p>
        <p className="mt-1 text-xs text-warn/80">
          {t(
            "You set and check the price, counterparty and tokens yourself. Blockchain network gas fees are paid from each user's own wallet.",
            "가격·상대방·토큰은 이용자가 직접 정하고 확인합니다. 블록체인 네트워크 가스비는 각 이용자의 지갑에서 지불됩니다.",
          )}
        </p>
      </div>
      {config.network === "testnet" && (
        <Notice tone="info">
          {t(
            "Testnet only. Mainnet swaps will be enabled only after an external security audit of the contract.",
            "테스트넷 전용입니다. 메인넷 스왑은 컨트랙트 외부 보안 감사 후에만 활성화됩니다.",
          )}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("Select chain", "체인 선택")}>
        {config.chains.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={c.id === chainId}
            onClick={() => {
              setChainId(c.id);
              setTokenA("");
              setTokenB("");
            }}
            className={cx(
              "rounded-lg border px-3 py-2 text-left text-sm",
              c.id === chainId ? "border-accent bg-accent/10" : "border-line text-muted hover:border-line-strong",
            )}
          >
            <span className="block font-semibold text-text">{L(c.shortName)}</span>
            <span className="text-[11px]">
              {L(c.name)} · {L(c.tokenStandard)}
            </span>
          </button>
        ))}
      </div>

      {chain && !chain.contractAddress && (
        <Notice>
          {t(
            "No swap contract has been deployed on this chain yet, so orders and fills aren't available. It becomes active once the operator deploys it from the admin screen.",
            "이 체인에는 아직 스왑 컨트랙트가 배포되지 않아 주문·체결을 할 수 없습니다. 운영자가 관리자 화면에서 배포하면 활성화됩니다.",
          )}
        </Notice>
      )}
      {chain?.contractAddress && (
        <p className="text-xs text-muted">
          {t("Swap contract", "스왑 컨트랙트")}{" "}
          <a className="num text-accent underline" href={explorerAddress(chain, chain.contractAddress)} target="_blank" rel="noopener noreferrer">
            {shortAddress(chain.contractAddress)}
          </a>{" "}
          {t("(deployed code verified by the server)", "(서버가 배포 코드를 검증함)")}
        </p>
      )}
      {msg && <Notice tone={msg.tone}>{L(msg.text)}</Notice>}

      {chain && (
        <>
          <PairPicker
            chain={chain}
            tokens={tokens}
            tokenA={tokenA}
            tokenB={tokenB}
            setTokenA={setTokenA}
            setTokenB={setTokenB}
            onAdded={reload}
            setMsg={setMsg}
          />
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <OrderBook chain={chain} abi={config.abi} orders={orders} tokenOf={tokenOf} tokenA={tokenA} tokenB={tokenB} onChange={reload} setMsg={setMsg} />
            <CreateOrder chain={chain} tokenOf={tokenOf} tokenA={tokenA} tokenB={tokenB} onCreated={reload} setMsg={setMsg} />
          </div>
          {w.me?.user && <MyOrders chain={chain} abi={config.abi} orders={mine} tokenOf={tokenOf} onChange={reload} setMsg={setMsg} />}
        </>
      )}
    </div>
  );
}

type SetMsg = (m: { tone: "info" | "down"; text: string } | null) => void;

function TokenLabel({ t: tok }: { t?: Token }) {
  const { t, L } = useI18n();
  if (!tok) return <span className="text-faint">?</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <b>{L(tok.symbol)}</b>
      {!tok.listed && <Badge tone="warn">{t("Custom", "커스텀")}</Badge>}
    </span>
  );
}

function PairPicker({
  chain,
  tokens,
  tokenA,
  tokenB,
  setTokenA,
  setTokenB,
  onAdded,
  setMsg,
}: {
  chain: ChainView;
  tokens: Token[];
  tokenA: string;
  tokenB: string;
  setTokenA: (v: string) => void;
  setTokenB: (v: string) => void;
  onAdded: () => void;
  setMsg: SetMsg;
}) {
  const w = useWallet();
  const { t, L } = useI18n();
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const opt = (tk: Token) => (
    <option key={tk.id} value={tk.address}>
      {L(tk.symbol)} {tk.listed ? "" : t("(custom)", "(커스텀)")} — {shortAddress(tk.address)}
    </option>
  );
  return (
    <Card className="grid gap-4 md:grid-cols-[1fr_1fr_1.4fr]">
      <div>
        <label htmlFor="ta">{t("Token A", "토큰 A")}</label>
        <select id="ta" value={tokenA} onChange={(e) => setTokenA(e.target.value)}>
          <option value="">{t("Select", "선택")}</option>
          {tokens.filter((tk) => tk.address !== tokenB).map(opt)}
        </select>
      </div>
      <div>
        <label htmlFor="tb">{t("Token B", "토큰 B")}</label>
        <select id="tb" value={tokenB} onChange={(e) => setTokenB(e.target.value)}>
          <option value="">{t("Select", "선택")}</option>
          {tokens.filter((tk) => tk.address !== tokenA).map(opt)}
        </select>
      </div>
      <div>
        <label htmlFor="addtoken">
          {t(
            <>Add a custom token ({L(chain.tokenStandard)} contract address)</>,
            <>커스텀 토큰 추가 ({L(chain.tokenStandard)} 컨트랙트 주소)</>,
          )}
        </label>
        <div className="flex gap-2">
          <input id="addtoken" value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder="0x…" className="num" />
          <button
            className={buttonClass("secondary", "sm") + " shrink-0 whitespace-nowrap"}
            disabled={busy || !addr || !w.me?.user}
            title={w.me?.user ? undefined : t("Sign-in required", "로그인이 필요합니다")}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await apiFetch<{ token: Token }>("/api/swap/tokens", { method: "POST", body: { chainId: chain.id, address: addr } });
                setMsg({
                  tone: "info",
                  text: bi(
                    `Added ${r.token.symbol} (${r.token.decimals} decimals).`,
                    `${r.token.symbol} (${r.token.decimals} decimals)를 추가했습니다.`,
                  ),
                });
                setAddr("");
                onAdded();
              } catch (e) {
                setMsg({ tone: "down", text: e instanceof Error ? e.message : bi("Couldn't add the token.", "추가 실패") });
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Add", "추가")}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-faint">
          {t(
            "Token info (symbol, decimals) is read directly from the chain. Fills are rejected for tokens that charge a transfer fee.",
            "토큰 정보(symbol·decimals)는 체인에서 직접 읽습니다. 전송 수수료가 붙는 토큰은 체결이 거부됩니다.",
          )}
        </p>
      </div>
    </Card>
  );
}

function OrderBook({
  chain,
  abi,
  orders,
  tokenOf,
  tokenA,
  tokenB,
  onChange,
  setMsg,
}: {
  chain: ChainView;
  abi: Abi;
  orders: OrderView[];
  tokenOf: Map<string, Token>;
  tokenA: string;
  tokenB: string;
  onChange: () => void;
  setMsg: SetMsg;
}) {
  const w = useWallet();
  const { t } = useI18n();
  const [filling, setFilling] = useState<OrderView | null>(null);
  if (!tokenA || !tokenB) {
    return (
      <EmptyState
        title={t("Select tokens A and B", "토큰 A와 B를 선택하세요")}
        desc={t("Orders in both directions between the two selected tokens are shown.", "선택한 두 토큰 사이의 양방향 주문이 표시됩니다.")}
      />
    );
  }
  const A = tokenOf.get(tokenA);
  const B = tokenOf.get(tokenB);
  const open = orders.filter((o) => o.status === "OPEN" && o.order.maker.toLowerCase() !== w.me?.user?.walletAddress);
  const side = (sell: string) => open.filter((o) => o.order.sellToken.toLowerCase() === sell);
  const onBuy = (o: OrderView) => (w.me?.user ? setFilling(o) : w.openConnect());

  return (
    <Card className="space-y-6">
      <OrderTable chain={chain} sell={A} buy={B} rows={side(tokenA)} onBuy={onBuy} />
      <OrderTable chain={chain} sell={B} buy={A} rows={side(tokenB)} onBuy={onBuy} />
      {filling && (
        <FillDialog
          chain={chain}
          abi={abi}
          view={filling}
          sell={tokenOf.get(filling.order.sellToken.toLowerCase())}
          buy={tokenOf.get(filling.order.buyToken.toLowerCase())}
          onClose={() => setFilling(null)}
          onDone={() => {
            setFilling(null);
            onChange();
          }}
          setMsg={setMsg}
        />
      )}
    </Card>
  );
}

function OrderTable({
  chain,
  sell,
  buy,
  rows,
  onBuy,
}: {
  chain: ChainView;
  sell?: Token;
  buy?: Token;
  rows: OrderView[];
  onBuy: (o: OrderView) => void;
}) {
  const { t, L } = useI18n();
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        {t(
          <>
            Orders selling <TokenLabel t={sell} /> — pay with <TokenLabel t={buy} />
          </>,
          <>
            <TokenLabel t={sell} /> 판매 주문 — <TokenLabel t={buy} />로 구매
          </>,
        )}
      </h3>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t("No orders.", "주문이 없습니다.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1">
                  {t("Price", "가격")} ({buy ? L(buy.symbol) : undefined}/{sell ? L(sell.symbol) : undefined})
                </th>
                <th className="text-right">
                  {t("Remaining", "남은 수량")} ({sell ? L(sell.symbol) : undefined})
                </th>
                <th>{t("Seller", "판매자")}</th>
                <th>{t("Expires", "만료")}</th>
                <th />
              </tr>
            </thead>
            <tbody className="num divide-y divide-line">
              {rows.map((o) => {
                const ord = toOrder(o.order);
                const remainingSell = sellAmountForPayment(ord, BigInt(o.remainingBuyAmount));
                return (
                  <tr key={o.id}>
                    <td className="py-1.5">{sell && buy ? orderPrice(ord.sellAmount, sell.decimals, ord.buyAmount, buy.decimals) : "—"}</td>
                    <td className="text-right">{sell ? fromUnits(remainingSell, sell.decimals) : "—"}</td>
                    <td>{shortAddress(o.order.maker)}</td>
                    <td>{L(dateTime(new Date(Number(o.order.expiry) * 1000)))}</td>
                    <td className="text-right">
                      <button
                        className={buttonClass("primary", "sm")}
                        disabled={!chain.contractAddress}
                        onClick={() => onBuy(o)}
                      >
                        {t("Buy", "구매")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FillDialog({
  chain,
  abi,
  view,
  sell,
  buy,
  onClose,
  onDone,
  setMsg,
}: {
  chain: ChainView;
  abi: Abi;
  view: OrderView;
  sell?: Token;
  buy?: Token;
  onClose: () => void;
  onDone: () => void;
  setMsg: SetMsg;
}) {
  const w = useWallet();
  const { t, L } = useI18n();
  const ord = toOrder(view.order);
  const remaining = BigInt(view.remainingBuyAmount);
  const [pay, setPay] = useState(buy ? fromUnits(remaining, buy.decimals) : "");
  const [ack, setAck] = useState(Boolean(sell?.listed && buy?.listed));
  const [step, setStep] = useState<string | null>(null);
  let payUnits = 0n;
  let err: string | null = null;
  try {
    payUnits = buy ? toUnits(pay || "0", buy.decimals) : 0n;
    if (payUnits > remaining) err = bi("That's more than the remaining amount.", "남은 수량보다 많습니다.");
  } catch (e) {
    err = e instanceof Error ? e.message : bi("Invalid format", "형식 오류");
  }
  const receive = sellAmountForPayment(ord, payUnits);

  async function run() {
    const provider = w.getProvider();
    if (!provider || !w.me?.user || !chain.contractAddress || !buy || !sell) return;
    try {
      setStep(bi("Switching wallet network…", "지갑 네트워크 전환…"));
      const c = await swapClients(provider, chain, getAddress(w.me.user.walletAddress));
      const have = await tokenBalance(c, ord.buyToken);
      if (have < payUnits) throw new Error(bi(`Insufficient ${buy.symbol} balance.`, `${buy.symbol} 잔고가 부족합니다.`));
      setStep(bi(`Checking ${buy.symbol} spending approval…`, `${buy.symbol} 사용 승인 확인…`));
      await ensureAllowance(c, ord.buyToken, getAddress(chain.contractAddress), payUnits);
      setStep(bi("Signing the fill transaction…", "체결 트랜잭션 서명…"));
      const hash = await c.wallet.writeContract({
        address: getAddress(chain.contractAddress),
        abi,
        functionName: "fill",
        args: [ord, view.signature, payUnits],
      });
      setStep(bi("Waiting for block confirmation…", "블록 확인 대기…"));
      const receipt = await c.pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(bi("The fill transaction failed.", "체결 트랜잭션이 실패했습니다."));
      await apiFetch("/api/swap/fills", { method: "POST", body: { chainId: chain.id, txHash: hash } });
      const got = fromUnits(receive, sell.decimals);
      const tx = explorerTx(chain, hash);
      setMsg({
        tone: "info",
        text: bi(`Filled: received ${got} ${sell.symbol} (${tx})`, `체결 완료: ${got} ${sell.symbol} 수령 (${tx})`),
      });
      onDone();
    } catch (e) {
      setMsg({ tone: "down", text: walletErrorMessage(e) });
      setStep(null);
    }
  }

  const maxPay = buy ? fromUnits(remaining, buy.decimals) : "?";
  const price = sell && buy ? orderPrice(ord.sellAmount, sell.decimals, ord.buyAmount, buy.decimals) : "?";
  const sellSym = sell ? L(sell.symbol) : undefined;
  const buySym = buy ? L(buy.symbol) : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md space-y-4 rounded-t-2xl border border-line bg-panel p-5 sm:rounded-2xl">
        <h3 className="text-lg font-bold">
          {t(
            <>
              Buy {sellSym} ({L(chain.shortName)})
            </>,
            <>
              {sellSym} 구매 ({L(chain.shortName)})
            </>,
          )}
        </h3>
        <div>
          <label htmlFor="pay">
            {t(
              <>
                {buySym} to pay (max {maxPay})
              </>,
              <>
                지불할 {buySym} (최대 {maxPay})
              </>,
            )}
          </label>
          <input id="pay" inputMode="decimal" value={pay} onChange={(e) => setPay(e.target.value)} className="num" />
          {err && <p className="mt-1 text-xs text-down">{L(err)}</p>}
        </div>
        <p className="num text-sm">
          {t("You receive: ", "받을 수량: ")}
          <b>{sell ? fromUnits(receive, sell.decimals) : "?"}</b> {sellSym}
          <span className="block text-xs text-muted">
            {t(
              <>
                Price {price} {buySym}/{sellSym} · fractions are rounded down
              </>,
              <>
                가격 {price} {buySym}/{sellSym} · 소수점 이하는 내림
              </>,
            )}
          </span>
        </p>
        {!(sell?.listed && buy?.listed) && (
          <label className="flex items-start gap-2 text-sm text-warn">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
            {t(
              "This includes a custom token that the operator hasn't verified. I have checked the token contract address and value myself and understand the risk of loss.",
              "운영자가 검증하지 않은 커스텀 토큰이 포함되어 있습니다. 토큰 컨트랙트 주소와 가치를 직접 확인했으며 손실 위험을 이해합니다.",
            )}
          </label>
        )}
        <p className="text-xs text-muted">
          {t(
            <>
              In your wallet you&apos;ll confirm ① the {buySym} spending approval (if needed) and ② the fill transaction. You pay the gas fees.
            </>,
            <>지갑에서 ① {buySym} 사용 승인(필요한 경우) ② 체결 트랜잭션을 확인합니다. 가스비는 본인 부담입니다.</>,
          )}
        </p>
        <p className="text-xs font-semibold text-warn">
          {L(SWAP_FEE_NOTICE)} {L(SWAP_RESPONSIBILITY_NOTICE)}
        </p>
        {step && <p className="text-sm text-accent">{L(step)}</p>}
        <div className="flex gap-2">
          <button className={buttonClass("secondary") + " flex-1"} onClick={onClose} disabled={Boolean(step)}>
            {t("Cancel", "취소")}
          </button>
          <button className={buttonClass("primary") + " flex-1"} disabled={Boolean(err) || payUnits === 0n || !ack || Boolean(step)} onClick={run}>
            {t("Fill order", "체결하기")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateOrder({
  chain,
  tokenOf,
  tokenA,
  tokenB,
  onCreated,
  setMsg,
}: {
  chain: ChainView;
  tokenOf: Map<string, Token>;
  tokenA: string;
  tokenB: string;
  onCreated: () => void;
  setMsg: SetMsg;
}) {
  const w = useWallet();
  const { t, L } = useI18n();
  const [flip, setFlip] = useState(false);
  const [sellAmt, setSellAmt] = useState("");
  const [buyAmt, setBuyAmt] = useState("");
  const [expiry, setExpiry] = useState<number>(86400);
  const [ack, setAck] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const sell = tokenOf.get(flip ? tokenB : tokenA);
  const buy = tokenOf.get(flip ? tokenA : tokenB);
  const custom = Boolean(sell && buy && !(sell.listed && buy.listed));

  let sellUnits = 0n;
  let buyUnits = 0n;
  let err: string | null = null;
  try {
    if (sell && sellAmt) sellUnits = toUnits(sellAmt, sell.decimals);
    if (buy && buyAmt) buyUnits = toUnits(buyAmt, buy.decimals);
  } catch (e) {
    err = e instanceof Error ? e.message : bi("Invalid format", "형식 오류");
  }

  if (!sell || !buy) {
    return (
      <Card>
        <h2 className="font-semibold">{t("Create an order", "주문 만들기")}</h2>
        <p className="mt-2 text-sm text-muted">{t("Select tokens A and B above.", "위에서 토큰 A와 B를 선택하세요.")}</p>
      </Card>
    );
  }

  async function submit() {
    const provider = w.getProvider();
    if (!provider || !w.me?.user || !chain.contractAddress || !sell || !buy) return;
    try {
      setStep(bi("Switching wallet network…", "지갑 네트워크 전환…"));
      const maker = getAddress(w.me.user.walletAddress);
      const contract = getAddress(chain.contractAddress);
      const c = await swapClients(provider, chain, maker);
      const have = await tokenBalance(c, getAddress(sell.address));
      if (have < sellUnits) {
        const held = fromUnits(have, sell.decimals);
        throw new Error(bi(`Insufficient ${sell.symbol} balance (you hold ${held}).`, `${sell.symbol} 잔고가 부족합니다 (보유 ${held}).`));
      }
      setStep(bi(`Checking ${sell.symbol} spending approval…`, `${sell.symbol} 사용 승인 확인…`));
      await ensureAllowance(c, getAddress(sell.address), contract, sellUnits);
      const order: SwapOrder = {
        maker,
        sellToken: getAddress(sell.address),
        buyToken: getAddress(buy.address),
        sellAmount: sellUnits,
        buyAmount: buyUnits,
        taker: zeroAddress,
        expiry: BigInt(Math.floor(nowMs() / 1000) + expiry),
        // Time-based nonce: unique per order and compatible with cancelUpTo().
        nonce: BigInt(nowMs()),
      };
      setStep(bi("Signing the order (no gas)…", "주문 서명 (가스비 없음)…"));
      const signature = await c.wallet.signTypedData({
        account: maker,
        domain: swapDomain(chain.id, contract),
        types: ORDER_TYPES,
        primaryType: "Order",
        message: order,
      });
      setStep(bi("Registering the order…", "주문 등록…"));
      await apiFetch("/api/swap/orders", {
        method: "POST",
        body: {
          chainId: chain.id,
          signature,
          order: Object.fromEntries(Object.entries(order).map(([k, v]) => [k, String(v)])),
        },
      });
      setMsg({
        tone: "info",
        text: bi(
          "Your order is registered. When another user fills it, the tokens are swapped automatically.",
          "주문이 등록되었습니다. 다른 사용자가 체결하면 토큰이 자동으로 교환됩니다.",
        ),
      });
      setSellAmt("");
      setBuyAmt("");
      setStep(null);
      onCreated();
    } catch (e) {
      setMsg({ tone: "down", text: walletErrorMessage(e) });
      setStep(null);
    }
  }

  const sellSym = L(sell.symbol);
  const buySym = L(buy.symbol);

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{t("Create a sell order", "판매 주문 만들기")}</h2>
        <button className={buttonClass("ghost", "sm")} onClick={() => setFlip((f) => !f)}>
          {t("⇅ Switch direction", "⇅ 방향 바꾸기")}
        </button>
      </div>
      <div>
        <label htmlFor="sellamt">{t(<>{sellSym} to sell</>, <>판매할 {sellSym}</>)}</label>
        <input id="sellamt" inputMode="decimal" value={sellAmt} onChange={(e) => setSellAmt(e.target.value)} className="num" placeholder="0.0" />
      </div>
      <div>
        <label htmlFor="buyamt">{t(<>{buySym} to receive (total)</>, <>받을 {buySym} (총액)</>)}</label>
        <input id="buyamt" inputMode="decimal" value={buyAmt} onChange={(e) => setBuyAmt(e.target.value)} className="num" placeholder="0.0" />
      </div>
      <p className="num text-sm">
        {t("Price: ", "가격: ")}
        <b>{sellUnits > 0n && buyUnits > 0n ? orderPrice(sellUnits, sell.decimals, buyUnits, buy.decimals) : "—"}</b> {buySym} / 1 {sellSym}
      </p>
      <div>
        <label htmlFor="exp">{t("Valid for", "유효기간")}</label>
        <select id="exp" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
          {EXPIRIES.map(([en, ko, s]) => (
            <option key={s} value={s}>
              {t(en, ko)}
            </option>
          ))}
        </select>
      </div>
      {custom && (
        <label className="flex items-start gap-2 text-sm text-warn">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
          {t(
            "Custom tokens haven't been verified by the operator. I understand the price is a fixed price I set, not a market price, and a fill can't be reversed.",
            "커스텀 토큰은 운영자 검증 전입니다. 가격은 시장가가 아니라 내가 정한 고정 가격이며, 체결되면 되돌릴 수 없음을 이해합니다.",
          )}
        </label>
      )}
      {err && <p className="text-xs text-down">{L(err)}</p>}
      <p className="text-xs text-muted">
        {t(
          <>
            ① Approve the contract to spend the {sellSym} amount you&apos;re selling (approve) ② sign the order (no gas). The tokens stay in
            your wallet until the moment of the fill. Cancel on-chain from &lsquo;My orders&rsquo; below.
          </>,
          <>
            ① {sellSym} 판매 수량만큼 컨트랙트 사용 승인(approve) ② 주문 서명(가스비 없음). 토큰은 체결 순간까지 내 지갑에 있습니다. 취소는 아래 &lsquo;내 주문&rsquo;에서 온체인으로 합니다.
          </>,
        )}
      </p>
      <p className="text-xs font-semibold text-warn">
        {L(SWAP_FEE_NOTICE)} {L(SWAP_RESPONSIBILITY_NOTICE)}
      </p>
      {step && <p className="text-sm text-accent">{L(step)}</p>}
      {w.me?.user ? (
        <button
          className={buttonClass("primary") + " w-full"}
          disabled={!chain.contractAddress || Boolean(err) || sellUnits === 0n || buyUnits === 0n || (custom && !ack) || Boolean(step)}
          onClick={submit}
        >
          {t("Sign and register order", "주문 서명하고 등록")}
        </button>
      ) : (
        <button className={buttonClass("primary") + " w-full"} onClick={w.openConnect}>
          {t("Connect MetaMask", "MetaMask 연결")}
        </button>
      )}
    </Card>
  );
}

function MyOrders({
  chain,
  abi,
  orders,
  tokenOf,
  onChange,
  setMsg,
}: {
  chain: ChainView;
  abi: Abi;
  orders: OrderView[];
  tokenOf: Map<string, Token>;
  onChange: () => void;
  setMsg: SetMsg;
}) {
  const w = useWallet();
  const { t, L } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);

  async function cancel(v: OrderView) {
    const provider = w.getProvider();
    if (!provider || !w.me?.user || !chain.contractAddress) return;
    setBusy(v.id);
    try {
      const c = await swapClients(provider, chain, getAddress(w.me.user.walletAddress) as Address);
      const hash = await c.wallet.writeContract({ address: getAddress(chain.contractAddress), abi, functionName: "cancel", args: [toOrder(v.order)] });
      const receipt = await c.pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(bi("The cancel transaction failed.", "취소 트랜잭션이 실패했습니다."));
      await apiFetch(`/api/swap/orders/${v.id}/sync`, { method: "POST", body: {} });
      setMsg({ tone: "info", text: bi("Order cancelled on-chain.", "주문을 온체인에서 취소했습니다.") });
      onChange();
    } catch (e) {
      setMsg({ tone: "down", text: walletErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <SectionTitle
        title={t("My orders", "내 주문")}
        desc={t(
          "A cancellation only takes effect once the contract processes it (because the signature is public).",
          "주문 취소는 컨트랙트에서 처리해야 효력이 있습니다 (서명이 공개되어 있기 때문).",
        )}
      />
      {orders.length === 0 ? (
        <p className="text-sm text-muted">{t("You have no orders on this chain.", "이 체인에 등록한 주문이 없습니다.")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-panel-2 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">{t("Created", "등록")}</th>
                <th className="px-3 py-2">{t("Selling", "판매")}</th>
                <th className="px-3 py-2">{t("Total to receive", "받을 총액")}</th>
                <th className="px-3 py-2">{t("Filled", "체결")}</th>
                <th className="px-3 py-2">{t("Status", "상태")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="num divide-y divide-line">
              {orders.map((v) => {
                const s = tokenOf.get(v.order.sellToken.toLowerCase());
                const b = tokenOf.get(v.order.buyToken.toLowerCase());
                const pct = (BigInt(v.filledBuyAmount) * 100n) / BigInt(v.order.buyAmount);
                return (
                  <tr key={v.id}>
                    <td className="px-3 py-2">{L(dateTime(v.createdAt))}</td>
                    <td className="px-3 py-2">
                      {s ? fromUnits(BigInt(v.order.sellAmount), s.decimals) : "?"} {s ? L(s.symbol) : undefined}
                    </td>
                    <td className="px-3 py-2">
                      {b ? fromUnits(BigInt(v.order.buyAmount), b.decimals) : "?"} {b ? L(b.symbol) : undefined}
                    </td>
                    <td className="px-3 py-2">{pct.toString()}%</td>
                    <td className="px-3 py-2">
                      <Badge tone={v.status === "OPEN" ? "accent" : v.status === "FILLED" ? "up" : "neutral"}>{v.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {v.status === "OPEN" && (
                        <button className={buttonClass("danger", "sm")} disabled={busy !== null} onClick={() => cancel(v)}>
                          {busy === v.id ? t("Cancelling…", "취소 중…") : t("Cancel on-chain", "온체인 취소")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
