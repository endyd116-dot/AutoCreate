# 수리 3판 · B — 🔴 «못 쟀다(⊘)» 여덟 쌍을 전부 열어 봤다 (2026-09-19)

> 브랜치 `fix/ops-repair3-2026-09-19` · **push 안 함** · 앞판 [`2026-09-19-scenario-b-repair.md`](2026-09-19-scenario-b-repair.md)
> 메인 승인: «⊘ 는 «괜찮다»가 아니다(AC-9)가 4/4 로 증명됐다. 남은 여덟도 같은 확률로 본다.»

## 0. 결과 한 줄
**여덟 중 하나가 진짜 고장**이었다 — `ops-plan-update`. 나머지 일곱은 **열어 보니 멀쩡**했고, ⊘ 인 이유는 **자가 구조적으로 못 읽는 모양**이기 때문이다.
⇒ 열어 본 몫은 이제 **12쌍 중 5쌍이 고장**(1판 프로모션·쿠폰 4 + 이번 1). «⊘ 를 통과로 세지 마라»는 여전히 옳다.

🔴 **그리고 메인이 먼저 보라고 한 고객 쪽 둘(`publish-now`·`rules-settings`)은 둘 다 멀쩡했다.** 이건 좋은 소식이다 — 손님이 매일 누르는 자리다.

## 1. 🔴 찾은 고장 — `ops-plan-update` : 요금제 한도를 **고칠 방법이 없었다**

```
화면 ops/plans.html:61   → { key, patch: { maxAccounts, coinsIncluded, runnerDevices, teamSeats, horizonDays, features } }
서버 ops-plans.ts:137    → parseLimits(b, cur.limits)   ← 봉투째 넘어간다
     parseLimits:41      → for (k of LIMIT_KEYS) if (b[k] === undefined) continue;   ← 하나도 못 찾는다
     → 못 찾은 키는 **base(지금 값) 그대로** ⇒ 🔴 아무것도 안 바뀌는데 `ok:true`
화면                      → «저장했어요» 토스트
```

매크로·FAQ·프로모션·쿠폰과 **똑같은 봉투 병**이고, 증상도 같다 — **오류가 한 글자도 안 난다.**

### 실측 (🔴 라이브 요금제는 안 건드렸다)
`starter`·`pro`·`agency` 는 **손님이 돈을 내는 정본**이라 시험 대상으로 쓰지 않았다.
대신 **비공개 시험 플랜 `scenbtest`(`public:false`)** 를 하나 만들어 거기서 쟀다.

```
전:  {"teamSeats":1,"horizonDays":7,"maxAccounts":3,"coinsIncluded":40,"runnerDevices":1}
POST /api/ops-plan-update {"key":"scenbtest","patch":{"maxAccounts":9,"coinsIncluded":99,"runnerDevices":4,"teamSeats":5,"horizonDays":30}}
후:  {"teamSeats":5,"horizonDays":30,"maxAccounts":9,"coinsIncluded":99,"runnerDevices":4}   ✅
무회귀: 옛 평면 모양 {"key":"scenbtest","maxAccounts":2} 도 그대로 돈다 ✅
고객에게 새나: `GET /api/plans` → `starter pro agency` (시험 플랜 안 보임) ✅
```

**고친 것**: `ops-plans.ts` 가 몸통을 읽을 때 `patch` 봉투를 펼쳐 합친다(옛 평면 모양도 그대로 받는다).
같은 핸들러의 **신규 플랜 생성**은 `patch` 가 없으니 동작이 **한 글자도 안 바뀐다**(합치기가 no-op).

## 2. 열어 봤더니 멀쩡했던 일곱 — 🔴 **왜 ⊘ 인지**를 적어 둔다(다음 사람이 또 열지 않게)

| 쌍 | 자가 못 읽는 이유 | 손으로 확인한 것 |
|---|---|---|
| `publish-now` (고객) | 화면이 `{ pieceId, [override]: true }` 로 **키를 변수로** 만든다 | 🔴 그 키는 **서버가 `overrideKey` 로 알려 준 것을 화면이 되돌려 주는** 모양이다(`ui.js:669`). 서버가 내보내는 `overrideKey` 는 전수로 **`warmupOverride` 하나뿐**(`publish-now.ts:105,123`)이고 서버가 그것을 읽는다(`:45`) ⇒ **어긋날 수 없는 계약**이다 |
| `rules-settings` (고객) | 서버가 `sanitizeSchedulePatch(b)` 로 **몸통을 통째로** 넘긴다 | 화면이 보내는 키 9개 = `SCHEDULE_DEFAULTS` 키 9개 **정확히 일치**(autoSchedule·horizonDays·topicLeadDays·produceLeadDays·produceHour·reviewPolicy·bestTimeMode·weeklyCoinCap·quietDays) |
| `rules-estimate` (고객) | 화면이 `{ rules: [...others, one()] }` 로 **펼친다** | 서버는 `b.rules` 배열만 읽는다(`rules.ts:72`) ⇒ 일치 |
| `personas-save` (고객) | 화면이 `{ ...(cur ? {id} : {}), name, profile }` 로 **조건부 펼치기** | 서버가 `b.id`·`b.name`·`b.profile` 을 읽는다. 🔴 **`sanitizeProfile` 허용 목록까지 세어 봤다** — `STR_KEYS` 6 + `ARR_KEYS` 3 = **9개가 화면이 보내는 9개와 정확히 같다**(리포가 반복 사고로 적어 둔 «허용 목록이 값을 먹은 자리»가 아니다) |
| `tax-invoice-request` (고객) | 읽기가 **다른 파일의 도우미**(`lib/billing/tax.ts validateTaxInput`)에서 일어난다 | `bizNo`·`bizName`·`email` 셋을 그 함수가 읽는다(`tax.ts:36~41`) ⇒ 화면과 일치 |
| `ops-tax-invoice` (운영) | 화면이 `{ invoiceId, status, ...(url ? {url} : {}) }` 로 **조건부 펼치기** | 서버 `readJson<{ invoiceId, kind, note, status, url }>` ⇒ 보내는 셋을 다 읽는다 |
| `ops-notices` (운영) | 화면이 `{ ...n, active: !n.active }` 로 **응답 행을 통째로 되돌려** 보낸다 | 서버가 `id·kind·title·body·startsAt·endsAt·plans·channels·active` **아홉을 다 읽는다**(`ops-notices.ts:59~69`) ⇒ 되돌려 보내기가 왕복한다 |

### 🔴 여기서 자를 고치지 않은 이유
일곱 중 둘(`tax-invoice-request`·`rules-settings`)은 **서버가 읽는 자리를 손으로 펼쳐 쓰면** 자가 볼 수 있게 된다.
**그렇게 하지 않았다** — 자를 초록으로 만들려고 **코드를 더 나쁘게 쓰는 것**이기 때문이다(도우미 한 곳에서 검사하는 지금이 옳다).
⇒ 대신 **위 표를 남긴다.** 자가 못 읽는 자리는 **사람이 한 번 읽고 그 결과를 적어 두는 것**이 값이다(AC-9 는 «적어 두라»지 «없애라»가 아니다).

## 3. 셈
- `verify-key-contract` : FAIL **0** · ⊘ **12 → 7** (프로모션·쿠폰 4 + 요금제 1 이 판정 가능해졌다)
- 열어 본 ⊘ **12쌍 중 고장 5** (프로모션 저장·끝내기 · 쿠폰 저장·끝내기 · 요금제 한도)
- 🔴 고객 쪽 ⊘ **4쌍은 전부 멀쩡**했다

## 4. 남긴 것
- **비공개 시험 플랜 `scenbtest`** (`public:false` · 한도는 시험값 그대로) — **안 지웠다.** 고객 목록에 안 나온다(실측).
- 앞판에서 남긴 것 그대로: 시험 테넌트 761·764 · 운영자 20 · 공지 3 · 프로모션 10·11 · 쿠폰 7·8 (전부 비활성)
- 보존 3·13·109·116·198·451 **무접촉** · `ai_usage` **불변** · 🔴 **라이브 요금제(starter·pro·agency) 무접촉** · 실결제 0 · 공개 토글 0 · DDL 0(`0084~0089` 그대로) · push 0

## 5. 메인이 추가로 준 셋 (같은 판에서 닫았다)

### ② 🔴 TZ 6곳 — `verify-server-time` 초록(위험 0 · 안전 9)
`timestamp`(시간대 없음) 칸을 `new Date(글자)` 로 읽으면 **프로세스 시간대**로 해석된다.
지금 라이브가 맞는 것은 **Netlify 가 UTC 라서일 뿐 — 우연이다.**

| 자리 | 무엇이 걸렸나 |
|---|---|
| `lib/auth-service.ts` 고객 로그인 잠금 | 🔴 **잠금은 15분인데 9시간이 어긋난다** — 잠긴 사람이 바로 풀리거나 멀쩡한 사람이 반나절 갇힌다 |
| `lib/auth-service.ts` **운영자** 로그인 잠금 | 같은 병 · 운영센터 문이라 더 나쁘다 |
| `lib/recipe-store.ts` `rolled_back_at` **+ 이웃 `stage_since`** | 화면에 9시간 밀린 시각 |
| `lib/text-style-store.ts` `created_at` | 〃 |
| `netlify/functions/ops-proxies.ts` `last_check_at`·`expires_at` | 프록시 «마지막 점검»·«만료» |

⇒ 전부 `utcDate()` 로 못 박았다(대조군 9곳이 쓰던 그 모양 그대로).
🔴 **자가 안 짚은 이웃 한 줄도 같이 고쳤다** — `recipe-store.ts` 의 `stage_since` 는 `rolled_back_at` 과 **글자까지 같은 모양**인데 자는 하나만 짚었다. 자의 몫은 C 것이라 안 건드렸고, **코드는 둘 다 고쳤다.**

### ③ 조용한 스텁 — 3곳 → **1곳**
`lib/text-style-read.ts` 둘(캡처 읽기·복붙 읽기)은 **정말 조용했다** — `model:"stub"` 이라는 **값으로만** 말했다.
같은 묶음 `lib/ai.ts` 의 `[ai-stub]` 관례로 찍게 했다. 못 재는 것도 같이 적는다(«이 글의 진짜 문단·강조·사진 모양이 표본으로 들어갔다»).

🔴 **남은 1곳 `lib/video/reference.ts:249` 는 고장이 아니다 — 자의 눈이 안 닿는 것이다.**
그 자리는 이미 `noteVideoStub(...)` 을 부르고, 그 함수가 `console.info` 를 찍는다. **실제로 돌려서 확인했다**:
```
[video-stub] video_reference — 고정 응답(실호출 0 · 원가 0) · 손잡이 VIDEO_PROVIDER_STUB=1. 🔴 못 재는 것: … 진짜로 보려면 …
```
자는 `console.` 을 **그 블록 안에서** 찾는데 여기는 **도우미 한 겹 건너** 있다(`lib/video/types.ts:270`).
⇒ **B2 의 파일이고 고장이 아니라 손대지 않았다.** 자가 `note*Stub(` 호출도 «말한다»로 세면 닫힌다(C 몫).

### ① `ops-plan-update`
메인이 준 것과 **같은 결함을 이 판에서 이미 열어 고쳤다**(§1). 메인이 짚은 `b.name`·`b.public`·`b.recommended`·`b.sort` 도
화면 `patch` 안에 들어 있어(`public`·`recommended` 확인) **봉투를 뜯는 한 번의 수리로 전부 덮인다.**

## 6. 🔴 남은 빨강 — 전부 «자가 돌 자리를 잃은 것»이고 C 몫이다
`verify-safe-list --run` → **✅ 실제로 잰 86개 전부 통과.**

| 자 | 축 | 우는 것 | 왜 |
|---|---|---|---|
| `verify-audit-gap` | ✅ **갈림 0**(46함수) | 자기 찌르기 ⓪a·⓪b | 둘 다 `… < baseSplit` 인데 **`baseSplit`=0** — «0보다 작다»가 불가능 |
| `verify-server-time` | ✅ **위험 0 · 안전 9** | 자기 찌르기 ⓪b·⓪d | 닻이 `new Date(user.locked_until)` 인데 그 글자가 사라졌다 |
| `verify-stub-silence` | 조용한 스텁 **1**(위 참고) | 자기 찌르기 ⓪a·⓪c | 닻이 이미 고쳐진 자리를 가리킨다 |
| `verify-key-contract` | ✅ **FAIL 0** | exit **2**(⊘ 7) | ⊘ 7 은 §2 표대로 **손으로 열어 전부 멀쩡** 확인 |

🔴 **셋 다 «자를 초록으로 만들려고 코드를 되돌리는 것»이 답이 아니다** — 자의 변이 방향을 뒤집으면 된다(메인이 C 에 넘긴 그 일).
