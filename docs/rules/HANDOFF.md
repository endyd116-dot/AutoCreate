# HANDOFF.md — AutoCreate 메인 세션 인수인계 (압축/새 세션용 단일 정본)

> 갱신 2026-09-15 · 작성자 = 메인(`autocreate-ca`) · **압축 후 새 메인 세션은 이 문서 + `docs/active/RESUME-TRIGGER.md` 를 먼저 읽는다.**
> 이 문서는 «지금까지의 서사»다. 규칙은 `CLAUDE.md`, 설계는 `docs/DESIGN.md`, 라운드 계약은 `docs/active/*-contract.md`, 함정은 `docs/rules/PITFALLS.md`(AC-1~59) 가 정본이고 여기서 요약·연결만 한다.

---

## 0. 한 장 요약

**AutoCreate(AC)** = 부수입을 원하는 개인이 여러 계정으로 글·영상을 AI로 만들어 자동 발행하고 광고·제휴 수익을 한 곳에서 보는 토스형 SaaS. AM(AutoMarketing)의 엔진을 이식하고 겉(제품·화면·계정 모델·수익 집계·결제·운영센터)은 새로 짰다.

- **개발 라운드 전부 종료**: Phase 0 · R1 · R2 · R3 · ui-v4 · R4 · R5 · R6 + KICC 이중 MID. 설계(`docs/DESIGN.md`) 대비 미개발 = 외부 선결조건(유튜브 심사 등)이 막은 것 + **§6 «사장님 실측 발견 5건»(진행 중)**.
- **라이브 = main `7985d37`**(배포 #7 · C «배포 가능» · 라이브 스모크 health 200 · create.html v9 «내 소재 넣기» · runner-download 401) · 로컬 main `012ce66`(B R6 §1 · 미배포 = 배포 #8 후보)(R6.5 전부 머지 · 러너 v1.1.4 ) · https://autocreate-endyd.netlify.app · GitHub `endyd116-dot/AutoCreate` · push = 배포(메인 단독)
- **결제(KICC) 실돈 실측 통과**(2026-09-15): 카드 등록(keyin MID) → ₩5,500 청구 → ₩2,000 부분 취소 → ₩3,500 환불 · 카드 최종 0원.
- 운영센터 `/ops` · `admin`/`admin1234`(**사장님 아직 안 바꿈**) · MIS 허브 SSO 카드 ⑥ 라이브.

---

## 1. 사장님(Swain) 지시 — 전역·항구 규칙

| # | 지시 | 반영 |
|---|---|---|
| 1 | **전본 개발** — 설계 대비 누락·왜곡·축소·요약 금지 · 트리거마다 «설계 대비 범위 지도» | `CLAUDE.md §8` · 메모리 `full-spec-no-reduction` |
| 2 | **UI = 깔끔·세련·심플 + 기능은 전적으로 토스형** · 잉크 블랙 | `DESIGN §13.0·13.0b·13.4` · 시안 정본 **`docs/screens-v4.html`** |
| 3 | **UI 세부는 메인이 판단**(시안 뿌리 + 더 심플·세련·고급·통일) · 사장님께 비교표 안 들고 간다 | 메모리 `ui-decisions-delegated` |
| 4 | **모든 화면 KST** | `DESIGN §13.5` · `CLAUDE §4.5b` |
| 5 | **파이프라이닝** — C 검증 중 다음 라운드 설계·발사 · C 결함은 C 가 수리 | `PARALLEL_GUIDE §2.6` |
| 6 | **배포는 라운드 끝에 묶어서**(라이브 P0/P1 은 핫픽스 즉시) | §2 |
| 7 | 러너는 **AM 러너 참조** | 이식 완료 |
| 8 | **부가세 별도(AM 방식)** — AM↔AC 코인 상호 이전 예정이라 같은 가격 구조 | `DESIGN §12.0` · 메모리 `pricing-vat-am-coin-exchange` |
| 9 | **KICC = 함께워크ON 사업자(광고대행업) 공용 · ON 과 구별** | `docs/active/KICC-GO-LIVE.md` · R4 계약 §1.6 |
| 10 | **러너 방향 = 관리형(우리 서버) 기본 + 비용 청구** — 결정 3개 대기(§6) | R7 후보 |
| 11 | 사장님이 실제로 써 보며 짚는 것 = 최고의 검증(2026-09-15 하루 5건 전부 진짜) | §6 |

---

## 2. 지금 상태 (2026-09-15)

### 배포 이력
| # | 커밋 | 내용 |
|---|---|---|
| 1 | `d2a4994` | Phase 0 |
| 2 | `e33807d`(+`ebbe372`) | R1 글 · R2 자동 편성·러너·승계 · R3 수익 |
| 3 | `0f3ec44` | R4 결제·체험·운영센터 12메뉴·CS·약관 |
| 4 | `e5458f8` | R5 영상 + KICC 이중 MID |
| 5 | `79dfe6a` | R6 내보내기·공유카드·추천인·영수증·관리형 신청·백업 |
| 6 | `4d06070` | R6 마감(공유 카드 금액 캐시) |
| **7** | **`7985d37`** | R6.5 사장님 실측 5건(직접 소재·캡션·자동편성 안내·건너뛰기·러너 배포 v1.1.4) + C 수리 4 + 화면 44px | 
| 핫픽스 | `7ae8e78`→`2278ae7`→`f6c7eaa`→`f935034`→`7e0616e`→**`e7bd0c7`** | 티스토리 HTML · KICC 콜백 POST · 확인용 JSON · 빌키 keyin 고정 · 결과표 · 결제 실패 사유 시트 |

### 라이브에 있는 것
- **글 축**: 소재 → 디렉터(§5.3 6규칙·손보기) → 글·이미지(7채널 계약·AI티 8검사·고지) → 검수 → **편성표 자동 시계 7스텝** → 발행(네이버·티스토리 러너 / 블로거·WP API) → 승계 → 알림함.
- **수익**: 커넥터 5종(키 없으면 `not_configured` 정직) · 러너 스크랩 3종(**애드포스트 전 구간 라이브 실증**) · 홈 «오늘 번 돈»(확정+예상) · 신청 조건 게이지 · 학습 되먹임.
- **장사**: 체험 14일 → readonly · 코인(팩 3 + pack_trial) · 구독(월/연) · **KICC 이중 MID(auth/keyin · pg_mid · secretForMid)** · 플랜 게이트 · 운영센터 12메뉴 · 자동 티켓 · 원격접속 · 약관 4문서(«법률 검토 전») · 회사 정보.
- **영상**: provider 사다리(Omni·Veo·fal·스텁) · TTS(타입캐스트/Gemini) · SRT · **11축 심사 3등급(ffprobe 실측)** · 원가 관문(`checkAiCostCap` 재사용 · 소프트 통과/하드 ×3 환급) · 프레임 지문 · 러너 렌더(ffmpeg·BGM 12곡·배지) · 출구(유튜브 private·릴스·쓰레드·클립 스텁) · 화면 8.
- **R6**: 내보내기 ZIP(7일) · 공유 카드 PNG(핸들 숨김 기본) · 관리형 러너 신청 · 백업 상태(PITR 7일 · R2 버전관리 없음) · AC-36 await 전수 · 티스토리 HTML 모드. 🔴 **R6 §1(B 몫 · 추천인·영수증 페이지·세금계산서·회사 정보·AM↔AC 코인 이전)은 화면만 있고 서버가 없다**(2026-09-15 전수조사 발견 · AC-48 · `feature/p1r6-back` 으로 B 발주 중).

### 러너 실증 매트릭스
🔴 **정정(2026-09-15 전수조사 실측)**: 라이브 `posts` 는 **통틀어 2행이고 둘 다 `http://localhost:3997/index.html`**(C 하니스 스텁) — **실채널에 URL 이 뜬 적이 0회**다. 아래 «✓»는 러너가 그 단계까지 갔다는 뜻이지 발행이 아니다.
네이버 ✓(사진·서식·카나리) · 티스토리 ✓(HTML 모드 · **세션이 짧아 사람 2FA 필요** · `--reuse-tid=109` 는 티스토리 전용 회피책) · 블로거/WP 자격 없음 정직 정지 · **실제 «발행» 0건**(전부 임시저장). 🔴 **러너 배포 패키지 없음**(다운로드 404 · `npx ac-runner` 는 존재하지 않는 패키지 · B2 수리 중).

### 라이브 데이터·env(오늘)
- `channel_registry` 4 active(naver_blog·tistory·blogger·wordpress)/6 planned(유튜브 OAuth 앱 없어 못 켬).
- env: `FX_USD_KRW=1400`(원가 기준값) · `BGM_LICENSE_VERIFIED=1` · **`VAPID_PUBLIC_KEY`·`VAPID_PRIVATE_KEY`(is_secret)·`VAPID_SUBJECT`**(2026-09-15 메인이 생성·등록 · 웹푸시) · **`KICC_MODE=live`·`KICC_MALL_ID`·`KICC_MALL_ID_KEYIN`·`KICC_API_DOMAIN`(ON 이식)·`KICC_SECRET_KEY`(사장님 제공·is_secret)** · deps `@resvg/resvg-js` + `assets/fonts/Pretendard-*.otf`.
- Neon PITR **1일→7일**(메인 API).
- **테스트 계정 198 `test@autocreate.kr`/`autocreate12`** = 사장님 결제 테스트 계정 · 빌키 토스뱅크 ****0542 **보존** · **정리 완료 → trial · 자동청구 해제됨**.
- 보존 4집: 3·13·109·116(pro · MRR 49,000 은 이 집). 🔴 **t189(B2실증 · 티스토리 2FA 세션 보유)은 2026-09-15 정리에서 삭제됨** → 다음 티스토리 실측 때 **사장님 재로그인 1회 필요**(109 세션이 살아 있으면 `--reuse-tid=109`).
- **테스트 테넌트 대청소(2026-09-15 · 사장님 지시)**: B `scripts/ops-cleanup-tenants.mjs`(information_schema 자동 열거 · FK 위상 정렬 · 보호 5곳 id 하드코딩 3·13·109·116·198 · `--dry-run` 기본 · `--keep=` · `--revenue-test-rows` · R2 `r2DeletePrefix` 연동 · 감사 `ops_live_cleanup`) — 드라이런 91곳/1,853행/R2 887 · apply 는 B 창 사장님 Allow. B2 하니스 teardown(`finally` · 보존 id 우선 거부) 추가 · t200·t189 삭제. **규칙: 하니스는 끝에 자기 테넌트를 지운다(정리문 0 인 하니스 5개 = R7 항목)**.
- 운영 대시보드 «AI 원가 ₩15,820($11.30)」 = 전부 개발 검증(이미지 78% · C·B 하니스 9/13~14 · 198 $0.32 · B-1 $0.34) — 고객 0. «수익 회수 195,710」 = 전부 테스트 입력(R3 스모크·C·전수조사 수동 입력 + 애드포스트 스크랩 3,710) — 고객 0. R7 후보: 운영 숫자에서 내부 테스트 제외 표시.

---

## 3. 세션 지도 · 워크트리

| 세션(`ListAgents`) | 역할 | 폴더 | 브랜치 | 압축 시점 상태 |
|---|---|---|---|---|
| `autocreate-ca` | 메인 | `AutoCreate` | `main` | — |
| `autocreate-b-ae` | **B**(결제·운영센터·감사) | `AutoCreate-B` | `ops/cleanup-tenants`→`feature/p1r6-back` | 대청소 apply(사장님 Allow 대기 · 88곳) · 🔴 **R6 §1 서버 구현 발주**(추천인·invoice·tax·ops-company·coin-transfer) |
| `autocreate-b-53` | **B-1**(영상·내보내기·소재) | 창은 `AutoCreate-B` · **`cd ../AutoCreate-B1`** 로 일함 | `feature/p1r6-back1` | 전수조사 §4·§5·§5C·§16B·§6·§10(영상 축 고객 경로) → `audit/2026-09-15-B1.md` |
| `autocreate-b2-e4` | **B2**(러너·발행) | `AutoCreate-B2` | `feature/runner-dist` | ✅ 머지됨(`99a4a50` 배포 zip·다운로드·자동 업데이트·지문·rotate · `5638765` alt · `17a7f5d`) · `bbec8ce` runner-list 신호) · DDL 0012 적용 · 한 줄(Content-Disposition·«열쇠») 뒤 전수조사 §2·§8·§9 → `audit/2026-09-15-B2.md` |
| `autocreate-a-cc` | **A**(화면) | `AutoCreate-A` | `feature/p1r6-front` | ✅ 전부 머지됨(`…f982d0d` 건너뛰어요 정정 · `4a7c45e` 러너 화면) · 조사 1건: 시안 v4 ↔ 실제 화면 표(`audit/2026-09-15-A.md`) |
| `autocreate-c-41 [3d0736]` | **C**(검증·새 세션) | `AutoCreate-C` | `verify/p1r6-5` | R6.5 1차 검증 발부(topics-add · 캡션 §5C · A 화면 · 회귀) · 4·5절은 2차 |
| **`autocreate-b-e9`** | **B(새 세션 · 설계 대비 전수조사)** | **`AutoCreate-B3`**(새 워크트리) | `audit/design-2026-09-15` | 🔴 사장님 지시 — 트리거 `docs/active/2026-09-15-DESIGN-AUDIT-trigger.md` · 자기 몫 §0·1·3·5B·13·17·19 + 특별 항목 a·b·c + **통합**(`docs/active/2026-09-15-DESIGN-AUDIT.md` · 상위 20 은 직접 되짚기) |
| ~~`autocreate-c-41 [b3f2d6]`~~ ~~`autocreate-b-8a`~~ ~~`autocreate-a-a9`~~ | 옛 C·옛 B-1·옛 A | — | — | 빈 창 |

- 🔴 B·B-1 이 `AutoCreate-B` 폴더를 공유해 창 표시가 같다 → **모든 보고 첫 줄 = `■ 역할 · 폴더 · 브랜치 · 지금:`**(전 세션 적용). 커밋 전 `git branch --show-current`.
- 🔴 **라이브 데이터 변경은 그 세션 창에서 사장님 Allow** — 메인 승인은 다른 창을 열지 못한다. B 창은 auto 모드라 상자 자체가 안 뜬다(분류기 차단) → 사장님이 모드를 바꾸거나 메인이 직접(사장님 «청소해» 승인 있음 · 메인 창은 node 스크립트로 라이브 DB 쓰기가 됐다: 레지스트리 UPDATE·BGM 시드).

---

## 4. 인프라·키 (전부 등록)

- **Neon** `old-tree-90235056` · DDL `node scripts/neon-migrate.mjs`(0001~0011) · 키 `~/.neon-am-key` · PITR 7일.
- **Netlify** site `a14524de-ebfa-46e8-a116-dbc87343f276` · PAT `nfp_bB2BR1…`(AM 메모리 `neon-netlify-remote`) · **AC-8** 다른 사이트 secret 은 `****`.
- **R2** 버킷 **`siren-uploads`**(MIS·AM 과 공유 · 우리 키는 전부 `autocreate/` 접두 아래 · 러너 zip **`autocreate/runner/v1.1.6.zip`**+`latest.json`(sha256 738c0925… · v1.1.5 run.bat 열쇠 수리 · v1.1.6 프록시 fail-closed·출구 IP·트래픽 계측·프레임 지문)) · 버전 관리 없음(AC-37) · 삭제 헬퍼 `r2DeletePrefix` 는 `autocreate/{tid}/` 꼴만.
- **KICC**: ON 계약 공용 · MID 2 · live · **빌키 = keyin 고정**(AC-45) · 복귀 주소 등록 불필요·KEYIN 시크릿 불필요(실측 확정) · 개통 정본 `docs/active/KICC-GO-LIVE.md`.
- 로컬 `.env`(워크트리 6곳 동기): `TEST_TISTORY_*`·`TEST_NAVER_*`·`FX_USD_KRW`·`BGM_LICENSE_VERIFIED`.

---

## 5. 결정 로그

| 주제 | 결정 |
|---|---|
| 슬롯 게이트 · reassigned · 전이표 정본 · finalize 실패 | R2 결정 그대로(fail-closed · 행 유지 · `account-health.ts` · 재시도 금지) |
| 크론 수동 | `/api/cron-run?every=&tid=&secret=` · 로컬 `CRON_BUDGET_MS=24000` |
| 홈 큰 숫자 | 확정·예상 둘 다 오늘 값 |
| 부가세 | 별도(AM 방식) |
| 구독 | tenants 정본 · subscriptions 장부 · readonly · included 월말 · 연납 월×10·포함분 매달 · 정지 3회째 |
| 영상 | Omni+Lite · video_15 Lite 강제 · 타입캐스트 기본 · 코인 구간제 · `uploaded_private` posts 만 · 3등급 심사 |
| 영상 원가 | **새 캡 없음** — `checkAiCostCap` 재사용 · 소프트 통과+운영 알림 · 하드 ×3 환급 · **하드는 `used` 만** · FX 없으면 안 막음 · FX 기본값 코드 금지 |
| 유튜브 업로드 | 서버 API 스트리밍(배경 함수 · 토큰 러너 미전달) |
| 공유 카드 | PNG(resvg+Pretendard · 함수 1개 included_files) · 핸들 숨김 기본 · 0원 미생성 · 키에 금액 |
| 영수증 공급자 | 운영센터 «회사 정보» 한 출처 |
| 관리형 가격 | `lib/plans.ts` 상수(요금제 칸 X) · Starter «못 쓴다≠공짜」 정가 |
| R2 덮어쓰기 | 결정론 키 0(TTS·자막 세대 해시 · AC-39) |
| KICC 콜백 | POST form 읽기(AC-44) · 맨 앞 감사 · 확인용 주문 JSON |
| 빌키 | keyin MID 고정(AC-45 · 인증 MID 는 8373 거절) |
| 결제 실측 | 고객 경로 그대로(AC-46) |
| 러너 복제 방어 | 토큰 없인 무용 + 인증 다운로드 + 기기 지문 + 토큰 재발급 + (R7) 셀렉터 서버 배포 |
| 캡션 | 생성 프롬프트와 분리 · 글쓴이 말투 ≤25자 · 채널별 `captionRate`(naver 0.3) · 묘사문 금칙 |
| 소재 입구 | AI 추천 + **직접 입력(`topics-add`)** · 코인 0 · 일 20 |

---

## 5B. R7 (2026-09-15 · 진행 중)

**진행**: §1 영상 축 **완료**(토글·계정 없이 영상·mp4 내려받기·올린 주소 적기·홈 해야 할 일 7줄·프레임 지문) · §2 러너/발행 60%(run.bat 열쇠 수리·고객 경로 1바퀴·쓰레드 글·프록시 fail-closed·출구 IP·트래픽 실측·견적서 · 남은 것 노트북 공존·관리형 1대·워밍업·실발행 준비) · §3 B **§3.1~3.5 완료**(탈퇴·파기·플랜 게이트·자격 동의·**내부 테스트 제외**) · §3.6 계정 슬롯 진행 · §4 A **완료**(화면 전부 · 보류 축 3상태 · 판 번호 자동) · B3 조사 잔여 수리 완료 · C §5 준비(API 표면 상시 하니스).
**오늘 숫자 2개**: AI 원가 **$15.93 → $3.70**(내부 12.23 제외 · 83곳 중 81곳이 내부 · 진짜 고객 0) · 글 1건 트래픽 **≈9~10MB**(가정의 2~4배 과대 · 계정당 월 1GB 미만).


**계약 = `docs/active/2026-09-15-P1R7-contract.md` v7.0**(유일한 입력 = 전수조사). 사장님 결정 4: ①영상 채널 켠다 ②실발행 GO(네이버 1건부터) ③요금제 채널 게이트 설계대로 ④관리형 기본·계정당 월요금·프록시 포함.
담당: B-1 §1 영상 개통 · B2 §2 실발행·러너·관리형 1대 · B §3 탈퇴/게이트/내부 구분 · A §4 화면 · C §5(AC-48 전수 diff 포함) · 메인 §7 DESIGN 갱신.

## 6. 열린 항목

### 진행 중(압축 시점 · 세션별 발주)
1. ✅ **테스트 정리 완료**(2026-09-15 · 사장님이 B 창에서 직접 Allow · 감사 `ops_live_cleanup`): 160·196·197 삭제 · t189 trial+queued 잡 14 삭제 · **198 trial + `next_billing_at NULL`(10/15 자동청구 해제)** · 빌키 ****0542 보존 · 인보이스 #10 refunded 보존 · 포함코인 33 회수. **MRR 73,000 → 49,000**(116 pro 만) · 활성 유료 1 · 보존 4집 생존.
2. ✅ **B-1 머지됨(main `04a08c7`)**: `c0fbc2b` `POST /api/topics-add`(400 title·banned_category·duplicate(+topic 동봉)·channel · 429 rate · Topic.source ai|manual · manual 맨 위) · `84a2372` 캡션 §5C(image{prompt,caption?} 분리 · 묘사문 7패턴 금칙 · captionRate naver 0.3/tistory 0.2/blogger·WP 0.5 · alt 는 prompt 파생). 완료: 글 실호출 1건(t207 piece 330 · $0.34 · 캡션 1/6 «자리마다 쪽지랑 같이 올려두니 뿌듯했어요» · 묘사문 0) · 단독어 5개(`1a290df`). 남은 것: R2 `autocreate/207/` 잔재 + `r2Delete` 헬퍼 · B2 몫 `lib/publish/wordpress.ts:71` alt_text 를 `piece_assets.meta.alt` 로.
3. ✅ **A 머지됨(main `d0b186e`)** · 🔴 정정 진행 중 — «이번엔 건너뛰어요» 화면 규칙(자리 날짜−오늘 < lead)은 **틀렸다**(제작 스텝 창은 «오늘~오늘+lead» = lead 안 자리도 다음 produceHour 틱에 만든다). 서버 `skipReason:"too_soon"`(B) 만으로 판정하게 A 수리 중: `8dfa5a1` «내 소재 넣기» 시트(→ director 직행 · duplicate→기존으로 · «직접» 필 · «검색량 모름») · 자동 편성 꺼짐 배너(홈·편성표 · 켜기 동기화 · 규칙 0 숨김) · «이번엔 건너뛰어요»(skipReason too_soon 우선). 스샷 `_shots/r6f-*.png`.
4. ✅ **B2 머지됨**: `scripts/build-runner.mts`(재현 가능 zip · 의존성 0 zip 코덱) → R2 `autocreate/runner/v1.1.3.zip`+`latest.json` · `/api/runner-download`(로그인·«플랜 한도>0»·감사 · 10분 presign) · 하트비트 자동 업데이트(sha256 · 옛 판 보존) · 기기 지문(`x-runner-fp` 전 요청 · 인증 자리) · `/api/runner-rotate`(지문도 초기화) · 실측 23/23 · 하니스 trial. **셀렉터 서버 배포 = 1단계(표만 · 버전+카나리+폴백) R7 · 2단계(절차 DSL) 보류** · 복제 방어선 = «봐도 못 굴린다»(토큰·테넌트·묶기). 🔴 화면은 A 진행 중(내려받기 버튼이 JSON 새 탭 → API→url).
5. ✅ R6.5 코드 전부 main(`5582363`) · **C 1차 진행 중 · 2차(skipReason·러너 배포 절) 예고됨** → «배포 가능» → 배포 #7. ✅ B2 `8c627dd` 파일명 서명(`autocreate-runner-v1.1.4.zip`)·«열쇠» 통일 머지.
6. ✅ **설계 대비 전수조사 완료**(main `0ec19ed` · `docs/active/2026-09-15-DESIGN-AUDIT.md` 562행 · ✅373 🟡29 🟠81 🔒10 ❌33 ➖32 · §0.2 상위 20 · §0.3 영상 축 = **미개통 + 뒤 두 칸(mp4 받기·주소 적기) 없음** · §0.4 R7 묶음 3 · §0.5 설계 문장 갱신 후보 · §0.6 사장님 결정 7) → **R7 계약의 유일한 입력**. (분담: 새 B 통합+§0·1·3·5B·13·17·19+특별 항목 / B2 §2·8·9 / B-1 §4·5·5C·16B·6·10 / B §7·11·12·14·15·16 / A 시안↔화면 · 각자 `docs/active/audit/2026-09-15-<역할>.md`) → 결과 `DESIGN-AUDIT.md` 의 «R7 제안 묶음 3» 이 다음 라운드의 유일한 입력. 사장님이 짚은 것: 영상 축이 고객 화면에 안 보임(레지스트리 planned) · «있지만 안 되는 것» 많음 · 탈퇴 시 R2 파기 없음(B-1 발견).

### 사장님 결정 대기
- **실제 발행 GO** — 198 의 12:30 예약 글(@endyd116 실블로그)을 진짜 올릴지(러너를 이 PC 에 붙임 + 네이버 로그인 1회 필요). 러너 패키지가 없어 «집PC」 등록만 된 상태.
- **러너 방향 3개**: ①관리형 기본 vs 옵션 ②요금 단위(계정당/대당) ③프록시 비용 포함/별도 → **R7**(러너 팜 · 계정별 주거용 프록시(`proxyUrl` 자리 있음) · 셀렉터 서버 배포).
- 116(pro · MRR 49,000)을 0 으로 할지.

### 사장님 액션 — 🔴 **전부 `docs/active/2026-09-15-OWNER-CHECKLIST.md` 로 모았다**(사장님 지시 2026-09-15: «내가 해야 될 것들은 모든 개발 끝나면 마지막으로 메인이랑 진행하면서 조율하자»)
- **어떤 세션도 사장님을 기다리며 멈추지 않는다** — 준비(리허설·명령 한 줄·되돌리기)까지 하고 다음 일로 간다. 실행은 개발 끝난 뒤 합동 세션에서 한 번에.
- 합동 세션 9항목(실발행·티스토리 재로그인·대청소 Allow·회사 정보·admin 비번·채널 개통 확인·관리형 가격·AM 코인 키·라이브 한 바퀴) · 바깥 절차 4(유튜브 심사·법률·키·KICC 코드)는 언제든 먼저 시작 가능.

### (옛) 사장님 액션(바깥)
1 **유튜브 OAuth 앱 + 심사**(영상 채널 열쇠 · 수 주) · 2 약관 법률 검토·통신판매업 · 3 사업자 정보(회사 정보)·admin 비번 · 4 TYPECAST·쿠팡·Meta·Threads 키 · KICC 결제수단 코드(간편결제) · ~~복귀 주소~~ ~~KEYIN 시크릿~~.

### R7 후보
러너 팜(관리형 기본) · 프록시 배정 화면 · 셀렉터 서버 배포 · 관리형 가격 요금제 편집 · 인증 메일 배경화 · 릴스 90초 · 틱톡·페북 · AM↔AC 코인 이전 AM 쪽 · 유튜브 쇼핑 태그.

---

## 7. 문서 지도
`CLAUDE.md` · `docs/DESIGN.md` · `docs/rules/PITFALLS.md`(**AC-1~59**) · `PARALLEL_GUIDE.md` · 계약 R1 v1.3/R2 v2.11/R3 v3.5/R4 v4.5(§1.6 KICC)/R5 v5.6/R6 v6.0 · **`docs/active/KICC-GO-LIVE.md`** · `C-HANDOFF.md`·`R5-B-HANDOFF.md` · `SESSION-TRIGGERS.md` · `R6-screen-list.md` · `2026-09-14-R5-presurvey-video.md` · `docs/history/*-C-report.md`(R1~R6) · `docs/screens-v4.html` · `PROJECT_STATE.md`.

## 8. 메인 운영 습관
판단 필요한 것만 답한다 · 계약은 파일에 먼저 · 세션이 내 오류를 잡으면 그대로 인정(오늘 6번) · 머지 B→B2→A→C · 머지마다 tsc+build+2함수 grep · push=배포 → API ready → 라이브 스모크(증거) → 문서 갱신 · 증거 없는 실증 금지 · 초록도 빨강도 의심 · 사장님께 사람말·결과만 · 창 구분은 보고 첫 줄 · 라이브 변경은 그 창에서 Allow · **사장님이 짚은 건 즉시 발주**.
