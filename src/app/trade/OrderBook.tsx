"use client";

import { SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";

interface Level {
  px: string;
  sz: string;
  n: number;
}

type WsState = "connecting" | "live" | "stale" | "error";

/**
 * Live L2 book over Hyperliquid WebSocket. The SDK transport reconnects with
 * backoff and re-subscribes; each message is a full snapshot, so a reconnect
 * restores state without merging deltas.
 */
export function OrderBook({ coin, network, onMid }: { coin: string; network: "testnet" | "mainnet"; onMid?: (mid: number) => void }) {
  const { t } = useI18n();
  const [bids, setBids] = useState<Level[]>([]);
  const [asks, setAsks] = useState<Level[]>([]);
  const [state, setState] = useState<WsState>("connecting");
  const lastAt = useRef<number | null>(null);

  useEffect(() => {
    const transport = new WebSocketTransport({ isTestnet: network === "testnet" });
    const client = new SubscriptionClient({ transport });
    let lastTime = 0;
    let unsub: (() => Promise<void>) | null = null;
    let cancelled = false;
    client
      .l2Book({ coin }, (ev) => {
        if (ev.time <= lastTime) return; // drop duplicate / out-of-order snapshots
        lastTime = ev.time;
        const [b, a] = ev.levels;
        setBids(b.slice(0, 12));
        setAsks(a.slice(0, 12));
        lastAt.current = Date.now();
        setState("live");
        if (b[0] && a[0]) onMid?.((Number(b[0].px) + Number(a[0].px)) / 2);
      })
      .then((s) => {
        if (cancelled) void s.unsubscribe();
        else unsub = () => s.unsubscribe();
      })
      .catch(() => setState("error"));
    const watchdog = setInterval(() => {
      if (lastAt.current && Date.now() - lastAt.current > 15_000) setState("stale");
    }, 5_000);
    return () => {
      cancelled = true;
      clearInterval(watchdog);
      void unsub?.();
      transport.close();
    };
  }, [coin, network, onMid]);

  const maxSz = Math.max(1, ...bids.map((l) => +l.sz), ...asks.map((l) => +l.sz));
  const Row = ({ l, side }: { l: Level; side: "bid" | "ask" }) => (
    <div className="relative grid grid-cols-2 px-3 py-0.5 text-xs">
      <div
        className={`absolute inset-y-0 right-0 ${side === "bid" ? "bg-up/10" : "bg-down/10"}`}
        style={{ width: `${(+l.sz / maxSz) * 100}%` }}
      />
      <span className={`num relative ${side === "bid" ? "text-up" : "text-down"}`}>{l.px}</span>
      <span className="num relative text-right">{l.sz}</span>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs">
        <span className="font-semibold">
          {t("Order book", "호가")} · {coin}
        </span>
        <span className={state === "live" ? "text-up" : state === "connecting" ? "text-muted" : "text-warn"}>
          ●{" "}
          {state === "live"
            ? t("Live", "실시간")
            : state === "connecting"
              ? t("Connecting", "연결 중")
              : state === "stale"
                ? t("Delayed (reconnecting)", "지연됨 (재연결 중)")
                : t("Connection error", "연결 오류")}
        </span>
      </div>
      <div className="grid grid-cols-2 px-3 py-1 text-[11px] text-faint">
        <span>{t("Price", "가격")}</span>
        <span className="text-right">{t("Size", "수량")}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        {[...asks].reverse().map((l) => (
          <Row key={`a${l.px}`} l={l} side="ask" />
        ))}
        <div className="my-1 border-y border-line py-1 text-center text-[11px] text-faint">
          {bids[0] && asks[0]
            ? (() => {
                const spread = (+asks[0].px - +bids[0].px).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
                return t(`Spread ${spread}`, `스프레드 ${spread}`);
              })()
            : "—"}
        </div>
        {bids.map((l) => (
          <Row key={`b${l.px}`} l={l} side="bid" />
        ))}
      </div>
    </div>
  );
}
