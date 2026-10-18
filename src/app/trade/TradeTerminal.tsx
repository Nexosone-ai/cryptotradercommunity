"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buttonClass, cx, Notice } from "@/components/ui";
import { useWallet } from "@/components/wallet/WalletProvider";
import { apiFetch } from "@/lib/client-api";
import type { PublicConfig } from "@/lib/config";
import { dateTime, feeLabel, usd } from "@/lib/format";
import { CandleChart } from "./CandleChart";
import { OrderBook } from "./OrderBook";
import { PermissionsPanel, type AccountPermissions } from "./PermissionsPanel";

interface Market {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  markPx: string;
  funding: string;
  openInterest: string;
  dayNtlVlm: string;
  prevDayPx: string;
}

interface Position {
  position: { coin: string; szi: string; entryPx: string | null; positionValue: string; unrealizedPnl: string; leverage: { value: number; type: string }; liquidationPx: string | null };
}

interface Account extends AccountPermissions {
  network: string;
  fetchedAt: string;
  hlError: string | null;
  state: { marginSummary?: { accountValue: string; totalMarginUsed: string }; withdrawable?: string; assetPositions?: Position[] } | null;
  openOrders: { coin: string; side: string; limitPx: string; sz: string; oid: number; timestamp: number }[];
  orders: { id: string; coin: string; side: string; orderType: string; price: string; size: string; status: string; builderFeeTenthsBp: number; error: string | null; createdAt: string; source: string }[];
}

interface Fill {
  coin: string;
  px: string;
  sz: string;
  side: string;
  time: number;
  fee: string;
  builderFee?: string;
  closedPnl: string;
  tid: number;
}

const FEE_TAKER = 0.00045;

export function TradeTerminal({ config }: { config: PublicConfig }) {
  const w = useWallet();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [coin, setCoin] = useState("BTC");
  const [mid, setMid] = useState<number | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [fills, setFills] = useState<Fill[]>([]);
  const [tab, setTab] = useState<"positions" | "open" | "orders" | "fills">("positions");
  const [marketErr, setMarketErr] = useState<string | null>(null);
  const loggedIn = Boolean(w.me?.user);

  useEffect(() => {
    apiFetch<{ markets: Market[] }>("/api/market/metadata")
      .then((d) => setMarkets(d.markets.sort((a, b) => Number(b.dayNtlVlm) - Number(a.dayNtlVlm))))
      .catch((e) => setMarketErr(e.message));
  }, []);

  const [tick, setTick] = useState(0);
  const loadAccount = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;
    const load = () =>
      Promise.all([apiFetch<Account>("/api/trading/account"), apiFetch<{ fills: Fill[] }>("/api/trading/fills").catch(() => ({ fills: [] as Fill[] }))])
        .then(([a, f]) => {
          if (!alive) return;
          setAccount(a);
          setFills(f.fills);
        })
        .catch(() => alive && setAccount(null));
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [loggedIn, tick]);

  const market = markets.find((m) => m.name === coin);
  const onMid = useCallback((m: number) => setMid(m), []);
  const change = market ? ((Number(market.markPx) - Number(market.prevDayPx)) / Number(market.prevDayPx)) * 100 : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={coin} onChange={(e) => setCoin(e.target.value)} className="w-auto min-w-36 font-semibold" aria-label="마켓 선택">
          {(markets.length ? markets : [{ name: "BTC" } as Market]).map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}-PERP
            </option>
          ))}
        </select>
        {market && (
          <div className="num flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <span>
              <span className="text-muted">Mark </span>
              {market.markPx}
            </span>
            <span className={change !== null && change >= 0 ? "text-up" : "text-down"}>{change?.toFixed(2)}% 24h</span>
            <span>
              <span className="text-muted">Funding </span>
              {(Number(market.funding) * 100).toFixed(4)}%/h
            </span>
            <span>
              <span className="text-muted">OI </span>
              {usd(Number(market.openInterest) * Number(market.markPx), 0)}
            </span>
            <span>
              <span className="text-muted">24h Vol </span>
              {usd(market.dayNtlVlm, 0)}
            </span>
            <span>
              <span className="text-muted">최대 </span>
              {market.maxLeverage}x
            </span>
          </div>
        )}
        <span className={cx("ml-auto rounded px-2 py-0.5 text-xs font-bold", config.network === "mainnet" ? "bg-down/20 text-down" : "bg-warn/15 text-warn")}>
          {config.network === "mainnet" ? "MAINNET 실거래" : "TESTNET — 실제 자금 아님"}
        </span>
      </div>
      {marketErr && <Notice tone="down">{marketErr}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[1fr_260px_320px]">
        <div className="h-[420px] overflow-hidden rounded-xl border border-line bg-panel">
          <CandleChart coin={coin} />
        </div>
        <div className="h-[420px] overflow-hidden rounded-xl border border-line bg-panel">
          <OrderBook key={`${config.network}:${coin}`} coin={coin} network={config.network} onMid={onMid} />
        </div>
        <div className="rounded-xl border border-line bg-panel p-4">
          {loggedIn ? (
            <OrderForm config={config} coin={coin} mid={mid} szDecimals={market?.szDecimals ?? 4} account={account} onPlaced={loadAccount} />
          ) : (
            <div className="space-y-3 text-sm">
              <p className="font-semibold">주문하려면 로그인하세요</p>
              <p className="text-muted">시세·호가는 로그인 없이 볼 수 있습니다.</p>
              <button className={buttonClass("primary") + " w-full"} onClick={w.openConnect}>
                MetaMask 연결
              </button>
            </div>
          )}
        </div>
      </div>

      {loggedIn && (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="rounded-xl border border-line bg-panel">
            <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2 text-sm">
              {(
                [
                  ["positions", "포지션"],
                  ["open", "미체결 (Hyperliquid)"],
                  ["orders", "플랫폼 주문"],
                  ["fills", "체결 내역"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={cx("rounded px-3 py-1", tab === k ? "bg-panel-2" : "text-muted")}>
                  {l}
                </button>
              ))}
              <span className="ml-auto text-[11px] text-faint">{account ? `Hyperliquid ${new Date(account.fetchedAt).toLocaleTimeString("ko-KR", { hour12: false })} 기준` : ""}</span>
            </div>
            <div className="overflow-x-auto p-3">
              {account?.hlError && <Notice tone="down">{account.hlError}</Notice>}
              {tab === "positions" && <PositionsTable account={account} />}
              {tab === "open" && <OpenOrdersTable account={account} />}
              {tab === "orders" && <PlatformOrders account={account} onChange={loadAccount} />}
              {tab === "fills" && <FillsTable fills={fills} />}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-panel p-4">
            <h2 className="mb-3 font-semibold">실거래 전 승인</h2>
            <PermissionsPanel config={config} perms={account} onChange={loadAccount} />
          </div>
        </div>
      )}
    </div>
  );
}

function OrderForm({
  config,
  coin,
  mid,
  szDecimals,
  account,
  onPlaced,
}: {
  config: PublicConfig;
  coin: string;
  mid: number | null;
  szDecimals: number;
  account: Account | null;
  onPlaced: () => void;
}) {
  const [isBuy, setIsBuy] = useState(true);
  const [type, setType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [mainnetOk, setMainnetOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);

  const refPx = type === "LIMIT" && price ? Number(price) : mid;
  const notional = refPx && size ? refPx * Number(size) : 0;
  const fee = config.manualOrderFeeTenthsBp;
  const est = useMemo(
    () => ({ base: notional * FEE_TAKER, builder: (notional * fee) / 100_000 }),
    [notional, fee],
  );
  const accountValue = account?.state?.marginSummary?.accountValue;
  const ready = Boolean(account?.agent) && (fee === 0 || (account?.builder.approvedMaxTenthsBp ?? 0) >= fee);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ order: { status: string; error: string | null } }>("/api/trading/orders", {
        method: "POST",
        body: {
          coin,
          isBuy,
          size,
          orderType: type,
          price: type === "LIMIT" ? price : undefined,
          reduceOnly,
          confirmMainnet: config.network === "mainnet" ? mainnetOk : undefined,
        },
      });
      setMsg({ tone: "info", text: `주문 전송됨 — 상태: ${r.order.status}` });
      setConfirm(false);
      setSize("");
      onPlaced();
    } catch (e) {
      setMsg({ tone: "down", text: e instanceof Error ? e.message : "주문 실패" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-panel-2 p-1">
        <button onClick={() => setIsBuy(true)} className={cx("rounded-md py-2 font-semibold", isBuy ? "bg-up text-black" : "text-muted")}>
          매수 / Long
        </button>
        <button onClick={() => setIsBuy(false)} className={cx("rounded-md py-2 font-semibold", !isBuy ? "bg-down text-white" : "text-muted")}>
          매도 / Short
        </button>
      </div>
      <div className="flex gap-1 text-xs">
        {(["MARKET", "LIMIT"] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} className={cx("rounded px-3 py-1", type === t ? "bg-panel-2 text-text" : "text-muted")}>
            {t === "MARKET" ? "시장가" : "지정가"}
          </button>
        ))}
      </div>
      {type === "LIMIT" && (
        <div>
          <label htmlFor="px">가격 (USDC)</label>
          <input id="px" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={mid?.toString()} />
        </div>
      )}
      <div>
        <label htmlFor="sz">수량 ({coin}, 소수 {szDecimals}자리)</label>
        <input id="sz" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder="0.00" />
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} /> 감소 전용 (청산)
      </label>
      <dl className="num space-y-1 text-xs">
        <div className="flex justify-between">
          <dt className="text-muted">계정 가치</dt>
          <dd>{usd(accountValue)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">주문 금액 (예상)</dt>
          <dd>{usd(notional)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">HL 기본 수수료 (taker 예상)</dt>
          <dd>{usd(est.base, 4)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">추가 Builder Fee ({feeLabel(fee)})</dt>
          <dd>{usd(est.builder, 4)}</dd>
        </div>
      </dl>
      {!ready && <Notice>아래 &lsquo;실거래 전 승인&rsquo;에서 거래 권한{fee > 0 ? "과 Builder Fee" : ""} 승인을 먼저 완료하세요.</Notice>}
      <button
        className={buttonClass("primary") + " w-full"}
        disabled={!ready || !size || Number(size) <= 0 || (type === "LIMIT" && !price)}
        onClick={() => setConfirm(true)}
      >
        주문 확인
      </button>
      <p className="text-[11px] text-faint">수동 주문 1회 한도 {usd(config.maxManualOrderUsd, 0)} · 시장가는 ±5% 슬리피지 IOC로 전송됩니다.</p>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm space-y-3 rounded-t-2xl border border-line bg-panel p-5 sm:rounded-2xl">
            <h3 className="text-lg font-bold">주문 확인</h3>
            <dl className="num space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">네트워크</dt>
                <dd className={config.network === "mainnet" ? "text-down" : "text-warn"}>{config.network.toUpperCase()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">주문</dt>
                <dd className={isBuy ? "text-up" : "text-down"}>
                  {coin} {isBuy ? "매수" : "매도"} {size} ({type === "MARKET" ? "시장가" : `지정가 ${price}`})
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">예상 주문 금액</dt>
                <dd>{usd(notional)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">HL 기본 수수료 (예상)</dt>
                <dd>{usd(est.base, 4)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">추가 Builder Fee</dt>
                <dd>
                  {feeLabel(fee)} · {usd(est.builder, 4)}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted">확정 수수료는 체결 후 Hyperliquid 체결 내역에 표시됩니다. 레버리지 거래는 강제청산될 수 있습니다.</p>
            {config.network === "mainnet" && (
              <label className="flex items-start gap-2 text-sm text-down">
                <input type="checkbox" checked={mainnetOk} onChange={(e) => setMainnetOk(e.target.checked)} className="mt-1" />
                실제 자금으로 메인넷에 주문하는 것을 확인합니다.
              </label>
            )}
            <div className="flex gap-2">
              <button className={buttonClass("secondary") + " flex-1"} onClick={() => setConfirm(false)}>
                취소
              </button>
              <button
                className={buttonClass("primary") + " flex-1"}
                disabled={busy || (config.network === "mainnet" && !mainnetOk)}
                onClick={submit}
              >
                {busy ? "전송 중…" : "주문 전송"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PositionsTable({ account }: { account: Account | null }) {
  const rows = account?.state?.assetPositions ?? [];
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">보유 포지션이 없습니다.</p>;
  return (
    <table className="w-full min-w-[620px] text-sm">
      <thead className="text-left text-xs text-muted">
        <tr>
          <th className="py-1">마켓</th>
          <th className="text-right">수량</th>
          <th className="text-right">진입가</th>
          <th className="text-right">가치</th>
          <th className="text-right">미실현손익</th>
          <th className="text-right">레버리지</th>
          <th className="text-right">청산가</th>
        </tr>
      </thead>
      <tbody className="num divide-y divide-line">
        {rows.map(({ position: p }) => (
          <tr key={p.coin}>
            <td className="py-1.5">{p.coin}</td>
            <td className={`text-right ${Number(p.szi) >= 0 ? "text-up" : "text-down"}`}>{p.szi}</td>
            <td className="text-right">{p.entryPx ?? "—"}</td>
            <td className="text-right">{usd(p.positionValue)}</td>
            <td className={`text-right ${Number(p.unrealizedPnl) >= 0 ? "text-up" : "text-down"}`}>{usd(p.unrealizedPnl)}</td>
            <td className="text-right">
              {p.leverage.value}x {p.leverage.type}
            </td>
            <td className="text-right text-warn">{p.liquidationPx ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OpenOrdersTable({ account }: { account: Account | null }) {
  const rows = account?.openOrders ?? [];
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">미체결 주문이 없습니다.</p>;
  return (
    <table className="w-full min-w-[520px] text-sm">
      <thead className="text-left text-xs text-muted">
        <tr>
          <th className="py-1">시간</th>
          <th>마켓</th>
          <th>방향</th>
          <th className="text-right">가격</th>
          <th className="text-right">수량</th>
        </tr>
      </thead>
      <tbody className="num divide-y divide-line">
        {rows.map((o) => (
          <tr key={o.oid}>
            <td className="py-1.5">{dateTime(new Date(o.timestamp))}</td>
            <td>{o.coin}</td>
            <td className={o.side === "B" ? "text-up" : "text-down"}>{o.side === "B" ? "매수" : "매도"}</td>
            <td className="text-right">{o.limitPx}</td>
            <td className="text-right">{o.sz}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlatformOrders({ account, onChange }: { account: Account | null; onChange: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const rows = account?.orders ?? [];
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">이 플랫폼에서 보낸 주문이 없습니다.</p>;
  return (
    <>
      {err && <Notice tone="down">{err}</Notice>}
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-1">시간</th>
            <th>마켓</th>
            <th>방향</th>
            <th className="text-right">가격</th>
            <th className="text-right">수량</th>
            <th className="text-right">Builder Fee</th>
            <th>상태</th>
            <th />
          </tr>
        </thead>
        <tbody className="num divide-y divide-line">
          {rows.map((o) => (
            <tr key={o.id}>
              <td className="py-1.5">{dateTime(o.createdAt)}</td>
              <td>{o.coin}</td>
              <td className={o.side === "BUY" ? "text-up" : "text-down"}>{o.side === "BUY" ? "매수" : "매도"}</td>
              <td className="text-right">{o.price}</td>
              <td className="text-right">{o.size}</td>
              <td className="text-right">{feeLabel(o.builderFeeTenthsBp)}</td>
              <td title={o.error ?? undefined} className={o.status === "ERROR" || o.status === "REJECTED" ? "text-down" : ""}>
                {o.status}
              </td>
              <td className="text-right">
                {o.status === "RESTING" && (
                  <button
                    className={buttonClass("ghost", "sm")}
                    onClick={async () => {
                      try {
                        await apiFetch(`/api/trading/orders/${o.id}/cancel`, { method: "POST", body: {} });
                        onChange();
                      } catch (e) {
                        setErr(e instanceof Error ? e.message : "취소 실패");
                      }
                    }}
                  >
                    취소
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function FillsTable({ fills }: { fills: Fill[] }) {
  if (!fills.length) return <p className="py-6 text-center text-sm text-muted">체결 내역이 없습니다.</p>;
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead className="text-left text-xs text-muted">
        <tr>
          <th className="py-1">시간</th>
          <th>마켓</th>
          <th>방향</th>
          <th className="text-right">가격</th>
          <th className="text-right">수량</th>
          <th className="text-right">HL 수수료</th>
          <th className="text-right">Builder Fee</th>
          <th className="text-right">실현손익</th>
        </tr>
      </thead>
      <tbody className="num divide-y divide-line">
        {fills.map((f) => (
          <tr key={`${f.tid}-${f.time}`}>
            <td className="py-1.5">{dateTime(new Date(f.time))}</td>
            <td>{f.coin}</td>
            <td className={f.side === "B" ? "text-up" : "text-down"}>{f.side === "B" ? "매수" : "매도"}</td>
            <td className="text-right">{f.px}</td>
            <td className="text-right">{f.sz}</td>
            <td className="text-right">{f.fee}</td>
            <td className="text-right">{f.builderFee ?? "0"}</td>
            <td className={`text-right ${Number(f.closedPnl) >= 0 ? "text-up" : "text-down"}`}>{f.closedPnl}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
