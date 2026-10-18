import type { BrowserContext, Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import { hexToString, type Hex } from "viem";

/*
 * Throwaway keys generated for this project's local E2E tests only.
 * They hold no funds and are never used on any network.
 */
export const E2E_KEYS = {
  admin: "0x3a14d35edc61be76e0d3619bfb70af9872cf5dd7b6df16be77bff57b5fc04493",
  owner: "0xc3eb0bd2aa0c6718f281283ffd20645debe71284a3c658eb4d020e008ab1909c",
  trader: "0x3468026fffdbb8ae1cccf4df49aefa52497b2ed9e9aedf531909614becda257b",
  partner: "0xa4d6d8f5470ee18bd62e5e1e5402f9580e4462c8da1b4af2dcc1bc5f23180d3b",
} as const;

export const E2E_ADMIN_ADDRESS = privateKeyToAccount(E2E_KEYS.admin).address;

/**
 * Injects an EIP-1193 provider that behaves like MetaMask (isMetaMask, EIP-6963
 * announce, accountsChanged) and signs with a local test key via a Node binding.
 */
export async function installTestWallet(context: BrowserContext, key: Hex) {
  const account = privateKeyToAccount(key);
  await context.exposeBinding("__ctcSign", async (_src, hexMessage: Hex) => account.signMessage({ message: hexToString(hexMessage) }));
  await context.addInitScript(
    ({ address }) => {
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const w = window as unknown as Record<string, unknown>;
      let current: string = address;
      // Starts on Ethereum mainnet so tests exercise the switch to the HyperEVM testnet.
      let chainId = "0x1";
      w.__ctcChainSwitches = 0;
      const provider = {
        isMetaMask: true,
        async request({ method, params }: { method: string; params?: unknown[] }) {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return current ? [current] : [];
            case "eth_chainId":
              return chainId;
            case "wallet_switchEthereumChain": {
              chainId = (params as { chainId: string }[])[0].chainId;
              w.__ctcChainSwitches = (w.__ctcChainSwitches as number) + 1;
              for (const cb of listeners.chainChanged ?? []) cb(chainId);
              return null;
            }
            case "personal_sign":
              return (w.__ctcSign as (m: string) => Promise<string>)((params as string[])[0]);
            default:
              throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
          }
        },
        on(ev: string, cb: (...a: unknown[]) => void) {
          (listeners[ev] ??= []).push(cb);
        },
        removeListener(ev: string, cb: (...a: unknown[]) => void) {
          listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== cb);
        },
      };
      w.ethereum = provider;
      w.__ctcSwitchAccount = (next: string) => {
        current = next;
        for (const cb of listeners.accountsChanged ?? []) cb(next ? [next] : []);
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: Object.freeze({ info: { uuid: "e2e", name: "MetaMask", rdns: "io.metamask", icon: "" }, provider }),
          }),
        );
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { address: account.address },
  );
  return account;
}

/** Opens the connect dialog, accepts terms and signs in. */
export async function signInViaUi(page: Page) {
  await page.getByTestId("connect-wallet").click();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /연결하고 서명하기/ }).click();
  await page.getByRole("button", { name: "로그아웃" }).waitFor();
}
