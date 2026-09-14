# C 인수인계 — 검증·수리 세션 (2026-09-14 · R1~R4 완료 · R5 대기)

> 다음 C 세션이 **같은 수준으로** 이어받기 위한 문서. 먼저 읽을 것: `docs/rules/PARALLEL_GUIDE.md` · `CLAUDE.md §4·§6·§8` · `docs/rules/PITFALLS.md §0`(AC-1~30) · 이 문서 · 그 라운드 계약서.

## 1. 지금 상태

| | |
|---|---|
| 워크트리 | `C:/Users/Administrator/Desktop/작업/dev/AutoCreate-C` (git worktree · 여기서만 명령) |
| 브랜치 | **`verify/p1r5`**(HEAD = R5 하니스 뼈대) · 베이스 main `9dac3cc` |
| 머지 끝난 내 브랜치 | `verify/p1`(R1) · `verify/p1r2`(R2·R3·C6) · `verify/p1r4`(R4·C6-R4) — 전부 main 에 들어갔다 |
| 안 머지된 것 | `verify/p1r5` 의 하니스 뼈대 1커밋(코드 변경 0 · 기능 영향 0) |
| 라이브 | https://autocreate-endyd.netlify.app · 배포 #3 = main `0f3ec44` → 이후 `9dac3cc` |
| 내가 잡은 결함 | R1 6 · R2 5 · R3 0 · C6 1 · R4 9+DDL 1 · C6-R4 1 = **22건 + DDL 2**(전부 수리·머지) |

## 2. 검증 방식 정본 (이 순서를 지켜라)

### 2.1 로컬 서버 — 내 전용 포트 8901
다른 세션(메인·B·B2)이 8899를 쓴다. **절대 8899를 재사용하지 마라**(로그가 섞이고 누가 죽였는지 모른다).
```bash
# 워크트리 안에서
node -e 'require("fs").rmSync(".netlify",{recursive:true,force:true})'   # 캐시 빌드 오류가 나면 반드시 먼저
(SITE_URL=http://localhost:8901 CRON_BUDGET_MS=24000 FX_USD_KRW=1400 \
 npx netlify dev --port 8901 --functions-port 3998 --target-port 3997 \
 --command "node _verify/_static.mjs" --offline > /tmp/nd.log 2>&1 &)
until grep -q "Local dev server ready" /tmp/nd.log; do sleep 5; done; sleep 20   # 첫 함수 호출은 콜드스타트로 느리다
```
- `netlify dev` 는 정적 서버 포트 **3999를 고정으로** 잡는다 → 두 번째 인스턴스가 안 뜬다. 그래서 `--command "node _verify/_static.mjs"`(내가 만든 40줄 정적 서버) + `--target-port 3997` 로 우회한다. `_verify/` 는 gitignore.
- `SITE_URL` 을 **localhost 로** 줘야 배경 함수(`generate-*-background`)가 라이브가 아닌 내 서버로 간다. 안 그러면 «라이브에 없는 함수 404 → piece failed» 를 로컬 결함으로 오진한다.
- `CRON_BUDGET_MS=24000` 은 **로컬 전용**(내 PC→Neon 질의당 ~300ms). 프로덕션엔 설정 금지.
- `FX_USD_KRW` 가 없으면 AI 원가 상한이 «미환산 통과» 로 빠진다 — 그 게이트를 재려면 넣어라.
- 서버가 응답을 멈추면(30초 타임아웃 연발) 죽이고 `.netlify` 지우고 다시 띄운다.

### 2.2 크론
```bash
SEC=$(grep '^CRON_SECRET=' .env | cut -d= -f2-)
curl -s -X POST "http://localhost:8901/api/cron-run?every=hourly&tid=3&secret=$SEC"
```
- 🔴 **`?tid=` 필수**. 없으면 활성 테넌트 전부를 돌아 예산이 쪼개지고 숫자가 섞여 재현이 안 된다.
- `cron-tick-5m`·`cron-tick-hourly` 를 직접 부르지 마라(AC-12① · 프로덕션 차단 · 로컬은 빈 응답).
- 시각 게이트 우회 손잡이(테넌트 `settings`): `produceHour` · `trialNoticeHour` · `billingHour` · `revenueSyncHour` · `CHAIN_BUDGET_MS`(env).

### 2.3 테스트 테넌트 규칙
- 라이브 실행은 **테스트 테넌트만**(PITFALLS #8). 하니스는 실행마다 새 가입(`c+r4-<stamp>@autocreate.test` 식)을 만들고 끝에 정리한다.
- DB 손질은 **`ALLOWED` 집합에 든 tid 에만**(`guard(tid)`), 그 밖은 예외를 던진다. 이 가드를 지우지 마라.
- **정리(cleanup)까지가 검증이다**: 스모크가 만든 `invoices·coin_orders·coin_ledger·subscriptions·tickets·runner_jobs·ai_usage` 행과 `plan_key='pro'` 같은 상태를 되돌린다. R4 때 B·B2 스모크가 남긴 가짜 유료 8집이 **운영 대시보드 MRR 272,000원·전환 100%** 를 만들고 있었다.

### 2.4 보고 규율
- **증거 없는 «실증» 금지**(PITFALLS #5): row id · 라이브 URL · 스샷 경로 중 하나를 문장 옆에. 없으면 «스모크».
- 하니스 초록은 증거가 아니다(#9). 빨강은 3부류(진짜 결함 / 계약 갱신 뒤처짐 / 방어 강화 뒤처짐) — 가려서 처치.
- 로컬 인공물(AC-7 정적 폴백 405 · AC-12② 배경 함수 동기 실행 30초 500)을 프로덕션 결함으로 적지 마라. 헷갈리면 «로컬 한정 의심».
- 결함은 **내가 직접 수리**(PARALLEL §2.6). 진단만 던지지 않는다. 수리하면 `PITFALLS §0` 에 AC-N 추가까지가 수리다.
- **«이 게이트를 누가 부르나» grep 을 보고에 붙여라**(AC-29) — R4 에서 `requireFeature` 호출처가 0이었다. 새 게이트·새 잡 kind·새 상태 어휘는 **호출처 수를 세라**.
- 진행률 «📊 X%/100 — 방금/다음» 한 줄. 질문은 선택지+추천으로 모아서.

## 3. 하니스 지도 (`scripts/`)

| 파일 | 무엇을 재나 |
|---|---|
| `verify-p1r1.mjs` | R1 API: 계정·소재·디렉터·생성·검수·편성 — 키/타입 계약 대조 · 코인 멱등 · IDOR · 자격 평문 0 · 고지 첫 블록 · 이미지 200 |
| `verify-p1r2.mjs` | R2: 크론 6스텝+reap · 변수 8 · 슬롯 4경로+IDOR · 러너 큐(claim/report/release) · 발행 멱등·오프라인 · 계정 전이 · 알림함 · 발행함 |
| `verify-p1r3.mjs` | R3 수익: 수동 입력·KST·멱등·0원 vs 미수집 · 확정/예상 분리 · not_configured · 키 필드 · 러너 revenueRows/parse · TOP5 귀속 · ad-eligibility · learn 중립 · `.ad-slot` |
| `verify-p1r4.mjs` | R4 돈·운영: 동의·체험·코인 팩/환불 5규칙·구독 견적(부가세)·readonly 게이트·plan_limit/feature·운영 12메뉴·역할표·가격 개정·CS·원격접속·정리 |
| `verify-p1r5.mjs` | **R5 뼈대**(아래 §5) |
| `shot-p1r1.mjs` | 화면(고객 22 + 운영 16 · `OPS=1`): 헌장 자동 검사(Primary ≤1 · 큰 숫자 ≤1 · 이모지 0 · 시스템 용어 0 · 가로 넘침 0 · 콘솔/≥400 0 · **터치 44는 `elementFromPoint`** 로) · 스샷 `_shots/` |
| `verify-live-c6.mjs` | 라이브 R1~R3 회귀·시나리오(가입→온보딩→규칙→크론→슬롯·topics-refresh 소요) |
| `verify-live-c6r4.mjs` | 라이브 R4(체험 알림 크론·operator 403+감사·원격접속·채널 토글·정리) |
| `verify-b2-runner.mts`(B2 작) | 러너 셀렉터 실증 — `npx tsx --env-file=.env scripts/verify-b2-runner.mts naver_blog [--with-image]` · **임시저장까지만** · 종료코드로 판정(AC-14) |
| `verify-failover.mts`(B2 작 + C 케이스) | 계정 정지→승계 19/19 · (다) 한 주치 9자리·daily_cap 2 케이스는 내가 추가 |
| `_verify/*.mjs`(gitignore) | 일회용 DB 조회·정리 스크립트. 패턴: `.env` 읽기 → postgres → 조회/정리. 필요하면 새로 써라 |

## 4. 라이브 검증(C6) 절차
1. 메인이 «배포 완료 · main 해시» 를 알리면 시작.
2. `BASE_URL=https://autocreate-endyd.netlify.app` 로 해당 라운드 live 하니스 실행(없으면 새로 쓴다 — 20분).
3. 화면: `BASE_URL=... SHOT_DIR=_shots/live-<라운드> node scripts/shot-p1r1.mjs`(고객) · `OPS=1 OPS_USER=... OPS_PASS=...`(운영).
   - 🔴 **운영 촬영용 임시 super_admin 을 만들지 마라**(메인 지시). `operator` 1명만 만들고 끝나면 삭제. `admin` 비밀번호 변경(`ops-change-password`)은 **사장님 몫** — 치지 마라.
4. 끝나면 스모크 행 정리 → 보고서 «라이브 절» → 메인에 [브랜치·해시·증거] 보고.

## 5. R5 검증 계획 (계약 `docs/active/2026-09-15-P1R5-contract.md` v5.2 · 하니스 `scripts/verify-p1r5.mjs`)
**손잡이(메인 확정)**: ① dev 서버 env `VIDEO_PROVIDER_STUB=1`(provider·TTS·비전 스텁 · ai_usage 원가 0) ② `CHAIN_BUDGET_MS`(기본 660000 · 이어달리기 재현은 **30000** 으로 2회차 실행) ③ 슬롯 없는 자동 생성은 새 손잡이 없이 `confirm({origin:"auto"})` 를 slotId 없이(HTTP 밖 — `npx tsx` 로 lib 직접 호출) → `piece_slotless_blocked` 감사.

절 12개(`SECTIONS=`): `setup`(kinds video·코인 60·유튜브 OAuth 정직) → `topics`(`topics-reference`→`shorts_templates` · 영상 힌트 후보) → `director`(PieceSpec.video · **코인 구간제** `videoCoinItem` · 확정 1회 · 이미지 ref 0 · 재확정 0 · 달러 캡 선검사) → `chain`(chainStage 전이 · piece_assets audio/clip 즉시 저장 · ai_usage 3 purpose · **잠금 20분 안 중복 호출 → ai_usage 증가 0**) → `sweep`(20분 침묵 → 재디스패치 · 상한 3 → failed+사유+환급+알림 · stage render 는 무접촉) → `cost`(테넌트 $30 → `step:"budget"` 코인 무접촉 · `feature_flags video=false` → killed · fail-closed) → `rules`(kind shorts 주 2 → coinsPerWeek 56 · 슬롯 점) → `disclosure`(배지·시작 자막·설명란 첫 줄) → `fingerprint`(pHash ≤10) → `posts`(**`uploaded_private` 16자 칸 폭** · `runner_jobs.kind` ≥22 · `piece_assets.kind`) → `regress`(글 파이프·타 테넌트 404·평문 0) → `cleanup`.

**라이브 «돈 쓰는» 실증 1회**(메인이 부를 때만): 테스트 테넌트 + 유튜브 **테스트 채널**에 60초 1편 — ① 스텁 끄고 실제 provider ② `chainStage` 로 진행 관측 ③ 러너(ffmpeg) 렌더 → R2 `HEAD 200` ④ 심사 등급 ⑤ 승인→발행 → **`posts.status='uploaded_private'`** + videoId ⑥ 증거(videoId·R2 키·스샷 경로)를 보고서에. 🔴 공개 업로드 금지 · 1회만(원가) · 끝나면 영상 행 정리.

## 6. 보존 테넌트 — 🔴 지우지 마라
| tid | key | 무엇 | 이유 |
|---|---|---|---|
| **3** | `cp1-yn9n4m` (`c+p1@autocreate.test`) | 내 주 테스트 테넌트(계정 4·자격 5·수익 소스 5) | R1~R3 하니스가 이 집을 재사용한다(계정·소재·슬롯 있음). 지우면 R1~R3 재현 준비에 30분 더 든다 |
| **13** | `cp1b-ak9fbc` (`c+p1b@autocreate.test`) | IDOR 대조군(빈 집) | 모든 하니스의 «타 테넌트» 검사가 이 계정으로 로그인한다 |
| **109** | `b2ver1789371667998` | B2 러너 검증 — **티스토리 세션 쿠키** | 사장님이 직접 2단계 승인해 만든 세션. 지우면 사람이 다시 로그인해야 한다(AC-13) |
| **116** | `adpost1789375259665` | B2 애드포스트 스크랩 — 네이버 세션 + `revenue_sources` | 같은 이유. **plan_key='pro' 는 의도된 것**(runnerRevenue 기능 게이트 때문) — 라이브 대시보드 MRR 49,000원은 이 집이다. 건드리지 말고 보고서에 «검증용 1집» 이라고 적어라 |
| 20·27·29·33·38 | `b2smoke*` | B2 옛 스모크(계정 2·자격 2씩) | B2 가 관리. 내가 지우지 않는다 |
- 그 밖의 `r4smoke*`·`smokelive*`·`cc6*`·`cr4*`·`c+r5-*` 는 **내가 만든 것 = 내가 지운다**(돈·CS 행 먼저, 테넌트 행은 FK 때문에 남겨도 된다 · plan/status 는 trial 로 되돌린다).

## 7. 내가 세운 함정(PITFALLS §0) — 새 C 가 이어서 번호를 붙인다
- **AC-16** 착수 호출(배경 함수) 실패를 삼키면 «영원히 만드는 중» — 실패는 상태+환급+알림 · 실패 처치는 한 왕복(CTE) · 이미 갇힌 것에 탈출구.
- **AC-23** `BETWEEN … AT TIME ZONE …` 는 Postgres 문법 오류 · `date + $1` 은 `::int` 캐스팅. 새 SQL 경로는 **실호출 1번이 tsc 보다 값지다**.
- **AC-24** «오늘 남은 칸» 을 «앞으로의 자리 전체» 예산으로 쓰지 마라 — 여유는 날짜별 · 못 옮긴 건수는 알림에 숫자로.
- **AC-25** `retriable:false` ≠ «사람이 볼 필요 없다» — 종결 여부와 «누가 다음 행동을 하나» 는 별개 축.
- (메인이 올린) **AC-28** bigint 는 문자열로 온다(=== 비교 전 `Number()`) · **AC-29** 새 게이트는 **호출처 수를 세라** · **AC-30** 식별자 칸 폭.

## 8. 보고서 위치
`docs/history/2026-09-14-P1R1-C-report.md`(R1·C4) · `…-P1R2-C-report.md`(R2·R3·라이브 C6) · `…-P1R4-C-report.md`(R4·라이브 C6-R4). R5 는 `docs/history/2026-09-15-P1R5-C-report.md` 로.
