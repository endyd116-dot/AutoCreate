# 수리 라운드 · B — 운영센터 ❌ 6건 (2026-09-19)

> 브랜치 `fix/ops-repair-2026-09-19` · **push 안 함** · 지도 [`2026-09-19-REPAIR-round.md`](2026-09-19-REPAIR-round.md)
> 나온 곳 [`2026-09-19-scenario-b-ops.md`](2026-09-19-scenario-b-ops.md)
> 🔴 규율: **수리마다 자를 같이 낸다 · 자를 내면 스스로 변이를 넣어 본다(AC-108).**

## 0. 한 줄 결론
여섯 건 다 고쳤고, **새 자 하나**(`verify-ops-contract.mjs` · 26검사)와 **변이 14개**를 같이 냈다.
🔴 **변이가 처음엔 6개가 안 울었다** — 자를 조여서 **14/14 전부 울게** 만들었다.
🔴 그리고 변이가 **내 수리의 구멍 하나를 실제로 찾아냈다**(①의 정규식이 진짜 하니스 키를 놓치고 있었다).

## 1. 🔴 ①의 «라이브 오염 목록» — **1건뿐이다**

느슨한 `INTERNAL_KEY_RE` 때문에 **키 규칙만으로** 내부로 켜진 집을 라이브에서 전수로 뽑았다
(도메인·사용자0명·보존id 로 걸린 집은 제외 — 그건 옳게 켜진 것이다):

| id | key | owner | 판정 |
|---|---|---|---|
| **764** | `smokehouse-x097e0` | `smokehouse@naver.com` | 🔴 **잘못 켜졌던 집** — 어제 내가 증거로 만든 시험 테넌트 |

⇒ **진짜 손님은 아직 한 명도 안 삼켰다.** 764 는 내 시험 테넌트라 **직접 되돌렸고**(허용 범위), 고친 규칙으로 크론을 실제로 돌려
**다시 안 켜지는 것까지 확인**했다(아래 §3①). 🔴 **다른 집은 손대지 않았다** — 되돌릴 것도 없다.

조회에 쓴 질의는 여기 남긴다(다음에 또 물을 것이다):

    SELECT t.id, t.key,
           (SELECT u.email FROM users u WHERE u.tenant_id=t.id ORDER BY u.id LIMIT 1) AS owner
    FROM tenants t
    WHERE t.is_internal AND t.internal_manual_at IS NULL
      AND t.key ~* '<옛 정규식>'
      AND t.id NOT IN (3,13,109,116,198)
      AND EXISTS (SELECT 1 FROM users u2 WHERE u2.tenant_id=t.id)
      AND NOT EXISTS (SELECT 1 FROM users u3 WHERE u3.tenant_id=t.id
                      AND (LOWER(u3.email) LIKE '%@test.local' OR ...));

## 2. 고친 것 여섯

| # | 무엇이 문제였나 | 어떻게 고쳤나 | 파일 |
|---|---|---|---|
| ① | 자동 분류가 **진짜 상호를 삼켜** 손님이 «0곳»으로 사라졌다. 화면은 서버가 준 «숨김 N곳»을 버렸고 꺼낼 토글도 없었다 | ㉠ 표시어에 **끝 경계**를 붙이고(`[0-9-]`) **«표시어+글자+숫자4»** 갈래를 더했다 · 🔴 **돈 낸 집은 자동 규칙이 못 건드린다**(새 안전선 `PAID_TRACE`) ㉡ 화면이 **«내부로 표시된 N곳은 빠져 있어요 [함께 보기]»** 를 말하고 `?internal=1` 로 꺼낸다 | `lib/ops/internal.ts` · `public/ops/_tpl.txt` |
| ② | 상태만 바꿔도 `ops-plan-change` 가 지나가 **고객의 해지 예약이 풀리고 결제일이 옮겨졌다** | 서버: **같은 플랜 + charge 아님 = 구독 장부를 안 건드린다**(`unchanged:true`) · 화면: **바뀐 것만 부른다** + 🔴 **무엇이 함께 바뀌는지 누르기 전에 적는다**(`#planWarn`) | `netlify/functions/ops-tenants.ts` · `_tpl.txt` |
| ③ | 화면 `text` ↔ 서버 `note` 가 어긋나 **메모가 안 남고 있던 것까지 지웠다**(응답은 `ok:true`) | **두 이름 다 받고**, 빈 말로는 안 덮고(400), **쌓는다** — 새 표 `ops_tenant_notes`(누가·언제) · 상세가 `notes[{text,by,at}]` 를 내려준다 · 감사에 **내용 앞머리**까지 | DDL `0083` · `ops-tenants.ts` · `db/schema.ts` |
| ④ | 멱등 키가 **시계**(`Date.now()`)에서 나와 더블클릭이 두 번 들어갔다 | 화면이 **시트마다 `idem` 하나**를 보낸다 · 없으면 **뜻으로**(운영자·집·수·사유·분) · 🔴 **회수 쪽에도 `ON CONFLICT`** 를 붙였다(거긴 원래 없었다) · `duplicate:true` 로 화면이 말해 준다 | `ops-tenants.ts` · `_tpl.txt` |
| ⑤ | «못 쟀다»(null)를 **«0%»** 라고 말했다 | 화면이 `null` 이면 «못 쟀어요» · 🔴 **이탈률도 같은 병이라 서버까지** 고쳤다(`churnBase 0 → null`) | `ops-dashboard.ts` · `_tpl.txt` |
| ⑥ | 뽑은 운영자는 `password_hash = NULL` 이라 **로그인 자체가 안 됐고**, 남의 비번을 정할 길이 없었다 | `POST /api/ops-operator-password`(super_admin · 감사 high) + `setOperatorTempPassword` — **`must_change_password=true`** 로 준다 · 화면에 **«비번 주기»** 단추 · 🔴 «초대했어요 · 첫 로그인에 비밀번호를 바꿔요» 라는 **거짓 문구도 고쳤다** | `ops-operators.ts` · `lib/auth-service.ts` · `_tpl.txt` |

### 🔴 ②·⑤ 는 «화면만» 고치면 안 되는 것이었다
②는 화면이 안 불러도 **서버가 여전히 같은 일을 한다**(다른 길로 오면 또 난다) · ⑤는 화면이 `null` 을 그려도 **서버가 0 을 주면** 소용없다.
⇒ 둘 다 **양쪽**을 고쳤고, 자가 **양쪽을 다 잰다**.

## 3. 🔴 실제로 눌러서 확인한 것 (시험 테넌트 761·764 만)

### ① 고깃집이 크론을 지나고 살아남나

    764 is_internal = false 로 되돌림(내 시험 테넌트)
    → syncInternalFlags() 를 **진짜로** 실행   → 이번에 내부로 켠 집: 0
    → 764 is_internal = false 그대로                          ✅
    → ops-tenants?q=smokehouse → total 1 · hidden 0           ✅ 운영자 목록에 뜬다

숨김 쪽도 확인: `q=scenario` → `total 0 · hidden 3` ⇒ 화면이 «0곳» + «내부로 표시된 **3곳**은 빠져 있어요 [함께 보기]» ·
`&internal=1` → `total 3`(761·762·763 전부 보임) ✅

### ② 고객의 해지 예약이 살아남나

    고객:   POST /api/subscription-cancel {atPeriodEnd:true}   → cancel_at_period_end = true
    운영자: POST /api/ops-plan-change {id:761, planKey:"pro"}   ← 화면이 보내던 그대로(같은 플랜)
       → {"ok":true,"unchanged":true,"message":"이미 같은 요금제예요 — 구독·결제일은 그대로 두었어요."}
    운영자: POST /api/ops-tenant-update {status:"readonly"}     → {"ok":true}
    결과:   cancel_at_period_end = **true** ✅ · next_billing_at **2026-10-18 18:56 그대로** ✅

🔴 고치기 전엔 이 자리에서 `true → false` 가 되고 결제일이 오늘로 옮겨졌다. **거짓 «요금제가 바뀌었어요» 알림도 안 갔다** ✅

### ③ 메모

    옛 화면이 보내던 그대로 { id, text } 만  → {"ok":true, "at":"…"}   ✅ (옛 판은 {"ok":true,"note":""} 로 지웠다)
    빈 메모로 덮으려 하면                     → 400 «메모를 적어 주세요.»  ✅
    ops_tenant_notes: 2줄 (operator_id 1 · «관리자» · 시각)
    상세 notes: [{text:"두번째 통화…", by:"관리자", at:"…"}, {text:"첫 통화…", …}]  ✅ 다른 운영자에게 보인다
    coinsSplit / slots.planned 도 같이 온다                                        ✅

### ④ 코인 멱등 — 두 갈래 다

    같은 idem 으로 동시에 두 번  → {"applied":30,"balance":240} · {"applied":0,"balance":240,"duplicate":true}
    idem 없이(옛 화면) 두 번      → {"applied":10,"balance":250} · {"applied":0,"balance":250,"duplicate":true}
    원장: ops:1:gtest…(1줄) · ops:1:761:10:장애 보상:29829459(1줄)   ✅ 두 줄이 안 생긴다

### ⑤ 대시보드
`trialToPaidPct = null` · `churn = {month:0, pct:null}` ⇒ 화면 **«못 쟀어요»** ✅

### ⑥ 상담원이 진짜로 들어오나

    임시 비번 주기            → {"ok":true,"mustChangePassword":true}
    기본 비번(admin1234)      → 400 «기본 비밀번호는 쓸 수 없어요.»                  ✅
    그 상담원이 로그인        → {"ok":true,"mustChangePassword":true,"role":"admin"}  🔴 어제는 여기서 «맞지 않아요» 였다
    본인이 비번을 정함        → {"ok":true}
    다시 로그인               → {"ok":true,"mustChangePassword":false}                ✅ 한 바퀴가 돈다

## 4. 🔴 새 자 — `scripts/verify-ops-contract.mjs` (26검사 · safe 갈래)

### 왜 이 자인가
어제 찾은 결함 아홉 중 **여섯이 한 가지 모양**이었다 — **«화면이 읽거나 보내는 이름 ↔ 서버가 보내거나 읽는 이름이 다르다».**
🔴 **그 축을 재는 자가 하나도 없었다.** `verify-r8-deadends` 는 «정의가 있나»·«호출이 있나»를 잰다 —
**둘 다 초록인 채로** 여섯 자리가 죽어 있었다. 이름이 어긋난 것은 **호출도 정의도 멀쩡하기 때문**이다.
🔴 특히 «보내는 이름»이 어긋나면 **오류가 안 난다**(서버가 못 읽은 칸을 빈 값으로 본다) — 200 이 오니 스모크로도 안 잡힌다.

### 무엇을 재나
① 읽는 축(5) · ② 🔴 **보내는 축(4 · 새로 생긴 축)** · 경로가 `config.path` 에 붙었나(1) ·
③ «모름»을 «0»으로 뭉개지 않나(3 · 화면 2 + 서버 1) · ④ 자동 분류 — 진짜 상호 12개 · 하니스 키 10개(2) ·
⑤ JS↔SQL 정규식 동기 · POSIX 호환(2) · 돈 안전선(1) · ⑥ 상태만 바꾸기(3) · 코인 멱등(2) · 운영자 초대(3)

🔴 **하니스 키 표는 라이브에서 실제로 뽑은 키를 그대로 썼다** — 지어낸 표로는 이 자가 값이 없다.

## 5. 🔴 변이 시험 — `scripts/_smoke/mutate-ops-contract.mjs`(커밋 안 됨 · AC-108)

### 첫 판: **14개 중 6개가 안 울었다**
자를 낸 것만으로는 부족했다. 안 운 이유가 전부 **«너무 헐거운 검사»** 였다:

| 안 운 변이 | 왜 안 울었나 |
|---|---|
| M1 ①화면 | `r.internal` 을 지워도 같은 파일의 **질의 문자열 `&internal=1`** 이 «internal 이 있다»로 읽혔다 |
| M3 ①안전선 | `PAID_TRACE` → `PAID_TRACE_OFF` 로 **이름만** 바꿨는데 `includes("PAID_TRACE")` 가 그대로 참이었다 🔴 **`verify-gate-pair` 가 적어 둔 «부분일치 금지» 함정에 내가 그대로 걸렸다** |
| M6 ③보내는축 | body 에서 `note:` 를 빼도 **경로 문자열 `/api/ops-tenant-note`** 가 초록으로 만들었다 |
| M7 ③읽는축 | 응답에서 `notes` 를 빼도 위쪽 **지역변수 `notes`** 가 남아 초록이었다 |
| M12 ⑥손 | `setOperatorTempPassword` → `…X` 로 꼬리만 붙였는데 부분일치로 통과 |
| M13 ⑥화면 | 표에서 단추를 빼도 **`[data-pw]` 선택자**가 남아 초록이었다 |

⇒ 낱말 찾기를 버리고 **«그 자리에서 그렇게 쓰는 모양»** 을 못 박았다
(`r.internal` · `note: d.text` · `notes, audit, setup` · `data-pw="${o.id}"` + 선택자 **둘 다** · 선언 + 쓰는 자리 **둘 다**).

### 둘째 판: **14/14 전부 운다** ✅
🔴 그리고 변이가 **내 수리의 진짜 구멍**을 찾았다 — M2 를 넣기 전에 «하니스 키는 그대로 잡나»가 빨개졌다:
첫 정규식(끝 경계만 막은 판)이 **`r8ta17894918-29buhy` 같은 진짜 하니스 키를 놓쳤다.**
자를 낮추지 않고 **규칙을 고쳤다**(«표시어+글자+숫자4» 갈래를 더함). **자가 없었으면 그대로 나갔다.**

## 6. ⚠️ 남는 위험 — 적어 둔다(AC-9 · «안 삼킨다»로 적지 않는다)
`test2024@…` 처럼 **«표시어 + 숫자»인 진짜 상호**는 여전히 삼킬 수 있다.
그 대신 ㉡ 로 **화면이 «N곳 숨겼어요»를 말하고 한 번에 꺼낼 수 있게** 했고, 운영자가 손으로 끄면 크론이 다시 안 켠다.
⇒ **«못 삼킨다»가 아니라 «삼켜도 보이고 되돌릴 수 있다»** 로 만든 것이다.

## 7. 🔴 이번에 내가 낸 함정 둘

### ㉠ `public/ops/*.html` 은 **생성물**이다
처음에 생성물만 고쳤더니 `verify-r8-deadends` 의 «정본(`_tpl.txt`)과 생성물이 안 어긋났다» 가 빨개졌다.
정본은 `public/ops/_tpl.txt` 이고 `node scripts/build-pages.mjs` 로 다시 만든다. **정본을 고치고 다시 만든다.**

### ㉡ `//` 줄주석이 **한 줄짜리 함수 본문**을 통째로 먹는다
운영 화면의 함수 본문은 **한 줄**이다(`UI.sheet(…)` 한 방). 거기에 줄 끝 `// 주석` 을 붙였더니
**그 뒤 닫는 괄호까지 전부 주석**이 됐다 — `tenant.html`·`operators.html` 두 화면의 스크립트가 깨졌다.
🔴 `tsc --noEmit` 은 **안 잡는다**(HTML 안의 스크립트다). `verify-pages.mjs` 가 잡았다(«스크립트가 깨졌다»).
⇒ **이 화면들에는 `/* … */` 만 쓴다.**

## 8. 검증
- `npx tsc --noEmit` → **통과**
- `node scripts/verify-safe-list.mjs --run` → **✅ 실제로 잰 69개 전부 통과** · ⊘ 못 쟀음 1개(`verify-runner-live-inside` — 잴 재료 없음 · 내 수리와 무관 · **통과로 적지 않는다**)
- `node scripts/verify-r8-deadends.mjs` → **PASS 135 · FAIL 0**
- `node scripts/verify-ops-contract.mjs` → **PASS 26 · FAIL 0**(새 자)
- `node scripts/verify-pages.mjs` → **PASS 45 · FAIL 0**
- 변이 → **14/14 전부 운다**

## 9. 남긴 것
- DDL `drizzle/0083-ops-tenant-notes.sql` — **라이브에 걸었다**(`applied 2/2`). B 칸 `0083~0089` 중 0083 사용.
  🔴 **B 머지와 같은 호흡**에 걸어야 한다(상세가 이 표를 SELECT · 다만 실패하면 빈 배열로 계속하게 짜 뒀다).
- 시험 테넌트 **761**(메모 3줄 · 코인 255) · **764**(`is_internal=false` — §1의 증거) — **안 지웠다.**
- 운영자 **20** `scenb-cs@autocreate.kr` — 비번이 생겼고 role admin · active. 🔴 **끄지 않았다**(⑥의 증거).
- 보존 3·13·109·116·198·451 **무접촉** · `ai_usage` **읽지도 쓰지도 않았다** · provider 실호출 0 · push 0.
