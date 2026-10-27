# 배포 (DEPLOYMENT)

> 아래 절차 중 외부 계정 생성, 시크릿 등록, 도메인 연결, 메인넷 활성화는 **운영자가 직접** 수행해야 한다. 이 저장소는 어떤 외부 배포도 자동으로 하지 않는다.

## 구성
| 구성요소 | 권장 | 비고 |
|---|---|---|
| Web/BFF | Vercel (Next.js 16) | 서버리스 — 상시 루프 금지 |
| DB | Supabase Postgres 15+ (또는 Neon/RDS) | `DATABASE_URL` (pooler 사용 시 `prepare:false` 이미 설정) |
| Worker | Railway / Fly.io / Render / EC2 (상시 실행) | `npm run worker:settlement` |
| Secrets | Vercel env + Worker env, 가능하면 KMS/Secret Manager | `AGENT_KEY_ENCRYPTION_KEY`, `SESSION_SECRET` |
| Redis/Queue | Phase 2 (BullMQ) | Phase 1은 불필요 |

## 1. 데이터베이스
```bash
DATABASE_URL=postgres://... npm run db:migrate
```
- `drizzle/0000_init.sql`(테이블·인덱스·FK·CHECK), `0001_rls_and_immutability.sql`(RLS, append-only, 분개 균형 제약, 정책 v1).
- 마이그레이션 실행 역할이 테이블 소유자가 되며, 앱도 같은(또는 BYPASSRLS) 역할로 접속해야 한다. Supabase anon/authenticated 키는 RLS로 차단된다.
- 백업: Supabase PITR 활성화, 원장 테이블 일일 덤프 보관.

## 2. 환경변수 (`.env.example` 참고, 값은 출력·커밋 금지)
| 변수 | 필수 | 설명 |
|---|---|---|
| `APP_URL` | 예 | `https://cryptotradercommunity.org` — SIWE 도메인 검증·추천 링크 |
| `REDIRECT_HOSTS` | — | APP_URL로 영구 리디렉트할 옛 호스트(예: `cryptotradercommunity.vercel.app`) |
| `DATABASE_URL` | 프로덕션 예 | 없으면 PGlite(개발 전용) |
| `SESSION_SECRET` | 프로덕션 예 | 32자 이상 랜덤 |
| `ADMIN_WALLET_ADDRESS` | 예 | 최초 관리자 |
| `HL_NETWORK` | — | `testnet`(기본) / `mainnet` |
| `WALLET_CHAIN_ID` | — | 지갑 서명 체인. 기본 testnet=998(HyperEVM testnet), mainnet=999(HyperEVM mainnet) |
| `MAINNET_TRADING_ENABLED` | — | `true`일 때만 메인넷 주문(+UI 재확인) |
| `BUILDER_ADDRESS` | 수수료 기능 | 플랫폼 Builder 주소(해당 네트워크 perps ≥ 100 USDC) |
| `PLATFORM_MAX_BUILDER_FEE_TENTHS_BP` | — | 기본 50 (0.05%) |
| `MANUAL_ORDER_BUILDER_FEE_TENTHS_BP` | — | 기본 0 |
| `MAX_MANUAL_ORDER_USD` | — | 기본 1000 |
| `AGENT_KEY_ENCRYPTION_KEY` | 거래 기능 | 64 hex. KMS 보관 권장, 웹·워커 동일 값 |
| `SETTLEMENT_INTERVAL_MS` | 워커 | 기본 60000 |
| `SWAP_NETWORK` / `SWAP_MAINNET_ENABLED` | — | 스왑 체인 세트. 기본 테스트넷, 메인넷은 둘 다 설정 + 감사 후 |
| `FAL_KEY` / `FAL_WEBHOOK_TOKEN` | 파트너 영상 | fal.ai 키·웹훅 토큰 (docs/PARTNER_VIDEO.md) |
| `VIDEO_MARKUP_PPM` | — | 파트너 영상 이용료 마크업, 기본 1400000(×1.4) |
| `COMPANY_NAME` / `COMPANY_BANK_NAME` / `COMPANY_BANK_ACCOUNT` / `COMPANY_BANK_HOLDER` | 충전·청구서 | 회사 입금 계좌 |
| `CREDIT_PACKAGES_USD` | — | 크레딧 패키지(USD), 기본 `50,100,300,500,1000` |
| `KOREAEXIM_API_KEY` | — | 한국수출입은행 환율 API 키(없으면 무료 환율 API) |
| `SWAP_RPC_<chainId>` | — | 스왑 체인 RPC 교체 (메인넷은 유료 엔드포인트 권장) |

## 3. Vercel
1. 이 저장소를 GitHub에 push → Vercel 프로젝트 연결(Framework: Next.js).
2. 위 환경변수 등록(Production/Preview 분리, Preview는 반드시 testnet).
3. 도메인 `cryptotradercommunity.org` 연결, HTTPS 자동 발급. `APP_URL`과 정확히 일치시킬 것.
4. 배포 후 `GET /api/me`, `/trade`(시세), 지갑 로그인 확인.

## 4. Worker
```bash
npm ci
DATABASE_URL=... HL_NETWORK=testnet BUILDER_ADDRESS=... npm run worker:settlement
```
- 단일 인스턴스로 운영(동시 실행해도 멱등이지만 불필요한 API 호출 증가).
- 실패 시 지수 백오프(최대 10분), `risk_events`에 `SETTLEMENT_SYNC_FAILED` 기록 → 알림 연동은 Phase 3.

## 5. 사전 점검
```bash
HL_NETWORK=testnet BUILDER_ADDRESS=0x... npm run check:hl
npm run verify      # typecheck + lint + unit/integration + build
npm run test:e2e    # Playwright (로컬 Chrome; CI는 E2E_CHANNEL=bundled + npx playwright install chromium)
```

## 6. 메인넷 전환 (운영자 승인 후에만)
1. `docs/LEGAL_CHECKLIST.md` 완료, 보안 감사 완료.
2. 메인넷 Builder 주소 준비(≥100 USDC perps), `npm run check:hl` 통과.
3. `HL_NETWORK=mainnet`, `MAINNET_TRADING_ENABLED=true` 설정 — 소액 한도(`MAX_MANUAL_ORDER_USD`)로 단계적 오픈.
4. 정산: 소액 실체결로 `builderFee` 수집 → `referral(builder)` 보상과 대사 → 확정 → claim → 테스트 지급 1건.
