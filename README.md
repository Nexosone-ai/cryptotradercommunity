# CryptoTraderCommunity

Hyperliquid 기반 비수탁형 트레이딩 봇 오픈 마켓플레이스 — **Build a Bot. Prove Performance. Trade Together.**

- MetaMask 지갑 서명(SIWE) 로그인만 사용
- 봇 등록 → 위험 검사 → 관리자 심사 → 공개, 등록자 지갑 자동 공개
- Hyperliquid Testnet 실시간 시세·호가·계정 조회, 서버 주문 게이트를 거친 실주문
- 공식 Builder Codes 추가 수수료: 봇 등록자 70% / 관리자 풀 30%(플랫폼 6% · 1차 14.4% · 2차 9.6%), 정수 원장
- 2단계 파트너 추천, 정책 버전, 감사 로그(해시 체인, append-only)

현재 상태: **Phase 1 MVP** — 무엇이 동작하고 무엇이 남았는지는 `docs/PRD.md`와 `docs/assumptions.md` 참고.

## 빠른 시작
```bash
npm install
cp .env.example .env.local     # 개발용 값 채우기 (SESSION_SECRET, AGENT_KEY_ENCRYPTION_KEY 등)
npm run dev                    # http://localhost:3000 — DB 없으면 ./.data/pglite 자동 생성·마이그레이션
```
- 관리자 화면(`/admin`)은 `.env.local`의 `ADMIN_WALLET_ADDRESS` 지갑으로 로그인하면 열린다(메뉴에 없음).
- Builder Fee 기능은 `BUILDER_ADDRESS`(테스트넷 perps ≥ 100 USDC) 설정 후 활성화.
- 테스트넷 주문: Hyperliquid testnet faucet으로 USDC를 받은 지갑 → `/trade`에서 거래 권한 승인 → 주문.

## 명령
| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` / `npm start` | 프로덕션 빌드/실행 |
| `npm run typecheck` | 라우트 타입 생성 + tsc |
| `npm run lint` | ESLint |
| `npm test` | Vitest 단위·통합 (PGlite 실DB) |
| `npm run test:e2e` | Playwright E2E (로컬 Chrome, 테스트 지갑 모사) |
| `npm run verify` | typecheck + lint + test + build |
| `npm run db:generate` | 스키마 변경 → SQL 마이그레이션 생성 |
| `npm run db:migrate` | `DATABASE_URL`에 마이그레이션 적용 |
| `npm run worker:settlement` | 정산 워커(체결 → 수수료 이벤트) |
| `npm run check:hl` | Hyperliquid 연결·Builder 자격 점검(읽기 전용) |

## 문서
`docs/PRD.md` · `docs/ARCHITECTURE.md` · `docs/FEE_POLICY.md` · `docs/SECURITY.md` · `docs/DEPLOYMENT.md` · `docs/API.md` · `docs/assumptions.md` · `docs/LEGAL_CHECKLIST.md` · 원본 요구사항 `docs/MASTER_PROMPT.md`

## 위험 고지
레버리지 선물 거래는 원금 전액 손실·강제청산 위험이 있습니다. 과거 성과는 미래 수익을 보장하지 않습니다.
