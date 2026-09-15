# CLAUDE.md — AutoCreate 프로젝트 가이드

> 새 대화 시작 시 자동 로드. Claude(메인·A·B·C)가 이 프로젝트에서 따라야 할 정책·구조·관습.
> AM(AutoMarketing)의 검증된 규칙을 이식했다. 병렬 규칙 [`docs/rules/PARALLEL_GUIDE.md`](docs/rules/PARALLEL_GUIDE.md) · 함정 [`docs/rules/PITFALLS.md`](docs/rules/PITFALLS.md) · 트리거 양식 [`docs/rules/TRIGGER-TEMPLATE.md`](docs/rules/TRIGGER-TEMPLATE.md) · 설계 정본 [`docs/DESIGN.md`](docs/DESIGN.md).

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 이름 | **AutoCreate(AC)** — 다계정 글·영상 자동 생성·발행 + 수익 통합 SaaS |
| 본질 | **"개인의 수익 공장"** — 소재(AI 트렌드) → 디렉터(채널·계정·감성·구성·일정) → 제작 → 검수 → 편성표대로 자동 발행 → 광고·제휴 수익 한 곳에서 |
| 대상 | 부수입을 원하는 개인(계정 2~30개) · 소규모 대행(Agency) · 운영자(싸이렌MIS SSO) |
| 관계 | AM의 엔진(소재·디렉터·글·이미지·쇼츠·러너·코인·SSO·AI 모델 관리)을 **파일째 이식**. 광고 집행·리드·너처링은 가져오지 않는다 |
| 설계 정본 | [`docs/DESIGN.md`](docs/DESIGN.md) — §2 채널 매트릭스 · §5 디렉터 · §5B 편성표 · §7 다계정 · §8 러너 · §9 수익 · §10 AI 버전 · §12 가격 · §13 UI |
| 라이브 | https://autocreate-endyd.netlify.app · GitHub `endyd116-dot/AutoCreate` |

---

## 2. 기술 스택 (AM·MIS와 동일 — 엔진 재사용 전제)

| 영역 | 기술 |
|---|---|
| Frontend | Vanilla HTML/CSS/JS **모바일 퍼스트 PWA** + 디자인 시스템 `public/css/ac.css` · 컴포넌트 12개 `public/js/ui.js` |
| Backend | Netlify Functions v2 (Node 20) · TypeScript |
| DB | Neon PostgreSQL + Drizzle ORM (독립 인스턴스) |
| Auth | JWT(httpOnly 쿠키) + bcryptjs · 싸이렌MIS 허브 SSO(aud `autocreate`) |
| AI | Gemini — 🔴 모델명은 `lib/ai-models.ts` **한 파일에만** · DB 오버레이 `ai_model_overrides`로 무배포 갱신 |
| 러너 | Node + Playwright + ffmpeg (`runner/`) · 계정별 브라우저 프로필 |
| 스토리지 | Cloudflare R2 · 결제 KICC(AM `kicc.ts`) · 코인 AM `coin-ledger.ts` 그대로(1코인=₩500) |
| Cron | Netlify Scheduled `cron-tick-5m`·`cron-tick-hourly` 우산 + GitHub Actions 보조 |

> **재사용 원칙**: `lib/*`는 AM에서 복사할 때 **헤더 주석에 «AM 원본 경로·복사일»을 남기고** 수정 범위를 명시한다. AM에서 고친 버그가 AC에도 있는지 추적하려면 출처가 있어야 한다.

---

## 3. UX/UI 표준 (필수 — 사장님 지시 2026-09-14 «깔끔·세련·심플 · 기능은 전적으로 토스형»)

- **헌장 = DESIGN.md §13.0** (깔끔·세련·심플을 반려 가능한 규칙으로): 화면당 색 3개 · 카드 대신 **그룹 섹션**(회색 바탕 위 흰 R20·테두리·그림자 0) · 첫 화면 숫자 1개 · Primary 버튼 1개 · 옵션은 바텀시트 · 설명 한 문장 · 8px 그리드 · 모션 한 방향.
- **토스 패턴 사전 = DESIGN.md §13.0b**: 모든 기능은 표의 토스 패턴 중 하나로 만든다(온보딩=한 화면 한 질문 · 계정 연결=계좌 연결 · 디렉터=송금 확인 · 편성표=소비 캘린더 · 수익=내 소비 …). **표에 없는 패턴은 표에 먼저 추가.**
- **시안 정본 = `docs/screens-v3.html`** — 구현은 이 픽셀을 따른다. 토큰: DESIGN.md §13.4.
- **금지**: 이모지 아이콘 · 그라데이션 히어로 · 다색 차트 · 팝업 모달 · 툴팁 설명 · 대시보드식 위젯 격자 · 시스템 용어(«테넌트» «러너 잡» «piece»).
- **말은 사람말**: «편성표» «내 계정» «오늘 12,400원 벌었어요». 문장형 헤드라인.
- 폰트 Pretendard. 라이트 우선·다크 토큰 동시 정의. 반응형 3구간(DESIGN.md §13.3b) — 앱·웹은 하나의 코드.

---

## 4. 코딩 컨벤션 (AM·MIS 검증 표준 — 필수)

### 4.1 API 응답
```typescript
return jsonError("select_pieces", err);   // { ok:false, error, step, detail, stack } status 500 (lib/response.ts)
return json({ ok: true, pieces });
```
- 단계별 try/catch + step 라벨. 보조 SELECT 실패는 빈 배열로 계속.

### 4.2 라우팅
- 모든 `/api/*` 함수에 **`export const config = { path: "/api/xxx" }`** (누락 시 404).

### 4.3 인증·권한
- httpOnly 쿠키 — `document.cookie` 체크 금지, 첫 API 401로만 판정.
- `lib/admin-guard.ts requireAdmin` → `if (!auth.ok) return auth.res;`
- 고객 핸들러는 `tenantScoped` + `tenantAllowed` 전수. 운영 핸들러는 super_admin.

### 4.4 schema.ts (B 전용·append-only)
- **B만** `db/schema.ts` 수정. 파일 끝 `/* === Phase N R M === */` 헤더 후 추가. 다른 라운드 정의 덮어쓰기 금지.
- schema.ts 정의는 **DDL 적용과 동시에**.

### 4.5 DB 변경 (Neon 직접 제어 · migrate 엔드포인트 없음)
- **추가형 DDL = 자율**: `node scripts/neon-migrate.mjs <file.sql>` (IF NOT EXISTS·멱등·DROP/DELETE/RENAME 자동거부).
- ⚠️ **`drizzle-kit push` 금지**. 추가는 surgical DDL로만.
- 🔴 **jsonb 쓰기 = `sql.json(obj)`만** (PITFALLS #1). 쓴 직후 `jsonb_typeof()` 확인까지가 쓰기다.
- 파괴적 DDL·라이브 데이터 변경·공개 토글은 **사장님 승인 후**.

### 4.5b 시각 — 🔴 저장 UTC · 표시 KST 전면(DESIGN §13.5)
- 화면은 `UI.timeKST/dateKST/ago`·`OPS.dt` 만 사용(timeZone 고정). timeZone 없는 `toLocale*`·`datetime-local`·`getHours()` 업무 판단 금지.
- 서버의 오늘·주·월·마감·produceHour 판정은 KST(SQL `AT TIME ZONE 'Asia/Seoul'` 또는 `lib/cron/base.ts` 소도구). 크론 표현식은 UTC, 업무 시각은 스텝 안에서 KST 판정.
- 메일·알림 문구의 시각도 KST. 내보내기는 «(KST)» 표기.

### 4.6 멀티테넌트
- 모든 도메인 테이블 `tenant_id`. 모든 쿼리·발행·집계 tenant 스코프. 교차 누수 금지.

### 4.7 절대 게이트 (AC 고유)
- **슬롯 없는 자동 생성 금지** — 자동 경로가 piece를 만들려면 편성표 슬롯을 말해야 한다(`content-slot-gate`). 거부는 audit + 홈 «해야 할 일»에 남긴다(조용히 0건 금지).
- **코인은 piece당 1회**(멱등 ref). 재생성·수리·승계 무료.
- **발행 멱등** — `channel_ref`/`external_url` 있으면 재게시 금지.
- **계정 자격은 AES-256-GCM(`CREDS_ENC_KEY` 폴백 없음)** · 평문 표면 2곳(러너 claim·운영 열람+감사)뿐.
- **제휴 링크 = 고지 문구 자동 삽입** · 발행 직전 금칙어·고지 재검사.
- **계정 캐던스**(daily_cap·min_gap) 초과 예약 금지 · 같은 채널 계정 간 30분 간격.

### 4.8 «완료»의 정의 = 화면에서 쓸 수 있을 때
- 옵션·모드를 만들면 **고르는 UI까지**가 그 기능. API로만 실증한 기능은 없는 기능.
- 라운드는 A(프론트)·B(백) 트리거를 짝으로. UI 불필요면 사유를 트리거에 명시.

### 4.9 AI 모델
- 모델 이름 문자열을 `lib/ai-models.ts` 밖에 적지 않는다. 목록에 있다고 쓰지 않는다 — `scripts/verify-ai-models.mjs`로 **우리 키로 불러 보고** 넣는다.

---

## 5. 병렬 작업 (메인·A·B·C)

[`docs/rules/PARALLEL_GUIDE.md`](docs/rules/PARALLEL_GUIDE.md) 정독. 요약:

| 채팅 | 역할 | 영역 | 브랜치 |
|---|---|---|---|
| 메인 | 설계·머지·조율·**push 단독** | `docs/active/`·`PROJECT_STATE.md`·머지 | `main` |
| A (Sonnet) | 프론트 | `public/`·`assets/` | `feature/...-front` |
| B (Sonnet) | 백 | `netlify/functions/`·`lib/`·`db/`·`drizzle/`·`runner/`·`package.json` | `feature/...-back` |
| C (Opus) | 검증·fix·백필 | 전 영역(fix 한정) | `verify/...` `fix/...` |

- **머지 순서(강제)**: B → DDL + schema.ts → A → C.
- **A·B 동시 발사**. 계약의 키 이름은 글자 그대로 적고 `grep`으로 라이브 충돌 확인.
- **A·B·C는 commit만·push 금지. 메인도 배치 push**: push 1회 = 배포 = 비용. 검증 끝난 기능 묶음일 때만(≤2~3회/일). docs·메모리·소변경 = commit만.
- 워크트리: `../AutoCreate-A/B/C`. 베이스 = 로컬 `main` HEAD.
- **FIX 라운드 = 진단(메인/C)과 실행(A/B/C 분배) 분리.**
- **압축(컴팩션) 시 무조건 먼저** PARALLEL_GUIDE · CLAUDE §5·§4·§6 · PITFALLS 상단을 읽고 재개.
- **PC 이관**: 메모리는 git 밖 — 유효한 메모리는 `docs/rules/MEMORY-PORTABLE.md`에 원문으로 둔다.

---

## 6. 자율성 (사장님 위임 — 전원 적용)

**완전 자율이 기본.** 오직 ①진짜 애매한 로직 해석 ②되돌리기 어려운 아키텍처 결정 ③비가역 위험작업(force push·reset --hard·DB DROP·운영 결제 전환)일 때만 멈추고 질문.
- 자율: 파일 R/W/Edit, git(add·commit·checkout·merge·rebase·fetch·restore·worktree), npm/npx, bash·PowerShell, curl, 메모리, 서브에이전트.
- `main` push(=실배포)는 메인 단독. A·B·C는 끝나면 **[브랜치·커밋해시·변경요약]만 보고**.
- 질문은 모아서 **선택지+추천**·한국어·로직/사용자 시나리오 위주. **진행률 % 한 줄**(트리거의 % 지도대로). 막히면 30분 안에 보고.
- 보고 어휘: **«실증»·«라이브 확인»은 증거(URL·row id·스샷) 동반 시에만**. 없으면 «스모크».

---

## 7. 환경변수 · 원격 제어
`.env.example` 참조. 핵심: `NETLIFY_DATABASE_URL` · `JWT_SECRET` · `SSO_SHARED_SECRET`(aud autocreate) · `CREDS_ENC_KEY` · `GEMINI_API_KEY` · `RUNNER_TOKEN_SECRET` · `KICC_*` · 채널 OAuth 앱 키.
- 메인은 Neon API·Netlify API 직접 제어(DDL·env·재배포). 키는 메모리 [[neon-netlify-remote]] + `docs/rules/MEMORY-PORTABLE.md`.

## 8. 🔴 전본 개발 규칙 (사장님 전역 지시 2026-09-14 — 최우선)

**설계도(`docs/DESIGN.md`) 대비 누락·왜곡·축소·요약 없이 전본을 개발한다.**
- 라운드/Phase 로 **순서**는 나눌 수 있다. 그러나 **내용**은 깎지 않는다 — 설계의 표·필드·규칙·게이트·변수 하나하나가 코드와 화면에 그대로 있어야 한다.
- 메인은 트리거마다 **«설계 대비 범위 지도»**(DESIGN §번호 → 이번 라운드 / 다음 라운드 / 외부 선결조건)를 적는다. 지도에 없는 설계 항목 = 누락 = 메인의 작성 미준수.
- A·B·C 는 «간단히» «축소판» «폴백으로 대체» «이번엔 생략» 을 쓰지 않는다. 설계에 있는데 못 만들면 **사유와 함께 보고**하고 지도에 남긴다(조용한 축소 금지).
- 외부 선결조건(앱 심사·키 발급 등)으로 막힌 항목은 코드·화면을 **먼저 완성**하고 «키 꽂으면 즉시 가동» 상태로 둔다(AM KICC 관례).
- 설계 자체를 바꿔야 할 때는 먼저 DESIGN.md 를 고치고(사장님 승인) 그 다음 코드.

---

## 9. 🔴 게이트 최소화 (사장님 전역 지시 2026-09-15 — 최우선)

> 사장님: **«모든 개발 규칙에는 «게이트는 최소화하라»를 전제로 깔아라. 너무 엄하게 게이트 잡을 필요 없다.»**

> 🔴 **보강(사장님 2026-09-15 · 같은 날 두 번째)**: **«플랫폼 정책이 무슨 법도 아니고 계속 변동되고 바뀌는 걸 우리가 무슨 수로 제약해. 제약할 의무도 없고.»**
> ⇒ 내가 처음 적은 «①법·플랫폼 정책 위반»은 **칸을 잘못 그은 것**이었다. 둘은 다르다. **플랫폼 정책은 하드가 아니다.**

**하드(막는다)로 둘 수 있는 것 — 이것뿐이다.**

| 하드 | 왜 |
|---|---|
| **대한민국 법령 위반** | 대가 고지(표시광고법·공정위 심사지침) · 거짓·과장(표시광고법) · **의료법 §56 환자 치료경험담**(형사처벌) |
| **제3자가 다치는 것** | 저작권·초상권(스톡 사람·상표 · 고객이 올린 남의 사진) — 🔴 **고객의 선택으로 남을 수 없는 유일한 것**이다. 침해는 **우리 도구로** 일어나고 통지는 **우리에게** 온다 |
| **되돌릴 수 없는 것** | 한 번 나가면 못 주워 담는 것 |

🔴 **플랫폼 정책은 전부 소프트다.** 애드센스 클릭 유도 · 네이버 제휴 링크 수 · 저품질/중복 · 자동화 약관 — **법이 아니고, 수시로 바뀌고, 우리가 고객 대신 지킬 의무도 없다.**
**우리가 하는 일은 «말해 주는 것»이다** — «이렇게 쓰면 애드센스가 정지시킬 수 있어요» 한 줄. **고르는 것은 고객이다.** 그 계정은 고객 것이다.

**나머지도 전부 소프트다.** 품질 · 모양 · 분량 · 반복 · 빈도 · 골격 · 시각 요소 최소치 · 링크 열림.

- 🔴 **막으면 공장이 선다.** 고객이 «알아서 올려»를 켰는데 우리가 조용히 안 올리면 **그게 더 나쁘다.** 고객이 못 고치는 것 앞에서 멈춰 세우는 게이트는 기능이 아니라 고장이다.
- 🔴 **새 게이트의 기본값은 소프트다.** 하드로 하려면 위 표의 어느 칸인지 **한 줄로 적는다.** 못 적으면 소프트다. «플랫폼이 싫어한다»는 근거가 **아니다**.
- 🔴 **계약의 «최소치»도 게이트다.** `visualMin` 처럼 «몇 개 이상»을 요구하는 값은 **숨은 하드 게이트**다 — 계약의 다른 부분(`tiers.optional`)과 싸우면 **매번 재작성이 돌아 돈이 두 배**로 든다(2026-09-15 blogger·wordpress `faq` 실제 사례).
- 🔴 **막는 대신 말한다.** 위험은 고객에게 **문장으로** 주고 고르게 한다(간격·새벽·새 계정·플랫폼 정책). 우리가 대신 정하지 않는다.
- 🔴 **«아직 모른다»로 막지 않는다.** 표본이 없어 판정을 못 하는 축은 **통과**시키고 «못 쟀어요»라고 적는다(AC-9·AC-60).
- 🔴 **«없는 길»은 이 규칙 밖이다.** 커넥터가 없어 못 올리는 것·유튜브를 못 내리는 것은 «게이트»가 아니라 **사실**이다. §9 는 «없는 길을 열라»는 뜻이 아니다 — **있는 길을 우리 판단으로 막지 말라**는 뜻이다.
- 소프트 축은 화면이 **«막지 않아요»**를 함께 말한다(A `UI.GATE_HARD` ↔ 서버 `HARD_GATE_KEYS` · 하니스 대조).
**이 규칙은 §8(전본 개발)과 충돌하지 않는다** — 설계의 항목은 전부 만들되, **그 항목을 «막는 것»으로 만들지 말라는 뜻**이다.

---

**마지막 업데이트**: 2026-09-15 (§9 게이트 최소화 — 사장님 전역 지시)
