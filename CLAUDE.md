@AGENTS.md

# CryptoTraderCommunity — 작업 지침

전체 요구사항: `docs/MASTER_PROMPT.md` (Phase 1~3). 현재 구현 범위·차이: `docs/PRD.md`, `docs/assumptions.md`.

## 절대 규칙
- 메인넷 주문·송금·Builder 보상 claim·외부 계정/시크릿 설정은 사용자 명시 승인 없이 실행하지 않는다. 기본 네트워크는 testnet.
- 가짜 지표·데모 통계를 실제처럼 보여주지 않는다. 검증 데이터가 없으면 "검증 데이터 부족"을 표시한다.
- Hyperliquid 기본 거래 수수료는 플랫폼 수익이 아니다. 분배 원천은 정산 확정된 추가 Builder Fee뿐이다.
- 시드 구문·개인키를 요청하지 않는다. agent 키는 암호화 저장, 클라이언트·로그에 노출 금지.

## 코드 규칙
- 금액: 원장은 bigint e8(1e-8 USDC) — JS float 금지. 수수료율: 1/10 bp 정수. 비율: ppm 정수. 표시·추정만 decimal.js.
- 모든 주문은 `src/lib/trading/service.ts#placeOrder` 게이트를 통과해야 한다(봇 주문 포함, `source: "BOT"`).
- 원장·감사 로그는 append-only. 정정은 반대 분개로. 수수료 정책은 미래 시점 버전만 추가.
- 변경 API는 `mutationContext`(세션·역할·Origin·rate limit)를 사용한다. 화면 권한은 서버 컴포넌트에서 검사(메뉴 숨김은 보안이 아님).
- Hyperliquid 접근은 `HlGateway`를 통해서만(테스트에서 `tests/helpers/fake-hl.ts`로 교체).
- 스왑 컨트랙트는 `contracts/`(Hardhat 3 별도 패키지). 수정 시 `npm run contracts:test` 후 `npm run contracts:export`로 `src/lib/swap/artifact.json` 갱신. 메인넷 배포는 외부 감사 후에만.
- 스키마 변경: `src/lib/db/schema.ts` 수정 → `npm run db:generate` → 생성된 SQL 검토.

## 검증
`npm run verify` (typecheck·lint·test·build) 와 `npm run test:e2e`가 통과해야 완료로 본다.
