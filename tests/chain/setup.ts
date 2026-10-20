import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/**
 * Starts a local Hardhat node that reports chain id 11155111 so the real swap
 * server code (RPC reader, code verification, signature checks, event
 * decoding) runs against a real EVM. Nothing touches a public network.
 */
const PORT = 8599;
let node: ChildProcess | undefined;

async function rpcUp(url: string) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function setup() {
  const url = `http://127.0.0.1:${PORT}`;
  node = spawn("npx", ["hardhat", "node", "--chain-id", "11155111", "--port", String(PORT)], {
    cwd: path.join(process.cwd(), "contracts"),
    shell: true,
    stdio: "ignore",
  });
  for (let i = 0; i < 120 && !(await rpcUp(url)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await rpcUp(url))) throw new Error("hardhat node did not start");
  process.env.SWAP_RPC_11155111 = url;
}

export async function teardown() {
  if (!node?.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(node.pid), "/T", "/F"]);
  else node.kill("SIGTERM");
}
