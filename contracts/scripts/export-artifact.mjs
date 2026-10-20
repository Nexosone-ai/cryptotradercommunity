// Copies the compiled CtcP2PSwap ABI and bytecode into the web app.
// Run after `hardhat build`: npm run export (from ./contracts).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "artifacts", "contracts", "CtcP2PSwap.sol", "CtcP2PSwap.json");
const dest = path.join(here, "..", "..", "src", "lib", "swap", "artifact.json");

const a = JSON.parse(readFileSync(src, "utf8"));
const immutableRanges = Object.values(a.immutableReferences ?? {})
  .flat()
  .map((r) => ({ start: r.start, length: r.length }))
  .sort((x, y) => x.start - y.start);

const out = {
  contractName: a.contractName,
  compiler: "solc 0.8.34, optimizer 200 runs, evm cancun",
  abi: a.abi,
  bytecode: a.bytecode,
  deployedBytecode: a.deployedBytecode,
  immutableRanges,
};
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${path.relative(process.cwd(), dest)} (${a.abi.length} ABI entries, ${immutableRanges.length} immutable ranges)`);
