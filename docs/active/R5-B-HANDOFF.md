# B-1 인수인계 — 영상(R5) · 내보내기·공유 카드(R6) · 영상 축 개통(R7 §1) (B-1 → 새 세션)

> 🔴 **이 문서를 읽는 순서**: **§0(지금 상태) → §13(R7 · 가장 최근) → §8~§12** 를 먼저 읽어라.
> **§1~§7 은 2026-09-15 R5 중간 시점의 스냅숏**이다 — «어떻게 여기까지 왔나»를 남겨 둔 기록이고, 그 안의 «미착수»·«못 정한 것»은
> **전부 끝났다**(어디서 끝났는지는 각 절 머리에 적어 뒀다). 지금 할 일을 §2 에서 찾으면 안 된다.

> 계약 정본 **R5** `docs/active/2026-09-15-P1R5-contract.md`(v5.6 — §1 이 B-1 몫) · **R6** `docs/active/2026-09-15-P1R6-contract.md`(v6.0 — §2 가 B-1 몫)
> 조사 정본 `docs/active/2026-09-14-R5-presurvey-video.md`(A~G) · 규칙은 CLAUDE.md, 설계는 DESIGN.md, **키 이름은 계약서가 정본**.
> 계약 정본 **R7** `docs/active/2026-09-15-P1R7-contract.md`(§1 이 B-1 몫)
> 이력: §1~§7 = 2026-09-15 R5 중간(작성 `autocreate-b-8a` · 브랜치 그때 `feature/p1r5-back`) · §8~§12 = R5 완료 + R6 §2 완료(2026-09-15) · **§13 = R7 §1 완료(2026-09-15 · `autocreate-b-53`)**.

---

## 0. 지금 상태

| | |
|---|---|
| 워크트리 | **`../AutoCreate-B1`** — 🔴 이 폴더에서 세션을 띄워라(다른 B 가 `AutoCreate-B` 를 쓴다 · 폴더를 공유하면 커밋이 섞인다) |
| 브랜치 | **`feature/p1r7-back1`**(베이스 main · R5·R6 분은 전부 머지됨) |
| 상태 | **R5 §1 100% · R6 §2 100% · R7 §1 100%** — §1.1~§1.5 는 main 머지 완료(`64d9b51`) · §1.6(`28588ed`) 머지 대기 |
| tsc | `npx tsc --noEmit` **0건** |
| DDL | `drizzle/0008-r5-video.sql` 적용 완료 · ⚠️ **0008 이 둘**(B2 것과) — **다음 번호는 0009** · R6 에서 B-1 이 더한 DDL 은 **없다**(내보내기 상태는 `tenants.settings.export` jsonb) |
| 보고 머리말 | `■ B-1 (영상·내보내기) · 폴더 AutoCreate-B1 · 브랜치 <브랜치> · 지금: <한 줄>` — 사장님이 창만 보고 구분하신다(메인 지시) |

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

## 2. [스냅숏 · 전부 완료] 그때의 «다음 할 일»

> ✅ ①~④ **전부 끝났다**(§8 참조). 남겨 둔 이유는 «어디까지 생각해 두고 넘겼나»가 다음 설계에 쓸모가 있어서다.

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

## 4. [스냅숏 · 전부 결정됨] 그때의 미결 5건

> ✅ 1~3 = 계약 v5.4~v5.6(§8-A) · 4 엔드카드 = R6 §2.3 으로 화면까지 · 5 클립 30초 = R6 §2.3 «서버가 말한다».

1. **자동 편성(`produce` 스텝)이 영상 슬롯을 집는다** — 지금 `lib/cron/produce.ts` 는 slot.kind 를 안 보고 전부 집는다. 영상 1편 = $6 이라 «자동으로 하루 한 편»이 켜지면 달러 캡에 금방 닿는다(캡이 막긴 한다 — `step:"budget"` → 슬롯은 자리에 남고 알림). R5 범위로 둘지(그대로) · kind='post' 로 좁힐지 **메인 결정 필요**.
2. **토킹 포맷의 정지 이미지** — `CutPlan.mode:"still"` 을 만들어 뒀지만 이미지 생성 경로(`ai-image.ts` 재사용)를 아직 안 붙였다. 지금은 still 컷이 **스킵**되어 그 구간 클립이 없다(러너가 imageKey 없이 받으면 검은 화면). 둘 중 하나: ①still 도 `generateImage` 로 한 장 굽고 `piece_assets kind='image'` → payload.imageKey ②토킹 포맷을 R6 로 미룸.
3. **BGM** — `resolveBgm` 관문·FreePD R2 시드(`scripts/seed-bgm.mjs`)가 아직 없다. payload.audio.bgm 은 **항상 null**(무음) — 계약대로 «미확인이면 무음»이라 정직하지만, 시드 스크립트는 계약 §4 B 몫.
4. **엔드카드 URL** — payload.overlay.endcard 에 text 만 넣는다. «설명란 링크» 컷(§6.2 수익 슬롯)은 문구만 있고 URL 은 안 싣는다(쇼핑 태그 메타는 키 후).
5. **naver_clip 30초 상한** — `clampSecondsForChannel` 로 자르지만, 디렉터가 60초를 요청해도 조용히 30 으로 내린다. 화면에 «클립은 30초까지예요»를 A 가 보여줄지 계약에 없다.

## 5. [스냅숏] 그때의 함정 메모

> ✅ 대부분 PITFALLS 에 올라갔다(AC-26·31·35·37·38·39). 아래는 원문 그대로 둔다.

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

## 7. [스냅숏] 그때의 재개 절차 — **§12 를 대신 보라**

```
cd ../AutoCreate-B1 && git branch --show-current   # feature/p1r5-back
git log --oneline -3 && npx tsc --noEmit           # render-queue 2건만 남는 게 정상
cat docs/active/2026-09-15-P1R5-contract.md        # §1 전부 · §0.1 결정 8 · §5 경계
cat docs/active/R5-B-HANDOFF.md                    # 이 문서
```
그다음 §2 의 ①→②→③ 순서. 커밋은 자유(push 금지) · 진행률 % 한 줄은 계약 §1 기준.

---
---

# ▣ 현재 (2026-09-15 · R5 완료 + R6 §2 완료)

## 8. R5 마무리 + R6 §2 — 한 일

### 8-A. R5 잔여(§1 100%)
| 무엇 | 어디 | 한 줄 |
|---|---|---|
| 원가 관문 재작성 | `lib/video/cost.ts` | 🔴 **새 캡을 만들지 않는다** — R4 `checkAiCostCap`(플랜 일일 KRW)을 부르고 판정만 2단계: **소프트**(일일 상한 초과 = 통과 + 운영 알림 1건/일) · **하드**(일일 × 3 = 차단 + 환급) · 전역 월 ₩1.4M. 🔴 [v5.6] **하드는 «이미 쓴 것»만 본다**(예상치를 더하면 trial 이 60초 1편도 못 만든다 — 실측 ₩8,989 vs 하드 ₩9,000) |
| 토킹 still 컷 | `providers/index.ts generateStill` · `gen.ts` | 스킵하면 `clipKey`·`imageKey` 둘 다 없는 장면이 러너로 가 **검은 화면**. payload 조립 후 «둘 다 없는 장면»이 하나라도 있으면 **내보내지 않고 failPiece** |
| 토킹 컷 수 | `writing-contracts.shortsFormOf` · `scenes.buildCutPlans` | 계약 §1.3 = «B-roll 3~4 · **나머지 정지**»인데 코드는 컷 **총수**를 3~4 로 읽었다 → 60초가 컷 4개(창 15초)인데 클립 상한은 8초 → 7초가 빈다. 이제 초÷5(60→12컷) · B-roll 은 고르게 흩은 3~4 |
| `topics-reference` | `lib/video/reference.ts` · `netlify/functions/topics-reference.ts` | AM `shorts-reference.ts` 이식 — 🔴 **저작권 게이트**(`sanitizeTemplate` 화이트리스트 복사 + 길이 캡)가 이 파일의 존재 이유. 소재 영상 힌트 → `factors.structureTemplateId` → 디렉터 `meta.structure` → 대본 «서사 단계» 전 구간 배선 |
| 검수 영상 분기 | `content-approve.ts recheckVideoPiece` · `pieces.ts` | 말(대본+설명란)은 글과 **같은 `runGate` 8키** · 고지는 영상 3종 · 화면 품질은 `gate_report.judge` 를 **읽어** 싣는다(여기서 심사를 다시 돌리지 않는다) · `judgeBlockers`(P0)가 승인·발행을 막는다 |
| 고지 재검사 배선 | `content-approve` + `publish-video-background` | `checkVideoDisclosure` 호출처가 judge 1곳뿐이었다(AC-29) → **승인·발행 직전 2곳**에 배선. 걸리면 올리지 않고 `awaiting_manual` |
| 스텁 누수 | `providers/index.ts` · `tts.ts` | `generateClip`·`synthesizeGemini` 에 `VIDEO_PROVIDER_STUB` 분기가 **없어서** 스텁 스모크가 실호출로 돈을 썼다(실측 $0.4) |
| BGM | `scripts/seed-bgm.mjs` · `lib/video/bgm.ts` | FreePD → **archive.org 미러**(freepd.com 폐쇄) 12곡(무드 4 × 3) → R2 · `--check`(HEAD 만 · R2 자격 불요) · 🔴 `BGM_LICENSE_VERIFIED=1` 없으면 **무조건 무음** |
| AC-35 | `pieces.ts` regenerate | `requireAiBudget` 은 판정이 아니라 **명령**(알림 INSERT) — 영상은 부르지도 않는다 |
| AC-39 | `tts.ts narrationKey`·`scriptGen` | 나레이션·자막 키에 **대본 세대 + provider**. 🔴 R2 는 버전 관리가 없다(AC-37) — **덮어쓸 수 있는 키 0** 이 이번 조사의 결론 |

### 8-B. R6 §2
| 무엇 | 어디 | 한 줄 |
|---|---|---|
| 내보내기 ZIP | `lib/export/{zip,r2-multipart,markdown,build,state}.ts` · `netlify/functions/export{,-background}.ts` | 의존 0(`node:zlib`) ZIP 라이터 + **R2 멀티파트 8MB 스트리밍**(다 만들어 올리면 배경 함수 메모리를 넘긴다) · 용량 상한은 **쓰면서 센다**(추정 금지) · 시간 예산 11분 · 상태는 `tenants.settings.export`(새 표 0) · 🔴 **만료된 URL 은 주지 않는다** |
| 공유 카드 | `lib/share-card/render.ts` · `netlify/functions/share-card.ts` | SVG → **resvg PNG**(래스터라이저는 `toPng` 한 함수 뒤) · `loadSystemFonts:false` + 우리 OTF(리눅스엔 한글 글꼴이 없다) · 🔴 **핸들·채널 꺼짐이 기본** · 0원이면 안 만든다 |
| R5 잔여 2 | `writing-contracts.videoChannelSpec` · `accounts-list` · `pieces-get` | 채널·포맷 상한을 **서버가 말한다**(화면 상수 0) · 자동 하향 `clampedFrom` · 엔드카드 노출 |

## 9. 지금 열려 있는 것 — 다음 세션이 이어받을 것

1. **C 의 R6 검증 결과 대기**. 결함이 `lib/video/**`·`lib/export/**`·`lib/share-card/**` 로 오면 B-1 몫이다.
2. **외부 선결(코드는 다 되어 있다 · «키 꽂으면 즉시»)**
   - `TYPECAST_API_KEY` — 없으면 Gemini 폴백(어절 시각 없음 → 자막 균등 분할 · `meta.tts.provider` 에 남는다).
   - 유튜브 앱 심사 — 심사 전엔 `privacyStatus:"private"` 고정(`posts.status='uploaded_private'`).
   - 유튜브 쇼핑 제휴 승인 — 엔드카드 `url`·쇼핑 태그 메타. **문구·자리는 이미 있다**.
3. **릴스 90초**(Phase 5) — `VIDEO_CHANNEL_MAX_SEC.reels` 를 60→90 으로 올리면 **그 자리에서 열린다**(clamp·화면·심사가 전부 그 표를 읽는다).
4. **관리형 러너 팜**(Phase 4) — `publish.youtube_shorts` 잡 kind 는 **어휘만 예약**돼 있다(지금 유튜브 업로드는 서버 API).

## 10. 결정(§3 에 더하는 것 · 다시 묻지 말 것)

- **원가**: 코인(고객) ↔ 원가 캡(우리)은 **별개 관문** · 소프트는 고객에게 **보이지 않는다** · 하드는 «이미 쓴 것» 기준 · 환율 없으면 **못 재므로 막지 않는다**(`fxMissing`).
- **`require~` 가드**(AC-35): 판정이 아니라 명령일 수 있다 — 반환만 분기하지 말고 **호출 자체를 가른다**. 단 «실제로 막는 자리»(`topics*`)는 알림이 **맞는** 동작이라 그대로 둔다.
- **R2 키**(AC-37·39): **덮어쓸 수 있는 결정론 키 0**. 새 산출물을 R2 에 쓸 땐 `safeKey`(타임스탬프+난수)나 **세대 폴더**를 쓴다.
- **내보내기 상태**는 `tenants.settings.export`(소재 뽑기 관례) — 테넌트당 1건이라 새 표를 만들지 않았다.
- **ZIP 은 부분 재개가 불가능**하다(스트림 한 줄기) → R5 의 «이어달리기» 자리는 «처음부터 다시»(상한 2). «기간을 좁혀 주세요» 류는 **재시도하지 않는다**(다시 걸어도 같은 결과).
- **공유 카드 핸들 숨김**은 취향이 아니라 안전이다 — 핸들이 박힌 이미지를 올리는 건 «이 계정은 자동화»를 공개 게시하는 것과 같다(DESIGN §16·§7.3).

## 11. 함정(§5 에 더하는 것 · 내가 실제로 밟은 것만)

- **AC-38 제어문자**: 소스에 유니코드 이스케이프를 쓸 때 **파일에 실제 제어 바이트가 박히지 않았는지** 확인해라(`grep -P '[\x00-\x1f]'`). 박히면 파일이 **바이너리로 취급**되어 git diff·grep·번들러가 조용히 달라진다. 실제로 `build.ts` 가 그렇게 됐다.
- **PITFALLS #4 재발**: `timestamp without tz` 는 문자열로 온다 — `new Date(문자열)` 은 **로컬 시각**으로 읽는다. 정본은 `lib/db-util.ts utcDate` 하나. SQL 쪽 KST 필터가 맞으면 «파일은 다 들어왔는데 **폴더 이름만** 틀린» 모양이 되어 더 안 보인다.
- **`volumedetect` 출력은 stderr**다 — stdout 만 받으면 늘 «측정 실패»로 읽힌다.
- **숫자만 보지 말고 그림을 열어 봐라**: 공유 카드는 단언 전건 통과 상태에서 «가운데가 텅 빈 카드»·«알약 밖으로 나간 한글 칩» 두 건이 남아 있었다. PNG 를 실제로 보고서야 잡혔다.
- **한글 글자 폭 ≠ 라틴**: 32px 에서 한글 ≈ 32px · 영문/숫자 ≈ 17px. 한 계수로 재면 상자 밖으로 나간다.

## 12. 재개 절차(새 세션 첫 5분) — §7 대신 이것

```
cd ../AutoCreate-B1 && git branch --show-current && git status --porcelain   # 🔴 폴더 확인(다른 B 가 AutoCreate-B 를 쓴다)
git merge main && npx tsc --noEmit                                          # 0건이 정상
cat docs/active/R5-B-HANDOFF.md                                             # 이 문서 §0 → §8~§12
cat docs/active/2026-09-15-P1R6-contract.md                                 # §2 가 B-1 몫 · §5 담당
sed -n '1,80p' docs/rules/PITFALLS.md                                       # AC-1~AC-39
```
스모크(전부 `scripts/_smoke/` · **커밋 금지** · 테넌트를 스스로 만들고 지운다):
```
npx tsx scripts/_smoke/r5-b1-caps.mts      # (없으면) r6-b1-caps — 채널·포맷 상한·clampedFrom
npx tsx scripts/_smoke/r6-b1-zip.mts       # ZIP 을 OS 압축 해제기로 연다
npx tsx scripts/_smoke/r6-b1-card.mts      # 카드 PNG 4종(그림을 눈으로 볼 것)
npx tsx scripts/_smoke/r6-b1-ttskey.mts    # AC-39 세대 키
npx --yes tsx --env-file=.env scripts/_smoke/r6-b1-export.mts        # 내보내기 라이브(교차 누수 0)
npx --yes tsx --env-file=.env scripts/_smoke/r5-b1-gates.mts         # 원가 관문 실판정
VIDEO_PROVIDER_STUB=1 npx --yes tsx --env-file=.env scripts/_smoke/r5-b1-bgm-mix.mts   # 렌더+BGM 믹스
```
> 🔴 스모크는 **미커밋**이라 워크트리에만 있다. 새 PC 로 옮기거나 지웠다면 이 문서의 목적(무엇을 재는가)만 보고 다시 짜라 —
> 재는 것은 ①교차 누수 0 ②스텁에서 실호출 0(`ai_usage.model='stub'`) ③덮어쓸 수 있는 키 0 ④그림을 눈으로 확인.

---

## 13. R7 §1 — 영상 축 «개통»(2026-09-15 · 세션 `autocreate-b-53`)

> R5·R6 이 «영상을 만들 수 있게» 했다면 R7 §1 은 **고객 화면에서 실제로 쓸 수 있게** 한 라운드다.
> 2026-09-15 설계감사(`docs/active/audit/2026-09-15-B1.md`)의 결론 «영상 축은 **미개통**(없는 게 아니라 문이 없다)» 을 푸는 절.

### 13.1 한 일(커밋 순서)

| 절 | 커밋 | 한 줄 |
|---|---|---|
| §1.1 | `bae443f` | `GET /api/tenant-settings`(`kinds`·`kindsSet`) + `normalizeKinds`(«글»은 항상 · 영상만 토글) · 소재 재사용 30→90일 |
| §1.2 | `5bd1e0c` | 계정 없이 영상 만들기 — `propose(..., { origin:"manual" })` 일 때만(자동은 fail-closed 유지) |
| §1.3 | `34c5ea7` | `GET /api/piece-video` · `POST /api/post-mark-published` · `lib/channel-url.ts`(신규) |
| §1.4 | `64f323e` | 홈 «해야 할 일» 7줄 |
| §1.5 | `3e19390` | 프레임 지문 실동작 · `JudgeAxis.pending` |
| §1.6 | `28588ed` | 수동 «만들기»가 그날 자동 자리를 쓴다 |

### 13.2 새로 생긴 파일·키(다음 세션이 알아야 할 것)

| 자리 | 무엇 |
|---|---|
| `netlify/functions/piece-video.ts` | `/api/piece-video`(mp4 내려받기) · `/api/post-mark-published`(직접 올린 주소 적기) — **한 이야기라 한 파일** |
| `lib/channel-url.ts` | 채널↔도메인 대조 + **`channelRef` 되뽑기**. 순수(임포트 0) |
| `lib/video/types.ts` | `videoFilename`/`videoSlug`/`kstDateCompact` · `RenderReport.thumbGray?`·`framePhash?` · `JudgeAxis.pending?` |
| 응답 키(A 와 약속) | `piece-video`: `{ ok, pieceId, channel, status, url, filename, expiresInSec, bytes, durationSec, stage? }`<br>`post-mark-published`: `{ ok, postId, pieceId, channel, already, url, channelRef?, slotId?, message }`<br>`director-confirm`: `usedTodaySlot?: { slotId, channel, publishAt, prevStatus }`<br>`home-summary.todo[]`: `count?`·`pieceId?` + kind `awaiting_manual`·`pending_login`·`runner`·`coin_short`·`slot_gate`·`forcedByPlan` |
| 감사 action | `post_marked_manual` · `manual_used_auto_slot` |
| `posts.published_via` | **`manual`** 이 실제로 쓰이기 시작했다(DDL 0001 부터 있던 3번째 값) |

### 13.3 결정(다시 묻지 말 것)

1. **mp4 파일이름은 ASCII 만**. `r2PresignGet` 이 싣는 건 `filename="…"` 한 벌이라 한글은 브라우저마다 깨진다(프리사인은 교차 출처라 `<a download>` 도 무시된다).
   제목의 한글은 떨어지고 남는 글자가 없으면 KST 날짜(`AC-329-20260915.mp4`). **RFC 5987 `filename*` 은 `lib/r2.ts`(B2) 몫으로 넘겼다** — 붙으면 `videoFilename` 한 함수만 고치면 된다.
2. **`post-mark-published` 는 `requireWritable` 을 안 부른다** — 이미 밖에 나간 일을 «기록»하는 경로다(돈 드는 경로가 아니고, 막으면 이미 올라간 글의 수익을 영영 못 붙인다).
3. **300자 넘는 주소는 자르지 않고 거부**한다(`finalizePublish` 가 300자로 자르는데 잘린 주소는 안 열리는 링크가 된다).
4. **자격 평문 표면을 늘리지 않는다** — 워드프레스 `siteUrl` 대조 대신 «제 도메인 채널은 모르는 도메인 통과 · 단 **다른 채널 도메인이면 거부**».
5. **`published_via='manual'` 은 DB 에 정본대로 쓰고 타입만 호출 한 줄에서 맞췄다** — `PublishVia` 는 커넥터 반환(`PublishOk.via`)과 겸용이라 넓히면 `publisher.ts:138` 분기 뜻이 흐려진다. `FinalizeInput.via` 분리는 **B2 몫**.
6. **지문 없음 = 보류**(AC-33). 단 «견줄 상대가 아예 없으면» 그건 보류가 아니라 **진짜 통과**다(겁주지 않는다).
7. **P1R5 §182 «유사하면 1회 자동 재생성»은 R7 에서 안 켰다** — 사유 원가 · **R8 후보**(메인 결정). 지금은 사람 검수로 간다(조용한 통과 아님).

### 13.4 함정(내가 실제로 밟은 것만 · §5·§11 에 더한다)

- 🔴 **유튜브 수익은 `posts.external_url` 이 아니라 `posts.channel_ref`(영상 id)로 붙는다**(`lib/revenue/youtube.ts:35`).
  주소만 적어 두면 손으로 올린 쇼츠는 영영 수익이 안 붙는다 — 커넥터와 **같은 모양**으로 주소에서 되뽑아야 한다.
- 🔴 **지문은 두 군데에서 죽는다**: ①`lib/runner-jobs.ts` 러너 보고 경계(필드를 **골라 담는** 자리 — C 가 ffprobe 실측을 여기서 흘린 전례) ②`finalizeRender` 의 `piece_assets.meta`.
  러너만 고치면 «보내는데 아무 일도 안 일어나는» 상태가 된다.
- 🔴 **`account_id IS DISTINCT FROM NULL` 은 NULL 끼리를 «같다»로 본다** — 계정 없이 만든 영상(§1.2)이 통째로 유사도 검사 밖이었다.
- 🔴 **러너 «꺼짐»을 `runner_devices.status` 로 판정하면 안 된다** — 프로세스가 죽어도 그 칸은 `online` 인 채로 굳는다. 하트비트(5분)로 잰다.
- 🔴 **경과 시간은 내림이 아니라 반올림** — 40분 전을 «39분째», 3시간 전을 «2시간째»로 말하면 사장님 시계와 어긋난다.
- 🔴 **파이썬으로 파일을 고칠 때 CRLF 가 LF 로 떨어진다**(universal newlines). 6줄 바뀐 커밋이 466줄 diff 가 됐다 —
  `lib/video/types.ts`·`render-queue.ts`·`home-summary.ts` 는 **CRLF** 다. 편집 전후로 `count(b"
")` 를 대조해라.
- 🔴 **커밋을 버리면(reset --soft 재작성) 메인에 먼저 알려라** — 메인이 이미 머지했을 수 있다(실제로 한 번 충돌시켰다).

### 13.5 스모크(전부 미커밋 · #16 — 무엇을 재는가만 남긴다)

```
npx tsx scripts/_smoke/r7-b1-noaccount.mts     # §1.1·§1.2 kinds 정규화 · 계정 0 에서 수동만 영상
npx tsx scripts/_smoke/r7-b1-mp4-out.mts       # §1.3 서명 URL 을 **실제로 눌러** Content-Disposition·바이트 대조 · 멱등 2회
npx tsx scripts/_smoke/r7-b1-home-todo.mts     # §1.4 7줄 · 러너 5경우 · 레지스트리 실값 대조
npx tsx scripts/_smoke/r7-b1-fingerprint.mts   # §1.5 **음성 대조**(같은 그림이 실제로 떨어지는가)
npx tsx scripts/_smoke/r7-b1-todayslot.mts     # §1.6 자리 수 불변 · 코인 1편 값 · 크론 경로 무변경
```
> 재는 것: ①**음성 대조**(결함을 일부러 만들면 떨어지는가 · AC-33) ②숫자만 보지 말고 **파일·그림을 열어 볼 것** ③0건이면 행이 없는가 ④스텁에서 실호출 0.

### 13.6 남은 것(B-1 몫이 아닌 것 포함)

| 무엇 | 누구 | 상태 |
|---|---|---|
| 러너가 `thumbGray`(32×32 그레이 raw base64) 또는 `framePhash` 를 보고에 싣기 | B2 | 메인이 전달함 · **오면 즉시 가동**(서버는 다 됐다) |
| `r2PresignGet` 에 RFC 5987 `filename*` | B2 | 메인이 전달함 |
| `FinalizeInput.via` 를 커넥터 타입에서 분리 | B2 | 메인이 전달함 |
| `gate_report.axes[].pending` 을 검수 화면이 ✅ 로 안 그리게 | A | 메인이 전달함 |
| P1R5 §182 유사 시 1회 자동 재생성 | B-1 | **R8 후보**(원가 · 메인 결정) |
