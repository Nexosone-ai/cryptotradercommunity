"use client";

import { CandlestickSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { apiFetch } from "@/lib/client-api";
import { bi } from "@/lib/i18n";

interface Candle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
}

const INTERVALS = ["5m", "15m", "1h", "4h", "1d"] as const;

/** Candles from Hyperliquid (via /api/market/candles), refreshed every 30s. */
export function CandleChart({ coin }: { coin: string }) {
  const { t, L, intl } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [interval, setInterval_] = useState<(typeof INTERVALS)[number]>("1h");
  const [updated, setUpdated] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!el.current) return;
    chart.current = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a96a3" },
      grid: { vertLines: { color: "#161c23" }, horzLines: { color: "#161c23" } },
      rightPriceScale: { borderColor: "#222a33" },
      timeScale: { borderColor: "#222a33", timeVisible: true },
    });
    series.current = chart.current.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });
    return () => chart.current?.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await apiFetch<{ candles: Candle[]; fetchedAt: string }>(`/api/market/candles?coin=${coin}&interval=${interval}`);
        if (!alive) return;
        series.current?.setData(
          d.candles.map((c) => ({ time: Math.floor(c.t / 1000) as UTCTimestamp, open: +c.o, high: +c.h, low: +c.l, close: +c.c })),
        );
        setUpdated(d.fetchedAt);
        setErr(null);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : bi("Chart data error", "차트 데이터 오류"));
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [coin, interval]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs">
        <div className="flex gap-1">
          {INTERVALS.map((i) => (
            <button key={i} onClick={() => setInterval_(i)} className={`rounded px-2 py-0.5 ${i === interval ? "bg-panel-2 text-text" : "text-muted"}`}>
              {i}
            </button>
          ))}
        </div>
        <span className={err ? "text-down" : "text-faint"}>
          {err !== null
            ? L(err)
            : updated
              ? (() => {
                  const time = new Date(updated).toLocaleTimeString(intl, { hour12: false });
                  return t(`Hyperliquid candles · updated ${time}`, `Hyperliquid 캔들 · ${time} 갱신`);
                })()
              : t("Loading…", "불러오는 중…")}
        </span>
      </div>
      <div ref={el} className="min-h-[280px] flex-1" />
    </div>
  );
}
