"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, Notice } from "@/components/ui";
import { useWallet } from "@/components/wallet/WalletProvider";
import { apiFetch } from "@/lib/client-api";

export function JoinButton({ code, signedIn }: { code: string; signedIn: boolean }) {
  const w = useWallet();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!signedIn && !w.me?.user) {
    return (
      <button className={buttonClass("primary") + " w-full py-3"} onClick={w.openConnect}>
        Connect MetaMask to join
      </button>
    );
  }
  return (
    <div className="space-y-3">
      <button
        className={buttonClass("primary") + " w-full py-3"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await apiFetch("/api/partner/join", { method: "POST", body: { code } });
            router.push("/partner");
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't join.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Join as an affiliate
      </button>
      {error && <Notice tone="down">{error}</Notice>}
    </div>
  );
}
