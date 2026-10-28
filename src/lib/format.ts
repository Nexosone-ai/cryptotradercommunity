import { getAddress } from "viem";
import { bi } from "./i18n";

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
  // Language-neutral "YYYY-MM-DD HH:mm:ss KST" so it reads the same in English and Korean.
  return `${d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hour12: false })} KST`;
}

export const RISK_LABELS: Record<string, string> = { LOW: bi("Low risk", "위험 낮음"), MEDIUM: bi("Medium risk", "위험 보통"), HIGH: bi("High risk", "위험 높음"), EXTREME: bi("Very high risk", "위험 매우 높음") };

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: bi("Draft", "작성 중"),
  SUBMITTED: bi("Submitted for review", "심사 요청"),
  UNDER_REVIEW: bi("Under review", "심사 중"),
  APPROVED: bi("Approved (not public)", "승인됨 (미공개)"),
  LIVE: bi("Live", "운영 중"),
  PAUSED: bi("Paused", "일시 중지"),
  ARCHIVED: bi("Archived", "보관됨"),
  REJECTED: bi("Rejected", "반려"),
  SUSPENDED: bi("Suspended by admin", "관리자 중단"),
};
