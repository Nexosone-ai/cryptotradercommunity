import { getAddress } from "viem";

export function checksum(address: string) {
  try {
    return getAddress(address);
  } catch {
    return address;
  }
}

export function shortAddress(address: string) {
  const a = checksum(address);
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function feeLabel(tenthsBp: number) {
  return `${(tenthsBp / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function usd(v: string | number | null | undefined, digits = 2) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function dateTime(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
}

export const RISK_LABELS: Record<string, string> = { LOW: "위험 낮음", MEDIUM: "위험 보통", HIGH: "위험 높음", EXTREME: "위험 매우 높음" };

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "작성 중",
  SUBMITTED: "심사 요청",
  UNDER_REVIEW: "심사 중",
  APPROVED: "승인됨 (미공개)",
  LIVE: "운영 중",
  PAUSED: "일시 중지",
  ARCHIVED: "보관됨",
  REJECTED: "반려",
  SUSPENDED: "관리자 중단",
};
