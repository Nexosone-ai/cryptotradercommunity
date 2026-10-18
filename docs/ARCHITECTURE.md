# 아키텍처

```text
Trader / Bot Owner / Partner / Admin (MetaMask: 확장 · 모바일 인앱)
        │  SIWE 로그인 서명 · approveBuilderFee · approveAgent (메인 지갑 서명)
        ▼
Next.js 16 App Router (Vercel)  ── 브라우저 → Hyperliquid WS (호가, 읽기 전용)
  ├─ UI (서버 컴포넌트 + 클라이언트 컴포넌트)
  └─ BFF API (/api/*): 인증 · RBAC · 검증 · rate limit · 주문 게이트
        │
        ▼
PostgreSQL (Supabase)  ← dev/test: PGlite
        ▲
        │
Settlement Worker (상시 실행, Vercel 외부)        Bot Runner (Phase 2, 격리 실행)
  └ fills 수집 → fee_events(OBSERVED)              └ placeOrder(source=BOT) 같은 게이트 사용
        │                                                  │
        └──────────── Hyperliquid Info / Exchange / WS ────┘
```

## 소스 구조
| 경로 | 내용 |
|---|---|
| `src/app/**/page.tsx` | 화면: `/`, `/bots`, `/bots/[id]`, `/bots/register`, `/trade`, `/portfolio`, `/rankings`, `/ref/[code]`, `/partners`, `/partner`, `/admin`, `/docs` |
| `src/app/api/**/route.ts` | API (docs/API.md) |
| `src/lib/config.ts` | 환경변수 → 설정. 누락 시 기능 비활성(사이트는 동작) |
| `src/lib/db/schema.ts`, `drizzle/*.sql` | 스키마·마이그레이션(RLS, append-only 트리거, 분개 균형 제약, 정책 v1 시드) |
| `src/lib/auth/*` | SIWE nonce/검증, 세션, 현재 사용자 |
| `src/lib/bots/*` | 설정 스키마(zod), 위험 검사, 상태 머신, 구독/재동의, 공개 목록 |
| `src/lib/fees/*` | 분배 엔진(bigint), 단위 변환, 예상 수수료 |
| `src/lib/ledger/service.ts` | 정책 버전, 확정·배분 분개, 대사, claim, 지급 |
| `src/lib/referral/service.ts` | 파트너 코드, 2단계 관계 고정, 수혜자 결정 |
| `src/lib/trading/*` | agent 키 암호화, agent 승인 확인, Builder 승인 확인, **주문 게이트** |
| `src/lib/settlement/ingest.ts` | 체결 수집 → fills/fee_events (멱등) |
| `src/lib/performance/metrics.ts` | 봇 성과(검증 기준, MDD, 승률), 방법론 문구 |
| `src/lib/hyperliquid/*` | SDK 래퍼(`HlGateway`, 테스트에서 주입 교체), 가격/수량 포맷 |
| `src/lib/hl-browser.ts` | 브라우저: 사용자 지갑으로 approveBuilderFee/approveAgent 서명 |
| `workers/settlement.ts` | 정산 워커 루프(지수 백오프, 종료 신호 처리) |
| `scripts/` | `migrate.ts`, `check-hyperliquid.ts` |
| `tests/unit`, `tests/integration` | Vitest (PGlite 실DB) |
| `tests/e2e` | Playwright (테스트 지갑으로 MetaMask 모사) |

## 핵심 흐름
**로그인**: `POST /api/auth/nonce` → 서버가 SIWE 메시지 생성 → `personal_sign` → `POST /api/auth/verify` → nonce 소비·서명 복원·사용자 생성(약관 동의)·추천 관계 고정·세션 쿠키.

**거래 권한**: `POST /api/fees/approval/challenge`(서버가 builder·상한 결정) → MetaMask `approveBuilderFee` → `GET /api/fees/approval`(Hyperliquid 조회·캐시). `POST /api/trading/agent`(서버 키 생성·암호화) → MetaMask `approveAgent` → `POST /api/trading/agent/verify`(Hyperliquid `extraAgents`로 확인 후 ACTIVE).

**주문**: `POST /api/trading/orders` → `placeOrder` 게이트 → orders(PENDING, cloid) → agent 서명 전송 → 상태 반영. Hyperliquid 응답이 원본(source of truth).

**정산**: 워커 → `userFillsByTime` → 플랫폼 주문 매칭 → `fills` + `fee_events(OBSERVED)`(정책 버전·추천 스냅샷 포함) → 관리자 확정 → 분개 → claim 기록 → 지급.

## 실시간 데이터
- 호가: 브라우저가 Hyperliquid WS `l2Book` 직접 구독(SDK가 지수 백오프 재연결·재구독), 스냅샷 시간 역행 메시지 폐기, 15초 무응답 시 "지연됨" 표시.
- 캔들: `/api/market/candles` 30초 주기, 마지막 갱신 시각 표시.
- 계정: `/api/trading/account` 15초 주기(Hyperliquid `clearinghouseState`, `frontendOpenOrders`).

## Vercel 서버리스 한계
Vercel 함수로 상시 자동매매·정산을 돌리지 않는다. 워커는 Railway/Fly.io/Render/EC2 등 상시 실행 환경에 배포(docs/DEPLOYMENT.md).
