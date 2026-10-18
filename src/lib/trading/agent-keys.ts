import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Agent (API) wallet keys are generated server-side, encrypted with
 * AES-256-GCM and never returned to the client or logged. Production should
 * source AGENT_KEY_ENCRYPTION_KEY from a KMS (docs/SECURITY.md).
 */

function key(): Buffer {
  const hex = process.env.AGENT_KEY_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("AGENT_KEY_ENCRYPTION_KEY is not configured");
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(sealed: string, aad: string): string {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** New agent keypair; the key is bound to the agent address via AAD. */
export function generateAgent() {
  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address.toLowerCase();
  return { address, encryptedKey: encryptSecret(pk, address) };
}

export function decryptAgentKey(encryptedKey: string, agentAddress: string): `0x${string}` {
  const pk = decryptSecret(encryptedKey, agentAddress.toLowerCase()) as `0x${string}`;
  if (privateKeyToAccount(pk).address.toLowerCase() !== agentAddress.toLowerCase()) {
    throw new Error("Agent key does not match its address");
  }
  return pk;
}
