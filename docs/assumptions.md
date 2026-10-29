# 가정 · 공식 문서와의 차이 · 설계 결정

공식 문서 확인일: **2026-10-18** (Hyperliquid GitBook: builder-codes, exchange-endpoint, nonces-and-api-wallets, trading/fees). Testnet Info API로 실측 확인한 항목은 ✅ 표시.

## 1. Hyperliquid 사양 (확인된 사실)

| 항목 | 확인 내용 | 코드 반영 |
|---|---|---|
| Builder Fee 상한 | perps 0.1%, spot 1% | `HL_MAX_PERP_BUILDER_FEE_TENTHS_BP = 100`, Phase 1은 perps만 |
| Builder Fee 단위 | 주문 `builder.f`는 *1/10 bp* (10 = 1bp = 0.01%) | DB·코드 전부 `*_tenths_bp` 정수 |
| approveBuilderFee | **메인 지갑 서명 필수**(agent 불가). `maxFeeRate`는 `"0.01%"` 형식 문자열 | 브라우저에서 MetaMask로 서명 (`src/lib/hl-browser.ts`) |
| 승인 조회 | info `{type:"maxBuilderFee", user, builder}` → 정수(1/10 bp) ✅ | 주문 게이트에서 매 주문 실시간 조회, 실패 시 거부(fail-closed) |
| Builder 자격 | builder 계정 perps account value ≥ 100 USDC, account abstraction=standard | `npm run check:hl`로 점검 |
| 사용자별 승인 수 | 최대 10개 builder 동시 승인 | UI 안내 |
| Builder 보상 조회 | info `referral(builder)` → `builderRewards`, `unclaimedRewards`, `claimedRewards` (소수 8자리) ✅ | 원장 단위를 1e-8 USDC(e8)로 결정 |
| Builder 보상 수령 | 일반 referral reward claim 절차 | 자동 claim 미구현 — 관리자가 claim 후 금액 기록 |
| Builder fills 데이터 | `stats-data.hyperliquid.xyz/Mainnet/builder_fills/{lowercase addr}/{YYYYMMDD}.csv.lz4` | Phase 2: 자동 대사에 사용 예정 |
| 자동 분배 | **체결 즉시 여러 지갑으로 자동 송금하는 기능 없음** | 내부 원장 + 관리자 승인 수동 지급 |
| Agent(API) wallet | 서명 전용, 1 unnamed + 3 named/계정, `agentName`에 ` valid_until <ms>` 로 만료(최대 180일) 설정 | 이름 `ctc valid_until …`, 30일 만료 |
| Agent 주소 재사용 | 등록 해제·교체 후 nonce 상태가 지워져 재생 위험 → **재사용 금지** 권고 | 매번 새 키 생성, 기존 PENDING 폐기 |
| L1 액션 서명 | phantom agent EIP-712 (chainId 1337) — MetaMask로 직접 서명 불가 | 주문은 서버 보관 agent 키로 서명 |
| 기본 수수료 | perps Tier0 taker 0.045% / maker 0.015% | 예상 수수료 표시용 상수 (`HL_BASE_PERP_FEE`) |
| 가격 규칙 | perps: 유효숫자 5자리, 소수 `6 - szDecimals`자리, 정수 가격은 항상 허용 | `formatPerpPrice` |
| 최소 주문 | 10 USDC 명목가 | 게이트에서 사전 거부 |
| Testnet | `api.hyperliquid-testnet.xyz`, 212개 perp ✅ | 기본 네트워크 |

## 1-1. 지갑 네트워크 (2026-10-18 결정)
- 테스트넷 단계의 지갑 네트워크는 **Hyperliquid 테스트넷 HyperEVM (chain 998, RPC `https://rpc.hyperliquid-testnet.xyz/evm`, 가스 HYPE)** — 사용자 결정. 처음엔 Ethereum Sepolia로 설정했으나, Hyperliquid 테스트넷은 Sepolia 자산과 연결되지 않으므로 HyperEVM 테스트넷으로 변경. 메인넷 기본값은 HyperEVM 메인넷(999) — 2026-10-24 사용자 결정, Hyperliquid 메인넷이 0x3e7 서명자를 정확히 복원함을 미입금 키로 실측. `WALLET_CHAIN_ID`로 변경 가능.
- 이 체인은 *서명용*: SIWE 로그인 메시지의 Chain ID와 Hyperliquid user-signed 액션(approveBuilderFee/approveAgent)의 `signatureChainId`(0x3e6). 거래·잔고(perps USDC)는 HyperCore 테스트넷에 있다.
- 실측: `signatureChainId` 0x3e6로 서명한 approveAgent에서 Hyperliquid 테스트넷이 서명자 주소를 정확히 복원 ✅ (미입금 계정이라 "Must deposit" 응답). RPC `eth_chainId` = 0x3e6 ✅.
- 테스트넷 USDC: Hyperliquid 공식 faucet `https://app.hyperliquid-testnet.xyz/drip` — **같은 주소로 Hyperliquid 메인넷에 입금한 이력이 있어야** 1,000 mock USDC를 받을 수 있다(공식 문서 onboarding/testnet-faucet). 주문·승인 전 테스트넷 계정에 USDC가 있어야 한다("Must deposit before performing actions").
- 서버는 nonce 발급 시 chainId가 설정값과 다르면 `WRONG_CHAIN`으로 거부하고, 클라이언트는 서명 전에 `wallet_switchEthereumChain`(없으면 `wallet_addEthereumChain`)으로 전환·추가를 요청한다.

## 1-2. 메인넷 전환 단계 (2026-10-24 사용자 결정)
- **1단계(현재): 조회 전용 메인넷** — `HL_NETWORK=mainnet`, `WALLET_CHAIN_ID=999`, `MAINNET_TRADING_ENABLED=false`. 시세·호가·계정 조회와 로그인은 메인넷, 주문·거래 권한 위임(approveAgent)은 서버에서 거부(`MAINNET_DISABLED`).
- 2단계(미실행): `MAINNET_TRADING_ENABLED=true` — 보안 감사·Builder 주소(메인넷 perps ≥100 USDC)·관리자 지갑 설정 후 사용자 명시 승인으로만.
- P2P 스왑은 컨트랙트 외부 감사 전까지 **테스트넷 유지**(`SWAP_NETWORK` 미변경).

## 1-4. 영어 전용 · 추천 프로그램 비공개 (2026-10-29 사용자 결정)
- 사이트는 **영어 전용**. 한국어 전환 스위치를 없애고 모든 요청을 `DEFAULT_LOCALE="en"`으로 렌더링한다(이전 `ctc_lang` 쿠키는 무시). 소스의 `t(en, ko)`·`bi(en, ko)` 한국어 절반은 남아 있지만 표시되지 않는다.
- 추천(파트너) 프로그램은 **공식 공개 상품이 아니다**. 공개 메뉴·홈·가이드·문서에서 안내를 뺐고, 사용자가 스스로 파트너가 되는 `/api/partner/activate`와 `/partners` 페이지를 삭제했다.
- 파트너는 **관리자가 개별적으로 지정**한다: 관리자 콘솔 「Referral partners」 탭(`/api/admin/partners`)에서 지갑 주소로 지정·정지·재개. 지정된 파트너만 마이페이지에서 코드·추천 링크·대시보드 링크를 본다. 지갑은 사이트에 한 번 로그인한 적이 있어야 한다.
- 공개 수수료 고지는 「봇 등록자 70% · 플랫폼 관리자 배분 풀 30%」로 표기한다. 풀 내부 배분(플랫폼·1차·2차 파트너) 정책과 원장 처리는 그대로다.

## 1-3. 전략 소스코드 첨부 (2026-10-27)
- 첨부는 선택이며 심사·투명성 목적이다. 플랫폼은 코드를 실행하지 않으므로 실거래 성과는 여전히 플랫폼 주문 체결로만 집계된다.
- Pine `indicator()` 스크립트는 주문을 내지 않는다. 자동매매 연결은 TradingView 알림 → 플랫폼 Webhook(Phase 2)이 필요하다고 화면에 안내.
- 운영 중(LIVE 등) 봇의 코드 해시가 바뀌면 중대 변경으로 보고 SUBMITTED로 되돌린다. 줄바꿈(CRLF)·끝 공백 차이는 정규화되어 변경으로 보지 않는다.

## 2. 요구사항과 다르게(또는 제한적으로) 구현한 부분

1. **"서버 측 주문 범위 제한"은 프로토콜 기능이 아님.** Hyperliquid agent wallet은 주문 종류·금액 범위를 프로토콜 차원에서 제한하지 않는다. 범위 제한은 플랫폼 서버의 주문 게이트(`placeOrder`)가 강제하며, UI·문서에 그렇게 명시했다. 사용자는 Hyperliquid 앱에서 agent를 언제든 제거할 수 있다.
2. **Agent 개인키 서버 보관.** 무중단 자동매매(Phase 2)와 서버 게이트를 위해 agent 키를 서버에서 생성·AES-256-GCM 암호화(AAD = agent 주소) 보관한다. 키는 클라이언트에 반환되지 않는다. 프로덕션은 KMS/Secret Manager에서 `AGENT_KEY_ENCRYPTION_KEY`를 주입해야 하며 키 로테이션은 Phase 3 항목.
3. **봇 주문은 공개 API로 받지 않음.** `/api/trading/orders`는 수동 주문 전용(`source=MANUAL`). 봇 주문은 같은 게이트를 `source=BOT`으로 호출하는 봇 워커만 생성한다(Phase 2). 따라서 Phase 1에는 실제 봇 체결이 없고 모든 봇은 `INSUFFICIENT_DATA`로 표시된다 — 의도된 정직한 상태.
4. **수동 주문의 Builder Fee 기본값 0.** 플랫폼 수익은 봇 Builder Fee의 배분 지분에서 나온다는 정책을 따름. 운영자가 `MANUAL_ORDER_BUILDER_FEE_TENTHS_BP`를 설정하면 수동 주문에도 붙으며, 이때 "봇 등록자 70%" 몫은 봇이 없으므로 `PLATFORM_NET_REVENUE`(메모: owner share of non-bot order)로 기록된다. 이는 운영자의 명시적 선택이며 FEE_POLICY에 기재.
5. **수익 확정(CONFIRMED)은 관리자 대사 후 수동.** 체결의 `builderFee`는 OBSERVED로만 기록되고, 관리자가 Hyperliquid `referral(builder)` 보상·builder_fills CSV와 대사한 뒤 확정해야 70/30 배분 원장이 생성된다. 자동 대사는 Phase 2.
6. **ROI(수익률) 미제공.** 봇 귀속 자본(분모)을 확정할 방법(봇별 sub-account 또는 할당 원장)이 Phase 2 설계 대상이므로 Phase 1은 USDC 기준 실현 순손익·MDD·승률·손익비만 표시. 지갑 전체 수익률을 봇 실적으로 쓰지 않는다.
7. **검증 기준**: 청산 체결 20건 이상 + 첫 체결 후 14일 이상이면 `VERIFIED_LIVE`. 임의로 정한 초기값이며 정책 결정 필요.
8. **wagmi 대신 viem + EIP-1193/EIP-6963 직접 사용.** 지원 대상이 MetaMask(확장·모바일 인앱)뿐이라 의존성을 줄였다. SIWE는 `viem/siwe`(EIP-4361) 사용. 스마트 컨트랙트 지갑(EIP-1271) 서명은 미지원.
9. **Next.js 16 Cache Components 비활성화.** 대부분 화면이 세션·DB 의존이라 요청 시 렌더링(`force-dynamic`)이 더 단순하고 안전하다.
10. **Redis/BullMQ 미도입.** Phase 1의 rate limit은 Postgres 고정 윈도(`rate_limit_buckets`), 워커는 단일 루프. Phase 2에서 작업 큐 도입.
11. **개발/테스트 DB = PGlite**(WASM Postgres, 실제 SQL·트리거·RLS 동일). 프로덕션은 `DATABASE_URL`(Supabase 등). PGlite는 단일 프로세스 전용.
12. **RLS**: 모든 테이블 RLS 활성 + 정책 없음 = 서버 소유자 역할 외 전면 차단(Supabase anon/authenticated 키로 직접 접근 불가). 접근 제어는 서버 API에서 수행.
13. **관리자 지급 승인**: 생성자=승인자도 허용하되 감사 로그에 `single-admin approval`로 기록. 프로덕션 전 2인 승인 강제 필요(체크리스트).
14. **ADMIN 변경**: 최초 관리자만 `ADMIN_WALLET_ADDRESS`로 부트스트랩. 관리자 추가/회수 UI는 미구현(다중 승인 설계 후 Phase 2) — 현재는 DB 직접 작업 + 감사 기록 필요.
15. **기존 저장소 재사용 없음.** 작업 폴더(GstaMobility)는 무관한 회사 사이트였으므로 사용자 확인 후 `D:\개발\cryptotradercommunity`에 신규 생성. GSTA의 Supabase·Vercel 설정은 사용하지 않았다.
