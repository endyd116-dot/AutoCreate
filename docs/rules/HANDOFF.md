# HANDOFF.md — AutoCreate 메인 세션 인수인계 (압축/새 세션용 단일 정본)

> 갱신 2026-09-14 · 작성자 = 메인(autocreate-ca) · **압축 후 새 메인 세션은 이 문서 + `docs/active/RESUME-TRIGGER.md` 를 먼저 읽는다.**
> 이 문서는 «지금까지의 서사»다. 규칙은 `CLAUDE.md`, 설계는 `docs/DESIGN.md`, 라운드 계약은 `docs/active/*-contract.md` 가 정본이고 여기서 요약·연결만 한다.

---

## 0. 한 장 요약

**AutoCreate(AC)** = 부수입을 원하는 개인이 여러 계정으로 글·영상을 AI로 만들어 자동 발행하고 광고·제휴 수익을 한 곳에서 보는 토스형 SaaS. AM(AutoMarketing)의 엔진을 이식하고 겉(제품·화면·계정 모델·수익 집계)은 새로 짰다.

- 라이브: **https://autocreate-endyd.netlify.app** (Phase 0 배포본 `d2a4994` · **P1R1·P1R2 는 아직 미배포** — 사장님 지시: «배포는 라운드 끝나면 묶어서»)
- GitHub `endyd116-dot/AutoCreate` · main 은 메인 세션만 push(= 배포)
- 운영센터 `/ops` · 초기 운영자 `admin` / `admin1234`(첫 로그인 비밀번호 변경 강제 — **사장님이 아직 안 바꿈**)
- MIS 허브 SSO 카드 ⑥ 라이브(tbfa.co.kr) — `sso-autocreate` + `AUTOCREATE_SSO_SECRET` 등록 완료

---

## 1. 사장님(Swain) 지시 — 전역·항구 규칙

| # | 지시 | 반영 위치 |
|---|---|---|
| 1 | **전본 개발** — 설계도 대비 누락·왜곡·축소·요약 금지. 순서만 나누고 내용은 안 깎는다 | `CLAUDE.md §8` · `PARALLEL_GUIDE §4.5` · 메모리 `full-spec-no-reduction` · 트리거마다 «설계 대비 범위 지도» |
| 2 | **UI = 깔끔·세련·심플 + 기능은 전적으로 토스형** | `DESIGN §13.0`(헌장·반려 가능 규칙) · `§13.0b`(토스 패턴 사전 19기능) · 시안 `docs/screens-v3.html` |
| 3 | **파란색 촌스럽다 → 잉크 블랙 액센트** | `DESIGN §13.4` v3 토큰 · `public/css/ac.css` |
| 4 | **모든 화면 KST** (고객·운영자·메일·내보내기) | `DESIGN §13.5` · `CLAUDE §4.5b` · 계약 v2.6 |
| 5 | **라운드 파이프라이닝** — C 검증 중 메인은 N+1 설계·A/B 발사 · **C 결함은 C 가 직접 수리** | `PARALLEL_GUIDE §2.6` |
| 6 | **배포는 라운드 끝에 묶어서** | 이 문서 §6 |
| 7 | 러너는 **AM 러너 참조**(AM 이 블로그를 디테일하게 만들어놨다) | P1R2-B2 트리거 · B2 에 전달 완료 |
| 8 | B·B2 분할(백엔드 2세션) · A·B 는 라운드마다 새 세션 · C 는 유지 | §3 세션 지도 |

---

## 2. 지금 상태 (2026-09-15 · **개발 라운드 전부 종료 · 배포 6회**)

### 라이브 = main `4d06070`(배포 #6) — https://autocreate-endyd.netlify.app
| 배포 | 커밋 | 내용 |
|---|---|---|
| #1 | `d2a4994` | Phase 0 뼈대 |
| #2 | `e33807d`(+핫픽스 `ebbe372`) | R1 글 파이프 · R2 자동 편성·러너 발행·승계 · R3 수익 |
| #3 | `0f3ec44` | R4 결제·체험·**운영센터 12메뉴**·CS·약관 |
| #4 | `e5458f8` | **R5 영상 축** + KICC 이중 MID |
| #5 | `79dfe6a` | R6 내보내기·공유카드·추천인·영수증·관리형 러너·백업 |
| #6 | `4d06070` | R6 마감(공유 카드 금액 캐시 수리) |

### 라운드별 완료
Phase 0 · R1 · R2 · R3 · **ui-v4**(시안 v4 11장 = 픽셀 정본) · R4 · R5 · R6 · KICC 이중 MID. **설계(`docs/DESIGN.md`) 대비 미개발 = 외부 선결조건이 막은 것뿐.**

### 이 프로젝트가 만들어 낸 규율(다음 사람이 이어받을 것)
- `docs/rules/PITFALLS.md` §0 **AC-1~AC-41** — 전부 «실제로 돌려서» 나온 것.
- `docs/active/C-HANDOFF.md` — 검증 방식 정본 · 하니스 14종 · **«빨강을 의심하는 데 드는 시간이 이 일의 본체»**(R5·R6 에서 C 의 빨강 14건이 «검사가 틀린 것»이었다).
- `docs/active/R5-B-HANDOFF.md` — 영상·내보내기 인수인계.
- `docs/active/KICC-GO-LIVE.md` — 키 쥔 날 이 문서 하나로 끝난다.
- `docs/active/SESSION-TRIGGERS.md` — 새 세션 트리거.

### 🔴 남은 것 = 전부 «바깥»
| 순위 | 항목 | 지금 상태 |
|---|---|---|
| 1 | **유튜브 OAuth 앱 + 심사** | 없으면 영상 채널 6개를 못 켠다(`planned`) · 심사 수 주 · 코드는 완성 |
| 2 | **KICC 2·3단계**(사장님 카드 1회) | 키 등록 완료 · `mode:live` · 1단계(거래등록) 통과 · ₩5,500 → 전액 환불 절차 |
| 2 | **티스토리 로그인 1회**(카카오 2FA) | B2 가 한 세션에 로그인→HTML 모드→발행 품질까지 끝내게 준비 완료 |
| 3 | 약관 4문서 법률 검토 · 통신판매업 신고 | 초안 + 동의 화면 완성(«법률 검토 전» 배지) |
| 4 | 사업자 정보(운영센터 «회사 정보») | 넣으면 영수증·약관 하단이 같이 산다 |
| 4 | admin 비밀번호 변경 | 아직 `admin1234` |
| 5 | TYPECAST·쿠팡·Meta·Threads 키 · KICC 복귀 주소 2개·결제수단 코드 | 전부 «키 꽂으면 즉시» |

### 배포 후 대기 작업(사장님 GO 뒤)
- 티스토리 라이브 실증 → C 검증 · KICC 2·3단계 → B 라이브 스모크 → 결제 라이브 절.

## 3. 세션 지도 · 워크트리

| 창 | 폴더 | 브랜치 | 비고 |
|---|---|---|---|
| 메인 | `dev/AutoCreate` | `main` | push·머지·배포 단독 |
| A | `dev/AutoCreate-A` | `feature/p1r2-front` | **머지 완료 · 창 닫아도 됨** |
| B | `dev/AutoCreate-B` | `feature/p1r2-back` | 진행 중 |
| B2 | `dev/AutoCreate-B2` | `feature/p1r2-back2` | 진행 중 |
| C | `dev/AutoCreate-C` | `verify/p1` → fix `fix/p1-c4` | 진행 중 |

- 각 워크트리에 `.env`(git 미추적) 복사본 · `.claude/settings.local.json` 으로 **push 차단**.
- 세션 이름은 `ListAgents` 로 확인(재시작하면 바뀐다). 소통은 `SendMessage`.

---

## 4. 인프라·키 (전부 등록 완료 — 새 세션이 다시 만들 것 없음)

- **Neon**: 프로젝트 `old-tree-90235056`(us-east-2·pg18·db neondb) · DDL = `node scripts/neon-migrate.mjs <sql>` · Neon API 키는 `~/.neon-am-key`
- **Netlify**: site `a14524de-ebfa-46e8-a116-dbc87343f276`(`autocreate-endyd`) · PAT·플레이북은 AM 메모리 `[[neon-netlify-remote]]`
- **등록된 env**(production+dev): DB(pooled/unpooled) · JWT_SECRET · ACTION_TOKEN_SECRET · CREDS_ENC_KEY · SSO_SHARED_SECRET/SSO_AUD · RUNNER_TOKEN_SECRET · INTERNAL_SECRET · CRON_SECRET · GEMINI_API_KEY · RESEND_API_KEY/RESEND_FROM · R2_*(5) · SITE_URL · NAVER_SEARCHAD_*(3) · NAVER_OPENAPI_*(2)
- **로컬 `.env` 에만**(git 미추적 · 워크트리 4곳 동기화): `TEST_TISTORY_*`(카카오 로그인 · 블로그 note83685) · `TEST_NAVER_ID/PW`
- ⚠️ **AC-8**: AM 사이트에서 env 를 복사하면 **production secret 은 마스킹(`****`)되어 온다**. R2·네이버 오픈API 자격이 그래서 죽어 있었고 MIS 사이트 실값으로 교체했다. 복사 후 길이·머리글자 확인 + 실호출 1회 검증 필수.

---

## 5. 결정 로그 (왜 그렇게 했는지 — 다시 묻지 않도록)

| 주제 | 결정 |
|---|---|
| 슬롯 게이트 | **fail-closed** — `confirm()` 의 origin 기본 `auto`, 사람 경로만 `manual` 명시. 슬롯 없는 자동 생성은 거부 + `piece_slotless_blocked` 감사 + 홈 노출 |
| `reassigned` 의미 | 아직 안 나간 자리 = **행 살리고 계정만 교체** · 이미 `publishing` 인 자리만 종결하고 새 행 생성(달력에 «넘김»·«예약» 둘 다) |
| 계정 전이표 정본 | **`lib/account-health.ts`(B)** — B2 `runner-block.ts` 는 «날것 실패 → RunnerErrorKind» 까지만, 표는 import(방향 B2→B · 순환 0) |
| 발행 성공 + finalize 실패 | `{ ok:false, reason:"config", retriable:false }` — **재시도 금지**(중복 글 방지) · `publish_finalize_failed` 감사 |
| 발행 멱등 | `finalizePublish` 조건부 UPDATE 선점(API 성공 ↔ 러너 report 동시에도 posts 1행) |
| 검수 게이트 | 판정기 정본 `lib/content-approve.ts` 한 벌 · `pieces.ts`·크론이 같은 함수 호출 · 자동 승인이 하드 게이트를 통과시키는 경로 0 |
| autoSchedule 게이트 | roll·assign_topics·produce·review_deadline 만 적용 · publisher·learn·reap 은 무관(사람이 승인한 글은 나가야 한다) |
| 계정 삭제 | 소프트(`disconnected` + `last_error_kind='removed'` · creds purged) · 목록·한도에서 제외 · 같은 핸들 재연결 시 초기화 후 되살림 |
| 시각 전달 | `slots-reschedule.at` = **UTC ISO(화면이 KST→UTC 변환)** · 서버 재해석 금지 / `preferredHour`·`produceHour` = **KST 벽시계** / `slot_date`·`day` = KST 날짜 |
| 코인 | piece 당 1회(멱등 ref) · 재생성 무료(실패 환급분만 `:regen{n}` 재차감) · 자동 경로는 included 우선(`auto:true` = 충전분은 옵트인 시만) |
| 자격 평문 표면 | 러너 claim 응답 **1곳뿐** + `runner_creds_issued` 감사 · 쿠키 유효하면 login 미포함 |
| 크론 구조 | 함수 2개(`cron-tick-5m`·`hourly`) 우산 · 스텝 등록기 · 테넌트 격리·예산 배분·회전 · `cron_tick` 전건 1행 + 일 있는 스텝만 개별 행 |
| 티스토리 | **API 없음**(2024-02 종료) → 러너 필수 · HTML 모드 1순위 · 카카오 로그인 경유 |

---

## 6. 열린 항목 (다음 세션이 이어서 할 일)

### 즉시(P1R2 마감 경로)
1. ✅ C fix 머지 · ✅ A 머지 · ✅ B2 머지
2. **B 완료 대기** → 머지(B5·B6·알림함·topics 배경화)
3. **A 추가분**(소재 뽑기 폴링 화면) 머지
4. **B2 셀렉터 실증** — 계정 해제됨(티스토리 카카오 승인 완료 · 네이버 새 비번 `.env` 갱신). 2단계가 다시 뜨면 사장님께 «지금 카카오톡 눌러 주세요» 전달 필요. 성공하면 `sweepFormatting` 이식까지.
5. **C 2단계**(P1R2 전체 검증) 발부 → 결함 자체 수리
6. **배치 배포**(라운드 끝 · P1R1+P1R2 한 번에) → 라이브 스모크 → 라운드 마감 보고

### 사장님 액션 대기
- `admin` 첫 로그인 → 비밀번호 변경
- **티스토리 카카오 2단계** — 러너가 로그인 창을 띄우면 휴대폰에서 승인 1회(5분 제한). 2단계 화면의 «이 브라우저에서 2단계 인증 사용 안 함» 을 직접 켜면 이후 자동화가 매끄럽다(우리가 대신 켜지 않는다)
- 네이버 개발자센터: 해당 앱에 **데이터랩(검색어 트렌드) API 추가** → `growthPct` 실값(지금 401 Scope Status Invalid)
- 쿠팡 파트너스 키(계정별) · 블로거/Meta/Threads/TikTok **OAuth 앱 키** — 없으면 `provider_not_configured` 정직 경로(코드는 완성)
- 워드프레스 테스트 사이트(있으면 WP 발행 실증)

### 🔴 열린 위험 — topics-refresh 동기 한도 → **배경화로 처리 중**(사장님 지시 2026-09-14)
«재지 말고 처음부터 배경으로» 지시에 따라 계약 v2.9 신설: `topics-refresh` 202 즉시 반환 + `topics-refresh-background`(15분) + `topics-list.refresh{running,…}` 폴링 + 고아 방지(10분). B(서버)·A(화면 폴링) 에 발주 완료. **이 라운드 안에 닫는다.**

### 다음 라운드 후보(P1R3 / Phase 2)
수익 회수(애드센스·쿠팡·유튜브 API + 애드포스트 러너 스크랩) · 정지 승계 실증 · 슬롯 시트 R2 동작(소재/시각 바꾸기·지금 만들기는 R2 에 이미 들어감 — 남은 건 학습 되먹임) · 관리형 러너 팜 · 운영센터 나머지 메뉴(요금제·이벤트·CS·AI·채널·공지) · KICC 결제.

---

## 7. 문서 지도

| 파일 | 내용 |
|---|---|
| `CLAUDE.md` | 프로젝트 규칙(§3 UX·§4 컨벤션·§4.5b KST·§4.7 절대 게이트·§5 병렬·§8 전본) |
| `docs/DESIGN.md` | 설계 정본(§2 채널·§4 상태기계·§5 디렉터·§5B 편성표·§5C 글 고도화·§7 다계정·§8 러너·§9 수익·§11 SaaS/운영센터·§12 가격·§13 UI·§16B 정책·§17 로드맵·§19 체크리스트) |
| `docs/rules/PARALLEL_GUIDE.md` | 병렬 규칙(§2.5 동시 발사·§2.6 파이프라이닝·§4 자율주행·§4.5 전본) |
| `docs/rules/PITFALLS.md` | §0 AC-1~8(AC 고유) + AM 원본 8,218줄 |
| `docs/rules/TRIGGER-TEMPLATE.md` | 트리거 양식·발부 체크리스트 |
| `docs/active/2026-09-14-P1R1-contract.md` | R1 계약 v1.3(키 이름·§4B bodyHtml class) |
| `docs/active/2026-09-14-P1R2-contract.md` | R2 계약 v2.7(크론·러너·커넥터·계정 전이·화면·§12 C 겹침) |
| `docs/screens-v3.html` · `screens-web-v1.html` | 시안 정본(폰·데스크톱) |
| `PROJECT_STATE.md` | 휘발성 상태(라운드·다음 할 일) |

---

## 8. 메인 세션 운영 습관(이어서 지킬 것)

- A·B·B2·C 보고가 오면 **판단이 필요한 것만** 답하고 승인/정정은 한 메시지로 묶는다. 계약이 바뀌면 **계약서 파일에 먼저 적고**(vN.N) 세션에 알린다.
- 세션이 계약 구멍을 찾으면 **채택 여부를 즉답**하고 담당(A/B/B2)을 지정한다. 지금까지 구멍 6건이 그렇게 메워졌다.
- 파일 겹침은 계약 §12 에 기록해 미리 피하게 한다.
- push 는 «검증 끝난 기능 배치»일 때만(배포 = 비용). docs·규칙은 commit만.
- 보고 어휘: 증거(URL·row id·스샷) 없으면 «실증» 이라고 쓰지 않는다 — 세션들에게도 같은 기준을 요구한다.
