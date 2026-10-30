import type { Metadata } from "next";
import { Card, LinkButton, Notice } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current";
import { getI18n } from "@/lib/i18n-server";
import { swapOpen } from "@/lib/swap/config";
import { SwapApp } from "./SwapApp";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("P2P swap", "P2P 스왑") };
}
export const dynamic = "force-dynamic";

export default async function SwapPage() {
  if (swapOpen()) return <SwapApp />;
  const user = await getCurrentUser();
  if (user?.roles.includes("ADMIN")) {
    return (
      <div className="space-y-4">
        <Notice tone="info">Swap is not open yet. Users see an &quot;opening soon&quot; page; only admins can see the swap below.</Notice>
        <SwapApp />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl" data-testid="swap-coming-soon">
      <Card className="py-12 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Preparing</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">P2P swap is opening soon</h1>
        <p className="mt-3 text-sm text-muted">We&apos;re getting peer-to-peer token swaps ready. They will open here soon.</p>
        <div className="mt-6 flex justify-center gap-2">
          <LinkButton href="/bots">Browse bots</LinkButton>
          <LinkButton href="/trade" variant="secondary">
            Trade
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}
