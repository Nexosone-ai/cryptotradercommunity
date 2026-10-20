import { apiContext } from "@/lib/api";
import { swapDeployments } from "@/lib/db/schema";
import { handler, json } from "@/lib/http";
import artifact from "@/lib/swap/artifact.json";
import { getSwapConfig } from "@/lib/swap/config";

/** Enabled swap chains with their verified settlement contract (if deployed). */
export const GET = handler(async () => {
  const { db } = await apiContext();
  const cfg = getSwapConfig();
  const deployments = await db.select().from(swapDeployments);
  const byChain = new Map(deployments.map((d) => [d.chainId, d]));
  return json({
    network: cfg.network,
    abi: artifact.abi,
    chains: cfg.chains.map((c) => ({
      ...c,
      contractAddress: byChain.get(c.id)?.contractAddress ?? null,
      deployedAt: byChain.get(c.id)?.verifiedAt ?? null,
    })),
  });
});
