# HANDOFF.md — AutoCreate 메인 세션 인수인계 (압축/새 세션용 단일 정본)

> 갱신 2026-09-15 · 작성자 = 메인(`autocreate-ca`) · **압축 후 새 메인 세션은 이 문서 + `docs/active/RESUME-TRIGGER.md` 를 먼저 읽는다.**
> 이 문서는 «지금까지의 서사»다. 규칙은 `CLAUDE.md`, 설계는 `docs/DESIGN.md`, 라운드 계약은 `docs/active/*-contract.md`, 함정은 `docs/rules/PITFALLS.md`(AC-1~46) 가 정본이고 여기서 요약·연결만 한다.

---

## 0. 한 장 요약

**AutoCreate(AC)** = 부수입을 원하는 개인이 여러 계정으로 글·영상을 AI로 만들어 자동 발행하고 광고·제휴 수익을 한 곳에서 보는 토스형 SaaS. AM(AutoMarketing)의 엔진을 이식하고 겉(제품·화면·계정 모델·수익 집계·결제·운영센터)은 새로 짰다.

- **개발 라운드 전부 종료**: Phase 0 · R1 · R2 · R3 · ui-v4 · R4 · R5 · R6 + KICC 이중 MID. 설계(`docs/DESIGN.md`) 대비 미개발 = 외부 선결조건(유튜브 심사 등)이 막은 것 + **§6 «사장님 실측 발견 5건»(진행 중)**.
- **라이브 = main `e7bd0c7`**(배포 #6 + 핫픽스 6회) · https://autocreate-endyd.netlify.app · GitHub `endyd116-dot/AutoCreate` · push = 배포(메인 단독)
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
| 핫픽스 | `7ae8e78`→`2278ae7`→`f6c7eaa`→`f935034`→`7e0616e`→**`e7bd0c7`** | 티스토리 HTML · KICC 콜백 POST · 확인용 JSON · 빌키 keyin 고정 · 결과표 · 결제 실패 사유 시트 |

### 라이브에 있는 것
- **글 축**: 소재 → 디렉터(§5.3 6규칙·손보기) → 글·이미지(7채널 계약·AI티 8검사·고지) → 검수 → **편성표 자동 시계 7스텝** → 발행(네이버·티스토리 러너 / 블로거·WP API) → 승계 → 알림함.
- **수익**: 커넥터 5종(키 없으면 `not_configured` 정직) · 러너 스크랩 3종(**애드포스트 전 구간 라이브 실증**) · 홈 «오늘 번 돈»(확정+예상) · 신청 조건 게이지 · 학습 되먹임.
- **장사**: 체험 14일 → readonly · 코인(팩 3 + pack_trial) · 구독(월/연) · **KICC 이중 MID(auth/keyin · pg_mid · secretForMid)** · 플랜 게이트 · 운영센터 12메뉴 · 자동 티켓 · 원격접속 · 약관 4문서(«법률 검토 전») · 회사 정보.
- **영상**: provider 사다리(Omni·Veo·fal·스텁) · TTS(타입캐스트/Gemini) · SRT · **11축 심사 3등급(ffprobe 실측)** · 원가 관문(`checkAiCostCap` 재사용 · 소프트 통과/하드 ×3 환급) · 프레임 지문 · 러너 렌더(ffmpeg·BGM 12곡·배지) · 출구(유튜브 private·릴스·쓰레드·클립 스텁) · 화면 8.
- **R6**: 내보내기 ZIP(7일) · 공유 카드 PNG(핸들 숨김 기본) · 추천인 · 영수증 인쇄 · 세금계산서 요청 · 관리형 러너 신청 · 백업 상태(PITR 7일 · R2 버전관리 없음) · AC-36 await 전수 · 티스토리 HTML 모드.

### 러너 실증 매트릭스
네이버 ✓(사진·서식·카나리) · 티스토리 ✓(HTML 모드 · **세션이 짧아 사람 2FA 필요** · `--reuse-tid=109` 는 티스토리 전용 회피책) · 블로거/WP 자격 없음 정직 정지 · **실제 «발행» 0건**(전부 임시저장). 🔴 **러너 배포 패키지 없음**(다운로드 404 · `npx ac-runner` 는 존재하지 않는 패키지 · B2 수리 중).

### 라이브 데이터·env(오늘)
- `channel_registry` 4 active(naver_blog·tistory·blogger·wordpress)/6 planned(유튜브 OAuth 앱 없어 못 켬).
- env: `FX_USD_KRW=1400`(원가 기준값) · `BGM_LICENSE_VERIFIED=1` · **`KICC_MODE=live`·`KICC_MALL_ID`·`KICC_MALL_ID_KEYIN`·`KICC_API_DOMAIN`(ON 이식)·`KICC_SECRET_KEY`(사장님 제공·is_secret)** · deps `@resvg/resvg-js` + `assets/fonts/Pretendard-*.otf`.
- Neon PITR **1일→7일**(메인 API).
- **테스트 계정 198 `test@autocreate.kr`/`autocreate12`** = 사장님 결제 테스트 계정 · 빌키 토스뱅크 ****0542 **보존** · **정리 완료 → trial · 자동청구 해제됨**.
- 보존 4집: 3·13·109·116(pro · MRR 49,000 은 이 집).

---

## 3. 세션 지도 · 워크트리

| 세션(`ListAgents`) | 역할 | 폴더 | 브랜치 | 압축 시점 상태 |
|---|---|---|---|---|
| `autocreate-ca` | 메인 | `AutoCreate` | `main` | — |
| `autocreate-b-ae` | **B**(결제·운영센터·감사) | `AutoCreate-B` | `fix/r4-audit-await` | 테스트 정리 완료 · 대기 |
| `autocreate-b-53` | **B-1**(영상·내보내기·소재) | 창은 `AutoCreate-B` · **`cd ../AutoCreate-B1`** 로 일함 | `feature/p1r6-back1` | `topics-add` API · 캡션/프롬프트 분리 발주 중 |
| `autocreate-b2-e4` | **B2**(러너·발행) | `AutoCreate-B2` | `feature/runner-dist` | 러너 배포 zip·인증 다운로드·자동 업데이트·기기 묶기 발주 중 |
| `autocreate-a-cc` | **A**(화면) | `AutoCreate-A` | `feature/p1r6-front` | «+ 내 소재 넣기»·자동편성 꺼짐 안내·건너뜀 표시 발주 중 |
| `autocreate-c-41 [3d0736]` | **C**(검증·새 세션) | `AutoCreate-C` | `verify/p1r5` | 대기 |
| ~~`autocreate-c-41 [b3f2d6]`~~ ~~`autocreate-b-8a`~~ | 옛 C·옛 B-1 | — | — | 빈 창 |

- 🔴 B·B-1 이 `AutoCreate-B` 폴더를 공유해 창 표시가 같다 → **모든 보고 첫 줄 = `■ 역할 · 폴더 · 브랜치 · 지금:`**(전 세션 적용). 커밋 전 `git branch --show-current`.
- 🔴 **라이브 데이터 변경은 그 세션 창에서 사장님 Allow** — 메인 승인은 다른 창을 열지 못한다. B 창은 auto 모드라 상자 자체가 안 뜬다(분류기 차단) → 사장님이 모드를 바꾸거나 메인이 직접(사장님 «청소해» 승인 있음 · 메인 창은 node 스크립트로 라이브 DB 쓰기가 됐다: 레지스트리 UPDATE·BGM 시드).

---

## 4. 인프라·키 (전부 등록)

- **Neon** `old-tree-90235056` · DDL `node scripts/neon-migrate.mjs`(0001~0011) · 키 `~/.neon-am-key` · PITR 7일.
- **Netlify** site `a14524de-ebfa-46e8-a116-dbc87343f276` · PAT `nfp_bB2BR1…`(AM 메모리 `neon-netlify-remote`) · **AC-8** 다른 사이트 secret 은 `****`.
- **R2** 버킷 `autocreate` · 버전 관리 없음(AC-37).
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

## 6. 열린 항목

### 진행 중(압축 시점 · 세션별 발주)
1. ✅ **테스트 정리 완료**(2026-09-15 · 사장님이 B 창에서 직접 Allow · 감사 `ops_live_cleanup`): 160·196·197 삭제 · t189 trial+queued 잡 14 삭제 · **198 trial + `next_billing_at NULL`(10/15 자동청구 해제)** · 빌키 ****0542 보존 · 인보이스 #10 refunded 보존 · 포함코인 33 회수. **MRR 73,000 → 49,000**(116 pro 만) · 활성 유료 1 · 보존 4집 생존.
2. **B-1**: `POST /api/topics-add`(직접 소재 · 검색량 조회 · 금칙·중복·일 20) · 캡션/프롬프트 분리(`captionRate` · 묘사문 금칙).
3. **A**: «+ 내 소재 넣기» 시트(→ director) · 자동 편성 꺼짐 안내+토글 · 오늘·내일 자리 «이번엔 건너뛰어요».
4. **B2**: `build-runner.mjs` → R2 zip + `latest.json` · `/api/runner-download`(로그인·플랜 게이트·감사) · 하트비트 자동 업데이트(sha256·옛 판 보존) · 기기 지문 묶기+토큰 재발급 · 셀렉터 서버 배포는 설계 보고.
5. 2~4 머지 → **C 검증 발부**(`verify-p1r6.mjs` 확장) → 배포 #7.

### 사장님 결정 대기
- **실제 발행 GO** — 198 의 12:30 예약 글(@endyd116 실블로그)을 진짜 올릴지(러너를 이 PC 에 붙임 + 네이버 로그인 1회 필요). 러너 패키지가 없어 «집PC」 등록만 된 상태.
- **러너 방향 3개**: ①관리형 기본 vs 옵션 ②요금 단위(계정당/대당) ③프록시 비용 포함/별도 → **R7**(러너 팜 · 계정별 주거용 프록시(`proxyUrl` 자리 있음) · 셀렉터 서버 배포).
- 116(pro · MRR 49,000)을 0 으로 할지.

### 사장님 액션(바깥)
1 **유튜브 OAuth 앱 + 심사**(영상 채널 열쇠 · 수 주) · 2 약관 법률 검토·통신판매업 · 3 사업자 정보(회사 정보)·admin 비번 · 4 TYPECAST·쿠팡·Meta·Threads 키 · KICC 결제수단 코드(간편결제) · ~~복귀 주소~~ ~~KEYIN 시크릿~~.

### R7 후보
러너 팜(관리형 기본) · 프록시 배정 화면 · 셀렉터 서버 배포 · 관리형 가격 요금제 편집 · 인증 메일 배경화 · 릴스 90초 · 틱톡·페북 · AM↔AC 코인 이전 AM 쪽 · 유튜브 쇼핑 태그.

---

## 7. 문서 지도
`CLAUDE.md` · `docs/DESIGN.md` · `docs/rules/PITFALLS.md`(**AC-1~46**) · `PARALLEL_GUIDE.md` · 계약 R1 v1.3/R2 v2.11/R3 v3.5/R4 v4.5(§1.6 KICC)/R5 v5.6/R6 v6.0 · **`docs/active/KICC-GO-LIVE.md`** · `C-HANDOFF.md`·`R5-B-HANDOFF.md` · `SESSION-TRIGGERS.md` · `R6-screen-list.md` · `2026-09-14-R5-presurvey-video.md` · `docs/history/*-C-report.md`(R1~R6) · `docs/screens-v4.html` · `PROJECT_STATE.md`.

## 8. 메인 운영 습관
판단 필요한 것만 답한다 · 계약은 파일에 먼저 · 세션이 내 오류를 잡으면 그대로 인정(오늘 6번) · 머지 B→B2→A→C · 머지마다 tsc+build+2함수 grep · push=배포 → API ready → 라이브 스모크(증거) → 문서 갱신 · 증거 없는 실증 금지 · 초록도 빨강도 의심 · 사장님께 사람말·결과만 · 창 구분은 보고 첫 줄 · 라이브 변경은 그 창에서 Allow · **사장님이 짚은 건 즉시 발주**.
