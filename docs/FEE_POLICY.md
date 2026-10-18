# 수수료 정책 (FEE_POLICY)

## 1. 수수료의 종류

| 구분 | 징수 주체 | 플랫폼 분배 대상 여부 |
|---|---|---|
| Hyperliquid 기본 거래 수수료 (taker/maker, 등급·할인 반영) | Hyperliquid | **아니오** — 플랫폼은 받지도 분배하지도 않음 |
| 추가 Builder Fee (Builder Codes, 주문별 `builder: {b, f}`) | 플랫폼 Builder 주소에 적립 | **예** — 유일한 분배 원천 |

- 한 주문에는 Builder Fee 하나만 붙는다. 플랫폼 수수료와 봇 수수료를 이중 청구하지 않는다.
- 적용 수수료율 ≤ 사용자가 메인 지갑으로 승인한 `maxFeeRate` ≤ 플랫폼 상한(`PLATFORM_MAX_BUILDER_FEE_TENTHS_BP`, 기본 0.05%) ≤ Hyperliquid 상한(perps 0.1%).
- 봇 주문의 수수료율은 **구독자가 동의한 값**(`bot_subscriptions.accepted_fee_tenths_bp`)이며 봇의 현재 값이 아니다. 인상 시 구독은 `REQUIRES_RECONSENT`가 되어 재동의 전 봇 주문이 차단되고, 인하는 즉시 적용된다.

## 2. 분배 (초기 기본값, `fee_policy_versions` v1)

기준 금액 R = 실제 수취 가능하고 **정산 확정(CONFIRMED)** 된 추가 Builder Fee.

| 대상 | R 대비 | 계산 |
|---|---:|---|
| 봇 등록자 | 70% | R × 0.70 |
| 관리자 배분 풀 | 30% | R × 0.30 |
| └ 플랫폼 최종 수익 | 6% | 풀 × 20% |
| └ 1차 파트너 | 14.4% | 풀 × 80% × 60% |
| └ 2차 파트너 | 9.6% | 풀 × 80% × 40% |

예: R = 100 USDC → 70 / 6 / 14.4 / 9.6 (테스트: `tests/unit/fee-split.test.ts`, `tests/integration/trading-ledger.test.ts`).

### 불변식 (코드·DB로 강제)
```
bot_owner_share + admin_pool_share = 100%            (ppm으로 저장, 나머지를 1-x로 계산)
platform_share_of_pool + partner_pool_share = 100%
tier1_share + tier2_share = 100%
net_payouts + reserved_unallocated + rounding_remainder = realized_revenue
```
- 각 몫은 R에서 하나의 분모로 내림 계산하고 남는 단위(< 4e-8 USDC)는 `ROUNDING_REMAINDER`로 보낸다 → 합계는 항상 정확히 R (속성 테스트 2,000회).
- 분개(journal)마다 차변 합 = 대변 합 — DB의 지연 제약 트리거가 커밋 시 검사.
- 원장(`ledger_entries`)과 감사 로그는 UPDATE/DELETE 금지 트리거(append-only).

## 3. 추천인이 없거나 자격이 없을 때
- 1·2차 추천인이 없거나 `partners.eligibility_status != ACTIVE` 이면 해당 몫은 `UNALLOCATED_PARTNER_RESERVE`로 보류된다.
- 예비금은 플랫폼 순이익(6%)에 합산하지 않으며 관리자 대시보드에 별도로 표시된다. 처리(소각·환원·재배분)는 관리자의 명시적 결정 + 감사 로그로만 가능(처리 UI는 Phase 2).

## 4. 수동 주문(봇 없음)
- 기본값: Builder Fee 0 (`MANUAL_ORDER_BUILDER_FEE_TENTHS_BP=0`) → 분배 대상 없음.
- 운영자가 0보다 크게 설정하면 봇 등록자 70% 몫은 봇이 없으므로 `PLATFORM_NET_REVENUE`로 기록(메모 "owner share of non-bot order"), 나머지 30%는 위와 동일하게 배분. 공개 문서에 고지 후 활성화할 것.

## 5. 정책 버전
- 새 정책은 **미래 시점부터만** 효력(`RETROACTIVE_POLICY` 거부). 각 수수료 이벤트는 체결 시점에 유효한 정책 ID를 저장하고, 배분은 그 버전으로 계산한다. 과거 장부는 재작성하지 않는다.
- 정책 생성은 관리자 전용 + 감사 로그(이전/이후 값, 사유).

## 6. 수취·지급 워크플로
1. 사용자가 봇의 수수료를 보고 동의(구독) → 메인 지갑으로 `approveBuilderFee` 서명(상한).
2. 서버 주문 게이트가 매 주문 Hyperliquid `maxBuilderFee`를 조회해 승인 ≥ 적용 수수료인지 검증(실패 시 거부).
3. 체결 → 정산 워커가 `userFillsByTime`에서 플랫폼 주문(cloid/oid 매칭)의 `builderFee`를 `fee_events(OBSERVED)`로 기록. 키 `network:tid:oid`로 중복 차단.
4. 관리자가 Hyperliquid `referral(builder)` 보상/ builder_fills CSV와 대사 → 확정 → 70/30 원장 생성.
5. Builder 보상을 Hyperliquid에서 claim → 관리자가 금액 기록(`BUILDER_FEE_RECEIVABLE → PLATFORM_HL_BALANCE`).
6. 지급 요청 생성(미지급 잔액, 6자리 USDC 단위로 내림, 최소 1 USDC) → 승인 → 운영자가 직접 송금 → tx hash로 완료 기록(`PAYABLE → PLATFORM_HL_BALANCE`). 청구 잔액을 넘는 지급은 거부.
7. 자동 지급 어댑터는 Phase 2. 그 전에는 화면에 "자동 지급 완료"를 표시하지 않는다.

## 7. 계정 구분 (장부)
| 계정 | 의미 |
|---|---|
| `BUILDER_FEE_RECEIVABLE` | 확정됐지만 아직 claim하지 않은 Builder 보상 (자산) |
| `PLATFORM_HL_BALANCE` | claim되어 플랫폼 Builder 계정에 있는 자금 (자산) |
| `BOT_OWNER_PAYABLE` / `PARTNER_PAYABLE` | 봇 등록자·파트너에게 지급할 미지급채무 (사용자별) |
| `PLATFORM_NET_REVENUE` | 플랫폼 순수익 |
| `UNALLOCATED_PARTNER_RESERVE` | 미배정 파트너 예비금 |
| `ROUNDING_REMAINDER` | 정수 내림 잔여 |
