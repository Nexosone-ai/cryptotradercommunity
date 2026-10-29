"use client";

import { AreaSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";

/** Cumulative realized net PnL from verified fills (lightweight-charts, Apache-2.0). */
export function PnlChart({ data }: { data: { time: number; value: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 220,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a96a3" },
      grid: { vertLines: { color: "#1a2028" }, horzLines: { color: "#1a2028" } },
      rightPriceScale: { borderColor: "#222a33" },
      timeScale: { borderColor: "#222a33" },
      // The site is English-only; without this the axis follows the computer's language (e.g. "26일").
      localization: { locale: "en-US" },
      autoSize: true,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#19d3c5",
      topColor: "rgba(25,211,197,0.25)",
      bottomColor: "rgba(25,211,197,0.02)",
    });
    // lightweight-charts requires strictly increasing times.
    const dedup = new Map<number, number>();
    for (const p of data) dedup.set(p.time, p.value);
    series.setData([...dedup].map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [data]);
  return <div ref={ref} className="h-[220px] w-full" />;
}
