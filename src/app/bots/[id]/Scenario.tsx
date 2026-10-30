import { Card } from "@/components/ui";
import { capitalRange, isRecoverySizing, scenarioRows } from "@/lib/bots/scenario";
import type { BotConfig } from "@/lib/bots/schema";
import { MIN_ORDER_USD } from "@/lib/engine/manage";

const usdc = (d: { toFixed(n: number): string }) => `${d.toFixed(2)}`;

/**
 * What a staged signal bot does, stage by stage, at the viewer's strategy capital
 * (or an example). Figures are what the platform sizes and where its stop sits;
 * the script's own decisions (take profit, pauses) are shown as the operator wrote them.
 */
export function ScenarioCard({ config, capital }: { config: BotConfig; capital: number | null }) {
  const s = config.scenario;
  if (!s) return null;
  const lev = config.risk.maxLeverage;
  const stop = config.risk.stopLossPct;
  const range = capitalRange(s.stages, lev, MIN_ORDER_USD, config.risk.maxOrderUsd);
  const example = capital ?? (range.min <= range.max ? Math.min(Math.max(1000, range.min), range.max) : 1000);
  const rows = scenarioRows(s.stages, example, lev, stop);
  const last = rows.at(-1)!;
  const worstPct = last.cumulativeLoss.div(example).mul(100);
  return (
    <Card>
      <h2 className="font-semibold">Strategy scenario</h2>
      <p className="mt-2 text-sm text-muted">
        Run by the operator&apos;s own script (e.g. Pine Script on TradingView). Each entry signal names its stage; the platform sizes the order from
        {capital ? " your" : " the subscriber's"} strategy capital and keeps a stop loss on Hyperliquid at −{stop}% price from entry (−{+(stop * lev).toFixed(1)}%
        of the stage&apos;s margin at {lev}x).
      </p>
      <p className="mt-3 text-sm" data-testid="scenario-capital">
        {capital ? (
          <>
            With your strategy capital of <b className="num">{capital} USDC</b>:
          </>
        ) : (
          <>
            Example with <b className="num">{example} USDC</b> strategy capital (subscribers can set {range.min}–{range.max} USDC):
          </>
        )}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm" data-testid="strategy-scenario">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1.5">Stage</th>
              <th className="text-right">Margin</th>
              <th className="text-right">Position ({lev}x)</th>
              <th className="text-right">Loss if stopped</th>
              <th className="text-right">Total if every stage so far stops</th>
            </tr>
          </thead>
          <tbody className="num divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.stage}>
                <td className="py-1.5">{r.stage}</td>
                <td className="text-right">
                  {r.pct}% · {usdc(r.margin)}
                </td>
                <td className="text-right">{usdc(r.notional)}</td>
                <td className="text-right text-down">−{usdc(r.loss)}</td>
                <td className="text-right text-down">
                  −{usdc(r.cumulativeLoss)} ({+r.cumulativeLoss.div(example).mul(100).toFixed(1)}%)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-down" data-testid="scenario-worst-case">
        Worst case: if all {rows.length} stages stop out, about −{usdc(last.cumulativeLoss)} USDC ({+worstPct.toFixed(1)}% of the capital), plus trading fees and
        funding.{isRecoverySizing(s.stages) ? " Later stages are larger: positions grow after losses." : ""}
      </p>
      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-muted">Entry</dt>
          <dd className="whitespace-pre-wrap">{s.entry}</dd>
        </div>
        <div>
          <dt className="text-muted">Take profit</dt>
          <dd className="whitespace-pre-wrap">{s.takeProfit}</dd>
        </div>
        <div>
          <dt className="text-muted">After the last stage</dt>
          <dd className="whitespace-pre-wrap">{s.afterLastStage}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-faint">
        Entry, take profit, stage order and pauses are decided by the operator&apos;s script; the platform can&apos;t see or verify that logic. A signal
        without a valid stage opens nothing. Figures exclude fees, funding and slippage, and a stop can fill worse than its trigger in fast markets.
        Performance shows only real fills of this bot&apos;s orders.
      </p>
    </Card>
  );
}
