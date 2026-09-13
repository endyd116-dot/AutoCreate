# PARALLEL_GUIDE.md — 4채팅 병렬 작업 규칙 (AutoCreate)

> AM(AutoMarketing) PARALLEL_GUIDE 이식(2026-09-14). MIS→AM에서 검증된 모델. 새 라운드 시작 시 메인 정독. A·B·C는 시작 시 본 문서 + `CLAUDE.md` + `docs/rules/PITFALLS.md` 상단 + 설계서 본인 § 정독.

## 1. 역할·영역

| 채팅 | 모델 | 역할 | 변경 영역 | 금지 영역 |
|---|---|---|---|---|
| **메인** | Opus | 설계·머지·조율·**push 단독** | `docs/active/`, `PROJECT_STATE.md`, 머지 커밋 | 코드 직접 구현(설계만·사소한 즉답 fix 예외) |
| **A** | Sonnet | 프론트 | `public/**`, `assets/**` | `lib/`, `netlify/`, `db/`, `drizzle/`, `runner/` |
| **B** | Sonnet | 백 | `netlify/functions/`, `lib/`, `db/schema.ts`, `drizzle/`, `runner/`, `scripts/`, `package.json`, `.env.example` | `public/`, `assets/` |
| **C** | Opus | 검증·fix·백필 | 전 영역(fix·검증보고 한정) | 신규 기능 추가 |

> A·B 둘 다 `PROJECT_STATE.md`·`docs/` **수정 금지**(머지 충돌). 상태는 메인에 보고 텍스트로만.
> 러너(`runner/`)는 B 영역이다. 러너 «화면»(트레이 앱 UI)이 생기면 그때 A/B 경계를 트리거에 명시.

## 2. 머지 순서 (강제)
```
B 백 머지 → DDL 적용(scripts/neon-migrate.mjs) + schema.ts 갱신 확인
 → A 프론트 머지 → C 검증 → C fix(있으면) 머지 → 메인 라운드 마감
```
- 어기면: A 먼저=호출할 백 없음 / DDL 전 schema 활성화=drizzle SELECT 깨짐.
- **B 머지 전**: B 응답 키 ↔ A mock 키 1:1 일치 확인.

## 2.5 🔴 A·B 동시 발사
**A와 B는 같은 라운드에서 «동시에» 발사한다.** 순차는 한쪽이 노는 시간이 낭비다. 이름 충돌은 순서가 아니라 **계약**으로 막는다:
1. 키 이름을 **실제 글자로** 적는다 — «A가 정한다»·«적절히»는 계약이 아니다.
2. 🔴 그 이름이 라이브에 이미 쓰이는지 **`grep`으로 먼저 확인**한다.
3. GET 투영 키와 body 키를 **양쪽 다** 적는다(이름·모양·«없으면 키를 안 싣는다»까지).
4. A·B 트리거의 계약 코드블록은 **정본과 바이트 일치**.
> 어긋나면 메인이 머지에서 봉합(관례: A 이름 정본·B 이름 폴백).

## 3. 워크트리 (필수)
```
AutoCreate          메인   main
../AutoCreate-A     A      feature/<round>-front
../AutoCreate-B     B      feature/<round>-back
../AutoCreate-C     C      verify/<round> | fix/<이름>
```
- 셋업: `git worktree add ../AutoCreate-A -b feature/<round>-front main` (최초 1회) · 이후 `cd ../AutoCreate-A; git checkout -B feature/... main`.
- 베이스 = **로컬 `main` HEAD**(설계 포함). 워크트리 공유라 origin push 불필요.
- A·B·C 워크트리는 `node_modules`를 각자 설치(`npm ci`).

## 4. 자율주행 정책 (전원)
모든 트리거 상단에 이 블록을 그대로 넣는다:
```
[자율주행 — 완전 자율]
- 파일 R/W/Edit, git(add·commit·checkout·merge·rebase·fetch·restore·worktree), bash·PowerShell, npm install/run, npx, curl(검증) — 전부 묻지 말고 자율 실행. 도구 허락 구하지 말 것.
- 커밋 자유. push 불필요 — 메인이 공유 git에서 너의 로컬 브랜치를 직접 머지·배포함. 끝나면 [브랜치·커밋해시·변경요약]만 보고. "push 막혔다/직접 해달라" ❌ (정상이니 그냥 보고).
- 오직 ①진짜 애매한 로직·기능 해석 ②중요한 워크플로우/아키텍처 결정 ③비가역 위험작업(force push·reset --hard·DB drop)일 때만 멈추고 질문.
- 막히면 30분 안에 보고.
[진행률 보고 — ★의무] 시작 0%부터 섹션 착수·완료마다 "📊 진행률 X%/100 — 방금: … / 다음: …" 한 줄을 텍스트로. 최소 4~5회. 완료 시 100% 한 번만 찍는 것은 위반. % 값은 트리거 섹션 제목의 % 지도에서 읽는다(계산 금지).
```
> ★ **% 지도 의무**: 메인은 트리거의 각 섹션 제목에 % 구간을 직접 배정한다(`## B1 (0→25%)`). % 지도 없는 트리거 = 메인의 작성 미준수.
> push/배포: `main` push(=실배포)는 메인 단독. A·B·C settings는 routine 도구 allow + `main` push deny.

## 5. 자체 검증 (메인 보고 전)
- **B**: `npx tsc --noEmit` 통과 / schema import 누락 점검 / `export const config = { path }` / DDL 멱등 / jsonb `sql.json` / tenant 스코프.
- **A**: 화면 진입·동작 / 캐시버스터 갱신 / 콘솔 에러 0 / **`ac.css` 토큰·12 컴포넌트만 사용** / 헌장 §13.0 체크(색 3·숫자 1·Primary 1) / 폰 400px·데스크톱 1280px 둘 다.
- **C**: §시나리오 라이브 / 회귀(로그인·기존 화면) / 사용자 동작·결과 위주 보고.

## 5.5 🔴 보고 어휘 규칙
- **«실증»·«라이브 확인»·«완주»는 증거 동반 시에만** — 라이브 URL·원장 row id·스샷 경로 중 1개를 그 문장 옆에. 없으면 **«스모크»·«로컬 재현»**.
- 함정을 밟았으면 수리 커밋과 같은 배치로 `PITFALLS.md` §0에 AC-N 추가 — 그것까지가 수리다.
- 브랜치 시작 전 자기 베이스가 로컬 main HEAD인지 확인.

## 6. 컨벤션 핵심 (CLAUDE.md §4 전문)
- API: try/catch step·detail·stack / `export const config={path}` / `requireAdmin`→`auth.res`.
- schema: B만·append-only·`/* === Phase N R M === */`.
- 멀티테넌트: 모든 쿼리 `tenant_id`.
- AC 절대 게이트(§4.7): 슬롯 없는 자동 생성 금지 · 코인 piece당 1회 · 발행 멱등 · 자격 암호화 · 제휴 고지 · 계정 캐던스.
