# 시나리오 B — «운영자»가 되어 운영센터를 전부 눌러 봤다 (2026-09-19)

> 트리거: [`2026-09-19-SCENARIO-B-trigger.md`](2026-09-19-SCENARIO-B-trigger.md) · 브랜치 `scenario/ops-2026-09-19` · **push 안 함**
> 물음: **«첫 손님이 들어왔을 때 우리가 그 사람을 다룰 수 있나»**

## 0. 어디서 돌렸나 · 시험 테넌트

| 항목 | 값 |
|---|---|
| 서버 | `http://127.0.0.1:8901` — **로컬** · DB 는 **라이브 Neon** |
| 운영자 | `admin@ops.local`(id 1 · super_admin · `must_change_password=true`) |
| 🔴 **내 시험 테넌트** | **id 761** `scenariob202-fblwbw` · 소유자 `scenario-b-20260919@test.local` · user id 431 — **지우지 않았다** |
| 🔴 **A 의 테넌트** | **id 762** `scenarioa202-mtokag` · `scenario-a-2026-09-19@example.com` — **읽기만** 했다 |
| 보존 테넌트 | 3·13·109·116·198·451 — **한 번도 부르지 않았다**(임퍼·수정·열람 전부) |

### 🔴 `npx netlify dev` 로 못 돌렸다 — 무엇을 대신 썼나
`npx netlify dev`(v26.0.0)를 **두 번**, 10분 넘게 띄웠으나 **출력 한 줄 없이 포트를 잡지 못했다**(8899·8901 · `--offline` 포함).
같은 시각 A 세션도 `netlify dev --port 8899 --offline` 로 같은 증상이었다(두 프로세스 다 LISTEN 없음).

그래서 **리포가 이미 쓰는 방식**으로 갈아탔다 — `scripts/serve-b2-local.mts` 가 그 방식을 이렇게 적어 두었다:

> «왜 netlify dev 가 아니라 이것인가: netlify dev 는 함수가 404 를 내면 같은 경로에 `.html` 을 붙여 다시 부르고
> **마지막 시도의 응답**이 클라이언트에 간다(PITFALLS AC-7) — 라이브에 없는 가짜 증상이 섞인다.»

⇒ `scripts/_smoke/serve-ops-local.mts`(커밋 안 됨 · `.gitignore`)를 새로 만들었다. 함수 폴더를 훑어 **`config.path` 를 그대로** 라우팅하고
default export 를 진짜 `Request`/`Response` 로 왕복시키며, `public/` 을 같은 오리진에서 내보내 **httpOnly 쿠키가 화면과 똑같이 붙는다.**
올린 결과: **함수 79/81 · 경로 214개** · 못 올린 2개는 `cron-tick-5m`·`cron-tick-hourly`(스케줄 함수 — `config.path` 가 없는 게 맞다) · **경로 중복 0건.**

⊘ **못 쟀다**: 브라우저를 띄우지 못했다(이 워크트리에 `playwright` 미설치 · 크로뮴 바이너리만 있다).
⇒ **화면 판정은 «서버 응답 ↔ 그 화면의 JS 가 실제로 읽는 키» 대조**로 했다. 아래 ❌ 는 전부 **그 화면의 코드 줄**을 짚었고, 가능한 것은 **실제로 눌러서**(HTTP 왕복 + DB row) 증명했다.

### ⚠️ 조사 도구를 한 번 고쳤다 (거짓 결함을 낼 뻔했다)
내 조회 헬퍼가 `timestamp without time zone`(UTC 를 시간대 없이 담는 칸)을 **로컬(KST)로 해석**해 9시간 밀려 읽었다
— `2026-09-18 18:46Z` 를 `09:46Z` 로. 하마터면 «API 가 시각을 9시간 민다»고 적을 뻔했다. **제품은 맞다**(`lib/db-util.ts utcDate` 가 `Z` 를 붙인다).
헬퍼에 OID 1114/1184 파서 우회를 넣어 고쳤다.

---

## 1. 화면별 판정

### 1 · 운영 로그인 `ops/login.html` — ✅
- 운영자 로그인 `POST /api/ops-login {email:"admin"}` → 200 · `ac_ops` httpOnly 쿠키(`Max-Age=7200`).
  아이디만 써도 `<id>@ops.local` 로 매핑된다 ✅
- 🔴 **일반 고객 계정으로는 못 들어간다** — 실측:
  - 고객 이메일+비번으로 `ops-login` → **401** `아이디 또는 비밀번호가 맞지 않아요.`
  - 고객 세션 쿠키(`ac_user`)만 들고 운영 API → `ops-dashboard` **401** · `ops-tenants` **401** · `ops-audit` **401** · `ops-operators` **401**
- `mustChangePassword` 면 `/ops/password.html?first=1` 로 보낸다(login.html:35) ✅

### 2 · 대시보드 `ops/index.html` — ❌ **«모름»을 «0»이라고 말한다**
숫자는 실제 DB 와 맞다(내가 만든 761 이 그대로 보였다): `signups.today 1` · `tenants.total 1 / trial 1 / newToday 1` · `internal.excluded 109`.

🔴 **그런데 트리거가 물은 바로 그 자리가 틀렸다.**

| | |
|---|---|
| 서버 | `ops-dashboard.ts:77` — `const trialToPaidPct = cohort > 0 ? Math.round(...) : null;` ⇒ **표본이 없으면 `null`**(= 못 쟀다) |
| 실제 응답 | `"trialToPaidPct": null` |
| 화면 | `index.html:83` — `` st("체험→유료", `${r.trialToPaidPct ?? 0}%`) `` ⇒ 화면에 **«0%»** |

**아무도 체험을 끝내지 않아서 못 잰 값**이 **«체험→유료 0%»**(= 전환이 하나도 안 된다)로 읽힌다. 겁주는 거짓말이고, 방향이 제일 나쁜 쪽이다.
🔴 **같은 파일이 다른 칸에서는 제대로 한다** — 그래서 이건 규칙이 없어서가 아니라 **한 줄이 규칙을 안 따른 것**이다:
- `index.html:71` `ai.calls == null ? "못 쟀어요" : ...` ✅
- `index.html:56` `r.marginKrw == null ? "원가가 환산돼야 계산해요" : ...` ✅
- CLAUDE §9 «🔴 **«아직 모른다»로 막지 않는다** — 표본이 없어 못 재는 축은 통과시키고 «못 쟀어요»라고 적는다(AC-9·AC-60)»

**고칠 자리**: `public/ops/index.html:83` → `r.trialToPaidPct == null ? "못 쟀어요" : `${r.trialToPaidPct}%``

### 3 · 회원 목록 `ops/tenants.html` — ✅
- 🔴 **새로 가입한 사람이 뜬다.** 내 761 이 가입 직후 목록 1행으로 떴고, **A 가 18:48Z 에 만든 762 도 다음 호출에서 그대로 떴다**
  (`total 2` · `internal.hidden 109`). 목록이 살아 있다는 증거다.
- 검색 ✅ `?q=scenario-b` → 1건 · `?q=zzzznope` → `total 0`(조용한 0 아님 · `hidden 0` 도 같이 온다)
- 내부 집 가리기 ✅ 기본은 109집 숨김 · `?internal=1` 이면 같이 보인다

### 4 · 회원 상세 `ops/tenant.html` — ❌ **한 화면에 모이긴 하는데, 서버가 보낸 것의 상당수를 화면이 못 읽는다**
서버는 한 번에 다 준다: `tenant users accounts runners coins coinDetail slots audit setup sources posts invoices tickets billingKey note`(+ 장부 있으면 `subscription`).
계정·글·코인·결제가 **한 화면에 모인다**는 뜻에서는 ✅.

🔴 **그런데 화면이 읽는 키가 서버가 보내는 키와 다르다** — 셋 다 «초록인데 고장»:

| # | 화면이 읽는 것 | 서버가 보내는 것 | 화면에 나타나는 증상 |
|---|---|---|---|
| a | `r.coinsSplit`(tenant.html:56) | **`coinDetail`** `{balance,included,purchased}` | 코인 **분해(포함/충전)가 영원히 안 뜬다** — 잔액만 나온다 |
| b | `r.slots.planned`(tenant.html:62) | **`slots.upcoming`** | 「편성 예정」이 **늘 0** (`UI.num(undefined)`) |
| c | `r.notes` 배열 `{text,by,at}`(tenant.html:63) | **`note`** 문자열 하나 | 메모가 **영원히 «메모 없음»** — ⑩ 참고 |

서버가 보내는데 화면이 **아예 안 그리는 것**: `invoices`(청구서 10건) · `tickets`(열린 문의) · `posts{total,lastAt}` · `sources`(수익 커넥터) · `billingKey`.
⇒ «결제가 한 화면에 모이나»의 답: **데이터는 왔는데 그려지지 않는다.** 구독 장부(`subscription`)는 키가 맞아 ✅(체험이라 «구독 없음»이 뜬 건 사실이다).

### 5 · 🔴 대신 들어가 보기(임퍼) — ✅ **네 가지 다 된다**
761 로 실제로 들어갔다 나왔다.

| 물음 | 결과 |
|---|---|
| 들어가지나 | ✅ `POST /api/ops-impersonate {id:761}` → `{ok:true, redirect:"/app/home.html", until:"…19:50:02Z"}` · `ac_user` 발급(60분 상한) |
| 고객 화면이 열리나 | ✅ `GET /api/home-summary` **200** · `auth-me` 가 `impersonation:{by:1,byName:"관리자",until:…}` 를 함께 준다 |
| 🔴 **들어가 있는 동안 표시가 뜨나** | ✅ `ui.js:410` → `UI.impBanner` → **«운영자가 보고 있어요 · 관리자 · 04:50까지»** + 「끝내기」 버튼.<br>🔴 **고객 화면 20개 전부** `.page` 와 `UI.boot` 를 갖고 있어(20/20) **배너가 빠지는 화면이 없다** — 실측으로 셌다 |
| 돈 경로가 막히나 | ✅ `coin-purchase-start`·`billing-key-start` → «원격접속 중에는 결제·충전을 할 수 없어요» · `account-close` → «탈퇴·되돌리기를 할 수 없어요» |
| 나와지나 | ✅ `POST /api/ops-impersonate-end` → `{ok:true,tenantId:761,minutes:1}` · 그 뒤 `auth-me` **401**, `ops-tenants` **200**(운영 세션은 살아 있다) |
| 🔴 **감사에 시작·종료가 남나** | ✅ `ops_impersonate_start`(id 5687 · **high**) · `ops_impersonate_end`(id 5692 · medium) |
| 고객이 아나 | ✅ 알림 2건 — `ops_assist` «운영자가 설정을 도와드리고 있어요» · `ops_assist_end` «운영자가 설정을 도와드렸어요» |

⚠️ 한 가지 적어 둔다: 「끝내기」는 `/api/ops-impersonate-end` 를 부르는데 이 경로도 **`requireAdmin`** 을 지난다(`ops-tenants.ts:56`).
즉 **운영 쿠키(`ac_ops`)가 살아 있어야 나올 수 있다.** 지금은 ops 2시간 > 임퍼 60분이라 실무상 안 걸리지만, 운영자가 다른 탭에서 로그아웃하면
**고객 몸으로 갇힌다**(나가는 문이 운영 권한을 요구한다). 못 나오면 쿠키를 지우는 수밖에 없다.

---

### 6 · 요금제 바꿔주기 — ✅ (다만 ⑨ 를 같이 읽어라)
`POST /api/ops-plan-change {id:761, planKey:"pro", cycle:"month"}` → `{ok:true, charged:false}`
- 정본 ✅ `tenants.plan_key trial→pro` · `status trial→active`
- 🔴 **고객 화면에서도 바뀐다** — 고객 세션 `auth-me` 가 즉시 `planKey pro / status active` · **포함 코인 150개가 자동 지급**(`coin_ledger` `included:761:2026-09`)
- 고객 알림 ✅ «요금제가 바뀌었어요 — 운영자가 Pro 로 바꿔 드렸어요»
- 감사 ✅ `ops_plan_change`(high · `{from:trial, to:pro, charge:false}`)

### 7 · 체험 늘려주기 — ✅ **거절 문구까지 사람말이다**
- 이용 중(active)인 집에 연장 → `{"ok":false,"error":"체험 중이거나 체험이 끝난 고객만 연장할 수 있어요.","step":"status"}` ✅ 겁주지 않고 왜 안 되는지 말한다
- **읽기 전용인 집에 7일 연장** → `{ok:true, trialEndsAt:"2026-10-09T18:46:35Z"}`
  · 정본 ✅ `status readonly→trial` · `readonly_at` 지워짐 · `trial_ends_at` +7일
  · 고객 알림 ✅ «체험이 7일 늘어났어요» · 감사 ✅ `ops_trial_extend`(medium)
  ⇒ **막힌 고객을 전화 한 통으로 풀어 주는 길이 실제로 있다.**

### 8 · 🔴 코인 넣어주기 — 원장 ✅ / **멱등 ❌**
- **원장에 남는다** ✅ `coin_ledger` 에 `kind=grant · bucket=included · delta=30 · reason · ref · actor_id=1` 로 박힌다
- 감사 ✅ `ops_coins_grant`(**high** · `{requested:30, applied:30, reason}`)
- 🔴 **두 번 눌러도 한 번만 들어가나 → ❌.** 같은 내용을 **동시에 두 번** 던졌다(더블클릭 흉내):

  ```
  {"ok":true,"applied":30,"balance":180}{"ok":true,"applied":30,"balance":210}
  ```
  원장에 **두 줄**이 들어갔다 — `ref: ops:1:1789757569049` · `ops:1:1789757569071` (**22ms 차이**). 잔액 150 → **210**(+60).

  **왜**: `ops-tenants.ts:181` — `` const ref = `ops:${o.ops.oid}:${Date.now()}`; `` ⇒ 멱등 키가 **운영자의 뜻이 아니라 시계**에서 나온다.
  같은 ms 안에 들어와야만 한 번이 되는데, 사람 손가락은 그것보다 느리다.
  🔴 **같은 파일이 다른 칸에서는 제대로 한다** — 월 포함분은 `ref: included:761:2026-09`(뜻으로 만든 키)라 몇 번을 불러도 한 줄이다.
  ⇒ 고칠 자리: 지급 ref 를 **뜻**(`ops:<oid>:<tenant>:<coins>:<reason해시>` 같은)으로 만들거나, 화면이 보낸 `idem` 을 받는다.
  지금은 **네트워크가 느려 운영자가 한 번 더 누르면 고객에게 코인이 두 배로 들어간다**(돈이다).

### 9 · 🔴 상태 바꾸기 — 「나올 문」 ✅ / **«상태만» 바꿀 수가 없다 ❌**

#### ⑨-a 「나올 문」은 진짜로 열린다 ✅ — 어제 자가 못 재던 것을 화면으로 확인했다
`verify-gate-pair.mjs` 가 스스로 «이 자가 보증하지 않는 것: 그 화면이 고객 눈에 실제로 보이나 … **초록을 «나올 문이 있다»로 읽지 마라**» 라고 적어 둔 그 자리다. 761 을 읽기전용으로 만들어 놓고 **고객 세션으로** 밀어 봤다.

| 확인 | 결과 |
|---|---|
| 막히는 순간 무엇을 보나 | `account-slot-buy` → **403** `{step:"writable", reason:"readonly", error:"체험이 끝났어요. 요금제를 고르면 바로 이어서 할 수 있어요."}` |
| 화면이 그걸 받나 | ✅ `ui.js:37` `UI.gate` → 바텀시트 «이어서 하려면» + **Primary 1개** 「요금제 고르기」→ `/app/plan.html` |
| 🔴 **그 문이 막힌 손 뒤에 있지 않나** | ✅ 읽기전용인 채로 전부 열렸다 — `GET /api/plans` **200** · `GET /api/subscription` **200** · `GET /api/subscription-quote?planKey=pro&cycle=month` **200**(`총 53,900원` 까지 계산해 준다) · `POST /api/subscription-change` 는 `step:"paid_terms"`(약관 동의를 묻는 것 · 막는 게 아니다) |
| 열람은 되나 | ✅ `home-summary` **200** · 소재 넣기도 된다(`topics-add` ✅ — AC-35 «소재 넣기는 생성이 아니다» 대로) |
| 탈퇴 신청한 집 | ✅ 서버가 `reason:"closed"` + `daysLeft` 를 실어 주고 화면은 «되돌리러 가기»로 가른다(`ui.js:41`) — «체험이 끝났어요»를 그 집에 하지 않는다 |

⇒ **읽기전용 고객은 스스로 나올 수 있다.**

⚠️ 한 줄 적어 둔다: 문구가 `readonly` 면 무조건 «**체험이 끝났어요**»다. 761 은 **plan_key=pro(유료)** 인데 운영자가 읽기전용으로 바꾼 집이었고, 그 집에도 «체험이 끝났어요»가 갔다. 거짓말이다(그 집 체험은 안 끝났다).

#### ⑨-b 🔴 **운영자가 «상태만» 바꿀 수 없다 — 그 대가를 고객의 돈이 치른다** ❌
상태를 바꾸는 UI 는 `ops/tenant.html:70` 「플랜 · 상태」 시트 하나뿐이고, 「바꾸기」 한 번이 **두 API 를 연달아** 부른다:

```js
let r = await UI.api("/api/ops-plan-change",  { body: { id, planKey } });   // ← 플랜 칩은 «지금 플랜»이 기본값
if (r.ok) r = await UI.api("/api/ops-tenant-update", { body: { id, status } });
```

그런데 `ops-plan-change` 에는 **«같은 플랜이면 아무것도 안 한다»가 없다**(`ops-tenants.ts:200~230`). 같은 플랜으로 불러도 매번:
`status='active'` · `readonly_at=NULL` · `suspended_at=NULL` · `period_start`·`period_end`·`next_billing_at` **오늘로 재설정** ·
`fail_count=0` · **`pending_plan_key=NULL`** · **`cancel_at_period_end=false`** · 그리고 «요금제가 바뀌었어요» 알림 발송.

🔴 **실제로 눌러서 증명했다.** 고객이 먼저 정상 경로로 해지 예약을 걸었다:

```
POST /api/subscription-cancel {"atPeriodEnd":true}
  → {"ok":true,"periodEnd":"2026-10-18T18:52:20Z","cancelAtPeriodEnd":true}     ✅ cancel_at_period_end = true
```

그 다음 **운영자는 상태 하나만** 바꿨다(읽기전용 → 이용 중 · 플랜 칩은 Pro 그대로 = 화면이 보내는 그대로):

| 구독 장부 | 누르기 전 | 누른 뒤 |
|---|---|---|
| `cancel_at_period_end` | **true** | 🔴 **false** |
| `period_start` | 18:52:20 | 18:56:16 |
| `period_end` · `next_billing_at` | 2026-10-18 18:52 | 2026-10-18 18:56 |

⇒ **«이번 달까지만 쓰고 그만할게요» 라고 신청해 둔 고객의 해지가 조용히 취소됐다.** 다음 달에 또 결제된다.
그리고 요금제를 바꾼 적 없는 고객에게 «요금제가 바뀌었어요 — 운영자가 Pro 로 바꿔 드렸어요» 알림이 갔다(982번).
운영자 화면에는 «바꿨어요» 토스트 한 줄만 떴다. **운영자는 자기가 무엇을 지웠는지 모른다.**

고칠 자리 둘 중 하나(또는 둘 다):
① `ops-plan-change` 에 «플랜이 같고 charge 도 아니면 구독 장부를 건드리지 않는다» 를 넣는다.
② `ops/tenant.html:70` 이 **플랜 칩이 바뀌었을 때만** `ops-plan-change` 를 부른다.

### 10 · 메모 — ❌ **남지 않는다. 그리고 있던 메모를 지운다**
화면(`tenant.html:71`)이 보내는 것과 서버가 읽는 것이 다르다.

```
화면:  POST /api/ops-tenant-note  { id, text: "…" }
서버:  const note = String(b.note ?? "").slice(0, 2000)      ← b.text 는 안 본다
       UPDATE tenants SET ops_note = ${note}                  ← 그래서 빈 문자열로 덮는다
```

🔴 **실측 2단계:**

```
① 서버 계약대로 { id, note:"첫 통화: 네이버 계정 연결 도와드림" }
     → {"ok":true,"note":"첫 통화: …"}        ops_note 저장됨 ✅
② 화면이 보내는 그대로 { id, text:"두번째 통화: 쿠팡 파트너스 문의" }
     → {"ok":true,"note":""}                  ops_note = ''  (length 0) 🔴 있던 메모가 날아갔다
```

- 🔴 서버가 **`ok:true`** 를 돌려주므로 화면은 시트를 닫고 «저장됐다»는 모양이 된다. **오류 한 글자도 안 뜬다.**
- 🔴 읽는 쪽도 끊겨 있다 — 화면은 `r.notes`(배열 `{text,by,at}`)를 그리는데 서버는 `note`(문자열 하나)를 보낸다 ⇒ **영원히 «메모 없음».**
- ⇒ «**다른 운영자에게 보이나**»의 답: **아무에게도 안 보인다.** 쓴 사람에게도 안 보인다.
- 감사에는 남는다 — `ops_tenant_note` 2건. 다만 `detail:{length:0}` 이라 **«메모를 남겼다»는 기록만 있고 내용은 어디에도 없다.**


### 11 · 문의·티켓 `ops/cs.html` `ops/ticket.html` — ✅ **한 바퀴가 진짜로 돈다**
A 도 나도 문의를 안 넣은 상태였다(761·762 둘 다 0건). 그래서 **내가 고객이 되어 넣고, 운영자가 되어 답했다.**

| 단계 | 결과 |
|---|---|
| 고객이 넣는다 | ✅ `POST /api/support-ticket {subject, text}` → `{ok:true, ticketId:54}` (화면 `app/support.html:74` 가 보내는 키와 서버가 읽는 키가 **맞다** — `text`·`body` 둘 다 받는다) |
| 🔴 **운영자에게 오나** | ✅ `GET /api/ops-tickets?status=open` 에 **즉시** 뜬다 — `{id:54, tenantId:761, source:"app", slaDueAt:"…19T18:58Z"}`(SLA 24시간이 붙어 나온다) |
| 상세에 맥락이 오나 | ✅ `GET /api/ops-ticket?id=54` 가 대화 + **`context:{planKey:"pro", status:"trial", coins:210, runner:{...}}`** 를 같이 준다 — 고객 화면을 따로 안 열어도 된다 |
| 🔴 **답이 고객에게 가나** | ✅ `POST /api/ops-ticket-reply` → 고객 세션 `GET /api/support-ticket?id=54` 에 **operator 말풍선이 그대로** 보인다 · 상태 `open→progress` 자동 · 알림 «문의에 답변이 도착했어요» |
| 닫기 | ✅ `ops-ticket-resolve` → `status:"resolved"` · `assignee:{id:1,name:"관리자"}` |
| 감사 | ✅ `support_ticket_create`(user) · `ops_ticket_reply` · `ops_ticket_update` |

⚠️ **화면이 안 부르는 CS API 3개** — 코드엔 있고 화면엔 없다:
`ops-ticket-claim`(주인 없는 문의에 **고객을 붙이는** 손) · `ops-ticket-update` · `ops-ticket-create`(운영자가 대신 문의 열기).
지금 목록에 **`tenantId:null` 인 주인 없는 문의가 실제로 있다**(50번 «카카오 채널 문의»). 🔴 **화면에서 그 문의에 고객을 붙일 방법이 없다.**

### 12 · 공지 `ops/notices.html` — ✅ **비공개까지 확인**
- `POST /api/ops-notices {kind:"notice", title:"[시나리오B 시험] 공개 안 함", active:false}` → `{ok:true, notice:{id:3, active:false}}`
- 🔴 **고객에게 안 보인다(확인함)** — 고객 세션 `GET /api/notices` → `{"ok":true,"notices":[]}` · 비로그인은 401
- **공지 3번은 `active:false` 로 남겨 뒀다**(공개 토글 안 함 — 절대선 준수)

### 13 · 결제·정산 `ops/billing.html` — ✅ **보기만 했다**
`ops-invoices`(환불된 5,500원 청구서 1건) · `ops-receivables`(0건) · `ops-billing-keys`(카드 1장 «토스뱅크 0542») · `ops-payment-settings` 전부 200.
⊘ **못 쟀다**: `ops-payment-settings` 가 `kiccConfigured:false · mode:"test"` — 로컬엔 KICC 키가 없다. **실결제·환불은 시도하지 않았다**(절대선).
⚠️ 이 목록에는 보존 테넌트(198)의 행이 섞여 있다. **목록으로 읽기만 했고 그 행을 열거나 임퍼를 붙이지 않았다.**

### 14 · 러너 `ops/runners.html` — ❌ **버전이 안 맞고, 운영자는 그걸 화면에서 알 수 없다**
- 기기 목록 ✅ 16대가 뜬다(요청·팜 포함)
- 🔴 **R2 가 실제로 주는 버전은 `1.4.0` 이다** — 고객 경로로 확인했다:
  `GET /api/runner-download` → `{"version":"1.4.0","bytes":200130,"sha256":"0864a8e8…","filename":"autocreate-runner-v1.4.0.zip"}`
  (presigned URL 이 `…/autocreate/runner/v1.4.0.zip` 로 나간다 · `runner/package.json` 도 `1.4.0`)
- 🔴 **그런데 붙어 있는 16대 중 `1.4.0` 은 0대다.** 버전 분포: `1.0.0` **7대** · `c` 4대 · `c-verify` 3대 · **없음 2대**
- 🔴 **더 나쁜 것은, 화면에 「최신은 무엇인가」가 아예 없다.** `ops/runners.html:45` 는 「버전」 칸에 기기가 스스로 말한 문자열을 그대로 찍을 뿐이고(`UI.esc(x.version || "—")`), `ops-runners` 응답에도 `release`/`latest` 키가 없다(`ok requests runners farm`).
  ⇒ **손님이 «프로그램이 안 돌아요» 라고 전화했을 때, 운영자는 그 사람이 구버전인지 화면에서 판정할 수 없다.** 낡은 기기를 골라낼 수도 없다.

### 15 · 채널 `ops/channels.html` — ✅
채널 17개 · 🔴 **`daangn | planned` 로 보인다**(물음 그대로).
`naver_blog`·`tistory`·`blogger`·`wordpress` 만 `active` · 나머지 13개 `planned`. 화면이 읽는 키(`r.channels`·`c.key`·`c.status`)가 서버와 **맞다** ✅

### 16 · AI 비용 `ops/ai.html` — ❌ **이 화면엔 «쓴 돈»이 없다**
- 🔴 물음(«C 가 오늘 쓴 실호출 비용이 여기 잡히나»)의 답: **`ops/ai.html` 에는 비용 숫자가 아예 없다.**
  이 화면이 부르는 것은 `ops-ai-models`·`ops-ai-apply`·`ops-ai-rollback`·`ops-ai-mode`·`ops-ai-cost-cap` 다섯 개뿐이고,
  응답 키는 `roles`(모델 사슬) · `settings`(업데이트 모드·후보) · `keys`(키 쉼 상태). **「원가」 칸은 «원가 상한» 설정값**이지 쓴 돈이 아니다.
- 쓴 돈이 나오는 곳은 **대시보드 하나**(`ops/index.html` «AI 원가 — 무엇에 썼나»)인데 거기도 **이달 단위**다. **«오늘» 창이 어디에도 없다.**
- 오늘 실호출은 DB 에 **있다**(KST 오늘 기준): **69회 · $0.2240** (`ai_usage` · 18:28~18:54Z)
- 🔴 **그런데 대시보드의 «우리가 낸 돈»은 `usd 0 · 호출 0 · byModel 0 · byPurpose 0` 이다.** 전부 «가른 몫»으로 빠졌다:
  `{internalUsd: 31.03, syntheticUsd: 18.02, orphanUsd: 32.45, byoUsd: 0.005, totalUsd: 44.96, calls: 569}`
  오늘치 69회를 테넌트로 갈라 보면 **757·758·759·760 — 넷 다 `tenants` 에 없는 id**(지워진 하니스 집) ⇒ **«주인 없는 집»(orphan)** 으로 빠진다.
  ⇒ 가르는 것 자체는 옳다(`lib/ops/internal.ts` 의 뜻대로). 다만 **운영자가 «오늘 우리 AI 에 얼마 썼나»를 볼 화면이 없다.**
- 모델 관리 쪽은 살아 있다 ✅ `roles`(high/low 사슬) · `canaryPct` · `candidate` · `keys.count 1`

### 17 · 요금제·프로모션 `ops/plans.html` `ops/promo.html` — ✅ **비공개까지**
- 요금제 목록 ✅ `trial`(공개 false) · `starter`·`pro`·`agency`(공개 true) + `priceEvents` — **공개 토글은 건드리지 않았다**
- **프로모션 만들기** `{kind:"trial_days", value:7, active:false}` → `{ok:true, promotion:{id:10, status:"ended"}}`
- **쿠폰 만들기** `{code:"SCENB-TEST-OFF", kind:"pct", value:10, active:false}` → `{ok:true, coupon:{id:7, status:"ended"}}`
- 🔴 **고객에게 새지 않는다(확인함)** — 고객이 그 쿠폰을 넣어 보면 `coupon:{ok:false, reason:"inactive", error:"기간이 지난 쿠폰이에요."}` · 고객이 보는 `GET /api/plans` 는 `starter pro agency` 와 `trialDays 14` 그대로(체험 7일 프로모션이 안 섞인다)
- **프로모션 10번·쿠폰 7번은 비활성으로 남겨 뒀다.**
- ⚠️ 말 한 가지: 한 번도 시작한 적 없는 비활성 프로모션의 `status` 가 **`"ended"`(종료)** 로 나온다. «아직 안 켬»과 «끝남»이 같은 말이 된다 — 화면에서 둘을 못 가른다.

### 18 · 🔴 감사 기록 `ops/audit.html` — ✅ **성공한 운영 행위는 하나도 안 빠졌다** / ❌ **실패한 로그인은 안 남는다**
화면은 `ops-audit-search` 를 쓴다(구 `ops-audit` 은 R1 호환으로 남아 있고 어느 화면도 안 부른다 — 문서대로다). 총 **3,424행** · 30개씩 페이지 ✅

🔴 **오늘 내가 한 운영 행위를 전부 대조했다 — 18건, 빠짐 0건:**

| 감사 action | 건수 | 내가 한 일 |
|---|---|---|
| `ops_login` | 2 | 운영 로그인 2회 |
| `ops_tenant_note` | 2 | 메모 2회(내용은 안 남는다 — ⑩) |
| `ops_impersonate_start` / `_end` | 1 / 1 | 대신 들어가기 |
| `ops_plan_change` | 2 | 요금제 바꾸기 2회 |
| `ops_tenant_update` | 3 | 상태 바꾸기 3회 |
| `ops_coins_grant` | 2 | 코인 지급 2회(더블클릭 실험) |
| `ops_trial_extend` | 1 | 체험 연장 |
| `ops_ticket_reply` / `ops_ticket_update` | 1 / 1 | 문의 답변 · 해결 |
| `ops_notice_create` | 1 | 공지 |
| `ops_promotion_create` / `ops_coupon_create` | 1 / 1 | 프로모션 · 쿠폰 |
| `ops_operator_create` / `_role` / `_disable` | 1 / 1 / 1 | 운영자 만들기 · 권한 · 끄기 |

돈·권한이 걸린 것은 전부 `risk_level: high` 로 박힌다 ✅ · 거르기도 된다 ✅ `tenant=761 → 22건` · `q=impersonate → 11건` · `actorType=operator → 398 / customer → 673 / system → 2354` · `risk=high → 135`

🔴 **그런데 «감사에 안 남는 운영 행위»가 하나 있다 — 실패한 운영 로그인.**
`loginOperator`(`lib/auth-service.ts:153~171`)는 **성공**만 적는다(`ops_login`). 없는 계정은 아예 그냥 돌아가고, 비번이 틀리면 `failed_logins` 숫자만 올린다.
감사에 남는 것은 **5번 틀려 잠긴 순간**(`ops_login_locked`)뿐이다.
- 실측: 고객 계정으로 1회 + 없는 계정으로 1회 + `admin` 에 틀린 비번 1회 = **세 번 시도 → 감사 0행.**
- DB 전체에 `ops_login_failed` 류의 action 은 **한 건도 없다.**
⇒ **없는 계정을 대고 두드리면 영원히 안 잠기고(잠금은 계정 단위) 영원히 안 남는다.** 운영센터 문을 누가 두드렸는지 우리는 모른다.

### 19 · 운영자 관리 `ops/operators.html` `ops/password.html` — ❌ **뽑을 수는 있는데 들여보낼 수가 없다**
- 목록 ✅ 운영자 3명(`admin@ops.local` super_admin · `admin@siren-org.kr` SSO · `byo-ops-…`)
- **만들기** ✅ `POST /api/ops-operators {email, name, role:"operator"}` → `{ok:true, operator:{id:20, …}}`
- **권한 바꾸기** ✅ operator → admin · **끄기** ✅ active:false · 둘 다 감사 `high` + `target:"operator:20"`
- 안전장치 ✅ 본인 super_admin 강등 거부(«본인의 super_admin 권한은 스스로 내릴 수 없어요») · 본인 비활성화 거부
- 비번 바꾸기 ✅ 기본 비번 거부(«기본 비밀번호는 쓸 수 없어요») · `ops_password_change` 감사(medium)
- 🔴 **그런데 새로 만든 운영자는 로그인할 수 없다.**
  만들면 `password_hash = NULL` 이고(계약도 «비밀번호는 여기서 안 만든다 · SSO/기존 흐름»), `loginOperator` 는 `password_hash` 가 없으면 `invalid` 를 돌려준다.
  실측: 방금 만든 20번으로 로그인 → `{"ok":false,"error":"아이디 또는 비밀번호가 맞지 않아요."}`
  그리고 **남의 비번을 정해 주는 길이 어디에도 없다** — `setOperatorPassword` 를 부르는 곳은 `ops-change-password` 한 곳뿐이고 그건 **본인**(`o.ops.email`)만 바꾼다. 초대 메일도, 운영자용 비번 재설정도 없다.
  ⇒ **상담원을 뽑아도 화면으로는 못 들여보낸다.** SSO 를 붙이거나 `scripts/seed-admin.mjs` 를 서버에서 돌리는 수밖에 없다.
- 남긴 것: **운영자 20번은 `active:false` 로 꺼 두었다**(지우지 않았다).

### 20 · 회사 정보 `ops/company.html` — ✅ 화면은 정상 / ⚠️ **내용이 비어 있다**
- `GET /api/ops-company` → 전 칸 빈 문자열 · `configured:false` · `updatedAt:null`
- 공개 경로 `GET /api/company` → `company:null` (로그인 없이도 열린다 ✅)
- 🔴 **비었을 때 화면이 겁주지 않는다** ✅ — `terms.html:50` 이 «**준비 중이에요 · 사업자 정보가 등록되면 여기에 바로 나와요.**» 한 줄로 받고 약관 본문은 그대로 보인다(빨간 오류 아님 · §3 말투 규칙대로)
- ⚠️ 다만 **약관·개인정보 화면 하단의 사업자 정보가 지금은 안 나온다.** 코드가 아니라 **채워 넣을 값**이 없어서다(상호·대표자·사업자등록번호·통신판매업 신고번호·주소). 장사를 열기 전에 사장님이 채워야 하는 칸이다.

---

## 2. 🔴 «운영자가 할 수 없어서 곤란한 것» — 손님이 전화했을 때 우리가 못 해 주는 일
> 트리거가 **이게 본체**라고 했다. 큰 것부터 적는다.

### ① 🔴 **손님을 찾을 수가 없다** — «0곳» 이라고 화면이 거짓말한다 (제일 큰 것)
**끝까지 눌러서 증명했다.** 진짜로 가입하는 손님을 하나 더 만들었다 — **「스모크하우스 바베큐」(`smokehouse@naver.com` · id 764)**. 고깃집이다.

```
가입 직후      ops-tenants?q=smokehouse → total 1   ✅ 보인다
하루 1번 도는 크론(syncInternalFlags)이 한 번 돌고 나면 → 내부로 켬 1건
그 뒤           ops-tenants?q=smokehouse → total 0 · internal {excluded:true, hidden:1}
화면(tenants.html:33)이 그리는 것 →  "0곳"  + 빈 표
```

**왜 켜졌나**: `lib/ops/internal.ts` 의 `INTERNAL_KEY_RE = /^(verify|smoke|test|harness|demo|skip|r[0-9]|…)/i` 에 테넌트 키가 걸린다.
테넌트 키는 **가입 메일 앞부분**에서 나온다(`smokehouse@…` → `smokehouse-x097e0`). 규칙에 걸리는 진짜 상호를 대 보면:

| 키 | 판정 |
|---|---|
| `smokehouse-…`(고깃집) · `demolition-…`(철거) · `skipper-…` · `testkim-…`(김테스트) · `r2coffee-…` · `r3design-…` | 🔴 **내부로 숨김** |
| `verynice-…` · `normalshop-…` | 보임 |

**세 겹으로 나쁘다:**
1. 🔴 **서버는 «1집 숨겼다»고 말해 주는데 화면이 그 말을 버린다.** `ops-tenants.ts:5` 주석이 직접 이렇게 적어 뒀다 — «응답 `internal:{excluded,hidden}` = 이번 조건에서 숨긴 집 수 — **«몇 집이 안 보이는지»를 화면이 말할 수 있어야 한다**». 그런데 `public/ops/tenants.html`(49줄)에는 **`internal` 이라는 글자가 한 번도 안 나온다.**
2. 🔴 **화면에 «내부 포함» 토글이 없다.** `internal=1` 을 보내는 화면이 하나도 없다 ⇒ 숨은 줄 알아도 **화면으로는 못 꺼낸다.**
3. 🔴 운영자는 «가입 기록이 없는데요» 라고 **손님에게 말하게 된다.** 손님은 가입해 있다.

**고칠 자리(작다)**: `tenants.html:33` 이 `r.internal.hidden > 0` 이면 «내부로 표시된 N곳은 빠져 있어요 · [함께 보기]» 한 줄을 붙이고, 그 버튼이 `internal=1` 을 실어 다시 부르면 된다.

### ② 🔴 **«상태만» 바꿔 줄 수가 없다 — 고객의 해지 예약이 조용히 취소된다**
⑨-b 참고. 상태 하나 바꾸려고 「바꾸기」를 누르면 화면이 `ops-plan-change` 를 먼저 부르고, 그 손이 **`cancel_at_period_end=false`·`pending_plan_key=NULL`·결제일 재설정**까지 해 버린다.
**증명**: 고객이 `{atPeriodEnd:true}` 로 해지를 걸어 둔 뒤 운영자가 상태만 바꿨더니 `cancel_at_period_end: true → false`.
«이번 달까지만 쓸게요» 하신 분이 **다음 달에 또 결제된다.** 운영자 화면엔 «바꿨어요» 한 줄만 떴다.

### ③ 🔴 **메모를 남길 수가 없다** — 다음 담당자에게 넘길 말이 없다
⑩ 참고. 화면이 `text` 로 보내고 서버는 `note` 를 읽는다 ⇒ **저장이 안 될 뿐 아니라 있던 메모까지 빈 문자열로 덮는다.** 그런데 응답은 `ok:true`.
읽는 쪽도 키가 달라서(`r.notes` ↔ `note`) 화면엔 **영원히 «메모 없음»**.
⇒ 전화 받은 상담원이 «이 손님 어제 뭐라고 했더라»를 볼 방법이 **없다.**

### ④ 🔴 **상담원을 뽑아도 들여보낼 수가 없다**
⑲ 참고. 만들면 `password_hash = NULL` 이고, **남의 비번을 정해 주는 화면·API 가 없다.** 초대 메일도 없다.
⇒ 사람을 늘릴 수 없다. 지금 운영센터에 들어갈 수 있는 사람은 **비번이 이미 있는 계정뿐**이다.

### ⑤ 🔴 **«그 손님 프로그램이 구버전인가»를 판정할 수 없다**
⑭ 참고. R2 가 주는 최신은 **v1.4.0** 인데 붙어 있는 16대 중 1.4.0 은 **0대**(1.0.0 이 7대). 그런데 **화면 어디에도 «최신이 무엇인가»가 없다.**
⇒ «안 돌아가요» 전화에 운영자가 할 수 있는 말이 없다.

### ⑥ 🔴 **«이 손님이 이달 얼마를 냈나/우리가 얼마를 썼나»를 한 손님 화면에서 못 본다**
④ 참고. 서버는 `invoices`·`tickets`·`posts`·`sources`·`billingKey` 를 **다 보내는데 회원 상세 화면이 안 그린다.**
⇒ 결제 문의가 오면 운영자는 `ops/billing.html`(전체 목록)로 가서 눈으로 찾아야 한다.

### ⑦ 주인 없는 문의에 고객을 붙일 수 없다
⑪ 참고. `ops-ticket-claim` 이 있는데 **어느 화면도 안 부른다.** 지금 목록에 `tenantId:null` 인 문의가 실제로 있다(50번).

### ⑧ «오늘 AI 에 얼마 썼나»를 볼 화면이 없다
⑯ 참고. `ops/ai.html` 엔 비용이 없고, 대시보드는 이달치뿐이다.

---

## 3. 🔴 «감사에 안 남는 운영 행위»
성공한 운영 행위는 **18건 전부 남았다**(⑱ 표). 안 남는 것은 **하나**다:

| 안 남는 것 | 무엇이 문제인가 |
|---|---|
| 🔴 **실패한 운영 로그인** | `loginOperator` 는 성공(`ops_login`)과 **잠김**(`ops_login_locked`)만 적는다. 없는 계정으로 두드리면 잠기지도 않고(잠금은 계정 단위) 기록도 없다. 실측 3회 시도 → 감사 **0행** · DB 전체에 `ops_login_failed` **0건** |

그 밖에 «열람»은 감사에 안 남지만 그건 설계대로다(CLAUDE §4.7 이 감사를 요구하는 것은 **계정 자격 평문 열람** 한 곳). 다만 **메모 내용**은 감사에도 안 실린다(`detail:{length:0}`) — ③과 겹친다.

---

## 4. 🔴 «초록인데 고장» — 코드엔 있는데 화면에서 안 되는 자리
전부 **«서버가 보내는 키 ↔ 화면이 읽는 키»가 어긋난 것**이다. 한 줄씩 고치면 되는 것들이다.

| # | 자리 | 화면이 읽는 것 | 서버가 보내는 것 | 증상 |
|---|---|---|---|---|
| 1 | `ops/tenants.html:33` | (안 읽음) | `internal:{excluded,hidden}` | 🔴 손님이 «0곳»으로 사라진다 — §2① |
| 2 | `ops/tenant.html:71` → `ops-tenants.ts:238` | 보냄 `text` | 읽음 `note` | 🔴 메모가 안 남고 **있던 것도 지운다** — §2③ |
| 3 | `ops/tenant.html:63` | `r.notes[]` | `note`(문자열) | 영원히 «메모 없음» |
| 4 | `ops/tenant.html:56` | `r.coinsSplit` | `coinDetail` | 코인 포함/충전 분해가 안 뜬다 |
| 5 | `ops/tenant.html:62` | `r.slots.planned` | `slots.upcoming` | 「편성 예정」이 늘 0 |
| 6 | `ops/index.html:83` | `?? 0` | `trialToPaidPct: null` | 🔴 «못 쟀다»를 «0%»라고 말한다 — ② |
| 7 | `ops/tenant.html` 전체 | 안 그림 | `invoices`·`tickets`·`posts`·`sources`·`billingKey` | 받아 놓고 안 보여 준다 |
| 8 | `ops/runners.html:45` | 기기 문자열만 | (최신 버전을 안 보냄) | 낡은 러너를 못 고른다 |
| 9 | 어느 화면도 안 부름 | — | `ops-ticket-claim`·`ops-ticket-update`·`ops-ticket-create` | 주인 없는 문의를 못 다룬다 |

---

## 5. 셈

| | 화면 |
|---|---|
| ✅ **12** | ① 운영 로그인 · ③ 회원 목록 · ⑤ 대신 들어가기 · ⑥ 요금제 · ⑦ 체험 연장 · ⑨-a 나올 문 · ⑪ 문의·티켓 · ⑫ 공지 · ⑬ 결제(보기) · ⑮ 채널 · ⑰ 요금제·프로모션 · ⑳ 회사 정보(화면) |
| ❌ **8** | ② 대시보드(모름→0%) · ④ 회원 상세(키 어긋남 5곳) · ⑧ 코인 멱등 · ⑨-b 상태만 못 바꿈 · ⑩ 메모 · ⑭ 러너 버전 · ⑯ AI 비용 · ⑱ 실패 로그인 미기록 · ⑲ 상담원 못 들여보냄 |
| ⊘ **3** | 브라우저로 눌러 보기(playwright 없음 — 코드 대조로 대신) · 실결제·환불(KICC 미설정 + 절대선) · 내리기(takedown · 절대선) |

> ⑨·⑱·⑲ 는 한 화면 안에서 ✅ 와 ❌ 가 갈려 양쪽에 적었다. ❌ 8은 **화면 수**가 아니라 **결함 자리** 기준이다.

## 6. 남긴 것 (🔴 하나도 안 지웠다)

| 무엇 | id | 상태 |
|---|---|---|
| 내 시험 테넌트 | **761** `scenariob202-fblwbw` | `status=trial · plan_key=pro · trial_ends_at 2026-10-09` · 코인 210 · 메모 칸은 빈 문자열(⑩ 이 지웠다) |
| 🔴 **규칙에 걸려 숨은 «진짜 손님»** | **764** `smokehouse-x097e0` (스모크하우스 바베큐) | `is_internal=true` — **§2① 의 증거다. 이 집을 켜 두어야 그 결함이 살아 있다** |
| A 의 테넌트 | 762 `scenarioa202-mtokag` | **읽기만** 했다 |
| 티켓 | 54 | `resolved` |
| 공지 | 3 | **`active=false`**(비공개) |
| 프로모션 · 쿠폰 | 10 · 7 | **비활성**(`SCENB-TEST-OFF`) |
| 운영자 | 20 `scenb-cs@autocreate.kr` | **`active=false`**(꺼 둠 · 비번 없음) |

- 🔴 **보존 테넌트 3·13·109·116·198·451 은 열지도, 임퍼를 붙이지도 않았다.** `ops-invoices`·`ops-billing-keys`·`ops-runners` **목록에 섞여 나온 것을 읽기만** 했다.
- 🔴 **`ai_usage` 는 읽기만 했다**(SELECT 뿐 · 지운 것 없음).
- 🔴 **실결제·환불 0건** · **공개 토글 0건** · **내리기 0건** · **push 0회.**

## 7. 검증
- `npx tsc --noEmit` → **통과**(출력 없음)
- `node scripts/verify-r8-deadends.mjs` → **통과**
- 커밋한 것은 이 문서 하나다. `scripts/_smoke/*` 는 `.gitignore` 라 안 올라간다.

## 8. 🔴 이 결함들은 **이미 있는 자에 한 줄씩 더하면 잡힌다**
`verify-r8-deadends.mjs` 는 **바로 이 모양의 검사를 이미 갖고 있다** — 오늘 135개 전부 초록인데, 그 목록에 «운영 화면이 이 키를 읽나»가 **다섯 개만** 들어 있다:

```
✓ 운영 화면이 «AI 원가 — 제공사별»(byProvider)을 읽나      화면 1곳 [ops/index.html]
✓ 운영 화면이 «AI 원가 — 용도별»(byPurpose)을 읽나         화면 1곳 [ops/index.html]
✓ 운영 화면이 «AI 원가 — 모델별»(byModel)을 읽나           화면 1곳 [ops/index.html]
✓ 운영 화면이 «AI 원가 — 우리가 안은 몫»(overPlan)을 읽나
✓ 운영 화면이 «AI 원가 — 뺀 몫»(excluded)을 읽나
```

§4 표의 아홉 자리는 **이 목록에 없어서** 통과한 것이다. 넣을 줄(그대로 같은 모양):

| 더할 검사 | 무엇을 막나 |
|---|---|
| 회원 목록이 `internal` 을 읽나 → `ops/tenants.html` | §2① 손님이 «0곳»으로 사라지는 것 |
| 회원 상세가 `coinDetail`·`slots.upcoming`·`invoices`·`tickets`·`billingKey` 를 읽나 | §4 표 4·5·7 |
| 메모: 화면이 보내는 칸 이름 = 서버가 읽는 칸 이름 | §2③ — **보내는 쪽 ↔ 읽는 쪽**을 맞추는 축은 지금 아무 자에도 없다 |
| 대시보드가 `trialToPaidPct` 를 `?? 0` 으로 뭉개지 않나 | ② «모름»을 «0»이라 말하는 것 |
| 러너 화면이 «최신 버전»을 말해 주나 | ⑭ |

🔴 **셋째 줄이 제일 크다.** 오늘 찾은 아홉 중 **여섯이 «화면이 보내는 키 ↔ 서버가 읽는 키» 가 어긋난 것**인데, 그 축을 재는 자가 **하나도 없다.**
«정의가 있나»도 «호출이 있나»도 아니고 **«같은 이름으로 부르나»** 다. 메모처럼 **오류 한 글자 없이 `ok:true` 로 조용히 죽는 자리**는 이 축으로만 잡힌다.
