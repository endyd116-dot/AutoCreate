# R5 사전 조사 — 영상 축 · 쇼츠 공장 (B-1 · 2026-09-14 · 읽기만 · 코드 0)

> 대상: AM `lib/shorts-*`·`creative-*`·`video-providers/*`·`public/runner/content-runner-core.mjs`(4,267줄)·`docs/active` SHORTSFACTORY·SHORTS1~6·SHORTSBILL · AC main `runner-jobs`·`oauth-providers`·`revenue/youtube` · DESIGN §6·§2.2·§8·§16B·§17 · PITFALLS AC-1~26.
> 용도: **R5 계약서(`2026-09-1x-P1R5-contract.md`)의 뼈대.** 메인 결정은 §D 에 표시.

## 0. 먼저 알아야 할 구조 사실 3개
① AM 쇼츠 체인의 «합성»은 서버가 아니다 — `lib/shorts-graphic-story.ts`(대본→팩트체크→TTS→Omni 컷 N개)는 Netlify **background 15분** 안에서 돌고, 마지막에 `creative_assets.status='rendering'` 으로 넘기면 **PC 러너**(`content-runner-core.mjs` · playwright 크롬 프레임 캡처 + ffmpeg concat·자막 번인·오디오 4층 amix·loudnorm)가 mp4 를 굽고 R2 presigned PUT 으로 올린 뒤 `render_report` → 서버가 headFromR2 로 실존 확인 → 8축 심사(`creative-judge.ts`) → 미달이면 결정론 수리 후 재큐(≤2회) → 3회째 pending_review. **AC 도 «생성은 서버 배경함수 · 합성은 러너 잡 `render.video`»**(DESIGN §6.2 «렌더 러너 필수 · 서버리스 불가»).
② AM 은 **15분 벽을 실제로 맞았다**(SHORTSBILL #912 14분·#896 29분·첫 실행 흔적 없이 소실) → 수리 = `lineage.chainStage` 하트비트 + `CHAIN_BUDGET_MS=11분` 이어달리기(`chainResume` · 재시도와 다른 축) + 스위퍼(20분 stale) + `chainLock`(동시 실행 차단 — $6.9 두 번 쓸 뻔). **AC 는 처음부터 이 셋을 계약에.**
③ 유튜브 업로드 어댑터는 AM 에 **없다**(youtube_shorts = MANUAL 복붙). AC 에는 `oauth-providers.ts`(youtube.upload/readonly)·`publish/tokens.ts`·`revenue/youtube.ts` 가 있어 **출구는 AC 가 새로 만든다**(B2).

## A. 그대로 옮겨도 되는 것(수정 0~소 · 헤더 «AM 원본·복사일»)
1. `lib/video-providers/registry.ts` — provider 표(wan·hailuo·veo·veo_fast·veo_lite·kling·omni)·티어 사다리 `pickProvider(tier, i2v|t2v)`·**하드 금지**(Sora·Hunyuan·LTX) `assertProviderAllowed`. 순수.
2. `omni.ts`(Interactions API 동기 ~35s · previous_interaction_id 편집 재생성 · policyBlocked) · `veo.ts`(predictLongRunning 폴링 · referenceImages i2v) · `fal.ts`. 키 = `GEMINI_API_KEY`(`resolveMeteredKey`→우리 ai.ts 치환 소).
3. `lib/creative-tts.ts` 순수부(`preprocessForSpeech`·`readNumberKo`·`readMoneyKo`·`speechCharBudget`·`checkScriptFit`·`buildNarrationFromCaptions`·`packNarrationCues`) · 합성부 `synthesizeNarration`(Gemini TTS) 는 ai-meter 의존만 제거 · `lib/tts-typecast.ts`(필재·ssfm-v30·`/with-timestamps` 어절 시각·`audio_tempo`) 그대로.
4. `lib/shorts-captions.ts`(어절 타임스탬프→구절 자막·**SRT** `phrasesToSrt`) · `shorts-annotations.ts`.
5. `lib/shorts-scenes.ts` 컷 프롬프트 계약(`buildGraphicShotPrompt` SUBJECT/STYLE/COLOR/BEAT · `checkCutConflicts` · `bakedWordOk`). 순수.
6. `lib/shorts-script.ts` 게이트(`checkHook` 3초 훅 · `fictionFrameOk`/`fictionNumbersOk` · `unverifiedTokens`/`correctionLanded` 팩트체크 · `hasFactualClaims`) + `buildGraphicStoryScript`(googleSearch 그라운딩 — **우리 ai.ts 에 googleSearch 옵션 복원 필요**) + `buildYoutubeMeta`.
7. `lib/creative-judge.ts` 8축(`judgeSpecDeterministic`·`judgeFramesVisionOutcome`·`checkFramesNotBlank`·`checkLoopSeam`·`repairSpecDeterministic`) + `SHORTS_GATE_RETRY_MAX` · `creative-review-gate.ts` · `creative-polish.ts`.
8. `lib/video-render.ts`(BGM FreePD 카탈로그·R2 시드) + `resolveBgm`(`BGM_LICENSE_VERIFIED=1` 없으면 무음) + `creative-sfx.ts resolveSfx` — 라이선스 단일 관문.
9. 러너 렌더부 `content-runner-core.mjs` §render(`openRenderBrowser` · ffmpeg 사다리 `FFMPEG_CANDIDATES` · concat·번인·amix normalize=0·loudnorm · `amix=inputs=0` 방어 · CRF) → AC `runner/channels/render-video.mjs` **파일 분리 이식**(core.mjs 무접촉).
10. `shorts-topics.ts`(뱅크·30일 중복·`findBridgeTopic`) · `shorts-reference.ts`(레퍼런스 URL→구조 템플릿) · `shorts-bandit.ts`(훅·오프너·클로징 밴딧) — AC `topics` 와 **합쳐야**(B-3).

## B. 🔴 바꿔야 할 것(AC 모델 차이)
1. **객체 모델**: AM `creative_assets` 1행 ↔ AC `pieces(kind video·channel·account_id)` + `piece_assets(video/thumb/audio/clip)` + `runner_jobs(render.video)`. spec/lineage/quality → `pieces.meta`·`pieces.blocks`(컷 시퀀스)·`gate_report`. 큐 북키핑(`claimedAt` 15분 TTL·`RENDER_RECLAIM_MAX=3`) → `runner_jobs.claimed_at/attempts`. **`creative_assets` 표를 만들지 않는다(두 척추 금지).**
2. **큐 축**: AC `runner_jobs` claim/report/release 에 **kind `render.video` 하나 추가**(우선순위 70 · 발행>세션>수익>렌더). report = «러너 주장 불신»: mp4 R2 HEAD + `durationMs·bytes·frameCount` 구조화.
3. **소재·편성 두뇌 통합**: `shorts_topics/templates/shorts-loop` → AC `topics(channelHint 영상)`·`cadence_rules(kind shorts)`·`slots(kind shorts)`·디렉터 propose 로 **흡수**(새 뱅크·새 루프 크론 = 슬롯 없는 자동 생성 재발). `topics.factors.structureTemplateId` 만 추가 · `shorts_templates` 표는 유지.
4. **다계정 변주**(§6.2 신규): PieceSpec `variant:{ hookType, palette, voice }` → 컷 프롬프트 COLOR 절 + TTS `voiceForChoice`. 유사도 게이트 = **프레임 지문**(`pickSharpestFrame`+pHash) — R5 에서 새로.
5. **포맷 3종**(graphic · talking · clip): `writing-contracts.ts` shortsContract 4행에 **컷 수·초 예산·provider 티어** 붙여 표 한 벌(`shortsFormOf` SHORTS6 이식).
6. **채널 프리셋·세이프존**: 쇼츠 ≤60 · 클립 15~30 · 릴스 90 · 상하 UI 가림 — `creative-layout.ts computeLayout` 채널 파라미터 + **§16B 우상단 배지 상시 오버레이 트랙**(자막과 별도 레이어).
7. **비용 게이트**: `video_assets.cost_usd` 월캡·kill switch → AC `ai_usage(purpose video_clip)` 합 월캡 + `feature_flags`. **코인 선차감(piece당 1회)과 달러 캡은 별개 두 관문.**
8. **이어달리기·잠금·스위퍼**(§0-②) → `generate-video-background` 에 처음부터: `meta.chainStage·chainLock·chainResume` + 컷 결과는 `piece_assets(kind clip · sort=컷번호 · meta.interactionId)` **컷마다 즉시 저장**(다시 만들면 돈 두 배). 스위퍼 = `cron-tick-5m` 스텝.
9. **팩트체크 왕복** = `lib/ai.ts` `googleSearch:true` 옵션 복원(jsonMode 병용 불가 → 텍스트 후 파싱).
10. **TTS·클립 비용 계상** = `ai_usage.purpose`(`tts`·`video_clip`) 어댑터 3줄.
11. **정책 표시**(§16B 영상): 시작 3초 자막 + 우상단 배지 + 설명란 첫 줄 공식 문구 + 유튜브 `status.containsSyntheticMedia=true` + `selfDeclaredMadeForKids=false`. `disclosure.ts` 에 `videoBadge`/`videoDescriptionFirstLine`.
12. **러너 잡 payload**: `RunnerPiecePackage.render = { scenes, clips[{r2Key,startMs,endMs}], captions(phrases), audio{narrationKey,bgmKey}, overlay{badge}, out{w:1080,h:1920,fps:30} }` — 러너가 서버에 다시 묻지 않는다.

## C. 외부 선결조건
1. **유튜브**: OAuth 앱 `youtube.upload` + **민감 스코프 앱 심사** 착수 · 심사 전 비공개 고정(AC-4) · 일 쿼터 10,000u(videos.insert 1,600u ≈ 6편/일 → 증설 신청) · `containsSyntheticMedia` 실측.
2. **TTS**: `TYPECAST_API_KEY`(사장님 발급 이력) + 보이스 ID(«필재» `tc_68257f68bc6e3c161ab5078d` · AC 기본 2~3개).
3. provider 키: Omni/Veo = GEMINI_API_KEY · fal = `FAL_KEY`(선택).
4. **ffmpeg — Netlify 함수에 넣지 않는다**(AM 도 안 넣음 · 서버리스 구조적 불가) · 러너 PC(winget/ffmpeg-static 사다리) · `runner/install.md` 에 설치 + `FFMPEG_PATH` 안내.
5. BGM: `BGM_LICENSE_VERIFIED=1` + FreePD R2 시드(`autocreate/bgm/`) — 없으면 무음(정직).
6. 네이버 클립: AM 코드 0 · PC 업로드(tv.naver.com 스튜디오) 실측 → 실패 시 에뮬/딥링크 폴백. R5 는 **잡 kind 예약만**.
7. 릴스·쓰레드 영상: `publish-instagram.ts` REELS 컨테이너+`status_code` 폴링 · `publish-threads.ts` VIDEO — Meta/Threads 앱 키 선결.

## D. 계약에 못 박을 결정(메인 · 2026-09-14)
| # | 항목 | 결정 |
|---|---|---|
| 1 | provider 기본 티어 | **Omni 기본 + Veo Lite 폴백**(동기·편집 재생성·같은 GEMINI 키). fal 은 FAL_KEY 있을 때만 · **video_15 는 Lite/이미지 위주 티어 강제**(원가 역전 방지) |
| 2 | TTS | **타입캐스트 기본 · Gemini TTS 폴백**(어절 타임스탬프 = 자막 싱크 품질 · AM SHORTS2 실측). 폴백 시 자막 균등 분할. 키는 사장님 액션 |
| 3 | 소재 뱅크 | **AC `topics` 흡수** + `shorts_templates` 만 표 유지(B-3) |
| 4 | 포맷 어휘 | `format:"graphic"\|"talking"\|"clip"` · 길이 `15\|30\|60` · 코인 `video_15/30/60` 구간제(AM `videoCoinItem` · 초 산식 금지) · 재렌더·수리·재큐 = 코인 0(ref `piece:{id}`) |
| 5 | 상태 어휘 | `generating(stage script\|tts\|clips\|render\|judging)` → `in_review` · 러너 렌더 대기 = piece generating + slot producing · 심사 3회 미달 = `in_review`+gate_report(**새 status 없음** · AC-21) |
| 6 | 공개 상태 | 심사 전 유튜브 `privacyStatus:"private"` 고정 → post status **`uploaded_private`**(신규 어휘 1 · 화면 «비공개 업로드됨 · 공개 전환 필요» · AC-4) |
| 7 | 심사 등급 | AM SHORTS5 «게이트 3등급» **채택**(P0 정책 위반만 차단 · 저품질 컷 1회 편집 재생성 후 통과 표시) |
| 8 | 달러 캡 초기값 | 테넌트 월 **$30** · 전역 **$300**(AM $20/$100 은 광고 소재 기준 · 쇼츠 주 3편이면 첫 주에 걸림) |

## E. 파일 소유(R5)
- **B(생성 두뇌)**: `lib/video/providers/*` · `script.ts`(포맷 3) · `scenes.ts` · `tts.ts`+`tts-typecast.ts` · `captions.ts` · `judge.ts` · `cost.ts` · `gen.ts`(chainStage·lock·resume) · `netlify/functions/generate-video-background.ts` · PieceSpec 영상 확장(variant·format·seconds) · 코인 소비처 · 스위퍼 스텝 · writing-contracts shorts 4행 · `disclosure.ts` 영상 문구.
- **B2(러너·출구)**: `runner/channels/render-video.mjs` · `lib/runner-jobs.ts` kind `render.video` + `RunnerPiecePackage.render` · `lib/publish/youtube.ts`(resumable insert · containsSyntheticMedia · private · 쿼터 회로) · `instagram.ts`(REELS) · `threads.ts`(VIDEO) · `publish.naver_clip` kind 예약 · `runner/install.md` ffmpeg.
- **A**: 디렉터 손보기 «영상» 행(포맷 3·길이·보이스·계정 변주 미리보기) · 검수 영상 플레이어+SRT+배지 미리보기+8축 목록 · 발행함 «비공개 업로드됨» · 편성표 kind shorts 점 · 러너 «ffmpeg 없음» 경고 칩.
- 겹침: `lib/runner-jobs.ts`(B2 · B 는 import) · `lib/director.ts`(B · B2 무접촉) · `lib/disclosure.ts`(B · B2 는 import).

## F. 코인 원가 실측치
- 60초 = 28코인(₩14,000) 근거: SHORTSBILL #912 **$6.9**(≈₩9,600 · cuts 9/9). 구성: Omni $0.10/s×60 ≈ $6.0 + 편집 재생성 1~2컷($0.8/컷) + 대본·팩트체크 $0.05~0.1 + TTS $0.02~0.045 + 심사 비전 $0.05 ≈ **$6.3~7.5** → 마진 ≈ ₩4,000~5,000/편.
- provider 60초 원가: Omni $6.0 · **Veo Lite $3.0** · Veo Fast $6.0 · Veo 표준 $24(캡) · wan $2.4 · hailuo $3.2 · kling $4.2(기본 제외).
- 포맷별: 클립 15초 $1.6~2.4(video_15 6코인 ₩3,000 · **Lite 면 ₩1,000**) · 토킹 30초 $1.5~2.5(12코인 ₩6,000) · 그래픽 60초 $6.3~7.5(28코인).
- TTS: 타입캐스트 $0.000075/자(무료 월 1.5만자 ≈ 25편).

## G. 선반영할 함정
AC-4 · AC-16(배경 함수는 틀린 시크릿에도 202) · AC-18(러너 채널 모듈 동적 import) · AM #907(`amix=inputs=0`) · 15분 벽(SHORTSBILL) · Omni 1:1 400(9:16/16:9 만) · personGeneration 제약 · PIPA(인물 사진 i2v 국외이전 게이트) · 타입캐스트 throttle · AC-26(심사 비전 콜도 thinking 모델 본문 0).
