# B2 인수인계 — 러너 · 발행 · 수익 · 프록시 (B2 → 새 세션)

> ⚠️ **이 파일은 2026-09-15 에 처음 만들었다.** 메인이 «`R5-B2-HANDOFF.md` 에 §R7 절을 더하라»고 했는데
> **그 파일이 없었다**(B2 인수인계는 한 번도 쓰인 적이 없다). `R5-B-HANDOFF.md` 는 B-1(영상) 것이라
> 러너·발행을 거기 섞지 않고 여기에 새로 열었다. 앞으로 B2 인수인계는 **이 파일 하나**다.
>
> 담당 영역: `runner/**` · `lib/publish/*` · `lib/runner-jobs.ts` · `lib/proxies.ts` · `lib/warmup.ts` · `lib/plans.ts`(**값만**)
> 브랜치 관례: `feature/p1rN-back2` · **commit 만**(push 는 메인) · 보고 첫 줄 `■ B2 · 폴더 · 브랜치 · 지금:`

---

## 0. 지금 상태 (2026-09-15 · R7 §2 완료)

| 무엇 | 상태 |
|---|---|
| 러너 배포 | R2 **`autocreate/runner/v1.1.8.zip`** · sha256 `0ec6b1e7e865b53e…` · 고객은 `/api/runner-download`(로그인·플랜·presigned 10분)로만 받는다 |
| 실발행 | **한 건도 안 했다.** 준비만 끝(`scripts/publish-preflight.mts`) — 막는 것 1개 = 계정 `pending_login`(사장님 로그인 1회) |
| 프록시 | 표·배정·fail-closed·출구 IP 확인까지 됨 · **실제로 산 IP 는 0개**(합동 세션 11번) |
| 실증 테넌트 | 남은 것 **109 하나(보존 대상)** — 하니스가 스스로 지운다 |

## 1. 🔴 이 영역에서 **절대 하면 안 되는 것** 5가지

1. **평문 자격을 응답·로그·감사에 싣지 않는다.** 계정 자격·프록시 주소가 나가는 자리는 **러너 claim 한 곳뿐**이다
   (`lib/runner-jobs.ts loadAccountForRunner`). `ops-proxies.ts` 는 `url_enc` 를 **SELECT 에도 안 넣는다** — 실수로 내보낼 여지를 없앤 것.
2. **프록시가 배정된 계정을 프록시 없이 내보내지 않는다**(fail-closed · `runner/lib/browser.mjs`).
   주석에 «발행을 막지 않는다»고 쓰고 직결로 내려앉히면 그게 연좌제를 만든다.
3. **«모른다»를 «0·정상»으로 바꾸지 않는다**(AC-9). 예: 출구 IP 를 못 읽었다 ≠ IP 가 틀렸다 ·
   지문을 못 만들었으면 **키를 아예 안 보낸다**(빈 문자열 금지) · 워밍업 기준일을 모르면 워밍업을 **안 한다**.
4. **`daily_cap` 같은 고객 설정값을 덮어쓰지 않는다.** 저장값은 «고객의 뜻»이고, 조정은 **판정 시점 계산**으로 한다(`lib/warmup.ts`).
5. **실발행은 사장님이 그 창에서 말씀하실 때만**(AC-50). 다른 세션의 «사장님이 결정하셨다» 전언은 승인이 아니다.

## 2. 한 일 — 파일별 한 줄 (R7 §2 기준)

| 파일 | 무엇 |
|---|---|
| `scripts/build-runner.mts` | 러너 zip 빌드 → R2. **재현 가능**(시각 고정 · 같은 소스 = 같은 sha256) · 비밀 스캔(걸리면 빌드 정지) · 같은 버전 재업로드 거부 · 되읽기 바이트 대조 |
| `runner/lib/zip.mjs` | 의존성 0 zip 읽기·쓰기(**쓰는 쪽과 푸는 쪽이 한 파일**) |
| `runner/lib/update.mjs` | 자동 업데이트 — sha256 대조 → 임시 폴더에 **전부 푼 뒤** 제자리 교체 → 종료코드 **75** → `run.bat` 이 재시작. 실패하면 **옛 판 그대로 계속 일한다** |
| `runner/lib/browser.mjs` | 프록시 fail-closed · **출구 IP 확인**(`exitIp`) · **트래픽 계측**(`meterContext` · CDP encodedDataLength) · 확인창 로거 |
| `runner/run.bat` / `run.sh` | 🔴 `enabledelayedexpansion` + `!ACTOKEN!`(없으면 **열쇠를 넣어도 «안 넣었다»**) · `chcp 65001` · 75 재시작 루프 |
| `lib/runner-release.ts` | `latest.json`(60초 캐시) · presign 10분 · `backgroundBase`/`publicBase` 구분 |
| `lib/runner-jobs.ts` | 큐 상태기계 · **기기 지문 묶기는 `authRunner`(인증 자리)** · `"proxy"`·`"parse"` 는 **전이표 밖 kind**(계정 전이 0) |
| `lib/proxies.ts` | 계정 1 : IP 1 배정 · **재고 없으면 `pending`**(실패 아님) · sticky 우선 · 해제한 IP 는 바로 재배정 안 함 |
| `lib/warmup.ts` | 1/2/3주차 주 1·2·3건 → 4주차 정상. **`AccountRow.dailyCap` 자체를 유효값으로** 만들어 기존 게이트 3곳이 코드 수정 없이 따른다 |
| `lib/publish/dispatcher.ts` | API 채널 계정별 IP **자리만**(기본 직결 · `PROXY_API_PUBLISH=1`+프록시일 때만 · `undici` 없으면 **던진다**) |
| `lib/cron/post-alive.ts` | 발행 7일 뒤 **1회** `verify.post_alive` 적재(러너 채널만 · 20/틱). 🔴 **표식(`posts.stats.alive7At`)을 잡보다 먼저** 찍는다 — 끝난 잡은 dedupe 가 못 막으므로 최악을 «한 번도 안 걺»으로 둔다. ⚠️ 이 확인은 **비공개 발행을 못 잡는다**(§5 열린 항목) |
| `lib/cron/managed-runner-watch.ts` | 관리형(우리 기기)이 30분 조용하면 **운영에** 알린다(**global 스텝** — 관리형은 `tenant_id NULL` 이라 테넌트 루프에 안 보인다) |
| `scripts/verify-runner-dist.mts` | 배포·업데이트·묶기 실증 **+ teardown**(실패해도 `finally` 로 테넌트 삭제) |
| `scripts/publish-preflight.mts` | «올리기 직전 한 화면» · **`--go` 없이는 아무것도 안 올라간다** |

## 3. 🔴 내가 실제로 밟은 함정 (같은 데서 또 넘어지지 말 것)

| 함정 | 무엇이 일어났나 |
|---|---|
| **배치 파일은 읽어서 못 잡는다** | `run.bat` 의 열쇠 입력이 **한 번도 동작한 적이 없었다**(괄호 블록 지연확장). 고객이 열쇠를 정확히 붙여넣어도 «안 넣었다». **돌려 보고서야** 잡혔다(AC-51) |
| **화면도 읽어서 못 잡는다** | preflight 가 «항목 전부 ✗ 인데 판정은 ✓ 전부 통과»로 찍혔다(칸 이름 `pass` 를 `ok` 로 읽음). **사장님이 «올릴까 말까» 정하는 화면**이었다. `as never` 캐스트 탓에 컴파일러도 못 잡았다 |
| **Playwright 는 확인창을 조용히 취소한다** | 티스토리 HTML 모드가 안 열린 진짜 이유. 핸들러가 없으면 `confirm()` 이 자동 «취소»되고 **화면·로그에 흔적이 0**(AC-42) |
| **같은 뜻의 요소가 숨은 복제본으로 한 벌 더** | `#editor-mode-html-tistory`(죽은 복제본) vs `#editor-mode-html`(진짜). `.first()` 는 매번 시체를 집는다(AC-43) |
| 🔴 **주석과 코드가 갈라져 있을 수 있다** | `isNaverLoggedIn` 주석은 «애매하면 로그아웃»인데 코드는 그 자리에서 `true` 를 냈다. **주석만 읽으면 멀쩡해 보이는 코드**는 리뷰·인수인계·다음 사람의 판단을 전부 속인다 — 주석을 계약으로 믿지 말고 **돌려 봐라** |
| 🔴 **«준비됐나»를 «N밀리초 잤다»로 대신하지 마라** | `gotoFirst` 가 고정 수면 뒤 **딱 한 번** 봤다 → 1.2초 뒤 그려지는 화면을 «주소를 못 찾았어요(우리 버그)»로 거짓 보고 · 대기값이 크면 준비돼도 끝까지 잠(8000 주면 8067ms). ⇒ `scrape.mjs waitFor` 로 **조건을 훑는다**(78ms/47ms 로 빨라지기까지 했다). ⚠️ `settle` 로 기다리는 자리가 아직 많다 — R8 |
| 🔴 **로그인 벽을 잘못 부르면 «우리 문제»인데 고객을 부른다** | 전이표상 `login_fail`·`captcha` → 계정 **`pending_login`** → «다시 로그인하세요». 종전 네이버는 로그인 화면에 남아 있기만 하면 이유 불문 **«아이디 또는 비밀번호가 맞지 않아요»** 라고 했다(거짓 안내 + 계정 정지). 카카오는 콜백 성공 뒤 **고객 블로그 글에 «2단계 인증»이 있으면 성공을 실패로 뒤집었다**. ⇒ 판정을 순수 함수로 뽑아 `scripts/verify-runner-auth.mts` 로 확인(17/17). 🔴 실계정 로그인 금지(캡차를 부른다 · AC-19) |
| 🔴 **표 찾기 층이 «조용히» 여섯 가지로 틀렸다** | 진짜 DOM 으로 돌려서 잡았다(`scripts/verify-runner-scrape.mts` · 5/11 → 11/11). 제일 나쁜 둘: **«예상수익» 열을 확정 수익으로 적었다**(숫자가 멀쩡해 보인다) · **`colspan` 행이 통째로 버려져 «수익 0원»** 이 됐다(모른다 ≠ 0). 나머지: 레이아웃 `<table>` 안 진짜 표가 격자로 섞임 · «합계» 행이 데이터로 들어가 표 한 장이 통째로 실패 · «정산일자»가 날짜·금액 둘 다로 골라짐 |
| 🔴 **문서에만 있고 코드에 없던 동작** | 클립 채널 주석은 «월별이면 그 달 1일로 적고»라고 했는데 `parseDayKst` 가 월 단위를 못 읽어 **월별 표는 통째로 `parse` 실패**했다. 주석을 계약으로 믿지 말고 **돌려 봐라**(`scripts/verify-runner-money.mts`) |
| 🔴 **돈·날짜 파서의 오류는 소리가 안 난다** | «26.12.31»(연도 명시)이 **2025**-12-31 로 접혔고, «1.234»(금액)가 **2026-01-23** 이라는 그럴듯한 날짜가 됐다. 둘 다 잘못 읽은 값이 «정상 값»처럼 생겨서 아무 데서도 안 걸린다 — 실측으로만 잡힌다 |
| 🔴 **«돌았나»만 보는 검사는 «틀린 성공»을 초록으로 찍는다** | AC-55(비공개 발행)·AC-42(조용한 confirm 취소)·AC-43(죽은 복제본) 셋 다 «동작했나»만 보면 **통과**한다. 그래서 카나리 판정을 «올바른 결과인가»로 올렸다(설계문서 §5) — 핵심은 **글 주소를 로그인 안 한 브라우저로 열어 보는 것** |
| **`SITE_URL` 로 자기를 부르면 라이브에서 돈다** | 로컬 스텁을 켜도 배경 함수는 라이브에서 실행 → 실제로 $3.63 이 나갔다(AC-53). 자기 호출은 `backgroundBase()` |
| **압축 풀린 크기로 트래픽을 재면 3~5배 부푼다** | CDP `encodedDataLength` 로 재야 한다. 가정(20~40MB)이 실제로는 **9~10MB** 였다 |
| **DDL 번호는 «파일 만들기 직전에» 확인** | `ls | tail -1` 을 보고도 파일을 먼저 써서 두 번 겹쳤다(AC-49) |
| **셸이 역슬래시를 먹는다** | `sed`·`perl`·`node -e` 가 조용히 0건 치환. **바꾼 개수를 찍어** 확인해야 한다. 🔴 2026-09-15 에 **또 걸렸다** — python 으로 `.mts` 를 깁는데 `
` 이 **진짜 줄바꿈**으로 들어가 문자열이 깨졌다(두 번 시도해도 같았다). ⇒ **고치려 하지 말고 이스케이프를 피해라**: `console.log("")` 두 줄로 나누거나 Edit 도구로 정확히 바꾼다. (적어 둔 함정에 또 걸렸다는 건 이 줄이 덜 쓰였다는 뜻이다) |

## 3B. 🔴 이 영역에서 제일 비싼 한 줄

> **모를 때 `login_fail` 을 쓰지 마라. 모르면 `unknown` 이다.**

전이표(`lib/account-health.ts`)에서 `login_fail`·`captcha` 는 계정을 **`pending_login`** 으로 밀고 고객에게 «다시 로그인하세요»를 시킨다.
그래서 **이유를 모를 때 `login_fail` 을 쓰면** ①멀쩡한 계정이 멈추고 ②고객이 헛일을 하고
③ **시키는 대로 재로그인을 반복하는 것이 캡차를 부른다** — 우리는 이미 한 번 그랬다(job #16 · AC-19).
`unknown` 은 계정을 안 건드리고 건강도만 깎는다. 모를 때 맞는 칸은 그쪽이다(AC-10 «우리 버그와 계정 문제를 섞지 마라»).
판정 근거는 `runner/lib/auth-*.mjs` 의 `classify*LoginWall`(순수 함수) · 검사는 `scripts/verify-runner-auth.mts`.

## 3C. 러너와 서버의 경계 — **러너는 사실, 서버는 문장**

메인 판정(2026-09-15): 러너 `notes` 를 저장하지 않는다(`RunnerReportOk` 에 칸이 없다 — 보내도 버려진다).
러너 노트를 저장하면 «러너가 하는 말»이 또 하나의 진실 원천이 되고, **화면 문구가 러너 판(zip)에 묶인다**(고치려면 재배포).
⇒ 러너는 `raw` 에 **사실**만(`amountEstimated`·`amountHead`·`rowsDropped`), **문장은 `lib/revenue/aggregate.ts` 가 만든다.**

## 4. 결정해 둔 것 (다시 묻지 말 것)

- 러너 배포는 **zip + R2 + presigned**. npm 패키지로 안 판다(`npx ac-runner` 는 존재한 적 없다).
- 낱말은 **«열쇠»**(토큰 아님) — 화면·설치 안내·서버 오류 문구·콘솔("Key") 네 면이 같은 말을 쓴다.
- 러너 오류 어휘 7종은 **B 소유**(`lib/account-health.ts`). 넓히지 말고 `"parse"` 처럼 **표 밖 kind** 로 처리한다.
- 관리형 요금 단위는 **계정당**(대수 아님) · **프록시 포함** · 값은 `MANAGED_RUNNER_ACCOUNT_KRW` 한 곳(**권장값 · 확정은 사장님**).
- AM 노트북과는 **합병하지 않고 별도 설치**(우리 업데이트 재시작이 AM 발행을 끌고 넘어진다).

## 5. 지금 열려 있는 것 (다음 세션이 이어받을 것)

| 무엇 | 누구 | 메모 |
|---|---|---|
| **실발행 1건**(네이버 → 티스토리·블로거·WP) | B2 + 사장님 | 합동 세션 1번. `publish-preflight.mts --piece=N` 으로 보여 드리고 «올려» 뒤 `--go`. **막는 것 = 계정 `pending_login`** |
| 프록시 실구매 | 사장님 | 합동 세션 11번 · 질문지 `2026-09-15-proxy-rfq.md` · **모바일 자체 구축이 더 싸다**(안 사는 선택지) |
| API 채널 dispatcher 실가동 | B2 | 자리는 있다 · `undici` 의존성 추가 여부는 메인 결정 |
| 🔴 **`post_alive` 가 «비공개 발행»을 못 잡는다** | B2 | **설계문서 §10 근거.** 잡이 그 계정의 로그인된 프로필에서 돌아(`core.mjs` profileKey+applyCookies) «비공개입니다» 정규식이 **남의 글에만** 걸린다 → AC-55 형 «비공개로 성공»은 발행 때도 7일 뒤에도 안 잡힌다. 실발행 0건이라 당장 안 터진다. 고침 작음(쿠키 없는 컨텍스트) · R8 «코드 0» 지시로 보류 |
| 셀렉터 표 서버 배포(1단계) | B2 | **설계 끝**(`2026-09-15-recipe-canary-design.md` · 커밋 88e7135). 🔴 카나리는 이미 둘 있다(셀렉터·AI모델) — 그 위에 얹는다. 발주 전 필요: `canary_runs` 유니크 교체 = **파괴적 DDL · 사장님 승인** |
| 팜 관리 화면(대수·배정·모니터) | A | 다음 라운드 |

## 5B. R8 §3 에서 더한 것 (2026-09-15 · 새 B2 세션)

| 파일 | 무엇 |
|---|---|
| `lib/publish/{facebook,x,tiktok}.ts` · `instagram.ts`(피드·캐러셀) · `youtube.ts`(롱폼) | 다음 Phase 채널 커넥터. 🔴 **커넥터를 쓴 뒤에** `channel-registry.publishVia` 를 채웠다 |
| `lib/publish/seo.ts` | WP `excerpt`·`slug`(로마자) + **Article JSON-LD 만**. 🔴 FAQPage·HowTo 는 **하지 않기로 한 것**(둘 다 구글이 지원 중단) |
| `runner/lib/profile-seal.mjs` | 로그인 정보가 실제로 잠겨 있나(읽기만). 🔴 같은 `v10` 이 윈도우=DPAPI · 맥=키체인 · **리눅스=하드코딩** |
| `lib/recipe.ts` · `lib/recipe-store.ts` · `runner/lib/recipe.mjs` · `lib/cron/recipe-rollout.ts` | 셀렉터 표 서버 배포(Ed25519 · 못 믿으면 묶여 온 표) |
| `.gitattributes` | 🔴 `*.bat = crlf` — main 의 `* eol=lf` 를 **뒤에서 덮는다**(gitattributes 는 나중 줄이 이긴다) |

### 🔴 이번에 밟은 것 — 같은 데서 또 넘어지지 말 것

| 함정 | 무엇이 일어났나 |
|---|---|
| 🔴 **`run.bat` 이 LF 전용이었다** | cmd.exe 의 `goto` 는 **바이트 오프셋으로 뛴다** — CR 가 없으면 **줄 중간에 착지**하고 그 자리부터를 명령으로 읽는다. `--autostart` 가 통째로 무시되고 러너가 그냥 실행됐다(**오류 한 줄 없이 «다른 일»**). 이미 있던 `goto :npmfail`·`:runloop` 도 같은 지뢰 위였다. ⇒ CRLF + `.gitattributes` + **빌드가 바이트를 다시 본다**(설정했다 ≠ 그렇다 · AC-66) |
| 🔴 **postgres jsonb 가 키 순서를 뒤섞는다** | 실측: 보낸 `version,channel,…,sig` → 돌아온 `sig,waits,channel,…` · 중첩까지(`title,publish,zzz,aaa` → `aaa,zzz,title,publish`). **정규화가 없으면 표를 꺼내는 순간 모든 서명이 깨지고** 전 러너가 조용히 폴백된다 |
| 🔴 **`caps` 가 화면에 한 번도 안 갔다** | 서버는 R5 부터 저장했는데 `listDevices` 가 SELECT 를 안 했다. 화면은 `d.caps.ffmpeg === false` 를 **네 곳**에서 읽는다 — «ffmpeg 없음» 칩이 **뜰 수가 없었다**. `grep caps` 로는 양끝이 다 나와 초록이다(AC-56 «가운데만 없다») |
| 🔴 **인스타 주소가 열린 적이 없다** | `media_publish` id 는 숫자인데 permalink 는 짧은 코드다. 발행은 «성공»인데 «글 보기»만 조용히 죽는다 ⇒ permalink 를 물어보고 **못 받으면 주소를 안 만든다** |
| **파이썬으로 파일을 고칠 때 줄끝** | `io.open(p,"w")` 는 윈도우에서 `
` 을 **CRLF 로 바꾼다** — 파일 전체가 diff 로 뜬다. ⇒ `newline=""` 로 읽고 쓰고, **원래 줄끝을 보존**한다. 리포에 CRLF 파일과 LF 파일이 섞여 있어(전체 정규화 전) **파일마다 확인**해야 한다 |
| **«없는 함수»를 쓸 뻔** | 운영 화면에 `UI.confirm`·`OPS.lock()` 을 썼는데 그런 시그니처가 없다(실제는 `UI.sheet`+`UI.confirmRow` · `OPS.lockPill`). 기존 화면이 쓰는 패턴을 먼저 본다 |

### 열려 있는 것(R8 §3 잔여)
- 🔴 **프로필 봉인 본체는 안 만들었다** — 설계만(`docs/active/2026-09-15-runner-profile-seal-design.md` §8 승인 4가지). 승인 뒤 구현.
- 🔴 **러너 v1.2.0 을 R2 에 안 올렸다** — 고객 러너가 자동으로 받아 가는 **대외 배포**라 메인 확인 뒤.
- **recipe 서명 열쇠 미발급** — `node scripts/gen-recipe-key.mjs` → env 둘 + `runner/recipe-key.pem`. 없으면 묶여 온 표로 도는 **정상 상태**.
- **brunch · naver_clip_post** — 계정 1개 + 화면 1회 실측이면 열린다(사장님 체크리스트 15번).

## 6. 재개 절차

```
cd AutoCreate-B2 && git fetch && git merge main
npx tsc --noEmit -p tsconfig.json                 # resvg 오류 1건은 기존 것(무시)
npx --yes tsx --env-file=.env scripts/verify-runner-dist.mts    # 28항목 · 스스로 테넌트 만들고 지운다
```
- 러너를 고쳤으면 **판 올리고 배포**: `runner/package.json` version +1 → `scripts/build-runner.mts` → 설치된 러너가 자동으로 받는다.
- 🔴 새 실증 테넌트를 만들면 `verify-runner-dist.mts` 의 `TEST_KEY` 에 **먼저** 넣는다(안 넣으면 teardown 이 안 지운다 — 실제로 t237 이 남았었다).

---

## 🔴 다음 사람이 꼭 알아야 할 것 둘 (2026-09-16 밤 · B2)

### ① 타입검사는 **`.mts` 만** 본다 — `.mjs` 50개는 밖이다
`tsconfig.include` 에 `scripts/**/*.mts` 를 넣었다(2026-09-16). 그런데 **`scripts/**.mjs` 50개는 여전히 검사 밖**이다
(`allowJs` 를 안 켰다 — 켜면 또 다른 크기다). `runner/**` 도 `exclude` 라 밖이다.
🔴 **「전부 검사받는다」고 믿지 마라.** 「`.mts` 는 재고 `.mjs` 는 안 잰다」가 지금의 사실이고, **알고 두는 것**이다.
⚠️ 켜자마자 잡힌 것이 있었다: `verify-b4-place.mts` 가 `structureFor` 를 **인자 순서가 어긋난 채**(`imageCount=null`,
`affiliate=6`) 부르며 **있지도 않은 조합**을 재고 있었다 — **초록인 채로**. `.mjs` 쪽에도 같은 것이 있을 수 있다.
⇒ **남은 일**: `allowJs`(+`checkJs`)를 켜고 `.mjs` 50개를 훑는다. 크기를 먼저 세고 나누는 것이 낫다.

### ② `.gitattributes` **재정규화**는 아직 안 했다 — 조건이 안 됐다
`.gitattributes` 자신이 적어 뒀다: 「전체 정규화는 **브랜치가 다 비었을 때** 한 번에 — 지금 하면 다섯 창의 브랜치가 통째로 충돌한다」.
🔴 2026-09-16 밤에 재 보니 **47파일 · +7,529/−7,513**(전면 재작성)이고 `feature/r9-front`(A)가 main 보다 앞서 있었다.
지금 하면 A 의 머지가 **파일 통째 충돌**이 되고, 그러면 **AC-77 ②** 가 그대로 재발한다(700줄 충돌 속에서 게이트 축이 조용히 증발).
⇒ **남은 일**: 모든 창이 비었을 때 **메인이 한 번에** `git add --renormalize .`. 그 전에는 하지 마라.

---

## 🔴 R12 (2026-09-17 · B2) — 영상 craft · 당근 · 남은 것

### 무엇이 바뀌었나 (한 줄씩)

| 파일 | 무엇 |
|---|---|
| `lib/video/tempo.ts` **신규** | 말 속도 판정 **순수 한 곳**. 🔴 배운 값은 «보통(1.0) 대비 배수»고 **우리 보통은 1.1**(`TYPECAST_DEFAULT_TEMPO`) ⇒ `clamp(1.1×배운값)`. 배운값 1.0 = 오늘과 같은 영상. `resolveNarrationTempo`·`checkTempoFitsSpec`(B2) · `effectiveTempo`·`syllableRatioOf`(B 가 대본 길이에 쓴다 · **식을 두 벌 안 적으려고 한 파일에**) |
| `lib/video/gen.ts` | ②tts 를 `bakeNarration(plan)` 으로 묶었다 — **잰 뒤에** 규격을 보고 넘치면 **보통으로 다시 굽는다**. R2 세대에 속도 꼬리(`t121`)를 붙여 **다른 속도의 음성을 안 집는다**(AC-39). 컷 하한·모션·전환을 payload 로 |
| `lib/video/scenes.ts` | `applyCutFloor` — 늘리기만 하고 **안 줄인다**(컷이 나레이션보다 짧으면 말이 잘린다) · 창을 늘리면 **그 창의 문장도 같이 민다** · 규격 넘으면 **통째로 버린다** |
| `lib/video/reference.ts` | R9 가 «일부러 뺀 둘»(`captionMotion`·`transition`)을 **연다**. 어휘를 `sanitizeTemplate` 이 **닫아** 둔다 |
| `lib/video/reference-apply.ts` | `audioTempo`·`captionMotion`·`transition`·`minCutMs` 가 `unused` → **`applied`** 로 |
| `runner/channels/render-video.mjs` | 🔴 `buildRenderArgs` 를 **`run()` 밖 순수 함수로 뽑았다** · 모션 넷 · 전환 셋 · `hasXfade()` · **되돌릴 길**(꾸미다 죽으면 꾸밈만 끄고 재시도) |
| `runner/lib/plan.mjs` | `itemPartsOf`·`marksForItem`·`marksForCell`·`rowPartsOf` — 목록·표·FAQ 안의 마크 |
| `runner/channels/naver-blog.mjs` | `typeParts(op, prefix)` — 항목마다 R9 세 겹을 **다시 탄다** |
| `runner/channels/daangn.mjs` **신규** | 당근 새소식(세션 쿠키만 · 서식 0 · 수익 없음) |

### 🔴 이번에 밟은 것 — 같은 데서 또 넘어지지 말 것

| 함정 | 무엇이 일어났나 |
|---|---|
| 🔴 **변이표가 내 축의 구멍을 찾았다** | `deco ? l.motion : "none"` 를 **지워도 초록**이었다 — ① 무회귀 축의 층이 전부 `motion:"none"` 이라 **그 분기를 아무도 안 밟고 있었다.** «망가뜨리면 빨개지나»를 안 돌렸으면 영영 몰랐다. ⇒ **«되돌림» 축**(꾸미다 죽어 다시 구울 때 층엔 이미 모션이 박혀 있다)을 더해서 잡았다 |
| 🔴 **템플릿 리터럴 안의 백틱** | `ANALYZE_PROMPT` 안에 `` `captionMotion` `` 을 적었더니 **문자열이 그 자리에서 닫혀** tsc 가 셋을 뱉었다. 프롬프트는 백틱 문자열이다 — 안에서 코드 강조를 쓰지 마라 |
| 🔴 **셸이 정규식의 역슬래시를 먹는다(또)** | 하니스에 `/\[ovs[0-9]+\]/` 를 python heredoc 으로 넣었더니 `[ovs[0-9]+]`(문자 클래스)가 되어 **엉뚱한 것을 셌다**. ⇒ 하니스에 `s_count(hay, needle)` 를 두고 **역슬래시 없는 `split` 으로** 센다 |
| 🔴 **주석 들여쓰기를 눈대중으로 맞추면 치환이 0건** | `reference.ts` 의 주석 블록이 `   *` (공백 3)인데 ` *`(공백 1)로 찾아 `AssertionError`. ⇒ **줄 번호로 자르고 앵커는 «본문 한 조각»으로** |
| 🔴 **`downloadImages` 는 Map(주소→파일\|null)** | 배열인 줄 알고 `setInputFiles` 에 넘겼으면 `null` 이 들어가 **사진 첨부 실패가 아니라 잡 전체가 죽는다** |
| 🔴 **낡아 버린 축을 «고장»으로 읽지 마라** | `verify-runner-format` F-12c·`verify-reference-apply` 의 «모션은 묻지 않는다» 가 빨개졌는데 **코드가 틀린 게 아니라 축이 낡은 것**이었다. AC-101 대로 «어느 쪽이 정본인지»(= 설계)를 먼저 정하고 **축을 뒤집었다** — 그리고 뒤집을 때 **대조군을 같이 넣었다**(«안 버렸다»만 세면 «아예 안 읽었을 때»도 0 이라 거저 초록이다) |

### 열려 있는 것 (다음 세션이 이어받을 것)

| 무엇 | 누구 | 메모 |
|---|---|---|
| 🔴 **당근 탐침 1회** | B2 + 사장님 | `OWNER-CHECKLIST §5.3` 에 두 줄 써 뒀다. **쓰기를 안 하니 되돌릴 것이 없다.** 필요한 것 = 비즈프로필 + 로그인 1회(SMS) |
| 🔴 **러너 새 판 R2 업로드** | 사장님 | `runner/package.json` 을 **일부러 1.3.0 그대로 뒀다**(버전을 올리는 순간이 «배포하겠다»는 뜻이다). R12 러너 변경 = 4파일(`render-video`·`plan`·`naver-blog`·`daangn` 신규) |
| 🔴 **모션·전환을 «진짜 구워서» 재기** | C | 내 자는 **ffmpeg 인자**까지다. «프레임이 실제로 달라지나»는 C 가 베이스 판과 맞대 굽는다(그쪽 축이 ⊘ 면 아무도 그 칸을 안 읽는 것이다) |
| 🔴 **`.mjs` 292건** | 메인이 나눈다 | `docs/active/2026-09-17-mjs-typecheck-size.md`. **혼자 다 고치지 마라**(트리거 지시) · `TS2345` 52건부터 |
| 🔴 **`profile-seal.mjs` 가 갈래마다 다른 모양을 돌려준다** | B2 | `sealed`·`exists` 가 어떤 경로에선 늘 `undefined`(AC-56). 봉인 본체가 아직 없어 같이 볼 자리 |
| **틱톡 키** | 사장님 | 코드 몫은 **남은 게 없다** — `TIKTOK_CLIENT_KEY`/`SECRET` 만 꽂으면 가동 |
