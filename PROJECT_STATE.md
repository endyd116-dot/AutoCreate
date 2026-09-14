# PROJECT_STATE.md — AutoCreate 작업 상태 (휘발성)

> 라운드 종결·상태 변경 시 메인이 즉시 갱신. 새 채팅(특히 메인)은 이 파일 + `CLAUDE.md` + `docs/DESIGN.md` §0 정독.

## 1. 개요
- **AutoCreate(AC)** — 다계정 글·영상 자동 생성·발행 + 수익 통합 SaaS(토스형). AM 엔진 이식.
- 라이브: https://autocreate-endyd.netlify.app (GitHub `main` push → 자동 배포) · 아직 빈 사이트(README만).

## 2. 현재 상태 (2026-09-15 · 배포 #5 완료 — **개발 라운드 전부 종료**)
- ✅ **라이브 = main `4d06070`**(배포 #6 · R6 마감 · 공유 카드 금액 캐시 수리) — 스모크: 화면 6종 · 가입 `mailSent:true` · **forgot 무누설**(있는/없는 계정 응답 동일) · 공유카드 0원 `step:"empty"` · 관리형 러너 `eligible:false` + **정가 30,000/3,000/33,000** · 채널 영상 상한(clip **30** · shorts/reels 60) · 백업 상태(**PITR 7일** · `r2Versioning:"unsupported"`).
- 배포 이력: #1 `d2a4994` · #2 `e33807d`(+`ebbe372`) · #3 `0f3ec44` · #4 `e5458f8` · #5 `79dfe6a` · **#6 `4d06070`**(R6 마감).
- ✅ **라운드 전부 완료**: Phase 0 · R1 · R2 · R3 · ui-v4 · R4 · R5 · **R6**(내보내기 ZIP · 공유 카드 PNG · 추천인 · 영수증 인쇄 · 세금계산서 · 회사 정보 · 관리형 러너 신청 · AM↔AC 코인 이전(AC 쪽) · 티스토리 HTML 모드는 사장님 GO 대기 · 백업 확인 · AC-36 감사/메일 전수) + **KICC 이중 MID**(ON 구별 · 키 등록 완료 · `mode:live` · 1단계 거래등록 통과).
- 함정 노트 **AC-41** 까지(하루에 30건 추가 · 전부 실측).
- ⏳ **남은 것 = 사장님 GO 2건 + 바깥 절차**:
  ① **티스토리 로그인 1회**(카카오 2FA · 세션이 짧아 «개입 0회»는 불가로 판명 · B2 가 한 세션에 로그인→HTML 실측→발행 품질까지 끝내게 준비 완료)
  ② **KICC 카드 1회**(2단계 빌키+청구 · 3단계 부분 취소 · ₩5,500 → 전액 환불 · `docs/active/KICC-GO-LIVE.md`)
  ③ **유튜브 OAuth 앱 + 심사**(없으면 영상 채널을 못 켠다 — 지금 6채널 `planned`) ④ 약관 4문서 법률 검토 · 통신판매업 신고 ⑤ 사업자 정보(운영센터 «회사 정보») ⑥ admin 비밀번호 변경 ⑦ TYPECAST·쿠팡·Meta·Threads 키 ⑧ KICC 복귀 주소 2개 허용·결제수단 코드 확인
- 배포 후 대기 작업: **C 라이브 절**(감사 3회 연속 잔존 · 공유카드 PNG 실물 · `clampedFrom` 디렉터 실경로) · B 라이브 operator 403 3회 · B2 잔재 t189 정리.

## 3. 다음 할 일
1. **C 라이브 검증**(배포 #5 뒤) → 라운드 마감 보고.
2. 사장님 GO 오면: 티스토리 · KICC 2·3단계.
3. 외부 키 도착 시 실증: 유튜브 업로드 · 애드센스/쿠팡 수익 · 릴스/쓰레드 · AM↔AC 코인 이전(AM 쪽 배선).
4. 다음 개발은 **Phase 5+**(틱톡·페북·롱폼 · 관리형 러너 실기기 · 릴스 90초 · 유튜브 쇼핑 태그) — 전부 외부 선결조건이 먼저다.

## 4. 운영 메모
- Netlify site id `a14524de-ebfa-46e8-a116-dbc87343f276` · 이름 `autocreate-endyd`(변경 가능).
- Neon: 프로젝트 `old-tree-90235056`(us-east-2 · pg18 · db neondb) · DDL은 `node scripts/neon-migrate.mjs <sql>` · 로컬 `.env`(git 미추적)에 접속문자열.
- Netlify env 등록 완료(2026-09-14): DB·JWT·ACTION·CREDS_ENC·SSO·RUNNER·GEMINI·RESEND·R2·SITE_URL.
- 초기 운영자: `admin@ops.local`(로그인 아이디 `admin`) · 시드 `scripts/seed-admin.mjs`.
- 화면 생성: `node scripts/build-pages.mjs`(템플릿 `public/app/_tpl.txt`·`public/ops/_tpl.txt`) — 생성물 커밋.
- push 규칙: docs·규칙은 commit만. 첫 push는 Phase 0 스캐폴드 배치.
