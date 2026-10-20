# P2P 스왑 모듈 (SWAP)

> **이용자 고지 (화면·/docs에 명시):** 스왑에 대한 수수료는 플랫폼에서 부과하지 않습니다. 스왑에 대한 모든 책임은 스왑을 진행하는 각자가 책임을 집니다.

결정(2026-10-20, 사용자): **자체 정산 컨트랙트**, **모든 토큰을 고정가 P2P로 우선 제공**(DEX 애그리게이터는 이후), **스왑 수수료 없음**.

## 지원 체인
| 체인 | 토큰 규격 | 테스트넷 (기본) | 메인넷 (잠금) |
|---|---|---|---|
| Ethereum | ERC-20 | Sepolia 11155111 | 1 |
| BNB Smart Chain | BEP-20 | BSC Testnet 97 | 56 |
| Polygon | ERC-20 | Amoy 80002 | 137 |
| Base | ERC-20 | Base Sepolia 84532 | 8453 |
| Robinhood Chain (Arbitrum Orbit L2) | ERC-20 | 46630 | 4663 |

- 모든 체인 ID는 2026-10-20 각 RPC의 `eth_chainId`로 확인(Robinhood 테스트넷 0xb626, 메인넷 0x1237). Robinhood 정보는 공식 문서 대신 RPC 실측 + 제3자 가이드 기반 — 메인넷 전 공식 문서로 재확인.
- 5개 테스트넷 모두 Cancun `MCOPY` 지원 확인(`eth_estimateGas` 실측) — 컨트랙트는 `evm=cancun`으로 컴파일.
- 메인넷은 `SWAP_NETWORK=mainnet` **그리고** `SWAP_MAINNET_ENABLED=true`일 때만 활성화. 외부 감사 전에는 설정 금지.
- RPC 교체: `SWAP_RPC_<chainId>` (예: `SWAP_RPC_11155111`).

## 동작 방식 (비수탁)
```
판매자(maker)                      서버                         구매자(taker)
 ① approve(sellToken → 컨트랙트, 판매수량)
 ② EIP-712 주문 서명(가스 없음) ──▶ 서명·잔고·승인·온체인 상태 검증 후 오더북 등록
                                   오더북 공개 ─────────────▶ ③ approve(buyToken, 지불액)
                                                              ④ fill(order, sig, 지불액)
                                   ◀── ⑤ tx 해시 보고 → 서버가 영수증의 OrderFilled 이벤트를 직접 읽어 기록
```
- 체결은 `CtcP2PSwap.fill()` 한 트랜잭션: 구매자 → 판매자(buyToken), 판매자 → 구매자(sellToken)가 **동시에** 이동하거나 전부 취소된다. 토큰은 컨트랙트에 머무르지 않는다.
- 부분 체결 지원. 지급량 = `floor(지불액 × sellAmount / buyAmount)` — 반올림은 항상 판매자에게 유리하며 0이 되는 먼지 체결은 거부.
- 커스텀 토큰 = 사용자가 컨트랙트 주소로 추가한 토큰(심볼·decimals는 체인에서 읽음, `listed=false`). 관리자가 검토 후 `listed`로 표시 가능. UI는 커스텀 토큰 거래 시 별도 확인을 받는다.
- 가격은 판매자가 정한 고정가이며 시장가와 무관하다.

## 컨트랙트 `contracts/contracts/CtcP2PSwap.sol`
- 소유자·관리자·수수료·업그레이드·일시정지 기능 **없음**(불변). 배포 후 운영자도 주문을 바꾸거나 자금을 옮길 수 없다.
- EIP-712 도메인 `("CTC P2P Swap", "1", chainId, verifyingContract)` → 다른 체인·다른 배포본으로 서명 재사용 불가.
- 서명 검증 `SignatureChecker`(EOA + EIP-1271 컨트랙트 지갑), ECDSA malleability 방지(OZ).
- 취소: `cancel(order)`(개별), `cancelUpTo(nonce)`(일괄). 서명이 공개 오더북에 있으므로 **오프체인 취소는 제공하지 않는다** — 취소는 반드시 온체인.
- 전송량 정확성 검사: 수령 잔고 증가분이 요청량과 다르면 revert → **전송 수수료(fee-on-transfer)·리베이스 토큰은 지원하지 않음**.
- 네이티브 코인(ETH/BNB/POL)은 직접 지원하지 않음 → WETH/WBNB 등 래핑 토큰 사용.
- `ReentrancyGuard`, `SafeERC20`(USDT 같은 비표준 반환값 대응), `Math.mulDiv`(오버플로 방지).
- 테스트(`contracts/test/CtcP2PSwap.ts`, Hardhat 3 EDR): 전량·부분 체결, 초과 체결, 먼지 체결, 위조·변조 서명, 지정 taker, 자기 체결, 다른 배포본 서명, 만료, 개별·일괄 취소, fee-on-transfer 거부, 판매자 잔고 부족 시 전체 revert, 무작위 부분체결 가격 불변식.

## 배포 (관리자)
1. 관리자 화면 → `스왑 컨트랙트` 탭 → 체인별 `MetaMask로 배포`. 배포 트랜잭션은 **관리자 본인 지갑**에서 서명·가스 지불(서버에 배포 키 없음).
2. 서버가 영수증의 컨트랙트 주소에서 `eth_getCode`를 읽고 컴파일 산출물(`src/lib/swap/artifact.json`)과 **immutable 영역을 제외하고 바이트 단위 비교** → 일치할 때만 기록(감사 로그).
3. 컨트랙트 코드를 바꾸면 `cd contracts && npm run export`로 산출물을 다시 내보내고 재배포해야 한다(기존 배포는 코드 불일치로 거부되지 않도록 체인별로 다시 기록).

## 서버 검증 (주문 등록 시)
판매자 = 로그인 지갑 · 두 토큰 등록 여부 · 금액 > 0 · 만료 1분~90일 · EIP-712 서명(배포 주소 기준) · 온체인 취소/nonce/체결 상태 · 판매자 잔고 ≥ 판매량 · 승인액 ≥ 판매량. 체결 기록은 클라이언트 값이 아니라 **영수증 이벤트**에서 읽고 `(chain, tx, logIndex)`로 중복 차단.

## 메인넷 전 필수
- [ ] 외부 스마트 컨트랙트 보안 감사, 버그 바운티
- [ ] 메인넷 RPC 유료 엔드포인트(`SWAP_RPC_*`), 레이트 리밋
- [ ] 커스텀 토큰 사기·피싱 대응 정책(신고, 차단 목록), 제재 주소 스크리닝
- [ ] P2P 중개의 규제 검토(VASP/중개업 해당 여부) — docs/LEGAL_CHECKLIST.md
- [ ] Robinhood Chain 공식 문서로 체인 정보 재확인
- [ ] 수수료 도입 시: 정책 버전·원장 설계(현재 0%)
