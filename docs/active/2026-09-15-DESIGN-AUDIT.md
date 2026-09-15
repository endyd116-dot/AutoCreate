# 설계 대비 구현 전수조사(DESIGN AUDIT) — 통합본 · 2026-09-15

> 사장님 지시(2026-09-15): «R1~R6 다 끝냈다고 했는데 설계도 대비 구현된 것·안 된 것을 전수조사해서 더 개발할 것을 진단해라. 영상 관련은 전부 빠져 있고, 기능은 있지만 제대로 안 되는 것도 너무 많다.»
> 트리거 `docs/active/2026-09-15-DESIGN-AUDIT-trigger.md` · 상태 어휘 §1(✅ 🟡 🟠 🔒 ❌ ➖ ⬜) · 행 형식 §2 그대로. **코드 수정 0 · LLM·이미지·영상 실호출 0 · 테스트 테넌트 1개(212)만.**
> 작성 = B(전수조사 · `AutoCreate-B3` · `audit/design-2026-09-15`) · 증거의 «파일:줄»은 **main `cd913a7`** 기준(C R6.5 1차 머지 뒤).
> 분담(메인 2026-09-15): §2·§8·§9 = B2 `audit/2026-09-15-B2.md` · §4·§5·§5C·§16B·§6·§10 = B-1 `…-B1.md` · §7·§11·§12·§14·§15·§16 = B `…-B.md` · 시안 대응 = A `…-A.md` · **§0·§1·§3·§5B·§13·§17·§19 + 특별 항목 a·b·c + 통합 = 이 문서**. 네 파일은 이 문서의 §8 에서 대조·상위 20 되짚기·❌ 재grep 을 했다.

---

## §0 한 장 요약

### 0.1 상태별 총계(다섯 파일 합 · 판정 단위 = 표 한 행)

| 파일 | 영역 | 행 | ✅ | 🟡 | 🟠 | 🔒 | ❌ | ➖ | ⬜ |
|---|---|---|---|---|---|---|---|---|---|
| 이 문서 §1~§5 | §0·§1·§3·§5B·§13·§17·§19 | 204 | 134 | 6 | 47 | 6 | 5 | 4 | 2 |
| B-1 | §4·§5·§5C·§16B·§6·§10 | 141 | 103 | 4 | 14 | 2 | 8 | 9 | 0 |
| B | §7·§11·§12·§14·§15·§16 | 137 | 106 | 0 | 6 | 1 | 10 | 14 | 0 |
| B2 | §2·§8·§9 | 80 | 33 | 19 | 11 | 1 | 12 | 3 | 1 |
| A | 시안 v4 16장 ↔ 실제 화면(별도 어휘 · 🟠 6) | — | 16장 대응 | — | 6 | — | 0 | — | 1 |
| **합(A 제외)** | | **562** | **376** | **29** | **78** | **10** | **35** | **30** | **3** |

> 합은 각 파일 보고값 그대로. §8.2 되짚기에서 **✅→🟠 정정 3건**(B 추천인 · B 세금계산서/영수증 · B-1 §16B.4 홈)과 **❌→➖ 2건**(B §15 accounts-health·director-settings)을 반영하면 ✅ 373 · 🟠 81 · ❌ 33 · ➖ 32. A 파일은 어휘가 달라(시안 대응표) 합에 넣지 않았다.

읽는 법: ✅ 가 많다고 «됐다»가 아니다 — ✅ 의 대부분은 **글 축 코드·화면**이고, 🟡·🟠·❌ 의 무게가 **영상 축(입구 잠김) · 한 번도 안 지나간 길(API 발행·API 수익·실발행) · 화면은 있는데 서버가 없는 R6 조각(추천인·영수증·세금계산서·회사 정보·코인 이전)** 에 몰려 있다. B2 의 한 줄이 이 조사 전체에 맞다: **«안 만들었다»가 아니라 «만들어 놓고 고객 앞에 안 열었다 · 한 번도 안 통과시켜 봤다».** 그리고 다른 영역 파일의 ✅ 를 되짚은 결과 **✅ → 🟠 로 뒤집힌 것 3건**(§8.2)이 있다 — 자기 영역 감싸기가 실제로 있었다.

### 0.2 🟠/❌ 상위 20 — 고객이 먼저 부딪히는 순(출처 파일 · 크기)

| # | 고객이 부딪히는 자리 | 무엇이 안 되나 | 증거 | 출처 | 크기 |
|---|---|---|---|---|---|
| 1 | **계정 연결 → 영상 채널이 안 보인다** | 그리드가 `status==='active'` 만 그린다 · 라이브 `channel_registry` 영상 4종(youtube_shorts·naver_clip·reels·tiktok) + 쓰레드·인스타 전부 `planned` → 유튜브·클립·릴스에 계정을 붙일 입구 0 → **라이브 영상 piece 0건** | `public/app/accounts.html:38` · 스샷 `_shots/audit-12-accounts-after-add.png`(N·T·B·W 4장만) · `accounts-list.channels` 실측(tid 212) `youtube_shorts:planned` … | 이 문서 §6 · B-1 · B2 · A | **S**(레지스트리 개통 = 운영센터 채널 화면 1클릭 · 사장님 결정) |
| 2 | **영상을 만들어도 내 손에 못 쥔다** | 검수 화면에 mp4 내려받기 0(`download=` 는 SRT 뿐) · `awaiting_manual` 영상의 발행함 시트는 «본문 복사하기»(글용) — «앱에서 직접 올리기» 경로의 마지막 한 칸이 없다 | `public/app/piece.html:56` · `posts.html:75` | 이 문서 §6 · B-1 | S |
| 3 | **기존 가입자는 영상을 켤 화면이 없다** | 온보딩에서만 `settings.kinds` 를 고른다 · 설정 화면에 «영상 만들기» 토글 0 · 온보딩 안 거친 테넌트(예: 212)는 kinds 자체가 없어 디렉터가 영상 piece 를 내지 않는다(`director.ts:170` 기본 `["text"]`) · 라이브 87/99 테넌트 kinds 에 video 없음(B-1) | `netlify/functions/tenant-settings.ts:38` · `public/app/settings.html`(kinds 항목 0) · `auth-me` 실측 tid212 settings `{trialDays,autoSchedule}` | 이 문서 §6 · B-1 | S |
| 4 | **R6 «추천인» — 화면만 있고 서버가 없다** | 가입 «추천 코드가 있어요» 칸은 서버가 버린다(`auth-register.ts` 에 referral 0) · 내 계정 «친구 초대» 행은 `/api/referral` **404** 라 눌러도 아무 일 없음 · 보상 지급 코드 0 | 실측 tid212 `404 /api/referral` · `grep referral netlify/functions/auth-register.ts` 0 · R6 계약 §1.1 담당 B · 전 브랜치 `git log --all -- netlify/functions/referral.ts` 0 | 이 문서 §5(§19) · **B 는 ✅ 로 적었다 → §8.2 정정** | M |
| 5 | **R6 «영수증 페이지·세금계산서 요청» — 서버가 없다** | `public/receipt.html:47` → `GET /api/invoice?id=` 없음(404 → «청구서를 찾을 수 없어요») · `plan.html:90/96` → `/api/tax-profile`·`/api/tax-invoice-request` 없음 · 운영센터 «회사 정보» 화면·표 0(영수증 공급자 정보 출처) | config.path 전수 grep 에 `invoice`·`tax-profile`·`tax-invoice-request`·`ops-company` 0 · R6 계약 §1.2·§1.3 | 이 문서 §5 · **B 는 «세금계산서 요청 기록» ✅ 로 적었다 → §8.2 정정** | M |
| 6 | **홈 «해야 할 일»이 반쪽** | 서버 todo = readonly/suspended · 정지·끊김 계정 · 봐주세요 · 첫 계정/규칙 · 이메일 인증 **뿐**. 설계가 여기 띄우라고 한 것 중 **러너 오프라인(§13.0b) · 직접 올려야 할 글 awaiting_manual(§16B.4) · 코인 부족 슬롯(§5B.9) · 다시 로그인 pending_login(§7.2) · 슬롯 게이트 거부(§5B.6 · `pendingSlotGateBlocks` 호출처 0 = AC-29)** 이 없다 | `netlify/functions/home-summary.ts:32-45` · `grep pendingSlotGateBlocks` 호출처 0 · `home.html` 은 `r.runner` 를 안 읽는다 | 이 문서 §2·§3 | M |
| 7 | **수익 화면이 기기 시간대를 탄다(§13.5 위반)** | `revenue.html:32` 가 KST 로 옮긴 Date 에 다시 `timeZone:"Asia/Seoul"` 을 걸어 **이중 시프트** — 뉴욕 시간대 브라우저에서 «날마다» 축이 «1일~16일»(오늘은 15일) · 지난달 «같은 날까지» 비교도 하루 밀림 | 실측: 같은 페이지를 `timezoneId` Asia/Seoul → «1일 / 15일», America/New_York → «1일 / 16일»(`_shots/audit-22-revenue-after-manual.png` · `audit-probe-app-revenue-html.png`) · 요청 `revenue-daily?…to=2026-08-15` vs `…08-16` | 이 문서 §3 | S |
| 8 | **글 축도 «실제 발행» 0건** | 라이브 posts 성공 = naver_blog 2(임시저장) · 티스토리·블로거·WP·영상 0 · API 수익 5종 0행 → §17 Phase 1·2·4 완료 정의(«URL 이 발행함에 뜬다»·«실돈 루프») 미충족 | B2 라이브 SELECT · HANDOFF §2 «실제 발행 0건(전부 임시저장)» | B2 · 이 문서 §4 | M(실행) |
| 9 | 쓰레드 «글» 이 발행 안 된다 | `TEXT_CHANNELS` 에 threads 가 있어 글 계약·생성은 되는데, `publish/index.ts:184` 가 채널 threads 를 무조건 `publishThreadsVideo` 로 보내 «올릴 영상이 아직 없어요» · 디렉터는 `isVideoChannel(threads)` 가 참이라 애초에 영상 piece 만 낸다(`director.ts:190`) | `lib/publish/threads.ts:76` · `lib/video/types.ts:15` | 이 문서 §1(§3.2) · B-1 | S |
| 10 | 인스타 카드뉴스 = 계약만 | `writing-contracts.ts:147` cardnews 계약은 있으나 디렉터 대상 채널 아님(TEXT/VIDEO 집합 둘 다 아님) · 카드 6~8장 이미지 렌더 0 · 인스타 피드 발행 0(`instagram.ts` 는 REELS 뿐) | grep | B-1 · 이 문서 §1 | L |
| 11 | 데스크톱 «우측 300px 패널 상시 노출» 없음 | CSS `.page.two>.aside` 는 있으나 쓰는 화면 0 — 편성표·디렉터가 시트를 열 때만 오른쪽 패널이 된다(§5B.8·§13.3b «상시 노출» 미충족) | `public/css/ac.css:42` · `grep 'page two\|aside' public/app/*.html` 0 · 스샷 `audit-33-schedule-desktop.png` | 이 문서 §2·§3 | M |
| 12 | 편성 규칙 8칸 중 4칸을 화면에서 못 정한다 | `every` 월 N회/매일 · `weekdays[]` · `preferred_hour` · `format_hint` — API(`rules-save`)는 받는데 규칙 시트는 «주 N회» 스테퍼뿐 · `format_hint` 는 저장돼도 읽는 코드 0 | `schedule.html` ruleSheet(주 N회·계정·검수뿐) · `grep formatHint lib/cron` 0 | 이 문서 §2 | S |
| 13 | 소재 재사용 기간 30일(설계 90일) | 같은 norm_key 재사용 차단이 30일 | `lib/cron/assign-topics.ts:39` `interval '30 days'` · DESIGN §19 «계정당 90일» | 이 문서 §5 | S |
| 14 | 러너 오프라인·PC 세션 파일 평문 | 계정 브라우저 프로필(`runner/profiles/{key}`)이 암호화 없이 디스크에 남는다(§19 «러너 PC 에 남는 세션 파일 암호화») | `runner/lib/browser.mjs:13` · grep encrypt 0 | 이 문서 §5 · B2 | M |
| 15 | 푸시 알림 0 · 설치형 PWA 아님 | 서비스워커 0 → 푸시 딥링크(§13.0b 알림) 없음 · 오프라인 0 · «앱»이라 부르기엔 manifest 뿐 | `grep serviceWorker public` 0 · `public/manifest.webmanifest` | 이 문서 §3 | M |
| 16 | 탈퇴·개인정보 파기 0 | readonly 30일 뒤 «파기 안내» 문구만 · 파기 잡·R2 정리·탈퇴 화면 0 | B §16 | B | L |
| 17 | 팀 시트 = 숫자만 | `team-invite/accept` 0 · member 초대 화면 0 · Agency «팀 승인 흐름» 플래그만 | B §11.0·§12.2 | B | M |
| 18 | 플랜별 채널 게이트 0 · 내보내기 플랜 무관 | Starter 도 전 채널·리포트 내보내기(설계 Pro/Agency) | B §12.2 | B | S |
| 19 | 프레임 지문(다계정 중복 회피) 미작동 | 러너가 지문을 안 보내 pHash 판정이 «지문 없음» 통과 | B-1 §6.2 · `judge.ts:106` | B-1 | L |
| 20 | 네이버 클립 업로드 = 스텁 | `publish.naver_clip` claim 즉시 `not_supported_yet` → awaiting_manual(정직) · PC 업로드 실측·에뮬 0 | B2 §2.2 · `runner/channels/naver-clip.mjs` | B2 · 이 문서 §5(§19 기술) | L |

> 상위 20 밖이지만 사장님이 바로 볼 것: 홈 «첫 계정을 연결해 보세요 — 네이버·티스토리·**유튜브** 중 하나면 돼요» 문구가 유튜브를 못 붙이는 지금 상태와 어긋난다(`home-summary.ts:43`) · 자동 편성 규칙 시트의 코인 미리보기에 «포함분 N 안»이 없다(잔여만) · 툴팁 `title=` 1곳(`piece.html:40` · 헌장 금지) · 하단 탭 눌림 42px·달력 칸 38px(A · 44px 하한) · 가입 응답이 로컬에서 11초(인증 메일 await · 라이브는 미측정).

### 0.3 영상 축 결론(특별 항목 a — B-1 a 절과 대조)

**결론은 B-1 과 같다: «누락»이 아니라 «미개통».** R5 계약 §1 코드(대본→TTS→컷→러너 렌더→11축 심사→출구) · 화면 8장 · 렌더 실측(C R5 보고서)까지 있는데, **첫 문(계정 연결 그리드)이 `channel_registry.status='planned'` 로 잠겨 있어** 고객 경로로는 영상에 한 발도 못 들어간다. 라이브 영상 piece 0건이 그 증거다. 다만 «열쇠 없이 갈 수 있는 최소 경로»로 따라가 보면 **레지스트리를 열어도 끊기는 칸이 4개** 있다(§6 표) — 이것이 R7 묶음 1 의 실제 목록이다:

| 단계 | 지금 | 빠진 것 |
|---|---|---|
| ① 계정 없이 «만들기»에서 영상을 고른다 | ✗ — 디렉터는 «영상 채널 계정이 있을 때만» 영상 piece 를 낸다(`director.ts:174`) · 만들기/디렉터에 «영상» 선택지 0 | 계정 없이 영상을 만드는 길(«아직 채널 없이 만들어 두기» · `kind:"video"` 강제) — 설계 §5.5 손보기의 «채널 토글» 확장 |
| ② 영상을 켠다 | 온보딩에서만 `settings.kinds` · 기존 테넌트 87/99 는 video 없음 | 설정 «영상 만들기» 토글(S) |
| ③ 심사 → 검수 화면 | ✅ `piece.html` 플레이어·자막·심사 축·설명란 | — |
| ④ mp4 내려받기 | ✗ SRT 만 `download=` | «영상 내려받기» 버튼 + 발행함 awaiting_manual 시트에 같은 버튼(S) |
| ⑤ 직접 올리기 → «올렸어요» 표시 | ✗ awaiting_manual 시트는 «본문 복사하기» · 직접 올린 URL 을 적어 published 로 바꾸는 입력 0 | «올린 주소 적기» → posts 1행(멱등) (S) |
| ⑥ 유튜브 OAuth 로 자동 업로드 | 🔒 `GOOGLE_OAUTH_CLIENT_ID` 없음 → «준비 중이에요»(실측) · 코드는 키 꽂으면 즉시(비공개 업로드 · `uploaded_private`) | 사장님 액션(앱 심사 수 주) |
| ⑦ 네이버 클립 | 세션 계정은 API 로 붙일 수 있으나(그리드엔 없음) 업로드는 스텁 `not_supported_yet` → awaiting_manual «앱에서 올려 주세요» | PC 업로드 실측 → 실패 시 에뮬(L) · 우선은 ④⑤ 로 «앱에서 올리기» 정직 경로 |

B-1 이 말한 «운영센터 채널 화면에서 naver_clip 을 active 로 바꾸면 OAuth 없는 경로가 열린다»는 **반만 맞다** — 그리드엔 뜨지만 ④⑤ 가 없어 «만들기 → 내려받기 → 앱에서 올리기»의 뒤 두 칸이 여전히 막힌다.

### 0.4 R7 제안 묶음 3(각 = 항목 + S/M/L 합 + 외부 선결조건)

**묶음 1 — 영상 축 개통(«열쇠 없이 되는 데까지»)** · 합 S×6 · M×1 · L×1(선택) · 외부 선결 = 유튜브 OAuth 앱(⑥만)
1. 레지스트리 `youtube_shorts`·`naver_clip`·`reels` → `active`(운영센터 채널 화면 · **사장님 결정** · S) + 그리드에 «준비 중» 채널을 흐리게라도 그려 «없는 채널»로 보이지 않게(A 🟠 · S)
2. 설정 «영상 만들기» 토글 + 기존 테넌트 `kinds` 마이그레이션(S)
3. 계정 없이 영상 만들기(디렉터 «영상» 선택지 · `kind:"video"` 강제 · 계정 미배정 허용)(M)
4. 검수·발행함 «영상 내려받기» + awaiting_manual «올린 주소 적기»(S+S)
5. 홈 «해야 할 일»에 awaiting_manual·러너 오프라인·코인 부족·재로그인·게이트 거부 추가(#6 · S)
6. 프레임 지문 실제 동작(러너가 대표 프레임 전송 · L · 선택 — 계정 2개 이상 영상부터)
7. (🔒) 유튜브 OAuth 앱 심사 착수 — 코드는 그대로

**묶음 2 — «한 번도 안 지나간 길» 첫 통과 + R6 서버 조각** · 합 S×4 · M×4 · 외부 선결 = 쿠팡·애드센스 키(수익만)
1. 실제 발행 GO(198 예약 글 1건 · 네이버 러너 실발행 → URL 이 발행함에) + 티스토리·블로거·WP 각 1건 실발행(M)
2. 러너 배포 zip 다운로드 → 설치 → 하트비트 → 발행 1바퀴를 «고객 경로»로(B2 runner-dist 머지 뒤 · S)
3. R6 §1 서버: `/api/referral` + 가입 referralCode + 보상 · `/api/invoice?id` + 운영센터 «회사 정보» · `/api/tax-profile`·`/api/tax-invoice-request` (M+M)
4. 쓰레드 글 발행 분기(`kind` 로 갈라 텍스트 POST)(S) · 규칙 시트에 월/매일·요일·고정 시각(S) · 소재 재사용 90일(S)
5. 수익 API 첫 회수 1행(쿠팡 키 또는 애드센스 OAuth 중 먼저 오는 것 · 🔒)

**묶음 3 — 정직 표기·헌장·법·보안 보수** · 합 S×7 · M×3 · L×2 · 외부 선결 = 법률 검토·통신판매업(문서만)
1. 수익 화면 KST 이중 시프트(#7 · S) · 홈 문구 «유튜브 중 하나면»(S) · 툴팁 1곳·탭 44px(S)
2. 서비스워커 + 푸시(알림 딥링크)(M) · 당겨서 새로고침·햅틱(S · 선택)
3. 러너 프로필 폴더 암호화(M) · 계정 자격 보관 동의(`creds_storage` 기록 0 → 연결 시트에 1줄 · S)
4. 탈퇴·파기 흐름(L) · 팀 초대(M) · 플랜 채널 게이트·내보내기 게이트(S)
5. 댓글·DM 비범위 명시(약관·FAQ 1줄 · S) · GitHub Actions 보조 크론 1개(S) · 데스크톱 우측 패널 상시(편성표·디렉터 · M)
6. 네이버 클립 PC 업로드 실측 → 에뮬 결정(L · 사장님 결정 뒤)

### 0.5 설계 문장 갱신 후보(➖ 모음 — «설계를 코드에 맞출지 / 코드를 설계에 맞출지» 사장님이 정할 목록)

| 출처 | DESIGN § | 지금 설계 문장 | 코드·결정의 실제 | 근거 |
|---|---|---|---|---|
| 이 문서 | §3.2 구성도 · §13.2 | 하단 탭 «발행함» | «편성표»로 교체(발행 결과는 편성표 «발행됨» 칩 + 별도 «올라간 글» 화면) | §5B.1 사장님 요청 |
| 이 문서 | §13.4 토큰 | ground `#F7F8FA` · brand `#3060F0` · money `#12B886` · CTA 56 · 반경 999 | v3 토큰(§13.0b 끝)이 대체: `#F2F4F6` · 잉크 블랙 · `#1FA97A` · CTA 54 · R16/R20 — §13.4 는 폐기 표기 필요 | ac.css:5 · 사장님 «파란 배경 촌스럽다» |
| 이 문서 | §13.3b | 시안 정본 `screens-v1.html`/`screens-web-v1.html` · §13.1 «v3» · CLAUDE «v3» | 실제 정본 **v4**(HANDOFF §1-2) | docs/screens-v4.html |
| 이 문서 | §5B.8 | «상단 세그먼트 주/월 · 주 보기 = 날짜별 리스트» | v3 정정: 2주 롤링 + 피드(§13.0b 편성표 행이 이미 정정) — §5B.8 문장은 옛것 | schedule.html |
| 이 문서 | §5B.7 · §15 크론 | 스텝별 주기(00:10·00:20·produceHour·매시·5분·매일) · 함수 6개 | 우산 2개(5m·hourly) + 스텝 14 · roll/assign 은 매시(멱등) | lib/cron/runner.ts:53 |
| 이 문서 | §3.1 러너 | «Windows 런처 → 트레이 앱» | 콘솔 런처(run.bat) + zip 배포·자동 업데이트(B2) · 트레이 앱은 없음 — 설계에서 뺄지 결정 | runner/run.bat |
| 이 문서 | §2 · §3.3 | 코드 정본 `lib/channel-registry.ts` | 파일 없음 · `lib/accounts.ts ALL_CHANNELS/connectMethodOf` + DB `channel_registry` + `runner-jobs.ts publishJobKindOf` 3곳 | B2 ➖ 와 같음 |
| 이 문서 | §19 제품 | «동일 소재 계정당 90일» | 30일(assign-topics.ts:39) — 어느 쪽이 맞는지 | — |
| B-1 | §5C.1·§5C.3 | «이미지 캡션 필수» | 2026-09-15 수리: 캡션은 기본 없음 · `captionRate`(naver 0.3) · 묘사문 금칙 | dec88c8 |
| B-1 | §6.2 | «릴스 90초» | R5 §7-3: 60초 상한 · 90 은 Phase 5 | R5 계약 |
| B-1 | §4.2 | «자동승인(신뢰 계정)» | reviewPolicy 는 **테넌트 단위** — 계정 단위 신뢰 없음 | review-deadline.ts |
| B-1 (➖ 9 전체) | §4·§5·§5C·§6·§10·§16B | B-1 파일 ➖ 행 9개 | 계약 R1/R2/R5·사장님 결정 인용 | `audit/2026-09-15-B1.md` |
| B (➖ 14 전체) | §7·§11·§12·§14·§15·§16 | `tenant_members`→users.role · `sessions`→JWT · `login_attempts`→users 칸 · `topic_sources`→topics.factors · `piece_gates`→gate_report · `schedules`→slots · `runner_heartbeats`→last_seen_at · `ai_model_probes`→ai_settings · `assets-presign`→서버 presign · 크론 6→우산 2 · 2FA Phase 4 · FK 방향 · 코인 이전 Phase 5 … | 표·API 이름을 코드에 맞춰 §14·§15 갱신 | `audit/2026-09-15-B.md` |
| B2 (➖ 6 전체) | §2·§8 | 상태 어휘 `live|beta|planned|paused` ↔ 실제 `active|planned|down` · 런처 파일명 · §8.2 잡 목록 누락 5종 · §8.3 API 경로 표기 · 클립 게시물형/영상 두 행 · 정본 파일명 | `audit/2026-09-15-B2.md` |

### 0.6 사장님 결정이 필요한 것

1. **레지스트리 개통** — `youtube_shorts`·`naver_clip`·`reels`(·threads·instagram) 을 `active` 로 켤지(운영센터 «채널» 1클릭 · 켜면 그리드에 뜨고 OAuth 채널은 «준비 중이에요» 정직 표기). 켜지 않으면 R7 묶음 1 은 의미가 없다.
2. **유튜브 OAuth 앱 + 민감 스코프 심사 착수**(수 주) — 코드는 «키 꽂으면 즉시» 상태(비공개 업로드).
3. **관리형 러너 3결정**(HANDOFF §6): 기본 vs 옵션 · 요금 단위 · 프록시 비용 — 러너 팜 자체가 0 이라 지금은 «신청·가격 표시»까지만.
4. **플랜 채널 게이트** — Starter 를 «글 전부 + 쇼츠»로 실제 막을지(지금 전 채널 개방).
5. **실제 발행 GO** — 198 의 예약 글을 실블로그에 진짜 올릴지(러너 + 네이버 로그인 1회).
6. **소재 재사용 기간** 30일 vs 90일 · **트레이 앱** 유지/삭제 · §13.4 옛 토큰 표 폐기 — 설계 문장 갱신(0.5).
7. **법**: 약관 4문서 법률 검토 · 통신판매업 신고 · 사업자 정보(회사 정보 화면이 생기면 넣을 값).

---

## §1 DESIGN §0 · §1 · §3

### §0 한 줄 정의 · 설계 원칙 6 · 사장님 결정 Q1~Q7

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 0 | 한 줄 정의 — 여러 계정 · 글 **과 영상** · 자동 발행 · 수익 한 곳 | 🟠 | 글 축 코드·화면 ✓ · 라이브 posts 성공 naver_blog 2(임시저장 · B2 SELECT) · 영상 piece 0 · API 수익 0행 | 영상은 입구가 잠겼고 글도 실발행 0 — «한 곳에서 보는 수익»은 수동 입력·애드포스트뿐 | §0.4 묶음 1·2 | L |
| 0 원칙1 | 디렉터가 앞에 선다 — 지시서 «이대로/손보기» | ✅ | `lib/director.ts` propose/confirm(:159·:320) · `public/app/director.html` CTA 2(손보기/이대로 만들기) | | | |
| 0 원칙2 | 채널 감성 자동 적응(채널별 톤·구성 계약) | ✅ | `lib/writing-contracts.ts` 7채널 + `emotion_profiles` 오버레이(AC-6 shape 가드) · B-1 §5C | | | |
| 0 원칙3 | «API 있으면 API 없으면 러너» — 레지스트리 **한 곳**이 결정 | 🟠 | 경로 결정 = `lib/accounts.ts:22 connectMethodOf` + `lib/runner-jobs.ts:83 publishJobKindOf` + `lib/publish/index.ts:180` 분기 3곳 · DB `channel_registry.publish_via` 는 표시용 · 설계의 `lib/channel-registry.ts` 파일 없음(grep 0) | 정본이 3곳이라 채널 하나 켤 때 세 군데를 맞춰야 한다 | 정본 1파일(B2 ➖ 와 짝) | S |
| 0 원칙4 | 계정은 소모품 — 정지 → 같은 채널 다음 계정 승계 · 계정 간 중복 0 | ✅ | `lib/account-health.ts:164 reassignSlots`(날짜별 예산 · AC-24) · `lib/similarity.ts` 계정 간 게이트 · B §7.2 | | | |
| 0 원칙5 | 한 화면 한 목적(큰 숫자 1 · CTA 1 · 옵션은 시트) | ✅ | 홈 `_shots/audit-23-home-after.png`(숫자 1 · 토글 1) · 수익 `audit-22`(숫자 1) · A 하니스 21화면 Primary 1 | | | |
| 0 원칙6 | AI 이름은 한 파일 · 자동 검증→승격→롤백 | ✅ | `lib/ai-models.ts` · `lib/cron/ai-model-watch.ts` · `ops-ai.ts`(apply/rollback/mode) · B-1 §10 | | | |
| 0 Q1 | S스토리 = 티스토리 | ✅ | `runner/channels/tistory.mjs` · `writing-contracts.ts:77` | | | |
| 0 Q2 | Starter 19,000 · Pro 49,000 · Agency 149,000 | ✅ | `lib/plans.ts:18-24` · 라이브 plans(B) · 실측 `/api/plans` tid212 | | | |
| 0 Q3 | 관리형 러너 = Pro 옵션 · Agency 포함 · 원가 별도 산정 | 🟡 | `plans.ts` managedRunner option/included · `netlify/functions/managed-runner.ts`(신청·가격 30,000+VAT · 실측 tid212 `eligible:false · price 33,000`) · `runner.html` «PC 없이 쓰기» | 신청·가격뿐 — 우리 서버가 대신 발행하는 러너 팜 0 · 원가 산정 문서 0 | R7 러너 팜(사장님 결정 3) | L |
| 0 Q4 | 유튜브·틱톡 앱 하나로 고객 OAuth | 🔒 | `lib/oauth-providers.ts`(google·meta·threads·tiktok 인가·교환·장기 토큰) · 키 없으면 `provider_not_configured`(실측 tid212 «준비 중이에요») · **키 꽂으면 즉시 가동** | 앱·키·심사 0 | 사장님 액션 | — |
| 0 Q5 | 프록시 기본 미제공 · «내 프록시 등록» 필드 | ✅ | `accounts.proxy_url` · `accounts.html:165` «프록시 주소(선택)» · `runner/lib/browser.mjs:30` 컨텍스트 적용 | | | |
| 0 Q6 | 잉크 블랙 액센트 · `--brand` 하나로 교체 | ✅ | `public/css/ac.css:5-6` `--brand:#191F28` | | | |
| 0 Q7 | 체험 소액팩 ₩5,000=10코인 1회 | ✅ | 실측 `/api/coin-packs` → `pack_trial:5000:10` · `coin_orders_tenant_pack_idx` 1회 판정(schema R4) · `coins.html` | | | |

### §1 제품 범위

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 1.1 | 주 사용자 개인 · 계정 2~30 · 하루 5~15분 | ✅ | plans 계정 3/15/50 · 자동 편성 크론 14 스텝(사람 개입 = 검수뿐) | | | |
| 1.1 | 부 사용자 대행(Agency 플랜·팀 시트) | 🟠 | `plans.ts` agency teamSeats 5 · **팀 초대 경로 0**(B §11.0 ❌) | 팀 시트가 숫자만 — 대행이 팀원을 못 넣는다 | B 참조 | M |
| 1.1 | 운영자 MIS SSO · super_admin/admin/operator | ✅ | `netlify/functions/sso-enter.ts` · `operators.role` · B §11 | | | |
| 1.2 | 글 축 6단계(소재→디렉터→제작→검수→발행→수익) | ✅ | `topics.ts`→`director.ts`→`content-gen.ts`→`content-approve.ts`→`publish/*`→`revenue/*` · 여정 실측 §7 | (실발행 0건은 §4 로드맵) | | |
| 1.2 | 영상 축 6단계 | 🟠 | 코드 R5 전부(B-1 §6 ✅ 다수) · 화면 8장(A) · **고객 경로 입구 0**(§6) | 라이브 영상 0건 | §0.4 묶음 1 | L |
| 1.3 | 비범위: 광고 집행 없음 | ✅ | `grep -rl "ad-\|ads-\|adgroup\|bid-\|budget-" lib netlify` 0 | | | |
| 1.3 | 비범위: 리드·너처링·CRM 없음 | ✅ | grep lead/nurtur 0 | | | |
| 1.3 | 비범위: 라이브 스트리밍·롱폼 편집 없음 | ✅ | 없음(맞음) | | | |

### §3.1 스택

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 3.1 | Frontend Vanilla **PWA** + `ac.css` + 12 컴포넌트 | 🟠 | `ac.css` · `ui.js`(컴포넌트 12 주석·구현) · `manifest.webmanifest` ✓ · **서비스워커 0**(`grep serviceWorker public` 0) | 설치·오프라인·푸시가 없어 «PWA»가 manifest 뿐 | sw.js + 푸시 | M |
| 3.1 | Backend Netlify Functions v2 · Node 20 · TS | ✅ | `netlify.toml` NODE_VERSION 20 · 함수 60개 `config.path` 전수 | | | |
| 3.1 | DB Neon + Drizzle 신규 인스턴스 · `neon-migrate.mjs` | ✅ | `db/schema.ts` 48표 · `drizzle/0001~0012` · `scripts/neon-migrate.mjs` | | | |
| 3.1 | AI Gemini 단일 출처 · `CHAIN_IMAGE` · TTS · video-providers | ✅ | `lib/ai-models.ts` · `lib/ai-image.ts` · `lib/video/tts*.ts` · `lib/video/providers/*` | | | |
| 3.1 | 러너 Node+Playwright+ffmpeg · Windows 런처 → **트레이 앱** | 🟠 | `runner/run.bat`·`run.sh` · `render-video.mjs`(ffmpeg 사다리) · zip 배포·자동 업데이트(B2 0012) | 트레이 앱 없음(콘솔 창) | 설계 문장 결정(0.5) 또는 트레이(M) | M |
| 3.1 | 스토리지 R2 presigned PUT | ✅ | `lib/r2.ts` r2Put/r2PresignPut/r2PresignGet/r2Delete | | | |
| 3.1 | 결제 KICC(kicc·billing·coin-purchase) | ✅ | `lib/kicc.ts` · `lib/billing/*` · 실카드 실측(KICC-GO-LIVE §0.1) | | | |
| 3.1 | Cron Netlify Scheduled + **GitHub Actions 보조** | 🟠 | `netlify.toml` 우산 2 ✓ · `.github/workflows` 없음(ls 0) | Netlify 스케줄이 멈추면 대신 깨울 것이 없다 | Actions 1개(`/api/cron-run` 호출) | S |
| 3.1 | 배포 GitHub → Netlify | ✅ | 라이브 URL · HANDOFF §2 배포 #1~#6 | | | |

### §3.2 구성도

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 3.2 | 고객 화면 5(홈/만들기/발행함/수익/내 계정) | ➖ | 탭 5 = 홈·만들기·**편성표**·수익·내 계정(§5B.1 교체) · 발행 결과는 `posts.html` 로 유지 | | 0.5 갱신 | |
| 3.2 | `/api/*` 핸들러 · 디렉터 엔진 · 생성 · 발행 디스패처 · 수익 수집기 · 크론 | ✅ | 함수 60 · `director.ts` · `content-gen.ts`/`video/gen.ts` · `publish/index.ts` · `revenue/index.ts` · `cron/runner.ts` 14 스텝 | | | |
| 3.2 | PUB → API 채널(블로거·WP·유튜브·인스타·쓰레드·틱톡) | 🟠 | blogger·wordpress·youtube·reels·threads(영상) ✓ `publish/index.ts:180-184` · **틱톡 커넥터 0 · 인스타 피드(글) 0 · 쓰레드 글 0**(`publish/threads.ts` 는 VIDEO 만 · 글 piece 도 여기로 가 «올릴 영상이 없어요») | 틱톡·인스타 피드·쓰레드 글 발행 없음 | 쓰레드 글 분기(S) · 틱톡·페북 Phase 5(L) | L |
| 3.2 | PUB → 러너 채널(네이버·티스토리·클립) | 🟠 | `runner/channels/naver-blog.mjs`·`tistory.mjs` ✓ · `naver-clip.mjs` = 스텁(`not_supported_yet`) | 클립 업로드 0 | PC 업로드 실측(§19) | L |
| 3.2 | REV → 수익 API(애드센스·유튜브·쿠팡·알리) | 🔒 | `lib/revenue/{adsense,youtube,coupang,aliexpress,linkprice}.ts` · 라이브 API 수익 0행(B2) · 키/앱 0 · 키 없으면 `not_configured` 정직(실측 tid212 adsense connect → 503 provider_not_configured) | 실회수 0회 | 키 · 첫 회수 1행 | — |
| 3.2 | RQ → REV 스크랩(애드포스트·클립) | ✅ | `runner/channels/revenue-adpost.mjs` 라이브 실증(HANDOFF) · `revenue-clip.mjs`(실측 0 · ⬜ 같이 봄) | | | |
| 3.2 | MIS → API 60초 토큰 | ✅ | `sso-enter.ts` · 허브 카드 ⑥ 라이브(HANDOFF §0) | | | |

### §3.3 AM 재사용 맵

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 3.3 | 인증·세션·운영자(auth·admin-guard·sso-role·sso-enter) 그대로(aud autocreate) | ✅ | `lib/auth.ts`(AM 헤더) · `lib/guards.ts`(admin-guard 흡수) · `lib/sso-role.ts` · `sso-enter.ts` aud `autocreate` | | | |
| 3.3 | 테넌트·플랜 게이트(plan-gate·ops-tenants) 표만 교체 | ✅ | `lib/plans.ts`(plan-gate 관례) · `ops-tenants.ts` | | | |
| 3.3 | 코인 5(ledger·purchase·invoice·refund·reconcile) 그대로 | 🟠 | `coin-ledger.ts` · `billing/coin-purchase.ts`(coin-invoice 흡수) · `billing/coin-refund.ts` ✓ · **coin-reconcile 0**(grep 0) | 원장 대조 없음(잔액 ≠ 원장 합 사고를 못 잡는다) | 대조 스크립트/크론 | S |
| 3.3 | 결제(kicc·billing·billing-math) 그대로 | ✅ | `lib/kicc.ts` · `lib/billing-math.ts vatOf` · `lib/billing/*` | | | |
| 3.3 | AI(ai·ai-models·ai-cache·ai-meter·ai-cost·ai-key) 그대로 + 오버레이 | 🟠 | `ai.ts`·`ai-models.ts`·`ai-cost.ts` ✓ · ai-meter → `billing/ai-cost-cap.ts` ✓ · **ai-cache 0 · ai-key 0** | 응답 캐시·키 로테이션 없음 | 선택 | S |
| 3.3 | 소재(content-topics·shorts-topics·검색량) 일반화 | ✅ | `lib/topics.ts`(AM 헤더) · `naver-volume.ts`·`naver-datalab.ts` · 뱅크는 topics 흡수(R5 §0.1-3) | | | |
| 3.3 | 디렉터(content-director·content-tone) 확장 | ✅ | `director.ts` · `writing-contracts.ts`(AM 헤더) | | | |
| 3.3 | 글 생성(content-gen·content-image·**thumbnail**·**tags**) 그대로 | 🟠 | `content-gen.ts`·`ai-image.ts` ✓ · **content-thumbnail 0 · content-tags 0**(태그는 hashtags 블록으로 흡수) | 썸네일 생성기 없음(대표 이미지 = 첫 사진) | 선택 | S |
| 3.3 | 쇼츠 공장 9종 이식 + 디벨롭 | ✅ | `lib/video/{script,scenes,tts,tts-typecast,captions,bgm,providers/*}` · `runner/channels/render-video.mjs` · shorts-loop 은 슬롯 크론 흡수(R5 지도) · B-1 §6 | | | |
| 3.3 | 발행 커넥터(threads/instagram/**facebook**·naver-publish-verify) + 신규(블로거·WP·유튜브·**틱톡**) | 🟠 | threads(video)·instagram(reels)·`post-alive.mjs` ✓ · blogger·wordpress·youtube ✓ · **facebook 0 · tiktok 0** | 페북·틱톡 발행 없음 | Phase 5 | M |
| 3.3 | 러너(content-runner·runner-jobs·runner-block·core·naver-blog-runner·runner-start.bat) | ✅ | `lib/runner-jobs.ts` · `runner-block.ts` · `runner/core.mjs` · `channels/naver-blog.mjs` · `run.bat` | | | |
| 3.3 | 채널 자격(channel-creds·channel-accounts) → 계정 N개 | ✅ | `creds-crypto.ts`(AES-GCM · `CREDS_ENC_KEY` 폴백 없음) · `accounts.ts` · `account_creds` | | | |
| 3.3 | 품질 게이트(ad-law-banned·ad-copy-similarity·**content-link-verify**) | 🟠 | `banned-words.ts`·`similarity.ts` ✓ · **content-link-verify 0**(발행 전 본문 링크 확인 없음 · 발행 후 `post_alive` 만) | §4.2 «코드 게이트(…링크)»의 링크 검사가 없다 | ai-tell-gate 에 link HEAD 1검사 | S |
| 3.3 | 알림·감사 그대로 | ✅ | `lib/audit.ts`(await · AC-36) · `notifications.ts` | | | |
| 3.3 | 안 가져오는 것(ad-*·리드·랜딩·제안서·brain·챗) | ✅ | grep 0 | | | |
| 3.3 · CLAUDE §2 | AC-1 «AM 원본 경로·복사일» 헤더 | 🟠 | 헤더 있는 파일 58 · 없는 파일 20(`grep -L` · `lib/auth-service.ts`·`accounts.ts`·`plans.ts`·`r2.ts`·`email.ts`·`cs.ts`·`billing/*`…) | 출처 없는 이식 파일은 AM 버그 추적이 안 된다 | 헤더 보강 | S |

---

## §2 DESIGN §5B 편성표

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 5B.0 | 규칙 1회 → 편성자 소재 → D-3 제작 → 3일 검수 → 최적 시간 발행(1주~한 달 자동) | ✅ | 스텝 `roll→assign_topics→produce→review_deadline→publisher`(`lib/cron/runner.ts:53`) · 실측 tid212 규칙 1개 → 슬롯 7개(`rules-save slotsCreated:7`) | (실발행 0건은 §4) | | |
| 5B.1 | 메뉴 이름 «편성표» · 발행함 탭 → 편성표 교체(탭 5 유지) | ✅ | `ui.js` 탭 5 = 홈·만들기·편성표·수익·내 계정 · 스샷 `audit-17` | | | |
| 5B.1 | 발행 결과 = 편성표 «발행됨» 칩 | ✅ | `UI.SLOT_STATUS.published` «발행됨» · `schedule.html` calCell/slotRow | | | |
| 5B.1 | 켜는 동작 «자동 편성 켜기» · 홈 «디렉터에게 맡기기» = 같은 설정(정본 편성표) | ✅ | 홈 토글 «자동 편성» = `settings.autoSchedule`(`home.html:26` · `tenant-settings.ts`) · 편성표 빈 상태 CTA «자동 편성 켜기» | (홈 문구가 «디렉터에게 맡기기»가 아니라 «자동 편성» — 설계 별칭 표기와 다름 · 사람말은 이쪽이 낫다) | | |
| 5B.2 D-∞ | 규칙 설정 → `cadence_rules` | ✅ | `db/schema.ts:289` · `/api/rules-save` · 시트 3스텝 | | | |
| 5B.2 D-7 | 편성자가 다음 주 슬롯마다 소재 배정 + 알림 «다음 주 소재 12개 정했어요» | ✅ | `lib/cron/assign-topics.ts:142` notifyOnce «다음 N일치 소재 N개를 정했어요» · 후보 0 → 배경 리필 + `no_topic` 알림(:119) | | | |
| 5B.2 D-3 | 자동 제작(produceLeadDays 3 · 1~7) → 코인 차감 → in_review | ✅ | `lib/cron/produce.ts`(창 `slot_date BETWEEN 오늘 AND 오늘+lead` · `produceHour` KST 게이트) · `director-auto.ts` | (⚠️ produceHour 시각 1틱만 — 그 틱이 예산에 끊기면 내일 · 주석에 정직) | | |
| 5B.2 D-3~D-0 | 검수창: 수정·교체·건너뛰기·컨펌 · 조용하면 자동 승인 | ✅ | `pieces-update`(수정 → 재검사 · 코인 0) · 슬롯 시트 «소재 바꾸기/시각 바꾸기/건너뛰기» · `review-deadline.ts`(silence_approves · 게이트 하드 실패면 awaiting_manual) | | | |
| 5B.2 D-0 | 채널별 최적 시간(기본표 + 실측 학습 + 사용자 고정) → 발행 | ✅ | `lib/best-time.ts`(표 · golden_hours · preferredHour) · `learn.ts:18 bestHoursFor` | | | |
| 5B.2 D+1 | 수익 매칭 → 슬롯에 «이 글 ₩N» → 편성자 성과 팩터 | 🟡 | `learn.ts:106` 30일 piece 수익 → `topics.factors.performance` + 점수 재계산 ✓ · **편성표 슬롯 행에 «이 글 ₩N» 표시 0**(`slotRow` 에 수익 없음 · 수익은 revenue.html «잘 번 글»에만) | 편성표에서 글별 수익을 못 본다 | slotRow 에 revenue 1칸 | S |
| 5B.3 | `channel` | ✅ | cadence_rules.channel · 시트 채널 행 | | | |
| 5B.3 | `kind` 글·쇼츠·**카드뉴스** | 🟠 | `RuleKind = post|shorts`(`lib/slots.ts`) · 카드뉴스 없음 | 카드뉴스 규칙 불가(인스타 카드뉴스 자체가 미구현 · §1 #10) | 카드뉴스 뒤에 | — |
| 5B.3 | `account_mode` 고정/자동 로테이션(건강도 순) | ✅ | rules.accountMode auto/fixed · 시트 2단계 «자동/고르기» · `director-auto.ts` assignAccount(health 순) | | | |
| 5B.3 | `every` 주 N회 / 월 N회 / 매일 | 🟡 | `rules-save` every day/week/month + `rollSlots` 분산 로직 ✓ · **규칙 시트는 «주 N회» 스테퍼만**(`schedule.html ruleSheet` `every:"week"` 고정) | 월 N회·매일을 화면에서 못 고른다 | 시트에 세그먼트 1 | S |
| 5B.3 | `weekdays[]` 요일(비우면 자동 분산) | 🟡 | API·rollSlots ✓(`slots.ts` weekdays) · 시트 0 | 요일 지정 불가 | 시트 칩 7 | S |
| 5B.3 | `preferred_hour` 고정 시각(KST) | 🟡 | API·best-time ✓ · 시트 0(설정의 bestTimeMode «정한 시간만»은 있는데 시각을 넣을 칸이 없다) | fixed 모드가 사실상 쓸 수 없다 | 시트 시간 칩 | S |
| 5B.3 | `format_hint` 경험담·정보·비교(비우면 로테이션) | ❌ | 칸·API 저장 ✓ · **읽는 코드 0**(`grep formatHint lib/cron lib/director` 0) · 시트 0 | 저장돼도 아무 효과 없음 | director-auto 에 1줄 + 시트 칩 | S |
| 5B.3 | `active` 켜짐/꺼짐 | ✅ | rules.active · 시트 count 0 = 비활성 · 설정 시트 규칙 요약 | | | |
| 5B.3 예 | 채널 여러 규칙 동시(네이버 주3 + 쇼츠 매일 + 티스토리 토·일) | 🟠 | 규칙 여러 개 ✓ · 채널당 1규칙만 시트가 만든다(`cur[c]` 채널 키) · 쇼츠 «매일»·«토·일»은 위 🟡 2개 때문에 화면에서 못 만든다 | 설계 예시 3개 중 화면으로 되는 건 «주 N회» 하나 | 위 3건 | S |
| 5B.4 | `horizonDays` 14(7·14·30) | ✅ | `ScheduleSettings`(`lib/slots.ts`) · 설정 시트 세그먼트 7/14/30 · 플랜 horizonDays 게이트(`plans.ts`) | | | |
| 5B.4 | `topicLeadDays` 7(3~14) | ✅ | 시트 칩 3/7/14(범위 안 3점만 — 설계 «3~14» 연속값은 아님) | | | |
| 5B.4 | `produceLeadDays` 3(1~7) | ✅ | 시트 칩 1/3/5 · 켜기 시트 3단계에도 | (7일은 못 고른다) | | |
| 5B.4 | `produceHour` 06:00 | ✅ | 시트 칩 06:00/09:00 · `produce.ts` KST 시 판정 | | | |
| 5B.4 | `reviewPolicy` silence_approves / require_confirm | ✅ | 시트 세그먼트 · `review-deadline.ts:39` | | | |
| 5B.4 | `bestTimeMode` auto / fixed | ✅ | 시트 세그먼트 · `best-time.ts` preferredHour 분기 | (fixed 는 5B.3 preferred_hour 🟡 와 묶임) | | |
| 5B.4 | `weeklyCoinCap` 플랜 포함분 기본 · 초과 → «코인 부족» 보류 | ✅ | `produce.ts:70-99`(주 consume 합 + 예상 > cap → `coin_short` + 알림) · 시트 «플랜 포함분/직접 정하기» 스테퍼 | | | |
| 5B.4 | `quietDays[]` 쉬는 날 → 슬롯 안 만듦 | ✅ | `rollSlots` quietDays 제외 · 시트 4주 달력 다중 선택 | | | |
| 5B.5 | 기본표 7채널(네이버 07:30·12·21 / 티스토리 08·13 / 블로거·WP 09 / 쇼츠 18·21 / 클립 19·22 / 릴스 12·19 / 쓰레드 08·22) | ✅ | `lib/best-time.ts:8-15` 값 일치 · 실측 슬롯 publishAt 03:00Z=12:00 KST · 22:30Z=07:30 KST | | | |
| 5B.5 | 학습: 네이버 24h 조회(러너) · 티스토리 애드센스 PV · 쇼츠 애널리틱스 · 클립 러너 · 릴스 인사이트 | 🟠 | `learn.ts` 마일스톤 6/24/72h · API 채널 `fetchStats` · 러너 채널 `revenue.stats` 잡 ✓ · **애드센스 PV·애널리틱스·인사이트 는 수익 커넥터와 별개 조회 0**(조회수만 · 매체 지표 아님) | 티스토리·쇼츠·릴스의 «학습 신호»가 설계와 다름(조회수 통일) | 매체 지표 붙이기(키 뒤) | M |
| 5B.5 | 같은 채널 계정 간 30분 · auto = 최근 30일 최고 시각 · 없으면 첫 후보 | ✅ | `best-time.ts:19 ACCOUNT_GAP_MIN=30` · `learn.ts bestHoursFor` · 첫 후보 폴백 | | | |
| 5B.6 | 상태 16종(planned·topic_assigned·producing·in_review·approved·edited·rejected·scheduled·publishing·published·awaiting_manual·awaiting_runner·reassigned·skipped·no_topic·coin_short) | 🟠 | 서버 전이 `setSlot`(`cron/base.ts`) · `UI.SLOT_STATUS` 16종이지만 **설계와 집합이 다르다**: `edited`·`rejected` 없음(수정 = piece 재검사·슬롯 in_review 유지 · 버리기 = 슬롯 `skipped` `pieces.ts:206`) · 대신 `assigned`·`failed` 추가 | 슬롯만 보면 «버린 글»과 «쉬는 날»이 같은 skipped 로 보인다 | rejected 를 슬롯에도(S) 또는 설계 문장 갱신 | S |
| 5B.6 | 정본은 슬롯 하나 · 슬롯 없는 자동 생성 게이트 거부 + 감사 | ✅ | `lib/slot-gate.ts`(fail-closed · `piece_slotless_blocked` risk high) · `director.ts:322` origin 기본 auto · C R2 검증 | | | |
| 5B.6 | 게이트 거부가 **홈 «해야 할 일»에** 남는다 | ❌ | `pendingSlotGateBlocks`(slot-gate.ts) **호출처 0** · `home-summary.ts` 에 없음 | 거부가 감사에만 남고 사용자는 못 본다(AC-29 · «조용한 0건») | home-summary 1행 | S |
| 5B.6 | 수동 «만들기»는 슬롯 없이도 · 편성표에 끼워 넣으면 그날 자동 슬롯 대체 | 🟠 | 수동 = `origin:"manual"` 슬롯 생성 ✓(`director.ts`) · **그날 자동 슬롯을 대체하는 코드 0**(grep 대체/replace 0) — 같은 날 자동 자리와 수동 글이 둘 다 나간다 | 중복 발행 방지 규칙 없음 | confirm 에서 같은 채널·날짜 planned 자동 슬롯 1개 skipped 처리 | S |
| 5B.7 | `slots.roll` 매일 00:10 → horizon 채움(quietDays·멱등) | ➖ | 매시(hourly 우산) · 멱등(rule_id,date) — 주기가 설계보다 잦고 결과 동일 | | 0.5 | |
| 5B.7 | `slots.assign_topics` 00:20 | ➖ | 매시 · 배경 리필 | | 0.5 | |
| 5B.7 | `slots.produce` 매일 produceHour | ✅ | `produce.ts` KST 시 게이트 | | | |
| 5B.7 | `slots.review_deadline` 매시 → D-0 02:00 미반려 approved | ✅ | `review-deadline.ts` · 실측 슬롯 `reviewDeadline` 17:00Z = 02:00 KST | | | |
| 5B.7 | `publisher` 5분 due → API/러너 | ✅ | `cron-tick-5m` · `publisher.ts` | | | |
| 5B.7 | `slots.learn` 매일 성과 → best-time·편성자 팩터 | ✅ | `learn.ts`(매시 · 마일스톤) | | | |
| 5B.8 | 첫 진입 빈 상태 한 문장 + CTA «자동 편성 켜기» | ✅ | `schedule.html` «규칙 하나면 한 달치가 알아서 나가요» · 스샷 `audit-16-schedule-empty.png` | | | |
| 5B.8 | 3스텝 시트 ①채널 행마다 주 N회 ②계정(자동 기본) ③검수 방식(3일 전·조용하면 발행) | ✅ | `ruleSheet` step 1~3 · prog 3칸 | | | |
| 5B.8 | 시트 끝 코인 미리보기 «주 84코인 · 포함분 150 안» | 🟠 | «이 편성이면 주 약 N코인 · 지금 잔여 N코인» — **«포함분 N 안»(플랜 포함 코인 대비) 없음** | 플랜 포함분과 견줘 볼 수 없다 | `me.plan.limits.coinsIncluded` 한 줄 | S |
| 5B.8 | 평소: 세그먼트 주/월 · 주 = 날짜별 리스트 · 월 = 달력 점(상태 색만) | ✅ | v3 정정(2주 롤링 + 피드 · 월 6줄) · 점 ≤3 상태색 · 스샷 `audit-17`·`audit-18` | | | |
| 5B.8 | 슬롯 탭 → 시트: 미리보기 · 소재 바꾸기 · 시각 바꾸기 · 지금 만들기 · 건너뛰기 | ✅ | `slotSheet` 4동작 + «글 보기» 링크(미리보기) · `slots-assign-topic`·`slots-reschedule`·`slots-produce-now`·`slots-skip` | | | |
| 5B.8 | 검수창 슬롯 «수정하기 / 이대로 발행» | ✅ | 시트 → `piece.html`(수정 저장 / 이대로 발행 예약) | | | |
| 5B.8 | 홈 «해야 할 일»에 «검수 기다리는 글 N건(내일 발행)» | ✅ | `home-summary.ts:39` «봐주실 글 N건이 있어요 · 내일 나가기 전에» | (다른 해야 할 일 누락은 §0.2 #6) | | |
| 5B.8 | 데스크톱: 좌 640 주간 리스트 + 우 300 패널(선택 슬롯 미리보기·수정) | 🟠 | 640 컬럼 ✓(스샷 `audit-33-schedule-desktop.png`) · **우 패널 상시 0**(`.page.two` 미사용 · 시트 열 때만 우측) | 선택 슬롯 미리보기·수정 패널이 없다 | `.page.two` + aside 에 slotSheet 내용 | M |
| 5B.9 | 코인 = 제작 시점 piece 1회 · 수정·재생성·승계 무료 | ✅ | `director.ts:424 consume(piece:{id})` · 재생성 ref regen(순액 1회) · `reassignSlots` 코인 0 | | | |
| 5B.9 | weeklyCoinCap 초과 → «코인 부족» + D-3 알림 → 충전하면 다음 produce | ✅ | `produce.ts:65` coin_short 재시도 대상 · 알림 · 슬롯 시트 «충전하기» | | | |
| 5B.9 | 플랜: Starter 규칙 3·horizon 7 · Pro 무제한·30·**자동 승인** · Agency 팀 컨펌 | 🟠 | maxRules 3/null · horizonDays 7/30 ✓(`plans.ts` · `rules.ts` step limit) · **자동 승인은 플랜 게이트 0**(Starter 도 silence_approves) · 팀 컨펌 = teamApproval 플래그만(B) | Starter 가 자동 승인까지 다 쓴다(설계 Pro) | reviewPolicy 게이트 1줄(사장님이 설계 유지할 때) | S |
| 5B.10 | AM 재사용(editorial-board·content-planner·slot-gate·content-approve·autopilot·cron-tick·organic-cadence) | ✅ | `slots.ts`(editorial-board·organic-cadence 관례) · `slot-gate.ts` · `content-approve.ts` · autopilot=autoSchedule · 우산 2 | | | |
| 5B(사장님 실측) | «이번엔 건너뛰어요» 판정 = 서버 `skipReason:"too_soon"` | ✅ | `lib/slots.ts:202`(main 머지됨) · 화면 우선 사용(`schedule.html tooSoon`) · 실측 스샷 `audit-17` 15·17일 | (홈 «오늘 편성»은 skipReason 을 안 읽어 같은 자리가 «예정» — `audit-23` · 작은 불일치) | home 1줄 | S |

---

## §3 DESIGN §13 UI / UX

### §13.0 헌장 · 금지 · 컴포넌트 12 · 접근성 · 마이크로 인터랙션 · v3 토큰

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 13.0 깔끔 | 화면당 색 3 · 카드 없음(그룹 섹션) · 그림자 시트만 · 첫 화면 숫자 1·항목 ≤7 | ✅ | `ac.css` 토큰(잉크·브랜드=잉크·초록 1 · 컬러는 채널 마크만) · `.group` R20 테두리·그림자 0 · 스샷 홈·수익 | | | |
| 13.0 세련 | 8px 그리드 · 타입 7단 · 큰 숫자 tabular-nums 자간 -2% · 모션 한 방향 · 아이콘 선형 1세트 · 장식 0 | ✅ | `ac.css` tabular-nums 14곳 · letter-spacing -.02em 7곳 · 시트 아래→위 · 아이콘 svg stroke 1.5~1.8 · 일러스트 0 | | | |
| 13.0 심플 | Primary 1 · 옵션은 시트 · 설명 한 문장 · 온보딩 ≤3 · 빈 상태 = 문장+CTA · 고급 설정 깊이 2 | ✅ | A 하니스 21화면 Primary 1 · 온보딩 3스텝 · 빈 상태(`audit-19/20/31`) · 편성 설정 = 편성표 우상단 ⚙ 1단 | | | |
| 13.0 금지 | 이모지 아이콘 0 | ✅ | A 하니스 0 · 채널 마크 = 글자/svg(`UI.mark` «N T B W ◎ ▶ …» — ◎·▶·♪ 는 기호 · 이모지 아님) | | | |
| 13.0 금지 | 그라데이션 히어로 0 | ✅ | `ac.css` gradient 6곳 전부 기능용(인스타 마크·CTA 페이드·빗금·스켈레톤·구분선) | | | |
| 13.0 금지 | 다색 차트 0(단색+강조 1) | ✅ | 수익 «날마다» 단색 막대 + 1등만 잉크(`audit-22`) | | | |
| 13.0 금지 | 팝업 모달 0 → 바텀시트 | ✅ | `grep 'alert(\|window.confirm(\|prompt('` 0 · 확인은 `UI.confirmRow` | | | |
| 13.0 금지 | 툴팁 설명 0 | 🟠 | `piece.html:40` 심사 그룹 `title="…"` 1곳 | 헌장 위반 1 | 문장으로 풀기 | S |
| 13.0 금지 | 배지 남발 · 3단 메뉴 · 위젯 격자 · 시스템 용어 0 | ✅ | A 하니스 시스템 용어 0(«테넌트·러너 잡·piece» grep 0) · 깊이 ≤2 | | | |
| 13.0 | 컴포넌트 12(AppBar·BigNumber·ListRow·StatusChip·BottomSheet·PrimaryCTA·StepBar·Skeleton·EmptyState·Toast·Toggle·SegmentedTabs) | ✅ | `ac.css:3` 목록 · `ui.js` `UI.sheet/toast/done/toggle/pill/seg/countUp` · `.steps`(StepBar :132) · `.sk` · `.empty` | | | |
| 13.0 접근성 | 터치 44px · 대비 4.5:1 · 포커스 링 · reduced-motion 0 | 🟠 | `:focus-visible` ✓ · `prefers-reduced-motion` ✓(`ac.css:29`) · **하단 탭 눌림 56×42 · 달력 날짜 칸 38px**(A · `ac.css:128`·`:184`) | 44px 하한 2곳 미달 | 높이 2줄 | S |
| 13.0 마이크로 | 카운트업 600ms · 스프링 시트(드래그 닫기) · 눌림 0.97 · 완료 체크 400ms 자동 닫힘 · 스켈레톤(스피너 0) | ✅ | `UI.countUp` · `ui.js:130` touchstart 드래그 · `scale(.97)` 2 · `UI.done` 400ms · spinner 0 | | | |
| 13.0 마이크로 | 당겨서 새로고침 · 확정 동작 햅틱 | ❌ | grep pull/당겨 0 · `navigator.vibrate` 0 | 둘 다 없음(선택 수준) | 선택 | S |
| 13.0b v3 토큰 | 바탕 #F2F4F6 · 섹션 흰 R20 · 잉크 #191F28 · 보조 #4E5968 · 흐림 #8B95A1 · 액센트 잉크 · 초록 #1FA97A · 행 56 · 마크 38 R12 · CTA 54 R16 · 헤드라인 30/800 · 다크 #17171C/#202027 | ✅ | `ac.css:4-11` 값 일치(--r-sec 20 · --r-mk 12 · --cta-h 54 · --row-h 56) · 다크 토큰 `:13-23` | | | |
| 13.4(옛 토큰) | ground #F7F8FA · brand #3060F0 · money #12B886 · CTA 56 · 반경 999 | ➖ | v3 가 대체(사장님 «파란 배경 촌스럽다») · §13.4 문장은 옛것 | | 0.5 | |

### §13.0b 토스 패턴 사전(19행)

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 13.0b | 온보딩 = 한 화면 한 질문(진행선 3 · 큰 질문 · 타일 · 뒤로만) | ✅ | `public/onboarding.html` 3스텝 · 건너뛰기 0 · `#prog` 3칸 | (기존 가입자가 다시 들어올 길 0 — §6 ③) | | |
| 13.0b | 홈 = 문장형 헤드라인 + 그룹 섹션(해야 할 일·오늘 편성·자동 편성 토글) | ✅ | `audit-23-home-after.png` «오늘 12,400원 벌었어요» | (해야 할 일 항목 누락 §0.2 #6) | | |
| 13.0b | 계정 연결 = 계좌 연결(마크 그리드 → 채널별 로그인 → 풀스크린 완료 체크) | 🟠 | 그리드·시트·`UI.done` ✓ · **영상 채널 4 + 쓰레드·인스타 타일이 안 보인다**(§0.2 #1) | 절반의 채널이 «없는 것처럼» 보인다 | 레지스트리 개통 + 준비 중 타일 | S |
| 13.0b | 내 계정 = 내 자산 목록(채널 그룹 · 행 = 마크+핸들+상태+알약 · 상세 건강도·오늘 발행·페르소나) | ✅ | `accounts.html` 행·상세 시트(건강·오늘 N/N·페르소나) · `account.html` 허브 | | | |
| 13.0b | 소재 고르기 = 추천 카드 스와이프(오른쪽 디렉터·왼쪽 넘김·위 나중에) | 🟠 | `create.html` 카드 + touch 2곳(좌우) · «위 = 나중에» 0 · 버튼 폴백 있음 | 3방향 중 «나중에» 없음(넘김과 합쳐짐) | 선택 | S |
| 13.0b | 디렉터 확인 = 송금 확인(질문 한 줄 · 대상 행 · 키-값 표 · 손보기/만들기) | ✅ | `director.html` «N곳에 만들까요?» · `#targets` 행 · 코인 표 · CTA 2 | | | |
| 13.0b | 손보기 = 바텀시트 편집(칩·세그먼트·토글 · 입력 최소) | ✅ | `director.html:72-115`(계정 seg · 감성 칩 · 구성 칩 · 이미지 스테퍼 · 제휴 토글 · 시각 칩) | | | |
| 13.0b | 만드는 중 = 스켈레톤 + 스텝 텍스트 + 예상 시간 + 완료 체크 | ✅ | `pieces.html` 스텝 바(글 4 · 영상 6 `meta.stage`) · `UI.done` | | | |
| 13.0b | 검수 = 알림 → 상세 → 하단 2버튼 · 채널 렌더 미리보기 · 인라인 편집 시트 | ✅ | `piece.html` `.preview.{channel}` · contenteditable 4 · «수정 저장/이대로 발행 예약» | | | |
| 13.0b | 편성표 = 소비 캘린더(2주 롤링 + 피드 · 월 6줄 · 우상단 설정) | ✅ | `schedule.html` · 스샷 `audit-17/18` | | | |
| 13.0b | 편성 규칙 = 3스텝 → 코인 미리보기 → «켜기» | ✅ | `ruleSheet` | (포함분 비교 없음 §2) | | |
| 13.0b | 수익 = 내 소비(«N월에 …원 벌었어요» 잉크 · 지난달 같은 날까지 · 단색 막대 1등 잉크 · 소스 마크 서비스 색 · 잘 번 글) | ✅ | `revenue.html` · 스샷 `audit-22` · `PREV_SAME` 같은 날까지 | (KST 이중 시프트 §0.2 #7) | | |
| 13.0b | 코인 충전 = 프리셋 타일 → 결제수단 행 → 충전 → 완료 | ✅ | `coins.html` 팩 4(pack_trial 포함) · 결제 실카드 실측(KICC) | | | |
| 13.0b | 구독 변경 = 세로 카드 3장 · 현재 표시 · «이 플랜으로» | ✅ | `plan.html` 카드 3 · «지금은 체험» · 스샷 `audit-25` | | | |
| 13.0b | 러너 = 연결 기기(상태 행 · 설치 한 화면 한 단계 · 오프라인이면 홈 해야 할 일) | 🟠 | `runner.html` 상태·설치 단계 ✓ · **홈 «해야 할 일»에 오프라인 0**(`home-summary.ts` runner 는 응답에만 · `home.html` 미사용) | 러너가 꺼져도 홈은 조용하다 | home 1행 | S |
| 13.0b | 알림 = 알림함 + **푸시 딥링크**(문장형) | 🟠 | 알림함·딥링크 `link` ✓(`notifications.html`) · **푸시 0**(서비스워커 0) | 앱을 안 열면 모른다 | sw + Web Push | M |
| 13.0b | 설정 = 그룹 리스트 + 토글(자동 편성 변수·알림·플랜/코인·계정·앱 정보 · 깊이 ≤2) | 🟠 | `settings.html` = 계정·보안·내 자료 · 편성 변수는 편성표 ⚙ · 플랜/코인은 내 계정 허브 · **«알림» 설정 0 · «앱 정보» 0 · «영상 만들기» 토글 0** | 알림 끄기·앱 버전·영상 켜기 자리가 없다 | 설정 섹션 2~3 | S |
| 13.0b | 그룹 «전체보기 ›» 링크 1개 · 앱바 제목 없음 | ✅ | `home.html:80` «전체» · `_tpl.txt` 앱바 아이콘만 | | | |
| 13.0b | 오류·빈 상태 = 토스트(원인+할 일) + 한 문장 빈 상태 | ✅ | `UI.toast` · `.empty`(스샷 `audit-19/20/31`) | | | |
| 13.0b | 운영 콘솔 = 예외(밀도만) | ✅ | `body.ops` 폭 1040 · 표 허용(B §11.4) | | | |

### §13.1 규율 · §13.2 정보 구조 · §13.3 핵심 화면 · §13.3b 웹 · §13.5 KST

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 13.1-1 | 한 화면 한 목적(제목 + 큰 숫자 + 하단 CTA) | ✅ | 스샷 전 화면 | | | |
| 13.1-3 | 진행 스텝 바(글쓰기→이미지→검수→예약) + 스켈레톤 + 예상 시간 | ✅ | `pieces.html` 스텝 · `.sk` | | | |
| 13.1-4 | 사람말(발행함·내 계정·오늘 번 돈) · 시스템 용어 0 | ✅ | A 하니스 · 여정 텍스트(§7) | («올라간 글»이 발행함 · 괜찮음) | | |
| 13.1-5 | 상태 칩 4색(정상 초록·주의 주황·정지 빨강·오프라인 회색) | ✅ | `.pill.ok/warn/danger/off` · `UI.ACC_STATUS` | | | |
| 13.1-6·7 | 모바일 퍼스트 400 → 데스크톱 720 중앙 + 좌측 탭 · 시안 정본 v3 | ✅ | `ac.css` 3구간 · `.rail` ≥641 · 스샷 `audit-32/35` | (정본은 v4 — 0.5) | | |
| 13.2 | 하단 탭 5(홈·만들기·편성표·수익·내 계정) | ✅ | `ui.js` 탭 · 스샷 | | | |
| 13.3 홈 | 오늘 번 돈 · 이번달 · 오늘 발행 N·대기 N · 해야 할 일 · 디렉터에게 맡기기 | ✅ | `audit-23` (오늘 발행 N·대기 N 은 «오늘 편성» 목록으로) | | | |
| 13.3 디렉터 | 소재 헤드(검색·상승·경쟁) · 대상 3행 · 시각 · 총 코인(잔여) · 손보기/이대로 | ✅ | `director.html` `#targets` · 코인 표 | (실측은 LLM 호출이라 안 함 · A 모의 확인) | | |
| 13.3 내 계정 | 채널 그룹(N) · 행 상태(정상/재로그인/정지→승계) · + 계정 연결 | ✅ | `accounts.html:43-48` | | | |
| 13.3 수익 | 9월 총합 · 소스 막대 · ⟳어제 신선도 · 글별 TOP5 | ✅ | `revenue.html` sourceGroup(신선도 «N분 전 가져옴») · pieceGroup | | | |
| 13.3b | 3구간(≤640 탭 / 641~1099 레일+720 / ≥1100 레일 220 + 640 + **우 300 패널 상시**) | 🟠 | ≤640·641~1099 ✓(`ac.css:35-43` · 스샷 `audit-35`) · ≥1100 640 컬럼 ✓ · **우 300 패널 상시 노출 0**(`.page.two` 미사용) | 데스크톱에서 미리보기·손보기 패널이 상시가 아니라 시트 대체 | 편성표·디렉터·검수 3화면에 aside | M |
| 13.3b | 텍스트 폭 720 초과 금지 · 짧은 목록 2열 허용 · BottomSheet→SidePanel | ✅ | `.page` max 720 · `.sheet` ≥1100 우측 300(`ac.css:197`) | | | |
| 13.5 저장 UTC | timestamp = UTC | ✅ | `db/schema.ts:3` · `db-util.ts utcDate` · AC-5 | | | |
| 13.5 응답 | ISO UTC `…Z` · 날짜 값은 KST `YYYY-MM-DD` | ✅ | 실측 `slots-list` publishAt `2026-09-15T03:00:00.000Z` · date `2026-09-15` | | | |
| 13.5 화면 | `UI.timeKST/dateKST/ago` 만 · timeZone 없는 `toLocale*` 0 · `datetime-local` 0 | 🟠 | `datetime-local` 0 · timeZone 없는 toLocale = `UI.won/num`(숫자 · 무해) 뿐 · **`revenue.html:32` 이중 시프트**(실측 Seoul «15일» vs New_York «16일») | 수익 «날마다» 축·지난달 비교가 기기 시간대를 탄다 | `todayYmd = new Date().toLocaleDateString("en-CA",{timeZone})` 로 1줄 | S |
| 13.5 입력 | 사용자가 고른 시각·요일·쉬는 날 = KST 해석 · 계약에 글자로 | ✅ | `schedule.html atKST`(KST 벽시계 → UTC ISO) · `slots-reschedule` · quietDays KST 날짜 | | | |
| 13.5 서버 | 오늘·주·월·마감·produceHour = KST(SQL AT TIME ZONE · `cron/base.ts` 소도구) | ✅ | `cron/base.ts kstHour/kstTodayUtc/kstWeekStartUtc` · `revenue/aggregate.ts` | | | |
| 13.5 크론 | 표현식 UTC · 업무 시각은 스텝 안 KST | ✅ | `netlify.toml` `*/5`·`0 *` · `produce.ts` kstHour | | | |
| 13.5 메일·알림 | 문구 시각 KST | ✅ | `trial-expire.ts` 09:00 KST 판정 · 알림 문구 «내일 …» | (표본 확인 · 전수 아님) | | |
| 13.5 내보내기 | KST + «(KST)» 표기 | ✅ | `lib/export/markdown.ts`/CSV 헤더 «(KST)»(B-1 §19 내보내기 ✓ 인용) | | | |
| 13.5 외부 값 | 받는 즉시 UTC 정규화 · 매체 «집계일»이 KST 와 다르면 화면에 «애드센스 기준일» 한 줄 | 🟠 | `lib/revenue/common.ts`(KST 날짜 소도구) · 커넥터는 API 가 준 날짜 문자열을 `revenue_daily.day` 에 그대로(`adsense.ts`·`youtube.ts` 에 timezone/PT 언급 0) · 화면 «기준일» 문구 0(`grep 기준일 public/app` 0) | 애드센스(PT)·유튜브(PT) 집계일이 KST 와 어긋나도 화면이 말하지 않는다 — 실회수 0이라 아직 안 드러남 | 커넥터 주석 + 소스 행 «기준일» 1줄(키 뒤) | S |
| 13.5 검증 | 기기 시간대 UTC·NY 로 열어도 같은가 | 🟠 | 편성표·홈 = 같음(NY 실측 12:00·07:30 KST) · 수익 = 다름(위) | 1화면 | 위 1줄 | S |

---

## §4 DESIGN §17 로드맵 · 리스크

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 17 P0 | 뼈대 완료 정의: MIS 카드/admin 로그인 → 운영 콘솔 · 셀프 가입 → 14일 체험 → 홈 | ✅ | 허브 카드 ⑥ 라이브 · 여정 실측 tid212(가입 → trial 14일 → 홈 `audit-23`) | | | |
| 17 P1 | 글 MVP 완료 정의: **계정 3개에 하루 3편 자동 예약·발행 · URL 이 발행함에** | 🟠 | 예약·제작·검수 ✓ · 러너 임시저장 실증 ✓ · **실제 발행 0건**(라이브 posts naver_blog 2 = 임시저장 · HANDOFF «실제 «발행» 0건») | URL 이 발행함에 뜬 적이 없다(임시저장 URL 뿐) | 실제 발행 GO 1건(사장님 결정 5) | M |
| 17 P2 | 수익·계정 완료 정의: 홈 «오늘 번 돈» 실데이터 · 정지 계정 글이 다음 계정으로 | ✅ | 애드포스트 스크랩 라이브 실증(HANDOFF) · 승계 = C `verify-failover.mts` + AC-24 수리 | (API 수익은 키 뒤 · 🔒) | | |
| 17 P3 | 영상 완료 정의: 소재 1개 → 60초 쇼츠가 계정별 변주로 예약·업로드 | 🟠 | 코드·렌더 실측 ✓(C R5) · **고객 경로 0 · 라이브 영상 0 · 업로드는 키 뒤** | §0.3 | 묶음 1 | L |
| 17 P4 | 상용 완료 정의: 결제 → 코인 → 생성 → 발행 → 수익 실돈 루프 | 🟠 | 결제 실돈 ✓(KICC 5,500) · 코인 ✓ · 생성 ✓ · **발행 실제 0 · 수익 API 0** | 루프가 «발행»에서 끊긴다 | P1 과 같음 | M |
| 17 P4 | 관리형 러너 팜 · 운영 콘솔 · AI 자동 업데이트 | 🟡 | 운영 콘솔 ✓ · AI auto 모드 ✓ · **러너 팜 0**(신청·가격만) | Q3 | 러너 팜 | L |
| 17 P5 | 티스토리 러너 · 틱톡 · X · WP 고급 · 화이트라벨 · 수익 학습 되먹임 | 🟠 | 티스토리 러너 ✓(임시저장·2FA 수동) · 되먹임 ✓(`learn.ts`) · **틱톡 0 · X 0 · 화이트라벨 0 · WP 고급(위젯 광고는 ✓) ** | Phase 5 잔여 3 | Phase 5 | L |
| 17 리스크 | 러너 셀렉터 변경·캡차 → 폴백 셀렉터 + 눈검사 스냅샷 + awaiting_manual | ✅ | `runner/channels/*.mjs` 후보 셀렉터 · `RUNNER_SHOTS`/`_shots` · AC-25 사람 개입 집합 | | | |
| 17 리스크 | 유튜브 심사 지연 → 비공개 업로드 안내 | ✅ | `posts.html` «심사 전엔 비공개로 올라가요» · `uploaded_private` | | | |
| 17 리스크 | 클립 PC 업로드 불가 → 에뮬 / «앱에서 올리기» 딥링크 폴백 | 🟠 | 스텁 → awaiting_manual «클립은 앱에서 올려 주세요» ✓ · 딥링크·mp4 내려받기 0 | 폴백이 문구뿐 | 묶음 1-4 | S |
| 17 리스크 | 계정 대량 정지 → 캐던스 보수·유사도·프로필 격리·고지 | ✅ | daily_cap 2 · min_gap 180 기본 · similarity · profiles · automation-notice 동의 | | | |
| 17 리스크 | 영상 원가 → 60초 28코인 · provider 비용 게이트 | ✅ | `coin-table.ts` · `video/cost.ts`(checkAiCostCap 재사용 · C 실측 14/14) | | | |

---

## §5 DESIGN §19 체크리스트 — 특별 항목 c(전 항목 판정)

### 법·약관

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 19 법 | 이용약관·개인정보처리방침·유료서비스 약관(자동결제 고지·해지·청약철회 7일·코인 환불) | 🔒 | `public/terms.html`·`privacy.html`·`paid-terms.html` 4문서 · 가입 동의 4 + `consents` 표 · 본문 «법률 검토 전» 표기 | 법률 검토 전 문서 | 사장님 액션(법률 검토) | — |
| 19 법 | 통신판매업 신고 · 현금영수증/세금계산서 발급 | 🟠 | 신고 = 사장님 액션(🔒) · 세금계산서 = 운영센터 «요청 기록»만(`ops-tax-invoice`) · **고객 요청 경로 404**(`plan.html:96` → `/api/tax-invoice-request` 없음) · 실발급 API 0 | 고객이 세금계산서를 요청하면 오류 | R6 §1.2 서버(M) + KICC 발급 연동(키 뒤) | M |
| 19 법 | 계정 제재 면책 고지 — 가입 시 명시 동의 · «내 PC 러너» 기본 | ✅ | `register.html:30` «자동 발행 · 계정 제재 안내» 동의(필수) · `consents kind automation_notice` · 관리형은 옵션 | | | |
| 19 법 | 표시광고법·쿠팡·애드센스·유튜브 합성 콘텐츠(§16B) | ✅ | `lib/disclosure.ts` · `ai-tell-gate` disclosure · `youtube.ts containsSyntheticMedia:true` · B-1 §16B | | | |
| 19 법 | 생성물 저작권·이용권 · 폰트·BGM·이미지 모델 라이선스 표 | 🟠 | `terms.html` «생성물의 권리는 이용자에게 · 회사는 서비스 목적 이용권» ✓ · «폰트·배경음악·이미지 모델은 회사가 확인한 것만» 한 줄 ✓ · **라이선스 «표»(어떤 폰트·BGM 12곡·모델이 어떤 라이선스인지) 0** · BGM 게이트 `BGM_LICENSE_VERIFIED=1` ✓ | 라이선스 목록 문서가 없다 | docs 1장(S) | S |
| 19 법 | 개인정보: 자격 보관 동의 · 파기 요청 절차 · 보관 기간 · 러너 PC 세션 파일 암호화 | 🟠 | 보관 기간·파기 안내 문구 ✓(`terms.html` 30일) · `account_creds.purged_at` ✓ · **`creds_storage` 동의 기록 0**(kind 정의만 · 호출처 0) · **파기 요청 절차·탈퇴 0**(B §16 ❌) · **러너 `runner/profiles/{key}` 평문**(grep encrypt 0) | 동의 없이 자격 저장 · 파기 못 함 · PC 에 세션 평문 | 연결 시트 동의 1줄(S) · 탈퇴·파기(L) · 프로필 암호화(M) | L |

### 제품

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 19 제품 | 콘텐츠 원본 내보내기 ZIP/마크다운 | ✅ | `netlify/functions/export.ts`(start/status) · `lib/export/*`(zip·markdown·R2 7일) · `settings.html` «전부 내보내기» 시트(범위·기간) · 실측 `export-start` 400 `range`(내 호출에 기간 누락 = 정상 검증) | | | |
| 19 제품 | 발행 후 통계 회수(조회·좋아요·댓글 · API/러너) | ✅ | `lib/cron/learn.ts` 마일스톤 6/24/72h · `publish/stats.ts fetchStats` · `revenue.stats` 러너 잡 · `posts.stats` · 발행함 «조회 N» | | | |
| 19 제품 | 댓글·DM 대응은 비범위로 명시 · 알림만 | ❌ | 약관·FAQ·화면 어디에도 «댓글» 언급 0(grep 0) · 댓글 알림도 0 | 고객이 «댓글도 달아 주나»를 알 길이 없다 | 약관/FAQ 1줄 | S |
| 19 제품 | 이미지 정책(실존 인물·유명인·로고·타사 상품 실사 금지 · 한글 오버레이) | ✅ | `lib/ai-image.ts:4·19` 고정 규칙(한글 굽기 금지·실존 인물·로고 금지) · `content-gen.ts:74` 장면 지시(사람·로고·글자 없는) | | | |
| 19 제품 | 동일 소재 계정당 **90일** 재사용 금지 · 계정 간 앵글 변주 | 🟠 | `assign-topics.ts:39` **30일** · 계정 간 유사도 게이트 ✓(`CROSS_ACCOUNT_SIMILARITY`) | 90 → 30 (설계와 다름 · 어느 쪽이든 결정) | 상수 1 · 0.5 | S |
| 19 제품 | 네이버 검색량 API 키(우리 계정·쿼터 관리) | ✅ | `.env` `NAVER_SEARCHAD_*`·`NAVER_OPENAPI_*` · `lib/naver-volume.ts`·`naver-datalab.ts` · 실측 `topics-add volume:10` | | | |
| 19 제품 | TTS 한국어 보이스 3~5종 · 실존 인물 모사 금지 | ✅ | `lib/video/tts.ts:108` GEMINI_VOICES 5 · 타입캐스트 목록 · «프리빌트만»(tts.ts:5) · 손보기 «목소리» 칩 | | | |
| 19 제품 | 시간대 전부 KST · 저장 UTC | 🟠 | §3 13.5 — 수익 화면 1곳 이중 시프트 | | 1줄 | S |
| 19 제품 | 결과 공유 카드(«이번 달 …원 벌었어요» 이미지) | ✅ | `netlify/functions/share-card.ts`(resvg+Pretendard · 핸들 숨김 기본) · `revenue.html` «이만큼 벌었어요 공유하기»(스샷 `audit-22`) · B-1 §19 | | | |
| 19 제품 | 추천인/레퍼럴 코인 | 🟠 | 화면 ✓(`register.html:22-23` 코드 칸 · `account.html:43` 친구 초대) · **서버 0**: `/api/referral` 404(실측 tid212) · `auth-register.ts` referralCode 처리 0 · `tenants.referral_code` 0 · 보상 grant 0 · R6 계약 §1.1(B) 미이행 · 전 브랜치 파일 0 | 코드 칸에 뭘 넣어도 무시 · «친구 초대» 행은 눌러도 반응 없음 | R6 §1.1 서버 | M |

### 운영

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 19 운영 | 러너 셀렉터 카나리(매일 «임시저장까지» 드라이런) | ✅ | `runner/ac-runner.mjs --canary` · `lib/cron/runner-canary.ts`(05:00 KST 평가 · 채널 down 제안) · `canary_runs` · 운영센터 러너 화면 | (자사 테스트 계정으로 «매일» 실제 도는지는 러너 PC 가동에 달림 · 라이브 canary_runs 는 B2 확인) | | |
| 19 운영 | AI 원가 상한(테넌트·일) + 이상치 알림 | ✅ | `lib/billing/ai-cost-cap.ts`(플랜별 일일 KRW) · 영상 소프트/하드 ×3(C 실측) · 운영 알림 `ai_cost_soft` | | | |
| 19 운영 | 남용 방지: 성인·도박·의료·비방 차단 · 이메일 인증 · 첫 발행 전 결제수단 | ✅ | `lib/banned-categories.ts`(소재 단계 거부+감사) · 인증 메일 + 홈 «이메일 인증» · `plans.ts:127 requireCardBeforePublish` + `publisher.ts:85`(플랜 토글 · 운영센터) | | | |
| 19 운영 | 고객 지원 채널(앱 문의 → 카카오/이메일 · 티켓) | 🟠 | 앱 «문의하기» → 티켓 ✓ · 답변 앱 알림+메일 ✓ · **카카오 채널·이메일 인바운드 0**(B §11.4 ❌) | 카카오/메일로 온 문의는 티켓이 안 된다 | 인바운드 2 | M |
| 19 운영 | 백업·복구(Neon PITR · R2 버전 관리) | 🟠 | `scripts/check-backup.mts` + `ops-backup-status`(실조회) · PITR 7일 ✓ · **R2 버전 관리 없음**(501 · AC-37 · 결정론 키 세대 표식으로 대체) | R2 는 되돌릴 수 없다(삭제·덮어쓰기) | 수용 여부 결정 | — |
| 19 운영 | 상태 페이지/공지(«지금 러너 발행이 늦어요») | ✅ | `notices` incident · 홈 배너(`home.html:41`) · 운영센터 공지 | | | |
| 19 운영 | 관리형 러너 원가 산정(Q3) | ❌ | 산정 문서·수치 0(가격 30,000 은 `plans.ts` 상수 · 원가 근거 없음) | 가격에 원가 근거가 없다 | 산정 1장(사장님 결정 3 뒤) | S |

### 기술(착수 시 실측)

| DESIGN § | 항목 | 상태 | 증거 | 안 되는 것 | 남은 일 | 크기 |
|---|---|---|---|---|---|---|
| 19 기술 | 유튜브 `containsSyntheticMedia` 필드 · 쿼터 증설 절차 | 🔒 | 코드 `youtube.ts` status 필드 ✓ · 쿼터 회로 ✓(`youtube.ts:92`) · 실측 0(앱 없음) · 증설 신청 = 앱 뒤 | 실측 못 함 | 앱 뒤 1회 | — |
| 19 기술 | 네이버 클립 PC 업로드 가능 여부(불가 시 에뮬) | ⬜ | 실측 기록 0(R5 presurvey «검증 필요» 그대로) · 스텁만 | 미실측 | 실측 1회(러너 PC · 테스트 계정) | M |
| 19 기술 | 티스토리 «수익 설정» 러너 조작 가능 여부 | ⬜ | `runner/channels/ads-setup-tistory.mjs` 코드 있음 · 실측 기록 0(C 보고서·HANDOFF 에 없음) | 미실측 | 드라이런 1회 | S |
| 19 기술 | 애드센스 Management API 접근 승인 | 🔒 | `lib/revenue/adsense.ts`·`google-oauth.ts` ✓ · 앱·승인 0 | | 사장님 액션 | — |
| 19 기술 | 쿠팡 파트너스 subId 단위 집계 실측 | 🔒 | `lib/revenue/coupang.ts` subId=piece · `affiliate-coupang.ts` · 키 0 → 실측 0 | | 키 뒤 1회 | — |

---

## §6 특별 항목 a — 영상 축이 고객 화면에서 보이는가(고객 경로로 따라감)

경로: 가입(tid 212) → 온보딩 → 계정 연결 → 만들기/디렉터 → 검수 → 발행함. 실측은 로컬 `netlify dev`(8905 · `VIDEO_PROVIDER_STUB=1`) + 라이브 DB · 스샷 `_shots/audit-*.png`.

| 단계 | 설계(§2.2·§6·R5 화면 8) | 지금(증거) | 판정 |
|---|---|---|---|
| 온보딩 «무엇으로 벌까요» | 글/영상 타일 | 영상 타일 있음 · 영상 채널이 전부 planned 라 «곧 열려요» 칩(`onboarding.html:76`) · 고르면 `settings.kinds` 저장 | 🟠 «곧 열려요»로 시작부터 «아직 아님»을 말한다 |
| 계정 연결 그리드 | 유튜브·클립·릴스·(쓰레드·인스타·틱톡) 마크 | **N·T·B·W 4장만**(`audit-12` · `accounts.html:38` `status==='active'` 필터 · 실측 `accounts-list.channels` 영상 4 `planned`) | ❌ 입구 0 |
| 유튜브 연결(API 직접) | OAuth 창 | `accounts-oauth-start youtube_shorts` → `provider_not_configured «준비 중이에요»`(실측) · 키 꽂으면 즉시 | 🔒 |
| 클립 연결(API 직접) | 세션 로그인 | `accounts-add naver_clip` → 400 `creds`(아이디·비번 요구 = 정상 검증 · 넣으면 pending_login 으로 붙는다) — **화면엔 타일이 없어 사람은 못 한다** | 🟡 |
| 만들기 → 디렉터 «영상» 고르기 | 대상 행에 «영상» · 손보기 영상 섹션 | 화면 코드 ✓(`director.html:78-85` 포맷·길이·목소리·변주·제휴 배지) · **디렉터가 영상 piece 를 내는 조건 = kinds 에 video ∧ 영상 채널 계정 alive**(`director.ts:170-174`) → 지금은 둘 다 없어 «영상» 행이 영영 안 뜬다 · 글 채널만 있을 때 «영상도 만들래요» 선택지 0 | 🟠 |
| 기존 테넌트 영상 켜기 | 설정 토글 | 0(`settings.html` kinds 없음 · 온보딩 재진입 링크 0) · 212 처럼 온보딩을 안 거치면 kinds 자체가 없다(`auth-me` settings `{trialDays,autoSchedule}`) | ❌ |
| 편성 규칙 «쇼츠 매일» | 규칙 시트에 영상 채널 행 | 시트는 **연결한 계정의 채널**만 나열(`ruleSheet chans = accounts.map`) → 영상 계정이 없으면 행 자체 0 | 🟠(계정 뒤에 정상) |
| 제작 → 심사 → 검수 화면 | 플레이어·SRT·배지·설명란·심사 축·다시 만들기 1회 | `piece.html:44-79` ✓ · 렌더 실측 C R5 · 실호출 금지라 이번 조사에선 화면 실측 ⬜(A 모의로 확인) | ✅(코드·시안) |
| mp4 내려받기 | (설계엔 명시 없음 · «앱에서 올리기» 폴백의 전제) | `piece.html` `download=` 는 SRT 뿐(:56) · `<video src>` 만 · 모바일에선 저장 불가 | ❌ |
| 발행함 awaiting_manual(클립·실패) | «직접 올려야 해요» + 사유 | 그룹·칩 ✓(`posts.html:52`) · 시트 CTA = **«본문 복사하기»**(:75 · 글 전용) · 영상엔 «영상 보기» 링크만 · «올린 주소 적기» 0 | 🟠 |
| 유튜브 비공개 업로드 표시 | «비공개 업로드됨 · 공개 전환 필요» + 스튜디오 링크 | `posts.html:34·58`(`uploaded_private` · `UI.studioUrl`) ✓ | ✅(키 뒤 실측) |
| 러너 ffmpeg 없음 | 칩 + 설치 안내 | `runner.html`(«영상도 이 프로그램이 구워요» · caps.ffmpeg 칩) ✓ | ✅ |

**어디서 끊기나(한 문단)**: 첫 문에서 끊긴다. 계정 연결 그리드가 `planned` 채널을 숨겨 유튜브·클립·릴스에 계정을 붙일 수 없고, 디렉터는 «영상 채널 계정이 있을 때만» 영상 piece 를 내므로 **고객은 영상이라는 선택지를 화면에서 한 번도 보지 못한다**(라이브 영상 piece 0건이 그 결과). 레지스트리를 열면(운영센터 채널 화면 1클릭) 클립은 세션 계정으로 붙어 «30초 제작 → 심사 → awaiting_manual»까지 가지만, **거기서 mp4 를 내려받을 버튼과 «앱에서 올렸어요»를 적을 칸이 없어** «만들기 → 내려받기 → 직접 올리기»의 마지막 두 칸이 여전히 막힌다. 유튜브는 OAuth 앱(🔒)이 와야 자동 업로드가 되지만 코드는 «키 꽂으면 즉시» 상태다. 정리하면 영상 축 = **코드 완성 · 문 잠김 · 손잡이 2개 없음**(§0.3 표 ④⑤). R7 묶음 1 이 그 목록이다.

---

## §7 특별 항목 b — 고객 여정 1바퀴(화면으로 직접 눌러 본 것)

방법: Playwright(뷰포트 400×860 · **기기 시간대 America/New_York** = §13.5 검증 조건) · 로컬 `netlify dev` 8905(라이브 Neon) · 테스트 테넌트 **212 `audit-mu21afgu@autocreate.test`**(user 109) · LLM 호출 0(소재 뽑기·디렉터 제안·글 생성은 안 눌렀다 — 실호출 금지) · 러너·발행 0 · 스샷 30장 `_shots/audit-01~35*.png` · 로그 `_verify/journey-walk-*.json`. 아래는 **걸린 곳만**(정상 동작은 §1~§5 표의 ✅ 증거로 흡수).

| # | 여정 단계 | 눌러 본 것 | 걸린 것 | 증거 | 판정 |
|---|---|---|---|---|---|
| 1 | 가입 | 이름·이메일·비밀번호 · «모두 동의» · 가입 | 응답 **10.9초**(로컬 · 인증 메일 await(AC-36) 포함) — 첫 하니스는 6초 안에 못 받아 «가입 안 됨»으로 오인. 라이브는 미측정 | `_verify/nd.log` «POST /api/auth-register … 201 in 10978 ms» | ⬜(라이브 재측정 · 메일은 배경 큐 후보) |
| 2 | 온보딩 | (브라우저를 닫고 바로 홈으로 들어감) | **온보딩은 가입 화면의 클라이언트 이동뿐** — 안 거치면 `settings.kinds`·`onboardedAt` 이 영영 없고 홈도 되돌려 보내지 않는다 · 212 가 그 상태 | `auth-me` settings `{trialDays:14,autoSchedule:true}` · `home.html` 온보딩 유도 0 | 🟠 |
| 3 | 홈(첫 화면) | 큰 숫자 · 해야 할 일 · 오늘 편성 · 토글 | «아직 연결된 곳이 없어요» → 수동 수익 넣은 뒤 «오늘 12,400원 벌었어요» ✓ · 해야 할 일 «첫 계정… **유튜브** 중 하나면 돼요» — 유튜브는 못 붙인다 | `audit-10`·`audit-23` · `home-summary.ts:43` | 🟠(문구) |
| 4 | 계정 연결 | 그리드 · API 직접 add | 영상·SNS 채널 6개 타일 없음(§6) · 세션 계정은 아이디·비번 없이는 안 붙음(정상) | `audit-12` | ❌(입구) |
| 5 | 소재 | «내 소재 넣기»(`topics-add`) | ✓ 코인 0 · 검색량 10 · 두 번째는 400 `duplicate`(정상) · **계정 0이면 소재 목록 대신 «먼저 계정을 연결해 주세요»**(넣은 소재 1이 «오늘의 소재 1» 숫자로만 보인다) | `audit-14` · `topics-add {ok,id:507}` | ✅(게이트 합리적) |
| 6 | 디렉터 | `/app/director.html?topicId=507` | 계정 0 → 제안 `no_account` → 만들기로 되돌림(정상) · 제안 자체는 LLM 이라 안 누름 | `audit-15` | ⬜ |
| 7 | 편성표 | 규칙 저장(주 3회) → 슬롯 7 → 2주/월 · 슬롯 시트 | ✓ KST(NY 시간대에서도 12:00·07:30) · «이번엔 건너뛰어요» 15·17일 ✓ · **홈 «오늘 편성»은 같은 15일 자리를 «예정»으로**(skipReason 미적용) · 규칙 저장을 두 번 하면 옛 규칙 비활성 + 슬롯 재생성(`n:2`) — 옛 planned 슬롯은 정리됨(slots-list 7) | `audit-17`·`audit-23` · `rules-save {n:2, slotsCreated:7}` | 🟠(홈 1줄) |
| 8 | 만든 글·검수 | 빈 상태 | «봐주실 글이 없어요» ✓ · 글 생성은 안 함 | `audit-19` | ⬜(실호출 금지) |
| 9 | 발행함 | 빈 상태 · 탭 3 | ✓ | `audit-20` | ✅ |
| 10 | 수익 | 큰 숫자 · 날마다 · 어디서 · 직접 넣기(협찬 12,400) | «날마다» 축 **1일~16일**(NY) — Seoul 로 열면 15일 · 지난달 비교 `to=08-16` vs `08-15` | `audit-22` · `audit-probe-app-revenue-html.png` | 🟠(#7) |
| 11 | 수익 매체(ad-media) | 목록 · 애드센스 연결 | 계정 0이라 애드센스·애드포스트·YPP 행이 안 보이고 쿠팡·알리·링크프라이스(키 필요)·클립(대기)·직접 넣기만 · 애드센스 connect → 503 `provider_not_configured «준비가 아직이에요»`(정직) | `audit-24` | 🔒 |
| 12 | 요금제 | 카드 3 · 부가세 별도 · 카드 등록 | ✓ «모든 가격은 부가세 별도예요» · 카드 등록은 KICC 실측 완료(사장님) | `audit-25` | ✅ |
| 13 | 코인 | 잔액 0 · 팩 4 · «다른 서비스 코인 가져오기» | 행은 있는데 `/api/coin-transfer` 없음(AM 쪽 선결 · R6 §1.4 미이행) → 누르면 실패 토스트 | `coins.html:104` · config.path grep 0 | 🟠 |
| 14 | 러너 | 설명 4줄 · «내 PC에서 켜기» · 관리형 신청 | `runner-download` 200 ok(B2 배포 zip 머지됨) · 관리형 `eligible:false · 33,000원`(trial) ✓ | `audit-27` | ✅ |
| 15 | 내 계정 허브 | 행 6 | «친구 초대» → **`/api/referral` 404**(콘솔 에러) → 눌러도 무반응 | 여정 apiLog `404 /api/referral` | 🟠(#4) |
| 16 | 설정 · 내보내기 | 이메일 인증 «다시 보내기» · 전부 내보내기 | 내보내기 시트 ✓(범위·기간 필수 — 400 `range` 는 내 호출 누락) | `audit-29` | ✅ |
| 17 | 문의 | FAQ · 문의 남기기 | ✓(문의는 안 남김) | `audit-30` | ✅ |
| 18 | 알림함 | 빈 상태 | «아직 알림이 없어요» ✓ — 규칙 저장·수익 입력엔 알림이 없는 게 맞다 | `audit-31` | ✅ |
| 19 | 데스크톱·태블릿 | 1280 · 800 | 레일 + 640 컬럼 ✓ · 우 300 패널 상시 ✗(#11) · 태블릿 레일+720 ✓ | `audit-32/33/34/35` | 🟠 |
| 20 | 로컬 성능 | 전 API | 호출당 4~8초(로컬 esbuild 콜드 · AC-12 로컬 인공물) — 화면이 스켈레톤으로 오래 머문다. 라이브는 미측정 | `nd.log` | ⬜ |

**여정 결론**: 글 축의 화면 골격은 설계대로 서 있고(토스 패턴·KST·정직 표기), 걸린 곳은 ①영상 입구 ②R6 서버 조각(추천인·코인 이전·영수증·세금계산서) ③홈이 못 보는 것(러너·직접 올리기·코인 부족·재로그인·게이트 거부·skipReason) ④수익 KST 1줄 ⑤온보딩 미이수 상태 — 다섯 묶음이다. LLM 실호출 금지 때문에 «소재 뽑기 → 디렉터 → 글 → 검수 → 발행» 본줄기는 이번 조사에서 **화면으로 안 눌렀다**(⬜ · C 보고서·사장님 실측 5건이 그 구간의 증거).

---

## §8 다른 영역 파일 통합 — 대조 · 상위 20 되짚기 · ❌ 재grep

### 8.1 파일 4개(요약은 각 파일 §0 그대로 · 여기선 통합 판단만)

| 파일 | 행 | 판정 분포 | 이 문서와 겹친 곳 | 통합 판단 |
|---|---|---|---|---|
| `audit/2026-09-15-B1.md` | 141 | ✅103 🟡4 🟠14 🔒2 ❌8 ➖9 | §4.2 자동승인(계정 단위 아님 · 🟠) · 영상 a 절 · mp4 내려받기 · kinds 켜기 | 전부 동의 · a 절은 «반만 맞다»(§0.3) |
| `audit/2026-09-15-B.md` | 137 | ✅106 🟠6 ❌10 ➖14 🔒1 | §11.4 추천인·세금계산서·회사 정보 · §12.2 채널 게이트 | **✅ 2건을 🟠 로 정정**(8.2) |
| `audit/2026-09-15-B2.md` | 80 | ✅33 🟡19 🟠11 🔒1 ❌12 ➖3 ⬜1 | §2 영상 채널 · 러너 배포 · 수익 0행 | 전부 동의 · «➖ 6 = 설계 문장» 0.5 에 수록 |
| `audit/2026-09-15-A.md` | 16장 | 🟠 6 · ⬜1 | 준비 중 타일 · 온보딩 칩 · `${UI.chev}`(main 에서 수리됨 cd913a7) · 탭 42px | ⬜(영상 planned 여부)는 이 문서가 라이브로 판정 → 🟠 |

### 8.2 다른 파일의 ✅ 중 상위 20 후보를 내가 되짚은 결과(자기 영역 감싸기 방지)

| 파일 · 행 | 그쪽 판정 | 되짚은 증거 | 최종 |
|---|---|---|---|
| B §11.4 «추천인 코인» | ✅(account.html:42 · promotions kind referral) | `/api/referral` 404(실측) · `auth-register.ts` referral 0 · 보상 코드 0 — 화면과 프로모션 «값»만 있고 흐름 0 | **🟠** |
| B §11.4 «세금계산서/현금영수증» | ✅(ops-tax-invoice 요청 기록) | 운영자 기록 API 는 있음 · **고객이 요청하는 `plan.html:96` 경로 404** · 영수증 `receipt.html:47` `/api/invoice` 404 | **🟠**(고객 쪽) |
| B §12.0 «부가세 별도 문구 … 영수증» | ✅(receipt.html 행) | 영수증 페이지는 API 404 로 «청구서를 찾을 수 없어요»만 뜬다 — 문구는 있어도 페이지가 안 열린다 | **🟠** |
| B-1 §16B.4 «발행 직전 재검사 → 홈 해야 할 일» | ✅(소스 판독) | `home-summary.ts` 에 awaiting_manual 행 0 — 알림함엔 가고 홈엔 안 온다 | **🟠**(홈 쪽) |
| B-1 §6.2 채널 규격·세이프존 · §6.3 코인 | ✅ | `writing-contracts.ts:228 VIDEO_CHANNEL_MAX_SEC` · `coin-table.ts` 6/12/28 · C 실측 — 유지 | ✅ |
| B-1 §10 AI 감시·카나리·롤백 | ✅ | `ai-model-watch.ts` · `ops-ai.ts` 5경로 · `ai_settings` — 유지 | ✅ |
| B2 §8.3 하트비트 60초·오프라인 30분 awaiting_runner | ✅ | `publisher.ts` fleetState · `UI.SLOT_STATUS.awaiting_runner` — 유지(홈 미표시는 별건) | ✅ |
| B2 §9.3 홈 큰 숫자 확정/예상 분리 | ✅ | 실측 tid212 수동 12,400 → 확정 진하게(`audit-23`) — 유지 | ✅ |
| B §7.3 계정 간 30분 · 프록시 · 프로필 격리 | ✅ | `best-time.ts:19` · `browser.mjs:30` — 유지 | ✅ |
| B §11.0 인증·잠금·리프레시 | ✅ | 여정 실측 가입·로그인·auth-me·refresh 401→200 — 유지 | ✅ |
| B §12.1 코인 표·팩 | ✅ | 실측 `coin-packs` 4팩 값 일치 — 유지 | ✅ |
| B-1 §5.5 디렉터 화면 CTA 2·손보기 시트 | ✅ | `director.html` 코드 확인(실측은 LLM 이라 ⬜) — 유지 | ✅ |
| B2 §2.1 네이버·티스토리 러너 | ✅ | HANDOFF 실증(임시저장) — 유지 · «실제 발행 0»은 §4 P1 🟠 로 따로 | ✅ |
| B §11.4 운영센터 12메뉴 | ✅ | `public/ops/` 17장 · 이번 조사에서 운영센터는 화면 실측 안 함(⬜ 표기 없이 코드만) — 유지 | ✅ |

### 8.3 다른 파일의 ❌ 를 한 번 더 grep 한 결과(«없다» 방향 오류 방지 · 메인 규칙)

| 파일 · 항목 | 그쪽 ❌ | 재grep | 최종 |
|---|---|---|---|
| B §7.1 `account_groups` 쓰는 코드 0 | ❌ | `grep -rn account_groups lib netlify` → 0(표만 · `group_id` 는 accounts 칸으로 참조) | ❌ 유지 |
| B §7.1 `avatar` | ❌ | schema accounts 에 avatar 0 · `UI.mark` 이니셜 | ❌ 유지(선택 수준) |
| B §11.0 `team-invite/accept` | ❌ | config.path 전수 grep 0 · `git log --all -- netlify/functions/team-invite.ts` 0 | ❌ 유지 |
| B §12.2 플랜 채널 게이트 | ❌ | `grep -rn "channels" lib/plans.ts` → limits 에 channels 없음 · accounts-add 에 플랜 채널 검사 0 | ❌ 유지 |
| B §15 `publish-now` · `accounts-health` · `director-settings` | ❌ | `publish-now`: «지금 올리기/지금 발행» grep 0 → **❌ 유지**(approve 뒤 5분 크론만) · `accounts-health` → `accounts-list` healthScore/`account-health.ts` · `director-settings` → `tenant-settings autoSchedule` = 다른 이름으로 있음 | publish-now ❌ · 나머지 2 ➖ |
| B §16 탈퇴·파기 | ❌ | `grep -rn "purge\|탈퇴\|withdraw" netlify/functions lib` → `account_creds.purged_at` 만 · 테넌트 파기 0 | ❌ 유지 |
| B2 §2.1 브런치·페북·X·미디엄 | ❌ | grep brunch/facebook/twitter → `runner-jobs.ts:46` 주석(«Phase 3»)뿐 · 코드 0 | ❌ 유지(설계상 P3~P4·보류) |
| B2 §2.2 틱톡 커넥터 | ❌ | `lib/publish/tiktok.ts` 0 · `oauth-providers.ts` 에 tiktok 인가만 | ❌ 유지 |
| B2 §9.1 쇼핑커넥트·텐핑·애드픽 | ❌ | `revenue/types.ts` 소스 13 에 없음 · 수동 «그 외»로만 | ❌ 유지(수동 흡수 가능 = 설계 문장 후보) |
| B-1 §5.3-2 페르소나-소재 적합도 LLM 1콜 | ❌ | `director.ts:152 assignAccount` = health 순만 · LLM 0 | ❌ 유지 |
| B-1 §6.2 프레임 지문(러너 전송) | 🟠 | `judge.ts:106` «지문 없음» · `render-video.mjs` 지문 전송 grep 0 | 🟠 유지 |
| B-1 §5C.1 인스타 카드뉴스 발행 | ❌ | `publish/instagram.ts` publishReels 만 · 카드 렌더 0 | ❌ 유지 |
| 이 문서 §5B.3 `format_hint` | ❌ | `grep -rn formatHint lib/` → slots.ts(저장·응답)만 · director-auto/produce 0 | ❌ 유지 |
| 이 문서 §19 댓글·DM 비범위 | ❌ | grep 댓글 in terms/privacy/automation-notice/support/faqs 시드 → 0 | ❌ 유지 |
| 이 문서 §13.0 당겨서 새로고침·햅틱 | ❌ | grep 0 | ❌ 유지 |

---

## 부록 A — 실측한 것 · 정리한 것

| 구분 | 내용 |
|---|---|
| 로컬 서버 | `netlify dev --port 8905 --functions-port 3985 --target-port 3984`(정적 `_verify/_static.mjs`) · env `SITE_URL=http://localhost:8905 CRON_BUDGET_MS=24000 FX_USD_KRW=1400 VIDEO_PROVIDER_STUB=1` · 라이브 Neon(`.env` 복사) |
| 테스트 테넌트 | **tid 212** `audit-mu21afgu@autocreate.test` / user 109 · trial 14일 · 만든 행: users 1 · tenants 1 · consents 4 · audit_logs(가입·로그인·규칙·수익) · topics 1(#507) · cadence_rules 2(1 비활성) · slots 7(#304~) · revenue_daily 1(sponsor 12,400 · 2026-09-15) · revenue_sources 1 · notifications 0 · pieces 0 · 코인 0 · 결제 0 |
| 실호출 | LLM 0 · 이미지 0 · 영상 0 · 이메일 1(가입 인증 → `@autocreate.test` 무효 도메인) · 러너 0 · 발행 0 · 결제 0 |
| 스샷 | `_shots/audit-01-register.png` ~ `audit-35-home-tablet.png` + `audit-probe-app-{home,revenue}-html.png`(gitignore · 워크트리 `AutoCreate-B3/_shots`) |
| 시간대 실측 | 같은 페이지를 `timezoneId` America/New_York · Asia/Seoul · UTC 로 열어 비교(수익 «날마다» 축 16일/15일 · 편성표 12:00·07:30 동일) |
| 정리 | 🔴 **tid 212 행은 아직 남아 있다** — 삭제는 라이브 데이터 변경이라 이 창(auto 모드)에서 실행하지 않았다(HANDOFF §3 «라이브 변경은 그 창에서 사장님 Allow»). 삭제 SQL 은 아래(tenant_id=212 한정 · 보존 4집 무접촉 · pieces·posts·coin_ledger 는 만든 적 없음) — 메인/사장님 Allow 뒤 실행 |
| 보존 4집 | 3·13·109·116 무접촉(SELECT 도 안 했다) · 198(사장님 결제 테스트) 무접촉 |

```sql
-- 전수조사 테스트 테넌트 212(audit-mu21afgu@autocreate.test · user 109) 정리 — 사장님 Allow 뒤 실행 · tenant_id=212 한정 · 보존 4집(3·13·109·116) 무접촉
BEGIN;
DELETE FROM revenue_daily   WHERE tenant_id = 212;
DELETE FROM revenue_sources WHERE tenant_id = 212;
DELETE FROM slots           WHERE tenant_id = 212;
DELETE FROM cadence_rules   WHERE tenant_id = 212;
DELETE FROM topics          WHERE tenant_id = 212;
DELETE FROM notifications   WHERE tenant_id = 212;
DELETE FROM consents        WHERE tenant_id = 212;
DELETE FROM audit_logs      WHERE tenant_id = 212;
DELETE FROM refresh_tokens  WHERE subject_type = 'user' AND subject_id = 109;
DELETE FROM users           WHERE id = 109 AND tenant_id = 212;
DELETE FROM tenants         WHERE id = 212 AND key LIKE 'auditmu21afg%';
COMMIT;
```

## 부록 B — 방법 · 한계

- «판정 단위» = 표 한 행 · 규칙 한 줄 · 변수 하나 · 화면 한 장 · API 하나. 🔒 는 «키 꽂으면 즉시»인지 병기했고, 아니면 🟡/❌ 로 내렸다.
- ✅ 는 파일:줄 + 화면 + (있으면) 실측. 실측 못 한 것은 ⬜ 로 두고 통과로 적지 않았다(AC-9). 하니스 초록은 증거로 안 썼다(#9).
- 🔴 한계: ① LLM·이미지·영상 실호출 금지 → 소재 뽑기·디렉터 제안·글 생성·검수 화면·영상 파이프는 **코드·시안·C 보고서로만** 판정(⬜ 표기) ② 러너·발행·결제는 드라이런도 안 돌렸다(HANDOFF 실증 인용) ③ 운영센터 화면은 코드만(B 가 화면 존재 확인) ④ 로컬 API 지연(4~8초)은 로컬 인공물(AC-12)이라 결함으로 적지 않았다.
- 다른 영역 파일의 ✅ 는 «고객이 먼저 부딪히는» 후보 14개를 골라 되짚었고(8.2 · 3건 정정), ❌ 는 전부 한 번 더 grep 했다(8.3 · 3건 ➖ 로 낮춤).
