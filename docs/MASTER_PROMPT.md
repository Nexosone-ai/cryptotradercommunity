# Claude Code 개발 실행 프롬프트 — CryptoTraderCommunity

> **사용법:** 이 파일 전체를 Claude Code 또는 Claude의 프로젝트 지침으로 제공한다. 프로젝트 루트에 `CLAUDE.md`로 저장해도 된다. 이 문서는 **구현을 지시하는 마스터 프롬프트**이며, 단순 기획서 작성 요청이 아니다.
>
> **서비스명:** CryptoTraderCommunity  
> **예정 도메인:** `cryptotradercommunity.org`  
> **서비스 성격:** Hyperliquid 기반 비수탁형(non-custodial) 트레이딩 봇 오픈 마켓플레이스  
> **기본 언어:** 한국어, 향후 영어 다국어 지원  
> **핵심:** MetaMask 지갑 로그인 · 봇 등록/검증 · 실거래 자동매매 · 검증된 수익률 공개 · Builder 수수료 정산 · 2단계 파트너 레퍼럴

---

## 0. Claude에게 주는 최우선 지시

당신은 Web3 프로토콜 엔지니어, 트레이딩 시스템 아키텍트, 백엔드 보안 엔지니어, 풀스택 UI 개발자, QA 담당자로 구성된 시니어 개발팀이다.

**CryptoTraderCommunity를 실제로 작동하는 프로덕션 지향 웹서비스로 개발하라.** 마케팅용 목업이나 가짜 지표를 완성품으로 제시하지 말라.

1. 현재 작업 폴더의 코드/패키지/DB/배포 설정을 먼저 검사하고 기존 자산을 최대한 재사용한다. 기존 코드가 없다면 신규 프로젝트를 생성한다.
2. 시작 시 공식 **Hyperliquid API/Builder Codes/Agent Wallet/수수료 규격의 최신 문서**를 확인한다. 문서와 충돌하는 요구는 임의로 API를 꾸며내지 말고, 실행 가능한 방식으로 구현하고 `docs/assumptions.md`에 차이와 이유를 기록한다.
3. 요구사항을 `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/FEE_POLICY.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`로 구체화한 뒤, **실제 코드를 작성**한다. 문서만 쓰고 끝내지 않는다.
4. 코드 변경 → 로컬 타입체크/린트/테스트 → 오류 수정 → 재검증을 반복한다. 작동하지 않는 버튼, 가짜 API 응답, 데모 통계를 실제 기능처럼 보여주지 않는다.
5. 모든 위험한 금전 이동/실거래/키 권한 위임에는 지갑 소유자의 **명시적 확인** 및 서버 측 검증이 필요하다. 운영자의 자산 보관 없이 사용자 자금은 가능한 한 본인 Hyperliquid 계정에 남긴다.
6. 외부 계정 설정, 시크릿, 메인넷 거래 승인, 실제 수수료 청구, 메인넷 자금 이체는 사용자의 실제 권한과 명시적 승인이 필요하다. 승인 없이 실행하지 않는다.
7. 환경변수가 없을 경우 `.env.example`, 테스트넷 통합, 안전한 읽기 전용 화면까지 완료한다. 누락된 키로 인해 전체 사이트가 죽지 않도록 한다.
8. 최종 보고서에는 구현된 것, 테스트된 것, 남은 설정값, 제약, 배포 절차를 정확히 구분한다.

---

## 1. 서비스 목표와 핵심 정책

- 전 세계 개발자가 **자신의 트레이딩 봇을 공개 등록**하고 다른 트레이더가 성능을 검증한 뒤 봇을 선택해 이용하는 오픈 플랫폼.
- **지갑 기반 신원 확인:** 일반 이메일/비밀번호·Google OAuth·ChatGPT 로그인 불필요. 기본 로그인은 MetaMask 지갑 서명만 사용.
- **유동성/호가/주문 체결:** Hyperliquid의 선물(perpetuals) 유동성을 사용한다. 자체 오더북이나 독립 유동성 공급원으로 가장하지 않는다.
- **봇 수익화:** 봇 등록자는 플랫폼이 허용하는 범위에서 자신의 봇에 적용할 *추가 Builder Fee율*을 설정하고, 검증된 거래로부터 수익을 얻는다.
- **플랫폼 수익:** 별도의 **추가 Builder Fee 수익 총액** 중 30%를 관리자 배분 풀로 배정한다. 이 풀에서 플랫폼 순수익과 1·2차 파트너 수익을 분리한다.
- **파트너:** 추천 링크를 이용한 2단계 레퍼럴 네트워크, 추천 유저의 플랫폼 경유 실체결에 따른 수수료 수익.
- **투명성:** 봇 등록자의 검증된 지갑주소 자동 노출, 공개된 실거래 실적과 수익률 검증 상태, 수수료율 및 이해관계 공개.
- 기본 서비스는 **비수탁형**으로 설계한다. 사용자 자산과 운영자의 정산 자산을 회계상 명확히 구분한다.

### 서비스 명칭 및 IA

상단 공개 메뉴는 `봇 마켓` / `트레이딩` / `랭킹` / `파트너 안내` / `마이페이지`로 단순하게 구성한다. 지갑 연결이 가장 눈에 띄는 CTA가 되게 한다.

- `/` 랜딩 홈
- `/bots` 봇 마켓 리스트
- `/bots/[id]` 봇 상세/실적/개발자 지갑/수수료/참여
- `/bots/register` 봇 등록 위저드 (지갑 서명 필요)
- `/trade` Hyperliquid 기반 실거래 화면
- `/portfolio` 내 잔고/봇 구독/포지션/이력
- `/rankings` 봇 랭킹 및 검증 지표
- `/ref/[code]` 추천인 랜딩 및 지갑 연결 시 연결 처리
- `/partners` 파트너 프로그램 공개 소개 페이지 (선택)
- `/partner` 파트너 전용 대시보드 (**메인 메뉴에 링크 노출 금지**)
- `/admin` 관리자 전용 대시보드 (**메인 메뉴에 링크 노출 금지**)
- `/docs` 서비스·수수료·보안 문서

`/partner`, `/admin`을 메뉴에서 숨기는 것만으로 보안 처리를 끝내지 말라. **서버 인증과 권한검사**를 강제한다.

---

## 2. 인증 — MetaMask Only

### 2.1 로그인

- EIP-1193 호환 주입형 지갑을 사용해 MetaMask 연결. 데스크톱 확장과 **MetaMask 모바일 인앱 브라우저**를 모두 지원한다.
- 지갑 연결만으로 인증 완료라고 보지 말고 서버에서 제공한 nonce를 포함하는 메시지에 **서명**한 뒤 검증한다(SIWE/EIP-4361 또는 검증된 동등 구현).
- nonce 일회용/만료, 도메인·체인ID 검증, 재전송 방지, 안전한 세션 쿠키 설정.
- DB에는 지갑 주소를 정규화해 저장하며 UI에서는 checksum 주소와 복사/익스플로러 링크 제공.
- 지갑 변경/계정 변경/연결 해제 즉시 세션과 권한 상태를 다시 평가.
- MetaMask 모바일에서 버튼 무반응 방지: 브라우저별 provider 탐지, 설치 유도/딥링크/모바일 브라우저 안내 및 오류 메시지.
- 로그인 요청과 **트레이딩 승인(Builder Fee/Agent Wallet)은 별개**다. 로그인만으로 주문 권한을 부여해서는 안 된다.

### 2.2 역할 및 권한

`VISITOR`, `TRADER`, `BOT_OWNER`, `PARTNER`, `ADMIN` 역할. 하나의 지갑이 여러 역할을 가질 수 있는 구조.

- 사용자: 공개 봇 탐색, 본인 데이터 열람, 본인 실거래/승인.
- 봇 소유자: 소유 인증이 완료된 봇만 생성·수정·중단, 자기 수익 확인.
- 파트너: 본인 레퍼럴 관계/수익 조회. 타인의 개인 거래 정보는 원칙적으로 비공개 또는 집계 제공.
- 관리자: 정책/심사/정산/감사 로그 관리.
- `ADMIN_WALLET_ADDRESS`는 환경변수로 초기 설정하되, 이후 변경은 다중 승인 또는 높은 수준의 재인증과 감사 기록을 요구.

---

## 3. 봇 등록 · 검증 · 운영

### 3.1 봇 등록 조건

MetaMask로 로그인하고 소유 지갑 서명을 완료한 사람만 등록한다. 봇 등록 시 아래 필드를 받는다.

- 봇명, 고유 slug, 로고/대표 이미지, 한 줄 소개, 자세한 전략 설명.
- 전략 유형: Trend Following / Grid / Martingale / TP Trading / Arbitrage(실현 가능성 검증 후 지원) / Custom.
- 거래 마켓 (예: BTC-PERP, ETH-PERP), Long/Short/Both, 레버리지 범위, 타임프레임, 주문 유형.
- 위험 파라미터: 1회 최대 주문, 최대 포지션 규모, 최대 레버리지, 손절, 일일 손실 한도, 긴급 중단.
- 실행 방식: 플랫폼 제공 전략 템플릿 / 검증된 전략 패키지 / 외부 신호 webhook 연동(보안 심사 시).
- 개발자 소개, 블로그/X/텔레그램 링크(선택 또는 신뢰도 평가에 반영).
- 봇별 **추가 Builder Fee율** (플랫폼 전역 상한/Hyperliquid 공식 상한 이내).
- `owner_wallet_address`: 현재 서명 검증된 지갑에서 서버가 자동 입력, 사용자가 직접 임의 주소로 속일 수 없음.
- 이용약관/위험 고지/수익률 표시 정책에 대한 동의.

### 3.2 봇 등록 상태

`DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → LIVE → PAUSED → ARCHIVED`, 필요 시 `REJECTED`, `SUSPENDED`.

- 승인 이전에는 공개 마켓에서 실행 가능한 봇으로 노출하지 않는다.
- 봇 소유자는 수정 이력과 버전을 확인할 수 있다.
- 봇 설정/수수료율 변경 시 기존 구독자에게 통지하고, 증가한 수수료는 **재동의 및 필요한 추가 승인** 후 적용한다.
- 거래 위험도/손절 미설정/과도한 레버리지/검증되지 않은 API 등을 사전 검사한다.
- 봇 정지 시 신규 주문 차단. 기존 포지션을 청산할지 여부는 사전 설정·사용자 권한·안전 정책에 따른다.

### 3.3 봇 코드 보안

- 불특정 개발자가 올린 소스 코드를 프로덕션 서버에서 그대로 실행하지 않는다.
- 우선 **샌드박스 격리된 워커** 및 제한된 전략 인터페이스를 사용한다.
- 패키지 서명/버전 고정/의존성 검사/네트워크 egress 제한/CPU·메모리·실행시간 제한/비밀정보 접근 차단/kill switch가 필요하다.
- MVP에서는 검증 가능한 기본 전략 템플릿과 제한된 webhook 인터페이스부터 시작한다.
- 봇 제작자의 소스코드를 자동으로 공개하지 않는다. 공개 지갑 및 성과와 소스의 공개 범위를 구분한다.

---

## 4. Hyperliquid 실거래 연동

### 4.1 연동 범위

- Hyperliquid 공식 Info API, Exchange API, WebSocket API 연동.
- 실시간 시장가격/호가/캔들/거래량/펀딩비/포지션/잔고/미체결/체결내역 표시.
- 매수·매도, 시장가/지정가, 청산(감소 주문), 포지션/손절/익절 관리.
- 사용자 승인 범위를 벗어나는 주문은 서버에서 거부.
- WebSocket 단절 시 지수 백오프 재연결, 스냅샷 복원, 중복 이벤트 방지, REST 재조정.
- 주문의 client order ID(`cloid`)를 봇 ID/실행 ID와 연관시켜 체결을 추적한다.
- Hyperliquid 주문/포지션의 진짜 상태를 source of truth로 사용한다.

### 4.2 자동매매 권한 위임

- 소유자의 자산은 사용자의 Hyperliquid 계정에 유지.
- Hyperliquid 공식 **API/Agent Wallet 승인 모델**을 검토해 제한된 주문 서명을 수행.
- 사용자에게 봇 실행 전 거래 권한·Builder 수수료 권한·위험을 구분해서 설명한다.
- 모든 서명은 사용자 명시적 승인으로 수행. 지갑의 seed phrase/private key 요구 금지.
- Agent 개인키가 꼭 필요하다면 별도 격리·암호화·KMS·키 로테이션·권한 만료를 구현하고, 범위 제약이 프로토콜에서 지원되지 않는 부분은 서버 주문 게이트·잔액 한도·kill switch로 보완한다. 프로토콜 자체 제한인 것처럼 홍보하지 않는다.
- 승인 취소 시 자동매매 중단/정산 유지. 실거래 중단 및 오류 시 관리자 경보.

### 4.3 테스트넷 우선

- Testnet과 Mainnet 환경을 설정으로 완전 분리.
- 기본값은 Testnet 또는 읽기 전용. Mainnet은 별도 환경변수와 사용자 재확인을 거친 후 활성화.
- 데모 모드와 실거래 결과를 UI에서 명확히 분리 표시.

---

## 5. 수수료 설계 — 가장 중요한 비즈니스 규칙

### 5.1 무엇을 분배하는가

Hyperliquid의 **기본 거래소 수수료(Hyperliquid protocol fee)를 플랫폼이 임의로 징수하거나 30%를 가져오는 구조로 가정하지 말라.**

공식 Builder Codes를 통한 **추가 Builder Fee 중 실제 체결로 발생한 수익**을 이 플랫폼의 분배 원천으로 한다. 플랫폼은 체결별 Builder 수수료율을 사용자의 승인 범위에서 설정한다. 기본 Hyperliquid 수수료와 추가 수수료를 UI에 각각 보여준다.

공식 문서 기준 Builder Fee 상한은 선물 0.1%, 현물 1%이며, 승인·적용 조건 및 수취 가능 마켓은 최신 공식 문서 기준으로 다시 검증하라. 최초 범위는 **Perpetuals**로 한정하고, 현물 지원은 후속 단계로 분리한다.

- `approveBuilderFee` 승인은 **사용자 메인 지갑 서명**이 필요하다.
- 추가 Builder Fee는 **주문별로** `builder` 파라미터를 사용한다.
- 주문에 적용할 수수료율은 사용자가 승인한 최대값 이하여야 한다.
- Builder로 지정할 관리자/플랫폼 계정은 공식 요구 조건을 충족해야 한다(예: perp 계정 가치 최소 100 USDC — 문서 확인).
- Hyperliquid 공식 Builder Fee 수취 흐름과 보상 claim 흐름을 검증한다. **주문이 체결되는 즉시 4명 지갑으로 자동 송금되는 기능을 Hyperliquid가 제공한다고 가정하지 않는다.**
- 정산은 실제 Builder 수익의 수취/claim 사실을 확인한 후, 별도 payout 레이어로 집행한다.

### 5.2 수수료 설정 모델

각 봇 제작자는 자신이 운영하는 봇에 적용할 `bot_builder_fee_rate`를 관리자 최대 허용치 내에서 설정한다. **하나의 주문에는 프로토콜이 허용하는 Builder Fee 하나를 사용**하며, 플랫폼 기본 수수료와 봇 수수료를 두 번 청구하지 않는다. 이 수수료의 **분배 지분**으로 플랫폼 몫을 확보한다.

수수료 계산에 쓰는 금액은 백분율이 아니라 정확한 소수(decimal) 타입으로 저장·계산한다. 정수 최소 단위 또는 지원 자산 decimal 정밀도를 사용한다.

### 5.3 초기 수익 분배 정책 — 100%의 사용처

**기준 금액 = 실제 수취 가능하고 정산 확정된 추가 Builder Fee 100%.**

| 대상 | 추가 Builder Fee 전체 대비 | 계산 원리 |
|---|---:|---|
| 봇 등록자 | **70%** | 수익 전체 × 0.70 |
| 관리자 배분 풀 | **30%** | 수익 전체 × 0.30 |
| └ 플랫폼 최종 수익 | **6%** | 관리자 풀 30% × 20% |
| └ 1차 추천 파트너 | **14.4%** | 관리자 풀 30% × 80% × 60% |
| └ 2차 추천 파트너 | **9.6%** | 관리자 풀 30% × 80% × 40% |
| **전체 합계** | **100%** | 70 + 6 + 14.4 + 9.6 |

**주의:** 플랫폼이 30%를 전액 *최종 순이익*으로 가져가고 파트너에게 또 24%를 지급하는 설계가 아니다. **30%는 최초 관리자 배분 풀, 플랫폼 최종 수익은 6%**다. 위 수치는 기존 협의에 따른 **초기 기본값**으로 설정한다.

예시: 실제 정산된 추가 Builder Fee가 **100 USDC**일 때

- 봇 등록자: 70 USDC
- 플랫폼 최종 수익: 6 USDC
- 1차 파트너: 14.4 USDC
- 2차 파트너: 9.6 USDC
- 총액: 100 USDC

관리자는 초기값을 변경할 수 있지만 아래 불변식을 강제한다.

```text
builder_fee_revenue = amount actually received / confirmed for payout
bot_owner_share + admin_pool_share = 100%
platform_net_share_of_pool + partner_pool_share_of_pool = 100%
tier1_share_of_partner_pool + tier2_share_of_partner_pool = 100%
net_payouts + reserved_unallocated + rounding_remainder = realized_revenue
```

### 5.4 추천인이 없는 경우

- 1차/2차 추천인이 없는 거래의 파트너 몫을 **존재하지 않는 파트너에게 가상 지급하지 않는다**.
- 미배정분은 `UNALLOCATED_PARTNER_RESERVE` 계정에 보류하며, 관리자의 정책에 따라 명시적인 결정과 감사 로그를 거쳐 처리한다.
- 이 미배정분을 플랫폼 순이익 6%로 합산하지 않는다. 미지급/미배정 상태를 대시보드에 별도 표시한다.

### 5.5 운영자 수취·지급 워크플로

1. 사용자가 봇의 총 Builder Fee율을 보고 승인한다.
2. 서버가 사용자 승인 여부와 수수료율을 검증한다.
3. 체결 시 플랫폼이 관리하는 **승인된 Builder 수취 주소**에 추가 Builder Fee가 적립되는 구조를 사용한다.
4. 온체인/공식 API/수취내역을 확인한 후, 봇 소유자 70%, 관리자 배분 풀 30%로 내부 정산 원장에 기록한다.
5. 관리자 배분 풀에서 플랫폼 20%, 파트너 80%를 계산하고, 1·2차 파트너에게 초기 60:40 비율을 적용한다.
6. 수익이 claim 및 지급 가능한 상태에 이르면 별도의 지급 어댑터가 수수료 자산/네트워크/가스/최소지급액을 검증하고 **승인된 payout**을 실행한다.
7. 지급 실패는 재시도하되 중복 송금 방지 키 및 원장 상태를 사용한다.
8. 자동 지급이 구현·검증되기 전에는 관리자 수동 승인 지급만 활성화하며, 화면에 자동 지급 완료라고 표시하지 않는다.

**중요:** 플랫폼 수취 주소, 관리자 순이익 계정, 고객/봇 개발자/파트너에게 지급할 미지급채무를 장부상 구분한다. 과금 및 정산 정책을 이용자에게 투명하게 공개한다.

### 5.6 수수료 사용자 경험

봇 상세 및 실거래 확인창에 다음을 반드시 표시:

- Hyperliquid 기본 거래 수수료(실제 계정에 적용되는 등급과 maker/taker에 따라 달라짐)
- 해당 봇의 추가 Builder Fee율
- 가상 체결 금액 대비 예상 총 수수료 및 실제 체결 이후 확정 수수료
- 수수료 수취 주체, 봇 등록자 수익배분 사실
- 서명/승인/취소/상한 변경 상태

---

## 6. 2단계 레퍼럴 파트너 시스템

### 6.1 관계 설정

- 파트너는 고유 코드와 URL을 가진다: `https://cryptotradercommunity.org/ref/ABC123`.
- 사용자가 URL로 진입하면 추천 코드를 안전하게 임시 보관하고, **최초 지갑 인증/약관 동의 시 추천 관계를 등록**한다.
- 최초 연결 후 추천인 변경은 원칙적으로 불가. 필요한 경우 관리자 승인/이력/부정행위 검사를 거친다.
- 동일 지갑의 자기추천, 다중계정 부정 추천, 순환 추천, 지갑주소 변경을 통한 수익 탈취 방지.
- Hyperliquid 자체 referral 코드와 **이 플랫폼의 내부 2단계 파트너 추천 원장**을 혼동하지 않는다. 내부 추천 프로그램 수익은 Builder Fee 몫에서 발생한다.

### 6.2 1차·2차 정의

예: `파트너 A → 파트너 B → 거래자 C`

- B가 직접 유치한 C 거래에서 **B가 1차 추천 수익**을 받는다.
- B의 추천인 A가 **2차 추천 수익**을 받는다.
- A가 직접 유치한 거래자 D 거래에서는 **A가 1차 추천 수익**을 받는다.
- 상위 2단계를 넘어서 지급하지 않는다.
- 추천자가 파트너 자격이 없거나 계약/규정상 수령 불가하면 해당 금액을 `UNALLOCATED_PARTNER_RESERVE`로 보류한다.

### 6.3 파트너 대시보드 (`/partner`)

- 내 추천 코드/복사 버튼/QR 코드.
- 직접 추천(1차) 인원, 간접 추천(2차) 인원.
- 총 거래량, 정산 확인된 Builder Fee, 1차 수익, 2차 수익, 미지급/지급 완료 내역.
- 날짜/봇/자산/추천 단계별 필터, CSV 내보내기.
- 수익 계산 근거와 수수료 정책 버전 명시.
- 개인정보 최소화: 타인 지갑 주소 및 포지션 등 민감 거래 세부 정보는 권한/동의와 정책에 따라 마스킹 또는 집계.

---

## 7. 봇 수익률 및 데이터 신뢰성

봇 개발자는 등록 시 공개 프로필에 **소유 인증된 지갑 주소**가 자동으로 표시된다. 그러나 지갑 하나에 여러 봇이나 외부 거래가 섞일 수 있으므로 **지갑 전체 수익률을 특정 봇 실적으로 둔갑시키지 않는다**.

### 공개 지표

- 최근 7/30/90일 및 누적 수익률(기간 선택), 실현손익, 미실현손익(별도 표시), 순손익.
- 최대 낙폭(MDD), 승률, 평균 손익비, 체결 횟수, 수익/손실 거래 횟수, 평균 레버리지, 청산 횟수.
- 누적 거래대금, 수수료/펀딩비, 전략 운영 시작일, 전략 버전, 최근 실행 시간.
- 누적 성과 그래프(검증된 데이터 출처 기반), 포지션 기록 및 거래 내역.
- 데이터 상태: `VERIFIED_LIVE`, `VERIFIED_HISTORICAL`, `BACKTEST`, `INSUFFICIENT_DATA`, `UNVERIFIED`.

### 계산 원칙

- 실제 체결/펀딩/잔고 변화/수수료를 Hyperliquid 공식 데이터로 확인한다.
- 입출금은 투자 성과와 분리한다. 사용자 자금의 외부 입출금이 수익률을 왜곡하지 않도록 TWR(시간가중수익률) 또는 적절한 현금흐름 조정 방식 정의.
- 여러 봇이 하나의 거래 계정을 공유하면 `cloid`/봇 실행 ID/포지션 장부를 바탕으로 귀속한다. 귀속 불가능한 항목은 **미귀속(Unattributed)** 으로 표시하고 검증된 수익률에 임의 포함하지 않는다.
- Hyperliquid sub-account 생성 자격/제한이 있을 수 있으므로 모든 신규 유저에게 무조건 sub-account를 만드는 전제를 두지 않는다.
- 개발자가 직접 입력한 과거 실적은 `SELF_REPORTED`로 구분하거나 공개 검증 지표에서 제외.
- 차트/랭킹에서 `BACKTEST`와 실거래를 섞지 않고 손실 가능성/청산 가능성을 눈에 띄게 표기.
- 특정 봇의 데이터가 부족하면 수익률 0% 또는 허구의 긍정 수치를 표시하지 말고 `검증 데이터 부족`을 노출.

---

## 8. 주요 화면과 디자인

### 비주얼 방향

- 글로벌 고급 트레이딩 터미널 스타일. **다크 테마 기본**, 추후 라이트 지원.
- 짙은 차콜/블랙 배경, 선명한 청록/블루 포인트, 손익 그린/레드, 넉넉한 여백과 읽기 쉬운 데이터 표.
- `CryptoTraderCommunity` 또는 `CTC` 텍스트 기반 심플 로고.
- desktop 거래 화면은 다중 패널, 모바일은 터치 우선 카드·탭·하단 액션바.
- MetaMask 연결 안내는 **불투명한 검정색 배경 + 흰색 글씨**, 높은 대비로 표기.
- 차트는 TradingView 또는 라이선스 호환 오픈소스 차트 라이브러리를 사용하되 실시간 데이터 출처와 업데이트 상태 표시.

### 홈 (`/`)

Hero: **“Build a Bot. Prove Performance. Trade Together.”**  
설명: “누구나 자신의 트레이딩 봇을 등록하고, 검증된 거래 성과를 공개하며, Hyperliquid 유동성으로 거래하는 오픈 커뮤니티.”

주요 블록: 실거래 검증 봇, 신규 봇, 위험 대비 성과, 봇 등록 프로세스, 수수료 공개, 파트너 소개, 위험 고지.

### 봇 마켓 (`/bots`)

카드/표 전환, 검색, 전략/자산/실거래 검증/수익률/최대 낙폭/수수료/운영기간 필터, 위험도 정렬.

봇 카드: 명칭·전략, 소유자 지갑 축약주소, 검증 배지, 기간 수익률, MDD, 거래 횟수, 추가 수수료율, 상세 보기.

### 봇 상세 (`/bots/[id]`)

수익률 차트, 거래 통계, 검증 상태, 개발자 주소(익스플로러 링크), 전략 설명, 위험 정책, 수수료 구성, 최근 체결, 구독/실행/중지 버튼.

### 트레이딩 (`/trade`)

마켓 선택, 실시간 차트·호가, 매수·매도, 레버리지/주문수량, 실시간 포지션/주문/체결/수수료, 봇 선택. **실거래 전 Builder Fee 승인 화면**을 제공.

### 관리자 (`/admin`)

수익 및 정산, 대기 봇 심사, 정책 버전/수수료 구성, 지급 승인, 지급 실패 모니터링, 지갑 권한/시스템 상태, 부정거래 검사, 감사로그.

---

## 9. 기술 스택 (권장)

기존 코드가 있다면 무조건 새로 갈아엎지 말고 현 기술 스택에 맞춰 적용하라. 신규 구축 시 기본 선택:

- Frontend: **Next.js (App Router) + TypeScript + Tailwind CSS**.
- UI: shadcn/ui 또는 동등 수준의 접근성 높은 컴포넌트.
- Web3: wagmi + viem + MetaMask provider / EIP-1193, 안전한 SIWE 라이브러리.
- DB: PostgreSQL (Supabase 이용 가능), Prisma 또는 Drizzle ORM.
- Cache/Queue: Redis + BullMQ 또는 동등 신뢰성의 작업 큐.
- Realtime: Hyperliquid WebSocket, 연결 상태/재조정 관리.
- Charts: Lightweight Charts 또는 적법한 TradingView 통합.
- Backend: Next.js API route는 BFF에 사용 가능. **주문/봇 실행/정산**은 장시간 실행 가능한 분리 워커 서비스로 설계.
- Deployment: Vercel(프런트엔드) + 별도 항상 실행되는 워커 호스팅 + DB + Redis + KMS/Secrets.
- Tests: Vitest/Jest 단위·통합 + Playwright E2E; 중요 정산 로직은 속성 테스트.

Vercel 서버리스 함수만으로 무중단 자동매매를 돌리지 않는다.

### 권장 아키텍처

```text
Trader / Bot Owner / Partner (MetaMask)
                    │
             Next.js Web UI
                    │
         Wallet Auth + BFF/API
                    │
      PostgreSQL + Redis/Queue
            ┌───────┴─────────┐
            │                 │
      Strategy Workers   Settlement Worker
            │                 │
      Order/Risk Gateway      Fee Ledger
            │                 │
            └── Hyperliquid ─┘
                 Info / Exchange / WS
```

---

## 10. DB 테이블 및 관계 — 최소 요구

테이블 생성 마이그레이션과 인덱스·유니크 제약·외래키·RLS/서버 권한검사를 구현한다.

| 엔터티 | 목적 / 주요 필드 |
|---|---|
| `users` | id, wallet_address(normalized unique), created_at, status |
| `user_roles` | user_id, role, granted_at |
| `auth_nonces`, `sessions` | nonce 일회용 검증, 서명 세션 관리 |
| `bots` | id, owner_user_id, name, slug, status, fee_rate, strategy_type, config_version |
| `bot_versions` | 봇 변경이력, 해시, 게시 상태 |
| `bot_review_logs` | 심사 결정, 관리자, 사유, 타임스탬프 |
| `bot_subscriptions` | 사용자-봇 연결, 수수료 재동의, 권한 상태 |
| `trading_accounts` | 유저 Hyperliquid 실제 계정주소/권한/환경 |
| `agent_authorizations` | 에이전트 승인 상태/권한 이력 (비밀키 plaintext 금지) |
| `builder_fee_approvals` | user, builder, max_fee_rate, chain, verification_at |
| `orders` | bot_id, user_id, cloid, order_id, side, price, size, status |
| `fills` | unique transaction/fill id, fee, builder_fee, funding link, source timestamp |
| `positions_snapshots` | 사용자/봇별 포지션 상태, 시점 |
| `bot_performance_snapshots` | 기간별 ROI/MDD/PnL/검증상태/방법론 |
| `partners` | user_id, referral_code(unique), eligibility_status |
| `referral_relations` | trader_id, direct_partner_id, indirect_partner_id, frozen_at |
| `fee_policy_versions` | 수수료 분배율, 유효시점, 승인자, 정책 상태 |
| `fee_events` | 실체결 Builder Fee 이벤트, idempotency key, 확인 상태 |
| `ledger_entries` | 복식 장부 항목, 금액/자산, 계정 유형, 이벤트 연계 |
| `payouts` | 수령인/금액/자산/네트워크/상태/tx_hash/재시도키 |
| `admin_audit_logs` | 변경 전후/주체/시점/해시/사유 |
| `risk_events` | 손절/서버중단/권한 오류/비정상 주문 알림 |

- 금액은 JS float를 회계 원장에 직접 사용하지 않는다.
- 중복 WebSocket 이벤트나 중복 API 응답을 받아도 원장에 한 번만 기록.
- 수수료 정책은 **체결 시점의 버전**으로 계산하고 사후 변경으로 과거 장부를 재작성하지 않는다.
- Admin 정산·봇 소유자·파트너 수익의 누적 합과 원천 Builder 수익을 항상 대사 가능해야 한다.

---

## 11. 백엔드 API — 구현 범위

실제 라우팅에 맞춰 API 계약(OpenAPI 등)을 작성하라. 예시:

```text
POST   /api/auth/nonce
POST   /api/auth/verify
POST   /api/auth/logout
GET    /api/me
GET    /api/bots
POST   /api/bots
GET    /api/bots/:id
PATCH  /api/bots/:id
POST   /api/bots/:id/submit
POST   /api/bots/:id/subscribe
POST   /api/bots/:id/start
POST   /api/bots/:id/stop
GET    /api/bots/:id/performance
GET    /api/market/metadata
GET    /api/market/candles
GET    /api/trading/account
GET    /api/trading/positions
POST   /api/trading/orders
POST   /api/trading/orders/:id/cancel
GET    /api/fees/estimate
GET    /api/fees/approval
POST   /api/fees/approval/challenge
GET    /api/partner/summary
GET    /api/partner/referrals
GET    /api/partner/earnings
GET    /api/admin/bots/pending
POST   /api/admin/bots/:id/approve
POST   /api/admin/bots/:id/reject
GET    /api/admin/fees/ledger
POST   /api/admin/payouts/:id/approve
GET    /api/admin/audit-logs
```

**주의:** 승인 서명은 프런트엔드 지갑/공식 Hyperliquid API가 담당하고 서버 API는 사용자 서명을 대체하지 않는다. 인증, 역할 검사, 유효성 검증, rate limit 및 replay 방지를 각 엔드포인트에 적용한다.

---

## 12. 보안·법률·운영의 필수 조건

- MetaMask 비밀복구구문/시드/개인키 요청 금지. 민감 값 로그 노출 금지.
- 트레이더별 주문/포지션 데이터 접근 차단과 `ADMIN`/`PARTNER` 역할별 서버 승인 필수.
- 위험 한도: 최대 일일 손실, 주문당 한도, 고레버리지 경고, 초당 주문 속도 제한, 불안정 API 시 fail-closed.
- 자동매매 장애 대응: 키 만료, 잔액 부족, 주문 중복, partial fill, 재연결, 가격 급변, 펀딩비, 청산, 서버 재시작.
- 정산 운영: 최소 지급액, 지급 주기, 수취 네트워크, 가스/claim 비용, 결제 취소 가능성, 조정 장부, 회계 감사.
- 보안 로그/정산 변경 내역은 변경 불가능한 감사기록 또는 이에 준하는 보호 적용.
- **수익 보장/무위험/확정수익 표현 금지**. 손실·레버리지·강제청산·시스템 장애 위험 및 과거 수익률 비보장 고지.
- 실제 운영 전 관할권별 자동매매 소프트웨어, 가상자산 서비스, 추천 보상, 개인정보, 마케팅·광고·세무 관련 법적 검토 항목을 체크리스트로 작성. 법적 적합성을 검토 없이 확정 주장하지 않는다.
- 백테스트/모의거래 결과의 데이터 제공자, 지연, 검증 방법을 명확히 공개.

---

## 13. 우선순위 및 실행 단계

### Phase 1 — 작동하는 MVP (우선 완성)

1. Next.js 반응형 UI와 기본 페이지.
2. MetaMask-only 로그인 및 모바일 인앱 브라우저 지원.
3. 봇 등록·검증 지갑 노출·관리자 심사·봇 마켓.
4. Hyperliquid Testnet 시세/잔고/포지션/주문/체결 조회 및 실 주문 연결.
5. Builder Fee 승인·수수료율 검증·수수료 예상액 표시.
6. 추천 링크 등록/2단계 관계 생성, 정책 버전 관리.
7. 체결 이벤트 기반 수수료 원장과 관리자/봇 개발자/파트너 정산 계산.
8. 실제 검증 가능한 봇 성과 지표(가능한 것만)와 데이터 부족 표시.
9. RBAC, 감사로그, 필수 단위/통합/E2E 테스트.

### Phase 2 — 자동화·지급·고급 봇

1. 격리된 봇 워커, 전략 템플릿(Trend/Grid/Martingale/TP Trading), 외부 webhook.
2. 동의/권한에 따른 실거래 자동매매, 위험관리, 긴급 중단.
3. 실제 Builder 수익 claim 확인 및 지급 워커, 예외/재시도 처리.
4. 수익률 고급 분석, 랭킹, 기간별 검증, 실시간 대시보드.
5. 부정 추천 탐지, 파트너 지표, 국제화.

### Phase 3 — 운영 준비 및 프로덕션 배포

1. Mainnet 수수료/승인/권한/정산 E2E 재검증.
2. 접근 권한·스마트 계약/프로토콜 상호작용·주문 게이트에 대한 보안 감사.
3. 세무/약관/규제 검토·운영 절차·모니터링/백업/복구 테스트.
4. Domain `cryptotradercommunity.org`, HTTPS, 배포, 관측성 및 장애 알림.
5. 운영자의 메인넷 활성화 및 정산 승인 후 단계적 론칭.

---

## 14. 수용 테스트 (모든 항목을 자동화 우선)

- [ ] 이메일 로그인 화면 없이 MetaMask로 로그인하고 로그아웃 가능.
- [ ] MetaMask 모바일 인앱 브라우저에서 연결 버튼이 실제 동작.
- [ ] 타인 지갑으로 등록된 봇을 수정하거나 등록자 주소를 위조 불가.
- [ ] 미심사 봇이 사용 가능 상품으로 노출되지 않음.
- [ ] Hyperliquid Testnet 시세 및 체결내역이 실제 값으로 갱신.
- [ ] 사용자의 Builder Fee 승인 없거나 상한 초과 시 주문 거부.
- [ ] 봇 수수료율 변경이 기존 구독자의 추가 동의 없이 적용되지 않음.
- [ ] 한 건 체결/수익 100 USDC에서 **70 / 6 / 14.4 / 9.6** 분배 합계가 정확히 100.
- [ ] 추천인 1차 또는 2차 부재 시 미배정 금액이 예약원장으로 이동.
- [ ] `A → B → C`에서 C 실거래시 B=1차, A=2차 계산.
- [ ] 같은 체결 이벤트를 여러 번 받더라도 수수료가 한 번만 정산.
- [ ] 주문 취소/부분 체결/리베이트/정산 오류에 대해 원장이 일치.
- [ ] `/admin`을 직접 접속해도 비관리자는 API 및 UI에서 모두 차단.
- [ ] `/partner`를 직접 접속해도 자격 없는 계정은 차단.
- [ ] 비공개 정보, 시크릿, 에이전트 키가 클라이언트 번들/로그에 노출되지 않음.
- [ ] Backtest 성과가 실거래 검증 성과로 표시되지 않음.
- [ ] 사용자 중단 명령 이후 신규 봇 주문이 즉시 차단됨.
- [ ] Testnet과 Mainnet이 명확히 분리되고 무승인 Mainnet 거래 없음.
- [ ] 빌드, 린트, 타입체크, 단위/통합/E2E 테스트 결과가 최종 보고에 명시.

---

## 15. 최종 산출물

다음 파일/코드를 실제 생성하라.

```text
cryptotradercommunity/
├── app/ or src/app/          # 공개/마이/파트너/관리자 UI
├── components/               # 디자인 시스템 / 차트 / 지갑 UI
├── lib/                      # wallet, hyperliquid clients, fee engine, auth
├── workers/                  # bot execution, WS, reconciliation, settlement
├── prisma/ or db/             # migrations, schemas, indexes
├── tests/                    # fee, referral, auth, live/testnet workflows
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── FEE_POLICY.md
│   ├── SECURITY.md
│   ├── DEPLOYMENT.md
│   ├── API.md
│   └── assumptions.md
├── .env.example
├── README.md
└── package.json
```

마지막 출력 형식:

1. **완료한 기능** (실제 동작 여부)
2. **실행 방법** (설치, DB 마이그레이션, 개발 서버, 워커)
3. **테스트 결과** (실행 명령 및 통과/실패)
4. **배포 방법** (Vercel + 장기 실행 워커 + Supabase/Postgres + Redis)
5. **필요한 환경변수/외부 승인** (실제 비밀값은 출력 금지)
6. **실제 작동하지 않는 항목 및 그 이유** (가짜 완성 선언 금지)
7. **Mainnet 출시 전 체크리스트**

---

## 16. 공식 문서 — 구현 전에 반드시 재확인

- Hyperliquid Builder Codes: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes
- Hyperliquid Exchange Endpoint: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint
- Hyperliquid Info Endpoint: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- Hyperliquid WebSocket Subscriptions: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
- Hyperliquid Nonces & API Wallets: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets
- Hyperliquid Trading Fees: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees
- Hyperliquid Referrals (플랫폼 자체 2단계 추천과 구별): https://hyperliquid.gitbook.io/hyperliquid-docs/referrals
- MetaMask 개발자 문서: https://docs.metamask.io/

## 시작 명령

**이제 저장소를 검사하고 Phase 1부터 실제로 개발을 시작하라.** 먼저 현재 디렉터리 구조, 기존 구현 활용 계획, 공식 문서 검증 결과, 수수료 및 지갑 보안 구현에 필요한 변경사항을 요약한 후 코드를 생성한다. 테스트 가능한 단위까지 작업하고 실제 테스트를 실행한다. 특정 기능에 외부 승인이나 자격증명이 필요하면 안전한 스텁/테스트넷 통합과 설정 안내를 제공한 뒤 독립적으로 가능한 다른 구현을 계속한다. 임의의 Mainnet 거래나 송금은 수행하지 않는다.
