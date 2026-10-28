import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n-server";
import { SwapApp } from "./SwapApp";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("P2P swap", "P2P 스왑") };
}
export const dynamic = "force-dynamic";

export default function SwapPage() {
  return <SwapApp />;
}
