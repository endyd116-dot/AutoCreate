# PROJECT_STATE.md — AutoCreate 작업 상태 (휘발성)

> 라운드 종결·상태 변경 시 메인이 즉시 갱신. 새 채팅(특히 메인)은 이 파일 + `CLAUDE.md` + `docs/DESIGN.md` §0 정독.

## 1. 개요
- **AutoCreate(AC)** — 다계정 글·영상 자동 생성·발행 + 수익 통합 SaaS(토스형). AM 엔진 이식.
- 라이브: https://autocreate-endyd.netlify.app (GitHub `main` push → 자동 배포) · 아직 빈 사이트(README만).

## 2. 현재 상태 (2026-09-15 · 배포 #4 완료)
- ✅ **라이브 = main `e5458f8`**(배포 #4 · **R5 영상 축 + KICC 이중 MID**) — 스모크: 화면 7종 · 가입(consents 4) · `coin-packs.keyin`·`subscription.keyin` · `ops-payment-settings`(keyin/kicc 전부 false = 정직) · 채널 4 active/6 planned.
- 배포 이력: #1 `d2a4994`(Phase 0) · #2 `e33807d`(R1+R2+R3, 핫픽스 `ebbe372`) · #3 `0f3ec44`(R4) · **#4 `e5458f8`(R5+KICC)**.
- ✅ 라운드 완료: Phase 0 · R1 · R2 · R3 · ui-v4 · R4 · **R5**(영상: provider 사다리·TTS·자막·컷·11축 심사·원가 관문·프레임 지문 / 러너 렌더 ffmpeg·BGM 12곡 / 유튜브·릴스·쓰레드 출구 / 화면 8) · **KICC 이중 MID**(ON 구별).
- R5 C 판정 «배포 가능» — 제품 결함 3건 수리(심사가 «계획서»를 검사하던 것 · 소프트 구간 거짓 알림 2곳). 함정 노트 **AC-35** 까지.
- 러너 실증 4/4(네이버·티스토리 임시저장 · 블로거/WP 정직 정지) · **실측 mp4**(12s·360프레임·R2 HEAD·ffprobe 3길이 일치).
- 🔨 **다음 = R6**(마지막): 내보내기 ZIP · 공유 카드 · 추천인 코드 · 영수증 페이지 · 세금계산서 · 관리형 러너 신청 · naver_clip 30초 안내 · 엔드카드 URL · **AM↔AC 코인 이전** · 티스토리 HTML 모드. 화면 목록 = `docs/active/R6-screen-list.md`.
- ⏳ **사장님 할 일**: ① 라이브 `admin` 비밀번호 변경(아직) ② **KICC**: MID 1개 추가(AutoCreate · ON 과 정산 분리 · **비인증 MID 동반**) + **복귀 주소 2개 허용**(`/api/coin-charge-return`·`/api/billing-key-return`) + **허용 결제수단 코드 확인** → `docs/active/KICC-GO-LIVE.md` ③ **유튜브 OAuth 앱 + 심사 착수**(없으면 영상 채널을 못 켠다 · 심사 전엔 비공개 업로드) ④ TYPECAST_API_KEY(없으면 Gemini TTS 폴백) ⑤ 쿠팡·Meta·Threads 키 ⑥ 약관 4문서 법률 검토 · 통신판매업 신고 ⑦ 사업자 정보(상호·대표·등록번호·주소·통판 신고번호 → 운영센터 «회사 정보»).
- 결정 누적: 부가세 별도(AM 방식 · AM↔AC 코인 이전 예정) · UI 세부는 메인 판단 · R5 §D 8건 + v5.6(하드 캡은 `used` 만) · 공유 카드 핸들 숨김 기본 · 공급자 정보는 운영센터에서.

## 3. 다음 할 일
1. **C 배포 후 3가지**: 라이브 회귀 · **«돈 쓰는» 60초 1편 실증**(`measured` 가 `piece_assets(video).meta` 까지 흐르는지) · 스모크 잔재 정리(승인 완료).
2. **R6 발사**(마지막 라운드) → 배포 #5.
3. 외부 키 도착 시 실증: KICC(①인증 결제 ②빌키+청구 ③**부분 취소**) · 유튜브 업로드 · 애드센스/쿠팡 수익 · 릴스/쓰레드.

## 4. 운영 메모
- Netlify site id `a14524de-ebfa-46e8-a116-dbc87343f276` · 이름 `autocreate-endyd`(변경 가능).
- Neon: 프로젝트 `old-tree-90235056`(us-east-2 · pg18 · db neondb) · DDL은 `node scripts/neon-migrate.mjs <sql>` · 로컬 `.env`(git 미추적)에 접속문자열.
- Netlify env 등록 완료(2026-09-14): DB·JWT·ACTION·CREDS_ENC·SSO·RUNNER·GEMINI·RESEND·R2·SITE_URL.
- 초기 운영자: `admin@ops.local`(로그인 아이디 `admin`) · 시드 `scripts/seed-admin.mjs`.
- 화면 생성: `node scripts/build-pages.mjs`(템플릿 `public/app/_tpl.txt`·`public/ops/_tpl.txt`) — 생성물 커밋.
- push 규칙: docs·규칙은 commit만. 첫 push는 Phase 0 스캐폴드 배치.
