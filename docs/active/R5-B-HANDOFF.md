# R5-B 인수인계 — «소재 하나가 계정별 쇼츠가 된다» 생성 두뇌 (B-1 → 새 세션)

> 작성 2026-09-15 · 작성자 = B-1(`autocreate-b-8a`) · 워크트리 **`../AutoCreate-B1`** · 브랜치 **`feature/p1r5-back`**
> 계약 정본 `docs/active/2026-09-15-P1R5-contract.md`(v5.1~v5.3) · 조사 정본 `docs/active/2026-09-14-R5-presurvey-video.md`(A~G · §D 결정 8)
> 이 문서는 «어디까지 했고 다음이 무엇인지»다. 규칙은 CLAUDE.md, 설계는 DESIGN.md, 키 이름은 계약서가 정본.

---

## 0. 지금 상태

| | |
|---|---|
| 브랜치 | `feature/p1r5-back`(베이스 main `0f3ec44` = R4 배포본 · rebase 완료) |
| HEAD | **`17f86c5`** + 이 문서 커밋(아래 §7) |
| tsc | `npx tsc --noEmit` → **`lib/video/render-queue.ts` 2건만**(자리 표시 — B2 본체 머지하면 사라진다). 그 밖 0 |
| DDL | `drizzle/0008-r5-video.sql` **Neon 적용 완료(5/5)** — shorts_templates · feature_flags · posts.status |
| 진행률 | 계약 §1 기준 **약 75%**(생성 두뇌·배선 완료 · 남은 것 = §5 아래) |

---

## 1. 한 일 — 파일별 한 줄

### 이식(AM 원본 · 헤더에 «AM 원본 경로 · 복사일 · 원본 해시» 표기 완료)
| 파일 | 한 일 |
|---|---|
| `lib/video/types.ts` | 🔴 **어휘·페이로드 정본**(B2·A 가 같은 파일을 본다) — VideoFormat/Seconds/Channel/ProviderKey/ClipTier/VideoStage/JudgeGrade · VideoSpec · ScriptLine/VideoScript · CutPlan · **RenderPayload·RenderReport**(계약 §2.1 글자 그대로) · JudgeResult · chainStage/lock/resume 상수 · **손잡이 2개**(`CHAIN_BUDGET_MS` env · `videoStub()`) |
| `lib/video/providers/registry.ts` | provider 표 7종 + 하드 금지(Sora·Hunyuan·LTX) `assertProviderAllowed` + `pickProvider`(AC 규칙: Omni 기본·**15초 = veo_lite 강제**·fal 은 FAL_KEY 있을 때만) + `fallbackProvider` 사다리 + 원가 추정 |
| `lib/video/providers/omni.ts` | Interactions API 동기 생성 + **편집 재생성**(previous_interaction_id · task 를 같이 보내면 400 — AM 실측 보존) + policyBlocked 판정 |
| `lib/video/providers/veo.ts` | predictLongRunning 제출·폴링 + **4·6·8 스냅**·1:1 금지·personGeneration 미전송(AM 실사고 보존) + `veoGenerate`(예산 안 폴링) |
| `lib/video/providers/fal.ts` | queue REST(submit/poll) + `falGenerate` · FAL_KEY 없으면 정직 실패 |
| `lib/video/providers/index.ts` | **컷 1개 생성의 단일 입구** — provider 호출 → mp4 회수 → R2(`autocreate/{tid}/{pieceId}/clips/…`) → `ai_usage(purpose 'video_clip')` · 폴백 1단(정책 차단은 폴백 안 함) |
| `lib/video/tts.ts` | 읽기 전처리(단위·금액·영문 사전·테넌트 사전) · 발화 예산(초당 4.6음절) · WAV 소도구 · **Gemini TTS 폴백**(어절 시각 없음) |
| `lib/video/tts-typecast.ts` | **기본 TTS** — with-timestamps(어절·음절) · audio_tempo 1.1 · 선두(타임스탬프)·꼬리(진폭) 무음 트림 + 안전벨트 2겹 · 1자=1크레딧 과금 → `ai_usage(purpose 'tts')` |
| `lib/video/captions.ts` | 어절 시각 → **구절 자막 동적계획 분할**(2~4어절·≤12음절·≥700ms·끊는 자리 비용표) · SRT · `phrasesToRender` |
| `lib/video/scenes.ts` | 문장→컷 창(같은 cutIdx 연속=한 창·1.8초 흡수·8초 상한) · **컷 프롬프트 계약**(SUBJECT/STYLE/COLOR/CAMERA BEAT·무텍스트·«»금지·하드컷 요구형·인물 캐스팅 고정) · `checkCutConflicts` · 키워드 추출 · **PALETTES·HOOK_TYPES**(변주 재료) |
| `lib/video/script.ts` | 대본 1콜(포맷 3 규칙·분량·컷 배정) · **3초 훅 게이트** · 수익 약속·금칙어·상투 게이트 · 🔴 **googleSearch 팩트체크 왕복 + 정정 1회**(남으면 실패) · 유튜브 메타 |
| `lib/video/judge.ts` | **11축 3등급**(P0 차단만 · P1/P2 기록 통과) · 결정론(훅·세이프존·읽기시간(수리)·리듬(수리)·금칙·고지·길이·바이트) + 비전 4축(깨진 글자·검은 여백·빈 프레임·UI 겹침) + 프레임 지문 · AC-26(parts 전부 이어붙임) · 비전 불능은 미달 아님 |
| `lib/video/cost.ts` | 달러 캡 **테넌트 $30 / 전역 $300**(`ai_usage` video_clip·tts·video_judge 합 · KST 월) · kill switch `feature_flags(key='video')` · **fail-closed** · `estimateVideoCostUsd` |
| `lib/video/fingerprint.ts` | pHash 64bit(32×32 그레이 DCT) · 해밍 ≤10 = 유사 · 계정 간 변주 게이트 재료 |
| `lib/video/gen.ts` | 🔴 **오케스트레이터** — 6단계 · `chainStage` 하트비트(컷·문장마다) · `chainLock`(20분·중복 체인 0) · `chainResume`(11분 예산·상한 3) · 문장 TTS·컷 클립 **즉시 저장 → 이어받기 재생성 0** · 제휴 딥링크 · RenderPayload 조립 → `enqueueRender` · `triggerVideo` · `precheckVideoBudget` |
| `lib/video/render-queue.ts` | **자리 표시**(B2 본체가 정본 — 머지 때 B2 것을 택한다) |

### 기존 파일 수정(전부 헤더·주석에 «P1R5» 표기)
| 파일 | 한 일 |
|---|---|
| `lib/ai.ts` | **googleSearch 옵션 복원**(tools google_search · jsonMode 병용 금지 → 텍스트 후 파싱 · `sources` 반환) |
| `lib/ai-models.ts` | 영상 모델 단일 출처 — MODEL_OMNI · MODEL_VEO/FAST/LITE · FAL_MODEL_* · VIDEO_MODELS |
| `lib/coin-table.ts` | `videoCoinItem(seconds)` 구간제(≤5 clip · ≤15 · ≤35 → 30 · 그 이상 60) |
| `lib/disclosure.ts` | 영상 3종 — `videoBadgeText`·`videoDescriptionFirstLine`·`videoOpeningCaption` + `checkVideoDisclosure`(배지·3초 자막·설명란 첫 줄 셋 다) |
| `lib/writing-contracts.ts` | **`shortsFormOf(format, seconds)`**(컷 수·컷 길이·provider·발화 예산·자막 프리셋·채널 상한) + `clampSecondsForChannel` + shorts 계약 4행 보강(클립·릴스 톤·§16B 규칙) |
| `lib/director.ts` | **영상 분기** — PieceSpec `kind`/`video` · `buildVideoSpec`·`variantFor`(훅×팔레트×보이스 결정론) · 영상 채널 포함(settings.kinds video) · goalOf ypp/clip_incentive · 손보기 패치(포맷·길이·보이스·팔레트·훅·컷) · **달러 캡 선검사(코인 전)** · 코인 1회(이미지 0) · slot kind shorts · `triggerVideo` |
| `lib/slots.ts` | `RuleKind = "post"|"shorts"` · `rollSlots` 가 kind 를 슬롯에 그대로 · coinsPerWeek 영상 단가 |
| `lib/cron/publisher.ts` | **영상 분기**(«R5 B-1 수정» 표기) — kind video 면 `publish-video-background` 202 호출 후 publishing 표시 · 호출 실패는 awaiting_manual+알림 |
| `lib/cron/video-sweep.ts` | 스텝 `video.sweep`(5m · 20분 stale · 잠금·render 잡 살아 있으면 skip · 상한 3 → failed+환급+알림 · 회차 5건) + `lib/cron/runner.ts` STEPS 등록 |
| `netlify/functions/rules.ts` | kind 허용(영상 채널이면 shorts 자동 · 글 채널에 shorts 금지) |
| `netlify/functions/generate-video-background.ts` | 생성 배경 함수(202·15분·INTERNAL_SECRET 폴백 0·멱등·잠금) |
| `netlify/functions/publish-video-background.ts` | 업로드 배경 함수(v5.3 §2.3b · `publishPieceById` 얇은 껍데기 · retriable 이면 scheduled 로 되돌림) |
| `db/schema.ts` | R5 append — shortsTemplates · featureFlags · postsR5.status · **runnerDevicesR5.caps**(B2 DDL 의 선언) |
| `drizzle/0008-r5-video.sql` | 추가형 DDL(적용 완료) |

---

## 2. 다음 할 일 — 순서와 «어디까지 생각해 뒀는지»

### ① `topics-reference`(계약 §1.11) — 미착수
- 경로 `POST /api/topics-reference { url }` → Gemini 가 URL 을 훅·서사·스타일로 분해 → `shorts_templates` 1행 → `{ ok:true, template:{ id, name, structure, hook, style } }`.
- 표는 이미 있다(0008 적용). `topics.factors.structureTemplateId` 를 후보 생성에 넘기는 자리는 `lib/topics.ts` 의 후보 프롬프트 — 영상 채널 힌트 허용도 아직 안 넣었다(계약 §1.11 두 줄).
- 코인 0 · 하루 3회(감사 기반 — `topics-refresh` 의 rate limit 와 같은 패턴 재사용).
- AM 참고: `../AutoMarketing/lib/shorts-reference.ts`(구조 템플릿 스키마·URL 직독 프롬프트).

### ② `pieces.ts` 검수 영상 분기 — 미착수(중요)
- `pieces-get`: 지금은 `piece_assets kind='image'` 만 읽는다 → **video/thumb/srt/clip** 도 실어야 A 가 플레이어·SRT 를 그린다. `coverUrl` 서브쿼리도 image 고정이라 영상은 포스터가 안 뜬다.
- `pieces-regenerate`: `triggerGenerate`(글) 고정 → **kind video 면 `triggerVideo`**. 재차감 ref 도 `piece:{id}:regen{n}` 인데 영상은 이미지 코인이 없으니 `videoCoinItem` 1건만.
- `pieces-approve`: `lib/content-approve.ts recheckPiece` 가 글 게이트(blocks/bodyHtml)를 본다 → **영상이면 `judgeVideo` 의 gate_report 를 쓰고 `checkVideoDisclosure` 로 재검사**해야 한다(계약 §1.8 «approve 직전 재검사»).
- 생각해 둔 모양: `content-approve.ts` 에 `if (String(p.kind) === "video")` 분기 하나 — 하드 실패 키는 P0 축(forbidden·disclosure·duration_fit·frames_not_blank).

### ③ 스모크(계약 §6)
- 순서: `VIDEO_PROVIDER_STUB=1` 로 전 경로(가입→계정→소재→디렉터 영상 제안→확정→배경 생성→render 잡→(B2 미머지면 여기서 멈춤)) → 그다음 **Omni 실호출 1컷만**(원가 · 트리거 지시).
- 로컬 실행은 R1 때와 같다: `netlify dev` 포트 충돌 회피(8901/functions 3901 · `[dev]` 블록은 커밋하지 말 것 · AC-7 `.html` 폴백 주의).
- 하니스는 C 가 짠 절 12개가 있다(메인에 문의). 스모크 스크립트는 `scripts/_smoke/`(커밋 금지 · PITFALLS #16).

### ④ B2 머지 후 할 일
- `lib/video/render-queue.ts` 자리 표시 **삭제**(B2 `feature/p1r5-back2` 본체 채택) → `gen.ts` 의 import 는 그대로 살아난다.
- `RunnerJobKind` 에 `render.video` 가 들어오면 `render-queue.ts` 의 캐스트 제거.
- `publishYoutubeShorts(piece, account) → PublishResult` 가 `lib/publish/index.ts` 디스패치에 배선됐는지 확인(내 배경 함수는 `publishPieceById` 만 부른다 — 채널 배선은 B2 몫).

---

## 3. 결정해 둔 것(다시 묻지 말 것)

- **코인**: 영상 = `videoCoinItem(seconds)` **1회**(이미지 코인 0) · ref `piece:{id}` · 재렌더·수리·재큐·이어달리기 = 0.
- **달러 캡은 코인과 별개 관문** · 선검사는 **코인 차감 전** · 실패 step `"budget"`(원장 무접촉).
- **stage 어휘**는 `meta.stage`(piece status 어휘 추가 0 · AC-21).
- **변주**: 같은 brief 의 i 번째 영상 = 훅 `HOOK_TYPES[i%5]` · 팔레트 `PALETTES[(accountId+i)%5]` · 보이스 rotate — 결정론(재제안 시 같은 값).
- **포맷 로테이션**: 그 계정 직전 영상 포맷과 다른 것(글의 pickFormat 과 같은 결).
- **TTS**: 타입캐스트 기본 · 실패·키 없음 → Gemini 폴백(자막은 균등 분할) · 폴백 사실은 `piece_assets.meta.provider` 에 남는다.
- **provider**: 15초 = veo_lite 강제 · 그 외 Omni · 폴백 1단(정책 차단은 폴백 금지).
- **slot kind**: 영상 규칙·슬롯은 `shorts`(글 크론이 집어가지 않게) · 플랜 `maxRules` 는 kind 무관 **규칙 개수 합산**.
- **게이트 우회 0**: 영상도 `guardSlot`·`requireWritable`·`requireAiBudget` 를 글과 같은 경로로 탄다.

## 4. 아직 못 정한 것(새 세션이 정하거나 메인에 물을 것)

1. **자동 편성(`produce` 스텝)이 영상 슬롯을 집는다** — 지금 `lib/cron/produce.ts` 는 slot.kind 를 안 보고 전부 집는다. 영상 1편 = $6 이라 «자동으로 하루 한 편»이 켜지면 달러 캡에 금방 닿는다(캡이 막긴 한다 — `step:"budget"` → 슬롯은 자리에 남고 알림). R5 범위로 둘지(그대로) · kind='post' 로 좁힐지 **메인 결정 필요**.
2. **토킹 포맷의 정지 이미지** — `CutPlan.mode:"still"` 을 만들어 뒀지만 이미지 생성 경로(`ai-image.ts` 재사용)를 아직 안 붙였다. 지금은 still 컷이 **스킵**되어 그 구간 클립이 없다(러너가 imageKey 없이 받으면 검은 화면). 둘 중 하나: ①still 도 `generateImage` 로 한 장 굽고 `piece_assets kind='image'` → payload.imageKey ②토킹 포맷을 R6 로 미룸.
3. **BGM** — `resolveBgm` 관문·FreePD R2 시드(`scripts/seed-bgm.mjs`)가 아직 없다. payload.audio.bgm 은 **항상 null**(무음) — 계약대로 «미확인이면 무음»이라 정직하지만, 시드 스크립트는 계약 §4 B 몫.
4. **엔드카드 URL** — payload.overlay.endcard 에 text 만 넣는다. «설명란 링크» 컷(§6.2 수익 슬롯)은 문구만 있고 URL 은 안 싣는다(쇼핑 태그 메타는 키 후).
5. **naver_clip 30초 상한** — `clampSecondsForChannel` 로 자르지만, 디렉터가 60초를 요청해도 조용히 30 으로 내린다. 화면에 «클립은 30초까지예요»를 A 가 보여줄지 계약에 없다.

## 5. 함정 메모(PITFALLS 에 아직 안 올림 — 새 세션이 밟으면 그때 AC-N 으로)

- **Omni 편집 왕복에 `video task` 를 같이 보내면 400** — AM 이 이걸 몰라 «1회 대안 재생성»이 실물에서 한 번도 성공한 적이 없었다(원장엔 retried 만 남아 고친 것처럼 보였다). `omni.ts` 에 주석으로 박아 뒀다.
- **Veo `durationSeconds` 는 4·6·8 만** — 5를 보내면 400인데 에러 문구가 «between 4 and 8»이라 거짓말처럼 읽힌다.
- **꼬리 무음은 타임스탬프가 거짓말한다** — 마지막 글자 endMs 가 클립 길이로 잘려 보고된다. 꼬리는 **진폭으로** 재야 한다(선두는 타임스탬프).
- **`amix=inputs=0`** — 오디오 라벨이 0개면 ffmpeg 가 죽는다(러너 쪽 · B2 에 전달됨).
- **AC-26 확장**: 심사 비전 콜도 thinking 모델이라 `parts[0].text` 만 읽으면 «본문 0»으로 오판한다 — `judge.ts` 는 parts 전부를 이어붙인다.
- **jsonb 오버레이 shape 가드(AC-6)** 는 `contractFor` 에 이미 있다 — shorts 계약을 `emotion_profiles` 로 덮을 때 배열/객체 모양을 반드시 맞출 것.

## 6. 경계(B2·A 와의 약속)

- `lib/video/types.ts` · `lib/video/judge.ts` = **B-1 정본**(B2 가 여기에 맞춘다).
- `lib/video/render-queue.ts` = **B2 본체**(내 자리 표시는 머지 때 버린다). 시그니처 `enqueueRender(pieceId, RenderPayload)` / `finalizeRender(pieceId, RenderReport)` / `judgeVideo(pieceId)` — 계약 §5 글자 그대로.
- `lib/runner-jobs.ts` = B2 소유(나는 import 만) · `lib/director.ts`·`lib/disclosure.ts` = B 소유(B2 는 import).
- 유튜브 커넥터 이름 = `publishYoutubeShorts(piece, account) → PublishResult`(메인 확정).
- A 어휘: `VideoStage`(meta.stage) · `posts.status += uploaded_private` · PieceSpec.video · 훅 5종 · 팔레트 5종.

## 7. 재개 절차(새 세션 첫 5분)

```
cd ../AutoCreate-B1 && git branch --show-current   # feature/p1r5-back
git log --oneline -3 && npx tsc --noEmit           # render-queue 2건만 남는 게 정상
cat docs/active/2026-09-15-P1R5-contract.md        # §1 전부 · §0.1 결정 8 · §5 경계
cat docs/active/R5-B-HANDOFF.md                    # 이 문서
```
그다음 §2 의 ①→②→③ 순서. 커밋은 자유(push 금지) · 진행률 % 한 줄은 계약 §1 기준.
