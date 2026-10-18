import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import type { Db } from "../db/client";
import { authNonces } from "../db/schema";
import { badRequest, unauthorized } from "../http";

const NONCE_TTL_MS = 10 * 60 * 1000;
export const SIWE_STATEMENT =
  "CryptoTraderCommunity 로그인. 이 서명은 로그인 전용이며 거래 권한이나 수수료 승인을 부여하지 않습니다.";

export interface NonceRequest {
  address: string;
  chainId: number;
  domain: string;
  uri: string;
}

/** Issues a single-use nonce and the exact EIP-4361 message the wallet must sign. */
export async function issueSiweMessage(db: Db, req: NonceRequest, now = new Date()) {
  if (!isAddress(req.address, { strict: false })) throw badRequest("INVALID_ADDRESS", "지갑 주소가 올바르지 않습니다.");
  if (!Number.isInteger(req.chainId) || req.chainId <= 0) throw badRequest("INVALID_CHAIN", "체인 ID가 올바르지 않습니다.");
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);
  const message = createSiweMessage({
    address: getAddress(req.address),
    chainId: req.chainId,
    domain: req.domain,
    uri: req.uri,
    nonce,
    version: "1",
    statement: SIWE_STATEMENT,
    issuedAt: now,
    expirationTime: expiresAt,
  });
  await db.insert(authNonces).values({
    nonce,
    walletAddress: req.address.toLowerCase(),
    chainId: req.chainId,
    message,
    expiresAt,
  });
  return { message, nonce, expiresAt };
}

/**
 * Verifies a signed SIWE message: the nonce must exist, be unused and
 * unexpired; the message must be byte-identical to the one issued (so domain,
 * URI, chain id and address cannot be swapped); the signature must recover to
 * the address. The nonce is consumed atomically, so a replay fails.
 */
export async function verifySiweSignature(
  db: Db,
  input: { message: string; signature: Hex; expectedDomain: string },
  now = new Date(),
) {
  const parsed = parseSiweMessage(input.message);
  if (!parsed.nonce || !parsed.address || !parsed.domain || !parsed.chainId) {
    throw unauthorized("서명 메시지 형식이 올바르지 않습니다.");
  }
  if (parsed.domain !== input.expectedDomain) throw unauthorized("서명 도메인이 일치하지 않습니다.");

  // Consume the nonce first (single use, even if verification then fails).
  const [row] = await db
    .update(authNonces)
    .set({ usedAt: now })
    .where(and(eq(authNonces.nonce, parsed.nonce), isNull(authNonces.usedAt), gt(authNonces.expiresAt, now)))
    .returning();
  if (!row) throw unauthorized("로그인 요청이 만료되었거나 이미 사용되었습니다. 다시 시도해 주세요.");
  if (row.message !== input.message) throw unauthorized("서명 메시지가 발급된 내용과 다릅니다.");
  if (row.walletAddress !== parsed.address.toLowerCase() || row.chainId !== parsed.chainId) {
    throw unauthorized("지갑 주소 또는 체인이 일치하지 않습니다.");
  }

  const ok = await verifyMessage({ address: parsed.address, message: input.message, signature: input.signature });
  if (!ok) throw unauthorized("서명 검증에 실패했습니다.");
  return { address: parsed.address.toLowerCase() as `0x${string}`, chainId: parsed.chainId };
}
