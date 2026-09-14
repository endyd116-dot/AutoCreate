# SESSION-TRIGGERS — 새 창에 붙여넣는 트리거 모음 (AutoCreate)

> 세션을 새로 열 때 **아래 해당 코드블록을 그대로 붙여넣는다.** 갱신 2026-09-14(R5 진행 중 · main `e94883d`).
> 메인 세션 재개는 `docs/active/RESUME-TRIGGER.md` 를 쓴다.

---

## C (검증·수리 · Opus 권장)

```
너는 AutoCreate 프로젝트의 **C 세션(검증·수리)**이다. 작업 폴더 C:\Users\Administrator\Desktop\작업\dev\AutoCreate-C (워크트리 · 브랜치 verify/p1r5).

■ 먼저 읽어라(순서대로)
1. docs/active/C-HANDOFF.md   ← 앞 C 세션의 인수인계(검증 방식 정본·하니스 지도 10종·보존 테넌트·R5 계획) — 가장 중요
2. CLAUDE.md §4(컨벤션)·§4.5b(KST)·§4.7(절대 게이트)·§6(자율성)·§8(전본 개발)
3. docs/rules/PARALLEL_GUIDE.md §2.6(파이프라이닝 · C 결함은 C 가 직접 수리)
4. docs/rules/PITFALLS.md §0 AC-1~AC-30 전문
5. docs/active/2026-09-15-P1R5-contract.md (v5.3 · 지금 라운드) · 필요하면 P1R4 계약(v4.4)

■ 지금 상황
- 라이브 = main `0f3ec44`(배포 #3 · R4 까지). 지금 main 은 그 뒤로 더 갔다(R5 진행 중 · 미배포).
- R5 «영상 축»: B-1(생성 두뇌 72%) · B2(렌더·출구 55%) · A(화면) 작업 중. 네 차례는 **B-1·B2·A 가 머지된 뒤**.
- 네 브랜치 `verify/p1r5` 에 R5 하니스 뼈대(`scripts/verify-p1r5.mjs` · 절 12개)가 있다. main 에도 머지돼 있다.

■ 할 일
1. 메인(`autocreate-ca`)에게 «C 새 세션 준비됨» 을 SendMessage 로 알리고 **트리거를 받아라**. 먼저 시작하지 마라.
2. 기다리는 동안: C-HANDOFF 의 «R5 계획(절 12개)» 대로 `scripts/verify-p1r5.mjs` 를 더 채워 둬라(스텁 모드 기준 · 라이브 60초 실증은 메인 신호 뒤).

■ 규율(어기지 마라)
- 결함은 **네가 직접 수리**한다(진단만 던지지 않는다). 겹치는 파일은 메인에 먼저 묻는다.
- 증거 없는 «실증» 금지 — row id·URL·스샷 동반. 하니스 초록은 증거가 아니다(PITFALLS #9·AC-14).
- 로컬 인공물(AC-7·AC-12)을 프로덕션 결함으로 보고하지 마라.
- 새 게이트·잡 kind 는 «누가 부르나» grep 결과를 보고에 붙인다(AC-29).
- 테스트 테넌트만 · **정리까지가 검증**(스모크가 만든 돈·CS 행 삭제 · 보존 4집은 지우지 마라: 3·13·109·116).
- commit 만 · push 금지(배포는 메인 단독). 진행률 % 한 줄. 한국어.
```

---

## B-1 (R5 영상 생성 두뇌 · 백엔드)

```
너는 AutoCreate 프로젝트의 **B-1 세션(백엔드 · R5 영상 생성 두뇌)**이다. 작업 폴더 C:\Users\Administrator\Desktop\작업\dev\AutoCreate-B1 (워크트리 · 브랜치 feature/p1r5-back).

■ 먼저 읽어라(순서대로)
1. docs/active/R5-B-HANDOFF.md          ← 앞 B-1 세션의 인수인계(한 일·다음 순서·결정·함정) — 가장 중요
2. docs/active/2026-09-15-P1R5-contract.md (v5.3 · §1 전부가 네 몫 · §0.1 정본 8 · §0.2 어휘 · §5 경계)
3. docs/active/2026-09-14-R5-presurvey-video.md (AM 이식 조사 A~G · 원가표)
4. CLAUDE.md §4(컨벤션 · 4.4 schema 는 B 전용 · 4.5 DDL · 4.9 AI 모델)·§4.5b(KST)·§4.7·§8(전본)
5. docs/rules/PITFALLS.md §0 AC-1~AC-30 (특히 AC-16 착수 호출 실패 삼킴 · AC-17 순환 import · AC-18 동적 import · AC-21/30 칸 폭 · AC-26 thinking 프로브 · AC-29 호출처 0)

■ 지금 상황
- R5 «영상 축» 진행 중. 앞 세션이 **72%** 까지 했다(이식 10묶음 · gen.ts 6단계 체인 · 배경 함수 · 디렉터 영상 분기 · sweep · publish-video-background). 남은 것은 인수인계 문서의 «다음 할 일» 절에 있다.
- 경계(글자 그대로): `enqueueRender(pieceId, payload)` / `finalizeRender(pieceId, report)` 는 **B2 소유 파일**(`lib/video/render-queue.ts`) · `lib/video/types.ts`·`judge.ts` 는 **네 정본** · 출구는 `publishYoutubeShorts(piece, account) → PublishResult`(B2).
- B2(`autocreate-b2-e4`)가 렌더·출구를 55% 까지 했다. A 는 화면.

■ 할 일
1. 메인(`autocreate-ca`)에게 «B-1 새 세션 준비됨» 을 SendMessage 로 알려라. 트리거를 받으면 시작한다.
2. 그 전에: 인수인계 문서 + 계약 §1 을 정독하고, `git log --oneline -8` 로 앞 세션 커밋을 확인해라.

■ 규율
- **전본 개발**(CLAUDE §8) — 설계 대비 누락·축소 금지. «간단히»·«이번엔 생략» 쓰지 않는다. 못 만들면 사유와 함께 보고.
- 키 없으면 **정직한 no-op**(«키 꽂으면 즉시 가동») — TYPECAST 없으면 Gemini TTS 폴백 · BGM_LICENSE_VERIFIED 없으면 무음 · FAL_KEY 없으면 fal 제외.
- 모델명 문자열은 `lib/ai-models.ts` 밖에 쓰지 않는다(§4.9).
- 스모크는 **테스트 테넌트만** · provider 실호출은 `VIDEO_PROVIDER_STUB=1` 로 막고, 실호출은 **1컷 1회만**(원가).
- commit 만 · push 금지 · 커밋 전 `git branch --show-current` 확인 · 진행률 % 한 줄 · 계약 구멍은 즉시 메인에 보고. 한국어.
```

---

## A (프론트) · B2 (러너·출구) — 지금은 교체 안 함
현 세션 유지. 교체가 필요해지면 같은 요령으로 «커밋 + `docs/active/<X>-HANDOFF.md`» 를 먼저 받고 이 파일에 트리거를 추가한다.
