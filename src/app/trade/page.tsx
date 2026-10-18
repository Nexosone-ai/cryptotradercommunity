import type { Metadata } from "next";
import { getPublicConfig } from "@/lib/config";
import { TradeTerminal } from "./TradeTerminal";

export const metadata: Metadata = { title: "트레이딩" };
export const dynamic = "force-dynamic";

export default function TradePage() {
  return <TradeTerminal config={getPublicConfig()} />;
}
