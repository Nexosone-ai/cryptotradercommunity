# API 계약

공통: JSON. 오류는 `{ "error": { "code", "message", "details?" } }`. 금액(e8 단위 bigint)은 문자열.
인증 = 세션 쿠키. **변경 요청은 `Origin`이 앱 출처와 같아야 함**(아니면 403). 역할 부족 403, 미로그인 401, 초과 요청 429.

## 인증
| Method | Path | 권한 | 설명 |
|---|---|---|---|
| POST | `/api/auth/nonce` | 공개 | `{address, chainId}` → `{message, expiresAt}` (SIWE 원문) |
| POST | `/api/auth/verify` | 공개 | `{message, signature, acceptTerms}` → 세션 쿠키. 첫 가입 시 `acceptTerms=true` 필수, 추천 쿠키 처리 |
| POST | `/api/auth/logout` | 세션 | 세션 폐기 |
| GET | `/api/me` | 공개 | `{user|null, partner, referredBy, config(public)}` |

## 봇
| Method | Path | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/bots` | 공개 | LIVE/PAUSED만. `q, strategy, market, verified=1, maxFee, sort=newest|pnl|drawdown|risk|fee` |
| POST | `/api/bots` | 로그인 | 봇 생성(DRAFT). 소유 주소는 세션에서 자동 |
| GET | `/api/bots/:idOrSlug` | 공개/소유자/관리자 | 비공개 상태는 소유자·관리자만. 버전 이력은 소유자·관리자 |
| PATCH | `/api/bots/:id` | 소유자 | 수정. 승인 후 중대 변경 → SUBMITTED, 수수료 인상 → 구독자 재동의 |
| POST | `/api/bots/:id/submit` | 소유자 | DRAFT/REJECTED → SUBMITTED (BLOCK 위험 시 400) |
| POST | `/api/bots/:id/start` | 소유자 | APPROVED/PAUSED → LIVE |
| POST | `/api/bots/:id/stop` | 소유자 | LIVE → PAUSED (봇 주문 즉시 차단) |
| POST | `/api/bots/:id/subscribe` | 로그인 | `{acceptedFeeTenthsBp, acceptRisk}` — 현재 수수료와 다르면 409 |
| POST | `/api/bots/:id/unsubscribe` | 로그인 | STOPPED (봇 주문 즉시 차단) |
| GET | `/api/bots/:id/performance?period=7d|30d|90d|all` | 공개 | 검증 상태 포함 지표 |

## 시장 (DB 불필요)
| GET | `/api/market/metadata` | 공개 | perp 목록·마크가·펀딩·OI·거래대금 |
|---|---|---|---|
| GET | `/api/market/candles?coin=BTC&interval=1h` | 공개 | 최근 300개 캔들 |

## 거래
| Method | Path | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/trading/account` | 로그인 | Hyperliquid 상태 + agent/Builder 승인 + 플랫폼 주문 |
| GET | `/api/trading/positions` | 로그인 | 포지션 |
| GET | `/api/trading/fills` | 로그인 | 최근 체결 100건 |
| GET | `/api/trading/orders` | 로그인 | 플랫폼 주문 |
| POST | `/api/trading/orders` | 로그인 | 수동 주문 `{coin, isBuy, size, orderType, price?, tif?, reduceOnly?, confirmMainnet?}` → 게이트 |
| POST | `/api/trading/orders/:id/cancel` | 본인 | cloid로 취소 |
| POST | `/api/trading/agent` | 로그인 | 새 agent 주소 발급(키는 서버 암호화) |
| POST | `/api/trading/agent/verify` | 로그인 | Hyperliquid `extraAgents` 확인 후 활성화 |
| DELETE | `/api/trading/agent` | 로그인 | 플랫폼 사용 중지 |

주문 거부 코드: `MAINNET_DISABLED`, `MAINNET_CONFIRM_REQUIRED`, `BOT_NOT_LIVE`, `SUBSCRIPTION_INACTIVE`, `MARKET_NOT_ALLOWED`, `FEE_ABOVE_CAP`, `AGENT_NOT_AUTHORIZED`, `BUILDER_NOT_CONFIGURED`, `HL_UNAVAILABLE`, `BUILDER_FEE_NOT_APPROVED`, `UNKNOWN_MARKET`, `PRICE_OUT_OF_BAND`, `ORDER_TOO_LARGE`, `ORDER_TOO_SMALL`.

## 수수료
| GET | `/api/fees/estimate?notional=10000&botId=` | 공개 | 기본/Builder 예상 수수료 |
|---|---|---|---|
| GET | `/api/fees/approval` | 로그인 | Hyperliquid `maxBuilderFee` 조회·캐시 |
| POST | `/api/fees/approval/challenge` | 로그인 | `{requiredTenthsBp}` → 서명할 `{builder, maxFeeRate, hyperliquidChain}` |

## 추천 · 파트너
| POST | `/api/referral/capture` | 공개 | `{code}` → httpOnly 쿠키(30일), 기존 로그인 사용자는 무시 |
|---|---|---|---|
| POST | `/api/partner/activate` | 로그인 | `{acceptPartnerTerms:true}` → 코드 발급, PARTNER 역할 |
| GET | `/api/partner/summary` | PARTNER | 1·2차 인원, 확정/대기 수익, 미지급/지급 |
| GET | `/api/partner/referrals` | PARTNER | 마스킹된 추천 목록 |
| GET | `/api/partner/earnings?tier=&from=&to=&botId=&format=csv` | PARTNER | 수익 내역(정책 버전 포함), CSV |

## 관리자 (ADMIN)
| GET | `/api/admin/bots/pending` | 심사 대기 + 위험 검사 결과 |
|---|---|---|
| POST | `/api/admin/bots/:id/approve` | 승인 |
| POST | `/api/admin/bots/:id/reject` | `{reason}` 반려 |
| POST | `/api/admin/bots/:id/review` | `{decision: START_REVIEW|APPROVE|REJECT|SUSPEND, reason?}` |
| GET | `/api/admin/fees/ledger` | 대사 리포트, HL Builder 보상, 이벤트, 미지급, 정책 |
| POST | `/api/admin/fees/sync` | 체결 수집 수동 실행 |
| POST | `/api/admin/fees/confirm` | `{eventIds, reason}` 확정·배분 |
| GET/POST | `/api/admin/fees/policy` | 정책 버전 조회/생성(미래 시점만) |
| POST | `/api/admin/fees/claims` | `{amountUsdc, reference}` claim 기록 |
| GET/POST | `/api/admin/payouts` | 지급 목록·미지급 / 지급 요청 생성 |
| POST | `/api/admin/payouts/:id/approve` | 승인 |
| POST | `/api/admin/payouts/:id/paid` | `{txHash}` 완료 기록 |
| GET | `/api/admin/audit-logs` | 감사 로그 + 해시 체인 검증 |
| GET | `/api/admin/system` | 설정·Hyperliquid 상태, 위험 이벤트 |
