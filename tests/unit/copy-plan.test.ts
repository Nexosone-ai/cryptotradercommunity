import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { planCopy } from "@/lib/engine/copy";

const d = (v: string | number) => new Decimal(v);
// Leader account 10,000 USDC, follower allocation 1,000 (10%), BTC at 80,000.
const base = { leaderValue: d(10_000), allocation: d(1_000), held: d(0), mid: d(80_000), direction: "BOTH" as const, maxPositionUsd: 100_000 };

describe("planCopy (proportional copy sizing)", () => {
  it("copies a new leader position at allocation ÷ leader account value", () => {
    const p = planCopy({ ...base, prev: d(0), next: d("0.5") });
    expect(p).toMatchObject({ kind: "OPEN", side: "LONG", closeFirst: false });
    expect(p.kind === "OPEN" && p.size.toString()).toBe("0.05");
    const s = planCopy({ ...base, prev: d(0), next: d("-2") });
    expect(s.kind === "OPEN" && [s.side, s.size.toString()]).toEqual(["SHORT", "0.2"]);
  });

  it("follows adds and reductions of a copied position", () => {
    const up = planCopy({ ...base, prev: d("0.5"), next: d("1"), held: d("0.05") });
    expect(up.kind === "ADJUST" && up.size.toString()).toBe("0.1");
    const down = planCopy({ ...base, prev: d("1"), next: d("0.5"), held: d("0.1") });
    expect(down.kind === "ADJUST" && down.size.toString()).toBe("0.05");
  });

  it("closes on a leader close, and closes then reverses on a flip", () => {
    expect(planCopy({ ...base, prev: d("0.5"), next: d(0), held: d("0.05") })).toEqual({ kind: "CLOSE" });
    expect(planCopy({ ...base, prev: d("0.5"), next: d(0) })).toMatchObject({ kind: "SKIP", reason: "No copied position to close." });
    const flip = planCopy({ ...base, prev: d("0.5"), next: d("-0.5"), held: d("0.05") });
    expect(flip).toMatchObject({ kind: "OPEN", side: "SHORT", closeFirst: true });
  });

  it("doesn't join a position the leader already held before the follower subscribed", () => {
    const p = planCopy({ ...base, prev: d("0.5"), next: d("0.8") });
    expect(p).toMatchObject({ kind: "SKIP" });
    expect(p.kind === "SKIP" && p.reason).toMatch(/next new position/);
  });

  it("skips trades below Hyperliquid's minimum at a small allocation", () => {
    const p = planCopy({ ...base, allocation: d(20), prev: d(0), next: d("0.01") });
    expect(p.kind === "SKIP" && p.reason).toMatch(/too small/);
  });

  it("caps the copied position at the bot's max position size", () => {
    const p = planCopy({ ...base, maxPositionUsd: 2_000, prev: d(0), next: d("0.5") });
    expect(p.kind === "OPEN" && p.size.toString()).toBe("0.025");
  });

  it("respects a one-direction bot and an unreadable leader account", () => {
    const longOnly = { ...base, direction: "LONG" as const };
    expect(planCopy({ ...longOnly, prev: d(0), next: d("-0.5") })).toMatchObject({ kind: "SKIP" });
    expect(planCopy({ ...longOnly, prev: d("0.5"), next: d("-0.5"), held: d("0.05") })).toEqual({ kind: "CLOSE" });
    expect(planCopy({ ...base, leaderValue: d(0), prev: d(0), next: d("0.5") })).toMatchObject({ kind: "SKIP" });
  });
});
