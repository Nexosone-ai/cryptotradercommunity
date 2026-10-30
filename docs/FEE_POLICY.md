# 수수료 정책 (FEE_POLICY)

## 1. 수수료의 종류

| 구분 | 징수 주체 | 플랫폼 분배 대상 여부 |
|---|---|---|
| Hyperliquid 기본 거래 수수료 (taker/maker, 등급·할인 반영) | Hyperliquid | **아니오** — 플랫폼은 받지도 분배하지도 않음 |
| 추가 Builder Fee (Builder Codes, 주문별 `builder: {b, f}`) | 플랫폼 Builder 주소에 적립 | **예** — 유일한 분배 원천 |

- 한 주문에는 Builder Fee 하나만 붙는다. 플랫폼 수수료와 봇 수수료를 이중 청구하지 않는다.
- 적용 수수료율 ≤ 사용자가 메인 지갑으로 승인한 `maxFeeRate` ≤ 플랫폼 상한(`PLATFORM_MAX_BUILDER_FEE_TENTHS_BP`, 기본 0.05%) ≤ Hyperliquid 상한(perps 0.1%).
- 봇 주문의 수수료율은 **구독자가 동의한 값**(`bot_subscriptions.accepted_fee_tenths_bp`)이며 봇의 현재 값이 아니다. 인상 시 구독은 `REQUIRES_RECONSENT`가 되어 재동의 전 봇 주문이 차단되고, 인하는 즉시 적용된다.

## 2. 분배 (2026-10-30부터: 도매 파트너 + 어필리에이트, `fee_policy_versions` 70 / 9 / 21)

기준 금액 R = 실제 수취 가능하고 **정산 확정(CONFIRMED)** 된 추가 Builder Fee.

| 대상 | R 대비 | 계산 |
|---|---:|---|
| 봇 운영자 · 카피 트레이딩 리더 | 70% | R × 0.70 |
| 관리자 배분 풀 | 30% | R × 0.30 |
| └ 플랫폼 | 9% | 풀 × 30% |
| └ 파트너 몫 | 21% | 풀 × 70% — 도매 파트너와 어필리에이트가 나눔 |

**파트너 구조 (1단계만)**
- **도매 파트너(WHOLESALE)**: 관리자만 지정한다. 고객 추천 링크(`/ref/{code}`)와 어필리에이트 초대 링크(`/join/{code}`)를 갖고, 자기 몫(portion)을 정한다. 몫은 수수료 대비 포인트(ppm)이며 0~21%. 하나의 값이 모든 어필리에이트에 적용된다.
- **어필리에이트(AFFILIATE)**: 도매 파트너의 초대 링크로 가입한다. 고객만 추천할 수 있고, 다른 어필리에이트를 모집할 수 없다.
- 어필리에이트의 고객: 도매 파트너는 자기 몫, 어필리에이트는 21%에서 그 몫을 뺀 나머지를 받는다. 예: 몫 10% → R = 100 USDC 기준 70 / 9 / 도매 10 / 어필리에이트 11.
- 도매 파트너가 직접 추천한 고객: 도매 파트너가 21% 전부를 받는다.
- 몫은 **체결 시점의 값**이 `fee_events.wholesaler_portion_ppm`에 고정된다. 몫을 바꾸면 그 이후 체결부터 적용되고, 이미 기록된 체결에는 소급되지 않는다.
- 2026-10-30 이전에 기록된 체결(`wholesaler_portion_ppm` NULL)은 기존 2단계 규칙(1차 60% / 2차 40%, 미배정 예비금)으로 배분된다.

(테스트: `tests/unit/fee-split.test.ts`, `tests/integration/trading-ledger.test.ts`, `tests/integration/referral-bots.test.ts`)

### 불변식 (코드·DB로 강제)
```
bot_owner_share + admin_pool_share = 100%            (ppm으로 저장, 나머지를 1-x로 계산)
platform_share_of_pool + partner_pool_share = 100%
wholesale_portion + affiliate_share = partner_pool_share   (몫은 파트너 몫을 넘지 않음)
net_payouts + reserved_unallocated + rounding_remainder = realized_revenue
```
- 각 몫은 R에서 하나의 분모로 내림 계산하고 남는 단위(< 4e-8 USDC)는 `ROUNDING_REMAINDER`로 보낸다 → 합계는 항상 정확히 R (속성 테스트 2,000회).
- 분개(journal)마다 차변 합 = 대변 합 — DB의 지연 제약 트리거가 커밋 시 검사.
- 원장(`ledger_entries`)과 감사 로그는 UPDATE/DELETE 금지 트리거(append-only).

## 3. 추천인이 없거나 자격이 없을 때
- 고객에게 파트너가 없으면 관리자 배분 풀 30% 전부가 플랫폼(`PLATFORM_NET_REVENUE`, 메모 "no affiliate")으로 간다.
- 파트너가 정지(`eligibility_status != ACTIVE`)되면 그 파트너의 몫도 플랫폼으로 간다. 도매 파트너가 정지되면 그 몫만, 어필리에이트가 정지되면 어필리에이트 몫만 플랫폼으로 가고 나머지는 그대로 지급된다.
- 기존 규칙으로 배분되는 이전 체결만 `UNALLOCATED_PARTNER_RESERVE`를 사용한다.

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
