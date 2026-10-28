# PRD — CryptoTraderCommunity (Phase 1)

원문 요구사항: `docs/MASTER_PROMPT.md`. 이 문서는 Phase 1에서 실제 구현한 범위와 수용 기준을 정리한다.

## 목표
누구나 트레이딩 봇을 등록하고, Hyperliquid 실체결로 검증된 성과를 공개하며, 비수탁 방식으로 Hyperliquid perps 유동성에서 거래하는 오픈 마켓플레이스. 수익원은 공식 Builder Codes의 추가 Builder Fee이며, 70%는 봇 등록자, 30%는 관리자 배분 풀(플랫폼 6%·파트너 24%).

## 사용자 · 역할
VISITOR(비로그인), TRADER, BOT_OWNER, PARTNER, ADMIN — 한 지갑이 여러 역할 보유.

## 정보 구조
공개 메뉴: 봇 마켓 `/bots` · 트레이딩 `/trade` · 스왑 `/swap` · 랭킹 `/rankings` · 마이페이지 `/portfolio` · 가이드 `/guide`. 파트너 프로그램 안내·가입은 마이페이지(로그인 후) 파트너 섹션에만 있으며 `/partners`는 `/portfolio#partner`로 이동. 숨김(서버 권한 검사): `/partner`, `/admin`. 그 외 `/`, `/bots/[id]`, `/bots/register`, `/ref/[code]`, `/docs`.

## 봇 상태 머신
```
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → LIVE ⇄ PAUSED → ARCHIVED
            └──────────────→ REJECTED → SUBMITTED
LIVE/PAUSED/APPROVED → SUSPENDED(관리자) → PAUSED(관리자만)/ARCHIVED
승인 후 중대 변경(전략·마켓·레버리지·위험·실행방식) → SUBMITTED(공개 중단, 재심사)
```
공개 마켓 노출: LIVE, PAUSED(일시 중지 표시). 그 외 상태는 소유자·관리자만 열람.

## Phase 1 기능 범위와 상태
| # | 항목 | 상태 |
|---|---|---|
| 1 | 반응형 UI, 다크 테마, 기본 페이지 | 구현 |
| 2 | MetaMask-only 로그인(SIWE), 모바일 인앱 딥링크, 계정 변경 시 로그아웃 | 구현 (실기기 MetaMask 모바일 수동 확인 필요) |
| 3 | 봇 등록 위저드·검증 지갑 자동 노출·위험 검사·관리자 심사·마켓·버전 이력 | 구현 |
| 4 | Testnet 시세/캔들/호가(WS)/잔고/포지션/미체결/체결 조회, 수동 주문·취소 | 구현 (주문은 agent 승인 + 테스트넷 자금 필요) |
| 5 | Builder Fee 승인(메인 지갑)·상한 검증·예상 수수료 | 구현 (BUILDER_ADDRESS 필요) |
| 6 | 추천 링크·2단계 관계 고정·정책 버전 | 구현 |
| 7 | 체결 기반 수수료 원장·배분·대사·claim·수동 지급 | 구현 (확정은 관리자 대사 후) |
| 8 | 검증 가능한 성과 지표·데이터 부족 표시 | 구현 (봇 실행 워커 전까지 모든 봇은 데이터 부족) |
| 9 | RBAC·감사 로그·단위/통합/E2E 테스트 | 구현 |
| 10 | 전략 소스코드 첨부(Pine Script·Python·JS/TS 등, ≤200KB): 기본 비공개, 버전별 보관(sha256), Pine 헤더 분석, 비밀값 거부, 코드 변경 시 재심사 | 구현 (코드는 실행하지 않음 — 저장·열람만) |

## 수용 테스트 매핑 (MASTER_PROMPT §14)
| 기준 | 자동 테스트 |
|---|---|
| 이메일 로그인 없이 MetaMask 로그인/로그아웃 | e2e `no email/password login…` |
| MetaMask 모바일 인앱 연결 | ⚠ 수동 확인 필요 (EIP-1193 주입 경로는 e2e로 검증, 딥링크 UI 구현) |
| 타인 봇 수정·등록자 주소 위조 불가 | integration `owner wallet is taken…`, `another wallet cannot…`, e2e lifecycle |
| 미심사 봇 비노출 | integration `unreviewed bots are hidden…`, e2e lifecycle |
| Testnet 시세 실값 갱신 | e2e `live Hyperliquid testnet market data` (체결내역은 실계정 필요) |
| Builder 승인 없음/상한 초과 시 주문 거부 | integration `refuses orders without a builder fee approval…` |
| 수수료 변경이 재동의 없이 미적용 | integration ×2, e2e lifecycle |
| 100 USDC → 70/6/14.4/9.6 | unit + integration |
| 추천인 부재 시 예비금 | unit + integration |
| A→B→C에서 B=1차, A=2차 | integration (referral + ledger) |
| 동일 체결 중복 수신 시 1회 정산 | integration `the same fill delivered many times…` |
| 취소/부분체결/정산 오류 시 원장 일치 | integration partial fills, reconcile, append-only (리베이트=음수 builderFee 없음; HL builder fee는 음수가 아님) |
| /admin·/partner 직접 접근 차단 | e2e |
| 시크릿·agent 키 번들/로그 비노출 | 빌드 번들 스캔(수동 스크립트), 코드 리뷰 |
| Backtest를 실거래로 표시 안 함 | 성과는 BOT 주문 체결만 집계, BACKTEST는 별도 상태 |
| 중단 명령 후 신규 봇 주문 즉시 차단 | integration `blocks new bot orders immediately…`, pause 테스트 |
| Testnet/Mainnet 분리, 무승인 메인넷 거래 없음 | integration mainnet 거부 테스트 |
