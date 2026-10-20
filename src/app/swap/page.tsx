import type { Metadata } from "next";
import { SwapApp } from "./SwapApp";

export const metadata: Metadata = { title: "P2P 스왑" };
export const dynamic = "force-dynamic";

export default function SwapPage() {
  return <SwapApp />;
}
