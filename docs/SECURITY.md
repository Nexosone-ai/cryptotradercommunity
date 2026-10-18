# 보안 설계 (SECURITY)

## 인증 — MetaMask only
- EIP-4361(SIWE) 메시지를 **서버가 생성**하고 nonce(128-bit, 1회용, 10분 만료)를 DB에 저장한다. 검증 시 nonce를 원자적으로 소비(`UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING`)하므로 재전송·동시 재사용이 불가하다.
- 서명된 메시지는 발급 원문과 **바이트 단위로 일치**해야 하며(도메인·URI·체인ID·주소 교체 방지), 도메인은 `APP_URL` 호스트와, 체인 ID는 `WALLET_CHAIN_ID`(testnet 기본 HyperEVM testnet 998)와 일치해야 한다. 서명은 `viem.verifyMessage`로 복원 검증.
- 세션: 32바이트 랜덤 토큰을 httpOnly·SameSite=Lax·(프로덕션) Secure·`__Host-` 쿠키로 발급, DB에는 HMAC-SHA256(SESSION_SECRET) 해시만 저장. 7일 만료, 로그아웃 시 폐기.
- 지갑 계정 변경/연결 해제(`accountsChanged`, `disconnect`) 감지 시 즉시 로그아웃.
- 로그인 서명은 거래 권한이 아니다. Builder Fee 승인과 Agent 승인은 별도 서명.

## 인가 (RBAC)
- 역할: TRADER, BOT_OWNER, PARTNER, ADMIN (`user_roles`, 다중 역할). VISITOR = 비로그인.
- 모든 변경 API는 `mutationContext`에서 세션 → 역할 → Origin 검사 → 사용자별 rate limit 순으로 처리.
- `/admin`, `/partner` 페이지는 서버 컴포넌트에서 역할 검사 후 404, API는 401/403 (E2E로 검증). 메뉴 비노출은 보조 수단일 뿐이다.
- 봇 소유자 주소는 세션 지갑에서 서버가 복사 — 요청 본문의 주소는 무시(테스트). 타인 봇 수정/제출 403.
- 관리자는 본인 봇을 심사할 수 없음(이해충돌). 관리자가 중단(SUSPENDED)한 봇은 소유자가 재개 불가.

## CSRF · 남용 방지
- 상태 변경 요청은 `Origin` 헤더가 앱 출처와 일치해야 함(+ SameSite 쿠키).
- Rate limit(Postgres 고정 윈도): nonce/verify IP당 20/분, 주문 사용자당 3/초·30/분 등.

## 거래 권한 · 키
- 시드 구문·개인키를 요청하지 않는다(UI 고지).
- Agent 키: 서버에서 생성, AES-256-GCM(12B IV, AAD=agent 주소)로 암호화 저장, 복호화 시 주소 일치 재검증. 클라이언트로 반환·로그 출력 없음(번들 검사로 확인). `AGENT_KEY_ENCRYPTION_KEY` 미설정 시 기능 비활성.
- Agent는 출금 불가(서명 전용). 30일 만료(`valid_until`), 재사용 금지(매번 새 주소).
- 주문 게이트(fail-closed): 네트워크 일치 → 메인넷 플래그+재확인 → 봇 LIVE·구독 ACTIVE·허용 마켓 → 수수료 상한 → agent 활성 → Hyperliquid `maxBuilderFee` 실시간 확인(조회 실패 시 거부) → 마켓 존재·가격 밴드(±20%)·최소/최대 금액 → cloid 기록 후 전송. 거부는 `risk_events`에 기록.

## 데이터 보호
- RLS 활성(정책 없음) — Supabase anon/auth 키 직접 접근 차단. 서버만 DB 접근.
- 원장·감사 로그 append-only 트리거, 감사 로그는 SHA-256 해시 체인(`verifyAuditChain`)으로 위변조 탐지.
- 파트너 화면의 추천 트레이더 지갑은 마스킹, 개별 포지션 미제공.
- 보안 헤더: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.

## 봇 코드 실행
- Phase 1은 업로드 코드를 실행하지 않는다. 실행 방식은 템플릿/패키지/Webhook 선언만 받고 심사 대상으로 표시.
- Phase 2: 격리 워커(컨테이너/Firecracker), egress 제한, CPU·메모리·시간 제한, 서명된 패키지·버전 고정, 시크릿 비접근, kill switch.

## 알려진 한계 (프로덕션 전 해결)
- 지급 2인 승인 미강제, 관리자 추가/회수 UI 없음.
- Rate limit이 DB 기반 — 대규모 트래픽 전 Redis로 이전.
- 감사 로그 외부 보관(WORM 스토리지) 미구성.
- CSP 헤더 미설정(Next 인라인 스크립트 nonce 구성 필요).
- EIP-1271(컨트랙트 지갑) 서명 미지원.
- 독립 보안 감사 미실시.
