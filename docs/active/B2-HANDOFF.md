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
| 러너 배포 | R2 `autocreate/runner/v1.1.6.zip` · 고객은 `/api/runner-download`(로그인·플랜·presigned 10분)로만 받는다 |
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
| **`SITE_URL` 로 자기를 부르면 라이브에서 돈다** | 로컬 스텁을 켜도 배경 함수는 라이브에서 실행 → 실제로 $3.63 이 나갔다(AC-53). 자기 호출은 `backgroundBase()` |
| **압축 풀린 크기로 트래픽을 재면 3~5배 부푼다** | CDP `encodedDataLength` 로 재야 한다. 가정(20~40MB)이 실제로는 **9~10MB** 였다 |
| **DDL 번호는 «파일 만들기 직전에» 확인** | `ls | tail -1` 을 보고도 파일을 먼저 써서 두 번 겹쳤다(AC-49) |
| **셸이 역슬래시를 먹는다** | `sed`·`perl`·`node -e` 가 조용히 0건 치환. **바꾼 개수를 찍어** 확인해야 한다 |

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
| `verify.post_alive` 를 **만드는 코드** | B2 | 종류·처리·러너 채널은 다 있는데 **enqueue 0건** — 발행 성공 7일 뒤 1회(메인 결정) |
| API 채널 dispatcher 실가동 | B2 | 자리는 있다 · `undici` 의존성 추가 여부는 메인 결정 |
| 셀렉터 표 서버 배포(1단계) | B2 | R7 계약에 «카나리 통과판만 + 실패 시 묶여 온 표로 복귀» 문장으로 들어감 |
| 팜 관리 화면(대수·배정·모니터) | A | 다음 라운드 |

## 6. 재개 절차

```
cd AutoCreate-B2 && git fetch && git merge main
npx tsc --noEmit -p tsconfig.json                 # resvg 오류 1건은 기존 것(무시)
npx --yes tsx --env-file=.env scripts/verify-runner-dist.mts    # 28항목 · 스스로 테넌트 만들고 지운다
```
- 러너를 고쳤으면 **판 올리고 배포**: `runner/package.json` version +1 → `scripts/build-runner.mts` → 설치된 러너가 자동으로 받는다.
- 🔴 새 실증 테넌트를 만들면 `verify-runner-dist.mts` 의 `TEST_KEY` 에 **먼저** 넣는다(안 넣으면 teardown 이 안 지운다 — 실제로 t237 이 남았었다).
