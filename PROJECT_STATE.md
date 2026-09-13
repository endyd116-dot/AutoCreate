# PROJECT_STATE.md — AutoCreate 작업 상태 (휘발성)

> 라운드 종결·상태 변경 시 메인이 즉시 갱신. 새 채팅(특히 메인)은 이 파일 + `CLAUDE.md` + `docs/DESIGN.md` §0 정독.

## 1. 개요
- **AutoCreate(AC)** — 다계정 글·영상 자동 생성·발행 + 수익 통합 SaaS(토스형). AM 엔진 이식.
- 라이브: https://autocreate-endyd.netlify.app (GitHub `main` push → 자동 배포) · 아직 빈 사이트(README만).

## 2. 현재 상태 (2026-09-14)
- ✅ GitHub·Netlify 연동 · 설계서 v5(`docs/DESIGN.md`) · 화면 시안 v3(`docs/screens-v3.html`) · 웹 시안(`docs/screens-web-v1.html`)
- ✅ 작업 규칙 이식: `CLAUDE.md` · `docs/rules/{PARALLEL_GUIDE,PITFALLS,TRIGGER-TEMPLATE,MEMORY-PORTABLE}.md` · `.claude/settings.json`
- ⏳ **사장님 결정 대기**: DESIGN.md §0 Q1~Q6 (S스토리=티스토리? · 구독 가격 · 관리형 러너 · 단일 앱 심사 · 프록시 · 브랜드 컬러)

## 3. 다음 할 일
1. Q1~Q6 답 → 설계서 확정(v1.0).
2. **Phase 0 뼈대**(DESIGN §17): 리포 스캐폴드 · AM 코어 이식(auth·tenant·coin·billing·ai·ai-models·audit·response) · Neon 인스턴스 · 스키마 v1 · `ac.css` + 12 컴포넌트 · 온보딩 · MIS SSO(`sso-autocreate`) · 운영 콘솔 진입.
   - 워크트리 `../AutoCreate-A/B/C` 생성 · 첫 트리거 `docs/active/2026-09-xx-P0-{A,B,C}-trigger.md`.
3. Phase 1 글 MVP → 2 수익·계정 → 3 영상 → 4 상용.

## 4. 운영 메모
- Netlify site id `a14524de-ebfa-46e8-a116-dbc87343f276` · 이름 `autocreate-endyd`(변경 가능).
- Neon: 아직 인스턴스 없음(Phase 0에서 생성).
- push 규칙: docs·규칙은 commit만. 첫 push는 Phase 0 스캐폴드 배치.
