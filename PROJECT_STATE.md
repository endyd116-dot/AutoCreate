# PROJECT_STATE.md — AutoCreate 작업 상태 (휘발성)

> 라운드 종결·상태 변경 시 메인이 즉시 갱신. 새 채팅(특히 메인)은 이 파일 + `CLAUDE.md` + `docs/DESIGN.md` §0 정독.

## 1. 개요
- **AutoCreate(AC)** — 다계정 글·영상 자동 생성·발행 + 수익 통합 SaaS(토스형). AM 엔진 이식.
- 라이브: https://autocreate-endyd.netlify.app (GitHub `main` push → 자동 배포) · 아직 빈 사이트(README만).

## 2. 현재 상태 (2026-09-14)
- ✅ GitHub·Netlify 연동 · 설계서 v8(`docs/DESIGN.md` — §5C 고도화·§16B 정책·§11.0 로그인·§11.4 종합 운영센터·§12.3 14일 체험·§19 체크리스트) · 화면 시안 v3(`docs/screens-v3.html`) · 웹 시안(`docs/screens-web-v1.html`)
- ✅ 작업 규칙 이식: `CLAUDE.md` · `docs/rules/{PARALLEL_GUIDE,PITFALLS,TRIGGER-TEMPLATE,MEMORY-PORTABLE}.md` · `.claude/settings.json`
- ✅ **라이브 배포**(2026-09-14 `d2a4994`): https://autocreate-endyd.netlify.app — 가입·홈·admin 로그인·대시보드 라이브 스모크 통과.
- ✅ **Phase 0 뼈대 코드**(2026-09-14): Neon `old-tree-90235056` · 스키마 v1(40표) · AM 코어 이식(response·sso-role·ai-models·kicc·billing-math·coin-table) · 인증(고객 9·운영자 4) · 종합 운영센터 API 8 · 앱 11화면 · 운영센터 6화면 · 시드(admin·플랜·채널·감성) · 로컬 스모크 통과
- ⏳ **사장님 할 일**: 라이브에서 `admin` / `admin1234` 첫 로그인 → 비밀번호 변경. Q1~Q5·Q7 은 기본 가정으로 진행 중.

## 2.5 진행 중 — P1R2 (2026-09-14)
- 계약 `docs/active/2026-09-14-P1R2-contract.md` v2.7 · 트리거 A/B/B2/C
- **머지 완료**: A(프론트 · abe602a) · C 의 P1R1 수리 4건 + 하니스(b23efa2) · 로그인 화면 개편(808bb14)
- **진행 중**: B(크론 B5·B6·알림함) · B2(러너 드라이런 실증)
- 🔴 **미배포** — 사장님 지시: 라운드 끝에 묶어서 배포
- 인수인계 정본: `docs/rules/HANDOFF.md` · 압축 재개 트리거: `docs/active/RESUME-TRIGGER.md`

## 3. 다음 할 일
1. **Phase 0 마감(잔여)**: tbfa-mis 커밋 `ed374ee4`·`71d0d5c3`(sso-autocreate + 허브 카드 ⑥) **push 는 사장님 배포 타이밍** — MIS env(`AUTOCREATE_SSO_SECRET`·`AUTOCREATE_URL`)는 등록 완료(201). push 후 허브 카드 → AC 운영센터 SSO 라이브 확인.
2. **Phase 1 글 MVP**(A/B/C 병렬 · 트리거 `docs/active/`): 소재(content-topics 이식+네이버 검색량) → 디렉터 → 글·이미지 생성(content-gen·writing-contracts·ai-tell-gate) → 검수 → 편성표(cadence_rules·slots 크론) → 네이버 블로그 러너 · 블로거 API · 계정 연결(N개) · 코인 원장 이식.
3. Phase 2 수익·계정 → 3 영상 → 4 상용(KICC·플랜 게이트·관리형 러너·AI 오버레이·운영센터 나머지 메뉴).

## 4. 운영 메모
- Netlify site id `a14524de-ebfa-46e8-a116-dbc87343f276` · 이름 `autocreate-endyd`(변경 가능).
- Neon: 프로젝트 `old-tree-90235056`(us-east-2 · pg18 · db neondb) · DDL은 `node scripts/neon-migrate.mjs <sql>` · 로컬 `.env`(git 미추적)에 접속문자열.
- Netlify env 등록 완료(2026-09-14): DB·JWT·ACTION·CREDS_ENC·SSO·RUNNER·GEMINI·RESEND·R2·SITE_URL.
- 초기 운영자: `admin@ops.local`(로그인 아이디 `admin`) · 시드 `scripts/seed-admin.mjs`.
- 화면 생성: `node scripts/build-pages.mjs`(템플릿 `public/app/_tpl.txt`·`public/ops/_tpl.txt`) — 생성물 커밋.
- push 규칙: docs·규칙은 commit만. 첫 push는 Phase 0 스캐폴드 배치.
