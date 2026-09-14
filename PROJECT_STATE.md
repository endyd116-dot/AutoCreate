# PROJECT_STATE.md — AutoCreate 작업 상태 (휘발성)

> 라운드 종결·상태 변경 시 메인이 즉시 갱신. 새 채팅(특히 메인)은 이 파일 + `CLAUDE.md` + `docs/DESIGN.md` §0 정독.

## 1. 개요
- **AutoCreate(AC)** — 다계정 글·영상 자동 생성·발행 + 수익 통합 SaaS(토스형). AM 엔진 이식.
- 라이브: https://autocreate-endyd.netlify.app (GitHub `main` push → 자동 배포) · 아직 빈 사이트(README만).

## 2. 현재 상태 (2026-09-14 · 배포 #3 완료)
- ✅ **라이브 = main `0f3ec44`**(배포 #3 · R4 «돈을 받고·운영한다» · Netlify ready) — 스모크: 고객 페이지 10종 · 가입(consents 4) · coin-packs 3금액 · subscription/quote(49,000/4,900/53,900) · KICC 없음 `not_configured` 정직 · 티켓 · **운영센터 12메뉴 API 전부 200**.
- 배포 이력: #1 Phase 0 `d2a4994` · #2 R1+R2+R3 `e33807d`(+핫픽스 `ebbe372`) · #3 R4 `0f3ec44`.
- ✅ 완료·머지: Phase 0 · R1 · R2 · R3 · ui-v4 · **R4**(B 결제·구독·체험·게이트·운영 6메뉴 API 116/116 · B2 러너팜·카나리·AI 자동 업데이트·채널·공지·운영진·블로거 템플릿 · A 운영센터 16장·코인/요금제/문의/약관 · C 결함 9건 수리 · 라이브 DDL 0004~0007). 러너 실증 매트릭스 **4/4**(네이버·티스토리 임시저장 ✓ · 블로거/WP 정직 정지) · 티스토리 쿠키 테넌트 109(2027-09 까지 · `--reuse-tid=109`).
- 🔨 **P1R5 «영상 축·쇼츠 공장» 진행 중**(계약 `docs/active/2026-09-15-P1R5-contract.md` v5.1 · 조사 `2026-09-14-R5-presurvey-video.md`): **B-1**(`autocreate-b-8a` · `../AutoCreate-B1` · `feature/p1r5-back` · 생성 두뇌) · B2(`feature/p1r5-back2` · 렌더 잡·유튜브/릴스/쓰레드 출구 · 그 전에 애드포스트 전 구간 되짚기) · A(`feature/p1r5-front` · 화면 8) · C(C6-R4 라이브 → R5 검증). B(`autocreate-b-ae`) 는 대기.
- 함정 노트 **AC-30** 까지.
- ⏳ **사장님 할 일**: ① 라이브 `admin`/`admin1234` 첫 로그인 → **비밀번호 변경(아직)** ② **TYPECAST_API_KEY**(R5 TTS · 없으면 Gemini 폴백) ③ **유튜브 OAuth 앱 심사 착수**(심사 전엔 비공개 업로드) ④ KICC 키 · 쿠팡·Meta·Threads 앱 키(정직 no-op 상태) ⑤ 약관 4문서 법률 검토(«법률 검토 전» 배지) ⑥ 통신판매업 신고.
- 결정 누적: 부가세 별도(AM 방식 · AM↔AC 코인 이전 예정) · 홈 큰 숫자 = 오늘 확정+예상 · UI 세부 메인 판단(시안 v3/v4 뿌리) · R5 §D 8건(Omni+Lite · 타입캐스트 · topics 흡수 · 코인 구간제 · uploaded_private · 3등급 심사 · $30/$300).

## 3. 다음 할 일
1. **R5 마감**: B-1→B2→A 머지 → C R5 검증(라이브 60초 1회 실증) → 배포 #4.
2. **R6 마무리**(콘텐츠 내보내기 ZIP · 공유 카드 · 추천인 코드 · 관리형 러너 팜 · AM↔AC 코인 이전 · 티스토리 HTML 모드 · 영수증 페이지 · 세금계산서 실발급).
3. 외부 키 도착 시 «키 꽂으면 즉시» 항목 실증(KICC 실결제 사다리 · 애드센스/유튜브 수익 · 쿠팡 회수 · 릴스/쓰레드 발행).

## 4. 운영 메모
- Netlify site id `a14524de-ebfa-46e8-a116-dbc87343f276` · 이름 `autocreate-endyd`(변경 가능).
- Neon: 프로젝트 `old-tree-90235056`(us-east-2 · pg18 · db neondb) · DDL은 `node scripts/neon-migrate.mjs <sql>` · 로컬 `.env`(git 미추적)에 접속문자열.
- Netlify env 등록 완료(2026-09-14): DB·JWT·ACTION·CREDS_ENC·SSO·RUNNER·GEMINI·RESEND·R2·SITE_URL.
- 초기 운영자: `admin@ops.local`(로그인 아이디 `admin`) · 시드 `scripts/seed-admin.mjs`.
- 화면 생성: `node scripts/build-pages.mjs`(템플릿 `public/app/_tpl.txt`·`public/ops/_tpl.txt`) — 생성물 커밋.
- push 규칙: docs·규칙은 commit만. 첫 push는 Phase 0 스캐폴드 배치.
