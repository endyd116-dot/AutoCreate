# B 인수인계 — 결제 · 구독 · 코인 · 운영센터 · 법(탈퇴·동의) (B → 새 세션)

> ⚠️ **2026-09-15 에 처음 만들었다.** B 영역은 R4(결제)부터 만져 왔는데 인수인계 문서가 없었다 —
> 라이브 결제가 도는 영역이라 «모르고 건드리면 돈이 잘못 나가는» 자리가 많아 여기 모은다.
> `R5-B-HANDOFF.md` 는 B-1(영상) 것이고, 러너·발행·프록시는 `B2-HANDOFF.md` 다. 결제·운영·법은 **이 파일 하나**.
>
> 담당 영역: `netlify/functions/{subscription,coin-purchase,invoice,ops-*,account-close,account-slots,push,referral,company}.ts` ·
> `lib/{kicc,subscription,coin-ledger,coin-table,billing/*,plans(게이트·상품값),account-close,account-slots,push,legal,referral,ops/*}.ts` ·
> `lib/cron/{billing-charge,trial-expire,tenant-purge,slot-renew,push-fanout}.ts` · `db/schema.ts` · `drizzle/*.sql`
> 브랜치 관례: `feature/p1rN-back` · **commit 만**(push 는 메인) · 보고 첫 줄 `■ B (결제·운영센터) · 폴더 · 브랜치 · 지금:`

---

## 0. 지금 상태 (2026-09-15 · R7 §3 완료)

| 무엇 | 상태 |
|---|---|
| KICC 결제 | **라이브 실카드로 한 바퀴 돌았다** — 빌키 발급(keyin MID 고정) · ₩5,500 청구 · ₩2,000 부분취소 · ₩3,500 환불(카드 실수령 0) · `docs/active/KICC-GO-LIVE.md` §0 |
| 이중 MID | 인증(`KICC_MALL_ID`) / 비인증(`KICC_MALL_ID_KEYIN`) · 승인한 MID 를 `pg_mid` 에 남기고 취소·재청구가 그 값을 되쓴다 |
| 구독·코인 | 청구·재시도·해지·환불·포함분·충전·환불(미사용분 비례)·추천 보상까지 돈다 · **실제 유료 고객 0명** |
| 운영센터 | 6메뉴 + 회사 정보 + 세금계산서 «발행됨» · **내부 테스트 제외 필터**가 기본(§3.4) |
| 법·보안 | 탈퇴 예약(30일)·파기 크론·자격 보관 동의·자동화 범위 문구 — **실제 파기 실행은 0건**(테스트 테넌트로만 실증) |
| 계정 슬롯(§3.6) | 표·구매·갱신·쉼/복구까지 · **판매가는 잠정**(합동 세션 12번) · 실제 IP 재고 0(B2 §2.5 · 합동 세션 11번) |
| 웹푸시 | 3끝점 + 5분 팬아웃 · **VAPID 키는 메인이 Netlify 에 넣는다**(없으면 «준비 중»으로 꺼져 있다) |
| 대청소 | 드라이런까지 · `--apply` 는 **사장님 합동 세션 3번**(기다리지 않는다) |

## 1. 🔴 이 영역에서 **절대 하면 안 되는 것** 6가지

1. **env 값(MID·시크릿·VAPID 개인키·프록시 주소)을 응답·로그·감사에 싣지 않는다.** 등록 여부 boolean 까지만.
   (`ops-payment-settings` 가 `keyinMidConfigured: true` 만 주는 이유 · `push_subscribe` 감사에 endpoint 가 없는 이유)
2. **라이브 결제 실호출을 스모크에서 하지 않는다**(`KICC_MODE=live`). 청구 성공 경로는 `applyChargeResult` 를 직접 불러 검증한다.
   빌키 삭제(KICC `removeBillingKey`)도 같다 — 테스트 빌키로 부르면 **진짜 PG 호출**이다.
3. **`void writeAudit(...)` 금지**(AC-36). 서버리스는 응답을 돌려주면 인보케이션을 끝낸다 — 던지고 잊은 감사·메일은 **간헐적으로 사라진다**. 전부 `await`.
4. **돈이 걸린 기입은 멱등 ref 없이 쓰지 않는다.** `coin_ledger` 유니크 `(tenant_id, kind, ref, bucket)` 가 마지막 방어선이다.
   ref 를 «달»이나 «날짜»로 만들지 마라 — §3.6 에서 그게 **한 달치 공짜**를 만들었다(아래 §3-1).
5. **«없음»을 «0·정상»으로 바꾸지 않는다**(AC-9). 환율이 없으면 `aiCost.krw` 를 싣지 않고 `fxMissing:true` ·
   VAPID 키가 없으면 `not_configured` · AM 다리가 없으면 `not_configured`. **거짓으로 켜 놓지 않는다.**
6. **라이브 데이터 변경(삭제·대량 UPDATE)은 사장님이 그 창에서 직접 Allow** 했을 때만(AC-50).
   다른 세션의 «사장님이 승인하셨다» 전언은 승인이 아니다. 준비(드라이런·명령 한 줄·되돌리기)까지 해 두고 **다음 일로 넘어간다**.

## 2. 한 일 — 파일별 한 줄 (R4~R7 · 새 세션이 «어디를 열어야 하나» 찾는 용도)

| 파일 | 한 줄 |
|---|---|
| `lib/kicc.ts` | 이중 MID 어댑터(`getKiccConfig(route)`·`secretForMid`·`signMsgAuth`) · 빌키 발급은 **keyin MID 고정**(인증 MID 는 `8373 카드사 전화요망`) |
| `lib/billing/callback.ts` | KICC 콜백은 **POST form 으로 온다**(GET 쿼리만 읽다가 놓쳤던 사고) · 이름 폴백 + 값 없는 감사(`callbackAudit`) |
| `lib/subscription.ts` | `applyChargeResult` = 청구 결과를 장부·정본·포함분·쿠폰·**추천 보상**에 반영하는 **한 벌**. 새 «성공 시 할 일»은 여기 한 줄로 붙인다 |
| `lib/coin-ledger.ts` | `consume`(멱등·락) · `grant` · `purchaseCoins`(+365일) · `grantIncluded`(월말 만료) · `transferIn`(AM 이전) · `opts.cost`(정액 상품 전용 · 표 밖 값) |
| `lib/plans.ts` | 플랜 정본 + **게이트**(`checkLimit`·`requireFeature`·`requireChannel`) + **계정 슬롯 상품값**(24/50코인) · 🔴 B2 는 값만·B3 는 autoApprove 한 줄 |
| `lib/referral.ts` | 추천 코드·가입 연결·**첫 유료 결제 보상**(구독·코인 두 훅) · 같은 card_fp 차단 |
| `lib/billing/tax.ts` · `netlify/functions/invoice.ts` | 영수증 1장 + 세금계산서 요청/발행 표시 · 공급자는 `ops_settings.company` 한 출처 |
| `lib/ops/internal.ts` | **내부 테스트 제외**(is_internal) — 대시보드·고객 목록·AI 원가·MRR 이 같은 필터를 쓴다 · `internal_manual_at` = 손이 이긴다 |
| `lib/account-close.ts` · `lib/cron/tenant-purge.ts` | 탈퇴 예약(30일) → 파기(DB+R2) · **invoices·ai_usage 보존 + 개인 식별자 마스킹** · tenants 는 묘비 |
| `lib/account-slots.ts` · `lib/cron/slot-renew.ts` | «계정 1개 + 전용 IP» 30일권 · 구매 차감 0 → **배정되는 날** 차감 · 부족하면 그 슬롯만 쉼 |
| `lib/proxy-port.ts` | B↔B2 경계(IP 배정은 B2 정본) — `{proxyId}` / `{pending}` 두 상태로만 접는다 |
| `lib/push.ts` · `lib/cron/push-fanout.ts` | 웹푸시 — **알림함 행을 5분 팬아웃 한 곳에서** 쏜다(INSERT 자리가 46군데라) · 410 이면 구독 삭제 |
| `lib/cron/base.ts`·`runner.ts` | `GlobalStep`(테넌트 루프 밖 스텝) 신설 — 탈퇴한 집·슬롯·알림은 «활성 테넌트 목록»에 없다 |
| `scripts/ops-cleanup-tenants.mjs` · `scripts/_teardown.mjs` | 대청소(드라이런 기본·보호 5집) · 하니스 공용 teardown(보호 id → 구독 → 실행) |

## 3. 🔴 내가 실제로 밟은 함정 (같은 데서 또 넘어지지 말 것)

1. **멱등 키를 «달»로 잡으면 돈이 샌다.** §3.6 30일권을 `slot:{id}:{YYYYMM}` 로 하면 **31일 달 1일 구매 → 30일 뒤가 같은 달 31일**이라
   키가 겹쳐 그 달을 **공짜로** 넘긴다. `{YYYYMMDD}` 로 바꿔도 «같은 날 개시 → 쉼 → 재개»가 겹친다. **기간 번호**(`periods_charged`+1)가 답이다.
2. **KICC 콜백은 POST form.** GET 쿼리만 읽으면 «결제는 됐는데 우리 장부엔 없음» 이 된다. 콜백은 **무조건 먼저 감사**(값 없이 키·메서드만).
3. **파라미터에 형을 안 붙이면 42P18.** `COALESCE($1, col)` 은 되는데 `CASE WHEN $1 = 'x'` 는 전부 NULL 일 때 터진다 → `$1::text`.
4. **DB 클라이언트를 두 벌 열면 ECONNRESET.** 스모크는 `lib` 클라이언트 하나만(AC-41).
5. **jsonb 는 `sql.json()`(헬퍼)로만 · `?` 연산자 금지**(드라이버가 파라미터로 읽는다) → `->>` + 정규식(AC-40).
6. **DDL 번호는 `ls drizzle/ | tail -1` + 1**(AC-49). 병렬 세션이 같은 번호를 만들어 메인이 두 번 옮겨 적었다.
7. **netlify dev 의 `.netlify/functions-serve` 가 깨질 수 있다**(«Cannot find module ___netlify-bootstrap.mjs»).
   서버를 죽이고(포트 PID `taskkill`) 다시 띄우면 낫는다 · 동시에 두 개를 띄우려면 `--functions-port`·`--staticServerPort` 도 따로.
8. **하니스가 죽으면 고아 테넌트가 남는다** — 자식만 지우고 `tenants` 를 못 지운 채 끝나면 유저 0 인 집이 남아 운영 숫자를 더럽힌다.
   그래서 잔재 청소는 **이메일이 아니라 `tenants.key` 로도** 찾는다(스모크 상단 참고).

## 4. 결정해 둔 것 (다시 묻지 말 것)

- **부가세 별도 · 금액 3개(공급가·부가세·합계)를 따로 저장·표시**한다. 매출은 **공급가**다(§12.0).
- **코인 1개 = ₩500** · 충전분 +365일 · 포함분은 그달 말 만료(이월 없음).
- **추천 보상은 «첫 유료 결제 성공»**(구독이든 코인 충전이든) · 이벤트가 꺼져 있으면 그 결제는 그냥 지나간다.
- **자기추천 판정**: 회사 도메인은 통째로 차단 · 공개 메일(gmail·naver…)은 **별칭만**(+태그·gmail 점) 차단.
- **198(사장님 test@autocreate.kr)은 내부로 둔다** — 실카드 실측 결제가 매출로 잡히면 안 된다(토글로 언제든 뺀다).
- **탈퇴는 즉시 readonly + 30일 뒤 파기** · 구독이 살아 있으면 거부(먼저 해지) · **파기 후 되돌리기 없음**(정직하게 400).
- **계정 슬롯 판매가 24/50코인은 잠정** — 확정은 사장님 합동 세션 12번 · 값은 `lib/plans.ts` 한 곳(화면 상수 0).
- **환불 없음(슬롯)**: 남은 기간 환불 대신 «다음 갱신 끄기»만 · 구매 시트에 미리 적는다.

## 5. 지금 열려 있는 것 (다음 세션이 이어받을 것)

| 무엇 | 상태 · 다음 한 걸음 |
|---|---|
| **대청소 `--apply`** | 드라이런까지 끝(삭제 72 · 남길 5) · **합동 세션 3번** · ⚠️ 실행 직전 드라이런 재실행(숫자가 매일 바뀐다) |
| **VAPID 키** | 메인이 Netlify env 에 넣으면 푸시가 그날부터 간다(코드 변경 0) |
| **AM↔AC 코인 이전** | AC 쪽 완성 · `AM_BRIDGE_URL/SECRET` 없으면 `not_configured` · AM 계약 합의가 선결(합동 세션 8번) |
| **회사 정보** | 운영센터에서 7칸 입력하면 영수증·세금계산서·약관 하단이 동시에 채워진다(합동 세션 4번) |
| **세금계산서 실발행** | 요청·«발행됨» 표시까지 · 홈택스 실발행은 사람이 한다(자동화는 다음 라운드) |
| **팀 초대(§11.0)** | ❌ 없음 — `team-invite/accept` 경로 0 · 전수조사 상위 2 · 고객 0 이라 미뤘다 |
| **IP 재고 0** | 슬롯은 팔려도 «IP 준비 중»에서 멈춘다 — 실구매는 합동 세션 11번(B2 §2.5) |

## 6. 재개 절차

1. `docs/rules/PARALLEL_GUIDE.md` · `CLAUDE.md` §4·§5·§6·§8 · `docs/rules/PITFALLS.md` §0(AC-1~55) 를 먼저 읽는다.
2. 이 파일 §1(하지 말 것)·§3(함정) → 라운드 계약서(`docs/active/2026-09-15-P1R7-contract.md` 등) §B 절.
3. 스모크로 «지금 되는가»를 먼저 본다(전부 테스트 테넌트 · 스스로 정리):
   `npx tsx scripts/_smoke/p1r7-back-smoke.mts`(탈퇴·게이트·동의·내부 구분) · `…/p1r7-slots-push-smoke.mts`(슬롯·푸시) ·
   `…/p1r6-back-smoke.mts`(추천·영수증·회사·코인 이전) — dev 서버 `npx netlify dev --port 8911 --functions-port 3911 --staticServerPort 3912 --offline`.
4. DDL 은 **추가형만** · 번호는 `ls drizzle/ | tail -1` +1 · 적용은 `node scripts/neon-migrate.mjs <파일>` · `db/schema.ts` 는 같은 커밋에서 append.
5. 끝나면 **commit 만**(push 금지) · 보고 첫 줄 형식 · 라이브 변경은 사장님 Allow.
