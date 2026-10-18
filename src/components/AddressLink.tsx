"use client";

import { useState } from "react";
import { checksum, shortAddress } from "@/lib/format";
import { explorerAddressUrl } from "@/lib/hyperliquid/format";

/** Checksum address with copy button and Hyperliquid explorer link. */
export function AddressLink({ address, network, full = false }: { address: string; network: "testnet" | "mainnet"; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  const cs = checksum(address);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a
        href={explorerAddressUrl(cs, network)}
        target="_blank"
        rel="noopener noreferrer"
        className="num break-all text-accent hover:underline"
        title={cs}
      >
        {full ? cs : shortAddress(cs)}
      </a>
      <button
        type="button"
        className="rounded border border-line-strong px-1.5 py-0.5 text-[11px] text-muted hover:text-text"
        onClick={async () => {
          await navigator.clipboard.writeText(cs);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "복사됨" : "복사"}
      </button>
    </span>
  );
}
