# PROJECT_STATE.md — AutoCreate 작업 상태 (휘발성)

> 라운드 종결·상태 변경 시 메인이 즉시 갱신. 새 채팅(특히 메인)은 이 파일 + `CLAUDE.md` + `docs/DESIGN.md` §0 정독.

## 1. 개요
- **AutoCreate(AC)** — 다계정 글·영상 자동 생성·발행 + 수익 통합 SaaS(토스형). AM 엔진 이식.
- 라이브: https://autocreate-endyd.netlify.app (GitHub `main` push → 자동 배포) · 아직 빈 사이트(README만).

## 2. 현재 상태 (2026-09-14 · 배포 #2 완료)
- ✅ **라이브 = main `e33807d`**(R1+R2+R3 · 186커밋 · Netlify deploy `6aa78b2d`) — 라이브 스모크: 페이지 8종 · 비로그인 401 전건 · 가입→홈→수익→계정 그리드(4 active) · **topics-refresh 배경 함수 프로덕션 ~12초 `added:15`** · ops 로그인·대시보드·고객 24.
- ✅ 완료·머지: Phase 0 · P1R1(소재→디렉터→글→검수→편성·코인) · **P1R2**(크론 7스텝·슬롯 게이트·계정 전이·발행 디스패처·러너 4채널·알림함·소재 배경화 · C 결함 5건 수리) · **P1R3**(수익 커넥터 5종·스크랩 잡 3종·집계 API·신청 조건 게이지·학습 되먹임·유사도 게이트·승계 실증 19/19 · C 결함 0) · **ui-v4**(시안 v4 11장 · `docs/screens-v4.html` 정본).
- 🔨 **P1R4 진행 중**(«돈을 받고·운영한다» · 계약 `docs/active/2026-09-14-P1R4-contract.md` v4.3): B(결제·구독·체험·게이트 완료 60% → 운영센터 6메뉴 API) · B2(러너팜·카나리·AI 자동 업데이트·채널·공지·운영진·블로거 템플릿) · A(운영센터 12메뉴·코인/플랜 화면·약관·문의) · C(C6 라이브 검증 → R4 검증).
- 라이브 데이터: `channel_registry` 4채널 active(naver_blog·tistory·blogger·wordpress) · 6 planned. DDL 0001~0005 적용.
- ⏳ **사장님 할 일**: ① 라이브 `admin`/`admin1234` 첫 로그인 → 비밀번호 변경(아직) ② **티스토리 카카오 로그인 1회**(«준비됐어» 신호 → B2 가 창 띄움 → 로그인+2FA) ③ 네이버 데이터랩 API 권한 ④ 쿠팡·OAuth 앱 키·KICC 키(없으면 정직 no-op).
- 결정: 부가세 **별도**(AM 방식 · AM↔AC 코인 이전 예정) · 홈 큰 숫자 = 오늘 확정+예상 분리 · UI 세부는 메인 판단(시안 v3/v4 뿌리 · 심플·세련·고급·통일).

## 3. 다음 할 일
1. **R4 마감**: B→B2→A 머지 → C R4 검증 → 배포 #3.
2. **R5 영상 축**(쇼츠 공장 이식 · 유튜브·릴스·쓰레드·클립 · 영상 광고 표시) — 유튜브 앱 심사 선결.
3. **R6 마무리**(콘텐츠 내보내기 · 공유 카드 · 추천인 · 관리형 러너 팜 · AM↔AC 코인 이전).
4. 문서: 라운드마다 HANDOFF·PROJECT_STATE 갱신 · 함정 노트 AC-25 까지.

## 4. 운영 메모
- Netlify site id `a14524de-ebfa-46e8-a116-dbc87343f276` · 이름 `autocreate-endyd`(변경 가능).
- Neon: 프로젝트 `old-tree-90235056`(us-east-2 · pg18 · db neondb) · DDL은 `node scripts/neon-migrate.mjs <sql>` · 로컬 `.env`(git 미추적)에 접속문자열.
- Netlify env 등록 완료(2026-09-14): DB·JWT·ACTION·CREDS_ENC·SSO·RUNNER·GEMINI·RESEND·R2·SITE_URL.
- 초기 운영자: `admin@ops.local`(로그인 아이디 `admin`) · 시드 `scripts/seed-admin.mjs`.
- 화면 생성: `node scripts/build-pages.mjs`(템플릿 `public/app/_tpl.txt`·`public/ops/_tpl.txt`) — 생성물 커밋.
- push 규칙: docs·규칙은 commit만. 첫 push는 Phase 0 스캐폴드 배치.
