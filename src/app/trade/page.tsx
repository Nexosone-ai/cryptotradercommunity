import type { Metadata } from "next";
import { getPublicConfig } from "@/lib/config";
import { getI18n } from "@/lib/i18n-server";
import { TradeTerminal } from "./TradeTerminal";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Trade", "트레이딩") };
}
export const dynamic = "force-dynamic";

export default function TradePage() {
  return <TradeTerminal config={getPublicConfig()} />;
}
