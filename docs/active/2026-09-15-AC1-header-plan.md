# AC-1 헤더 보강 계획 — 어느 `lib/*.ts` 가 AM 원본인가 (목록만 · 실행은 메인 신호 뒤)

> 작성 2026-09-15 · B3 · 전수조사 §1 «AC-1 «AM 원본 경로·복사일» 헤더» 🟠 의 실행 계획.
> 🔴 **없는 출처를 지어내지 않는다**(메인 지시) — 근거가 없으면 «AM 원본 불명»으로 적고 넘어간다.
> 기준 커밋 main `c5e6fc1` · 대상 = `lib/**/*.ts` 중 **출처 문장이 헤더에 없는 66개**(전체 137개 중 71개는 이미 «AM 원본: …» 또는 «AC 신규»를 적어 두었다).

---

## 0. 무엇을 증거로 삼았나 (판정 규칙)

| 증거 | 뜻 | 세기 |
|---|---|---|
| ① 파일 안에 이미 **AM 을 말하는 문장**이 있다(형식만 다르다) | 사람이 출처를 알고 썼다 — «AM 원본: 경로 · 복사일» 형식으로만 고치면 된다 | 강 |
| ② 그 파일을 **만든 커밋**이 AC 라운드 계약(P1R1~R7·phase0)이다 | 그 라운드가 «AC 신규»로 발주한 것 — 헤더에 «AC 신규(계약 §…)»를 적는다 | 강 |
| ③ AM `lib/` 에 **같은 이름**의 파일이 있다 | 이름만 같을 수 있다 — 내용까지 봐야 한다(아래 실제로 봤다) | 중 |
| ④ 내보낸 함수 이름이 AM 파일과 겹친다 | 이식의 흔적 | 중 |
| ⑤ 아무것도 없다 | **«AM 원본 불명»** 으로 적는다 | — |

실제로 돌린 것: AM `lib/` **869개** 전수 대조(같은 이름 · 내보낸 이름 겹침) + 대상 66개의 **생성 커밋** 조회.
결과: 같은 이름 4건(`coin-reconcile`·`email`·`period`·`cron/coin-reconcile`) · 이름 겹침 3개 이상 **0건** · 나머지는 AC 라운드가 만든 파일.

---

## 1. A군 — AM 을 말하고 있는데 **형식만** 다르다 (9개 · 문장을 AC-1 형식으로)

| 파일 | 지금 문장(요약) | 넣을 헤더 줄 | 근거 |
|---|---|---|---|
| `lib/email.ts` | «AM lib/email.ts 축약 이식(2026-09-14)» | `AM 원본: ../AutoMarketing/lib/email.ts (축약 이식 2026-09-14 · 추적 픽셀·클릭 래핑은 안 가져옴)` | 본문 1줄에 이미 명시 · AM 같은 이름 파일 존재 |
| `lib/plans.ts` | «AM `plan-gate.ts`(1,489줄)는 **옮기지 않는다**» | `AM 원본: ../AutoMarketing/lib/plan-gate.ts (관례만 · 코드 이식 0 — AC 축 6개라 두 함수로 새로 씀 2026-09-14)` | 본문에 «안 옮긴다»가 명시 = 출처 관계는 있다 |
| `lib/director.ts` | «AM 관례(content-director «앞뒤만 한다»)» | `AM 원본: ../AutoMarketing/lib/content-director.ts (관례 이식 2026-09-14 · 결정 규칙은 AC §5.3 으로 새로)` | 헤더에 AM 관례 명시 |
| `lib/billing/ai-cost-cap.ts` | «AM `ai-meter` 관례» | `AM 원본: ../AutoMarketing/lib/ai-meter.ts (관례 이식 2026-09-14 · 상한은 AC 플랜별 KRW)` | 헤더 명시 |
| `lib/billing/packs.ts` | «AM 과 동일» | `AM 원본: ../AutoMarketing/lib/coin-ledger.ts COIN_PACKS (값 동일 · DB 오버레이는 AC 추가 2026-09-14)` | 헤더 명시 |
| `lib/billing/price-events.ts` | «AM `plan_price_events` 계승» | `AM 원본: ../AutoMarketing/lib/billing.ts plan_price_events (관례 계승 2026-09-14)` | 헤더 명시 |
| `lib/video/bgm.ts` | «AM `video-render.ts BGM_LIBRARY` 정본» | `AM 원본: ../AutoMarketing/lib/video-render.ts BGM_LIBRARY (무드 표 이식 2026-09-15)` | 본문 명시 |
| `lib/video/providers/index.ts` | «AM 관례(video-clips.ts …)» | `AM 원본: ../AutoMarketing/lib/video-clips.ts (관례 이식 2026-09-15)` | 헤더 명시 |
| `lib/coin-reconcile.ts` | «AM `coin-reconcile.ts` 자리» | `AC 신규(2026-09-15 · AM 재사용 맵의 coin-reconcile 자리 — **코드는 AC 원장 규약으로 새로 씀**. AM 원본 복사 0)` | 🔴 이름은 같지만 **내가 오늘 새로 썼다** — «이식»이라 적으면 거짓이 된다 |

## 2. B군 — AC 라운드가 만든 것 (57개 · «AC 신규(계약 §…)» 한 줄)

> 전부 생성 커밋이 AC 라운드 계약이다. 헤더 한 줄은 `AC 신규(계약 P1Rn §x · YYYY-MM-DD)` 꼴로 통일한다.

| 라운드 | 개수 | 파일 |
|---|---|---|
| P1R3-B(수익) | 13 | `ad-eligibility` · `cron/revenue-sync` · `revenue/{adsense,aggregate,aliexpress,common,coupang,google-oauth,index,linkprice,types,upsert,youtube}` |
| P1R2-B(크론·편성) | 11 | `topics-refresh-state` · `cron/{assign-topics,base,director-auto,learn,produce,publish-port,publisher,reap,review-deadline,roll}` |
| P1R4-B(결제·CS) | 7 | `banned-categories` · `cs` · `billing/{consents,promotions}` · `cron/{cs-auto-ticket,trial-expire}` · `ops/period` |
| P1R6-B-1(내보내기·공유카드) | 6 | `export/{build,markdown,r2-multipart,state,zip}` · `share-card/render` |
| P1R4-B2(운영 뒷단) | 3 | `ai-verify` · `cron/{ai-model-watch,runner-canary}` |
| phase0(뼈대) | 3 | `auth-service` · `db-util` · `validate` |
| KICC(결제 개통) | 3 | `pay-route` · `billing/callback` · `ops/settings` |
| P1R6-B(추천인·영수증) | 3 | `referral` · `billing/tax` · `ops/company` |
| P1R5-B2(영상 출구) | 2 | `video/{render-notify,render-queue}` |
| 그 밖 1건씩 | 6 | `accounts`(P1R1-B3) · `r2`(P1R1-B1) · `runner-release`(러너 배포) · `cron/coin-reconcile`(R7-B3) · `publish/tokens`(B2-3) · `video/types`(P1R5-B) |

**내용까지 본 것 4건(이름만 같은 함정 확인)**
- `lib/ops/period.ts` ↔ AM `period.ts` — **다른 것**이다(AM = 관리자 지표 기간 필터 · AC = 운영센터 KST 월 범위). → «AC 신규».
- `lib/r2.ts` ↔ AM `r2-server.ts` — `getR2Client` 한 이름만 겹친다(관례 수준). → «AC 신규(AM r2-server 관례)»로 적되 **이식이라 하지 않는다**.
- `lib/auth-service.ts` ↔ AM `auth.ts` — 내보낸 6개 중 겹치는 이름 **0**. → «AC 신규».
- `lib/publish/tokens.ts` ↔ AM `publish-threads.ts` — 겹치는 이름 **0**. → «AC 신규».

## 3. C군 — AM 원본 불명 (0개)

이번 조사에서 «출처를 못 찾겠다»로 남은 파일은 **없다**. 다만 B군의 헤더는 «AC 신규»라는 **주장**이므로, 나중에 AM 에서 같은 코드가 발견되면 그 파일만 A군으로 고친다(그 사실을 여기 적는다).

---

## 4. 실행 방법 (메인 «시작해» 뒤 · 한 커밋)

1. A군 9개 — 기존 문장을 지우지 말고 **첫 줄 바로 아래**에 `*   AM 원본: … (… YYYY-MM-DD)` 한 줄 추가.
2. B군 57개 — 헤더 첫 블록에 `*   AC 신규(계약 P1Rn §x · YYYY-MM-DD)` 한 줄 추가. 날짜는 **생성 커밋 날짜**(git log)를 쓴다(오늘 날짜로 적으면 거짓).
3. 🔴 **코드 한 줄도 건드리지 않는다** — 주석만. 끝나고 `tsc --noEmit` 으로 파일이 깨지지 않았는지 확인.
4. 🔴 **AC-38**(제어 문자) 주의: 주석에 붙여 넣는 문자는 일반 텍스트만. 커밋 뒤 `grep -rlP '[\x00-\x08\x0b\x0c\x0e-\x1f]' lib/` 로 0 확인.
5. 커밋 1개 · 메시지에 «A군 9(형식) · B군 57(AC 신규 표기) · 불명 0» 과 이 문서 경로.

**예상 시간** 반나절 이하(S) · **충돌 위험**: 라운드 중이면 다른 세션이 같은 파일 헤더를 만질 수 있다 → 그래서 **라운드 머지가 끝난 뒤**에 한다(메인 신호).
