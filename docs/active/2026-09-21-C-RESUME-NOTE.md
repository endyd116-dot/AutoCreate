# C · 재부팅 대기 쪽지 (2026-09-21 · 열 줄)

1. 브랜치 `verify/e2e-rehearsal` · 해시 **`5b00484`**(= `main` 의 B 커밋 7개를 머지한 판) · **push 0** · 미커밋 0.
2. 🔴 **변이 잔재 0건 — `node scripts/verify-mutant-residue.mjs` 종료코드 0.** 제품 나무(`public/ lib/ netlify/ db/ drizzle/ runner/`) 변경 **0**. 도는 하니스 없음. 아레나(`_verify/`) 찌꺼기 0.
3. **앞 판(끝냄)**: 자 셋을 냈다 — `verify-quality-grade`(품질 축 6개 · 등급 67점) · `verify-quality-grade-mutants`(**7/7 · 0**) · `verify-experiment-holds`(«이 실험이 성립하나» · 자기찌르기 **0** · 전수 55개 = ✓44 ✗2 ⊘9). AC **210·211·212·213**. 대기 빨강에 넷 등록.
4. **앞 판에서 뒤집은 것**: 🔴 프록시 저장이 고객 **프록시 비밀번호를 지운다**(마스킹된 값 되돌려 쓰기 · 고칠 곳 **두 군데**: `accounts.html` + `_tpl.txt`) · `ops-proxies` 부르는 화면 **0곳** · 못 불러오면 **뼈대가 영원히 남는 화면 13/19**(홈 포함) · A 의 `verify-keyin-notice-mutants` 가 **진짜 나무를 더럽힌다**(AC-213).
5. **새 몫(2026-09-21 둘째 판)은 «시작 안 했다»** — 메인이 «멈춰라»를 보내기 전까지 **읽기만** 했다. 코드 한 줄 안 고쳤다.
6. 🔴 **다만 읽다가 절반은 끝냈다 — 이어 할 사람은 여기부터**: B 의 `scripts/verify-ai-usage-leaks.mjs` ⑤축 **ALLOW 9줄** 중 **①②③을 손으로 확인했고 셋 다 안전**하다.
   - ① `VID "fal_failed"` — `callProvider` 안쪽. 부르는 쪽 `generateClip` 이 `if (!r.ok)` 에서 **분기 전에** `video_clip:fail`(`provider_failed`)을 적는다. ✅
   - ② `VID 'r2Put(key, buf,'` — `if (videoStub())` 안. provider 호출 **전**이라 돈 0. 진짜 길은 `r2Put(key, bytes,` 로 **글자가 달라** 이 ALLOW 에 안 걸린다(과녁이 정확하다). ✅
   - ③ `VID 'r2Put(key, png,'` — `generateStill` 의 `if (videoStub())` 안. 1×1 PNG 자리채움 · 돈 0. ✅
7. 🔴 **남은 것 여섯이 진짜 위험한 쪽이다** — ④⑤⑥(`IMG` 의 `gemini_error_`·`empty_image`·`AbortError`)은 «`callImageModel` 안쪽이고 **부르는 쪽**이 적는다»는 주장이라 **`lib/ai-image.ts` 의 부르는 쪽을 전수로 열어야** 한다(한 갈래라도 안 적으면 돈이 샌다). ⑦⑧⑨(`TTS` 의 세 가드)는 «**호출 전**»이라는 주장이라 **네트워크 호출보다 위에 있는지**만 보면 된다.
8. 🔴 **덤으로 봐야 할 것**: `generateStill` 의 `if (!r.ok) { … return { ok:false, reason: r.reason } }`(`lib/video/providers/index.ts`)는 **B 의 ⑤축 모수에 안 들어온다** — `return { ok: false` 가 한 줄에 있어도 앞 12줄에 `recordAiUsage` 가 없는데, `generateImage` **안쪽**이 적는지 확인이 필요하다. ALLOW 에도 없고 빨강도 안 났다 ⇒ **왜 안 걸렸는지**부터 보라(모수 밖일 수 있다 · AC-141 ②).
9. 읽을 것: `CLAUDE.md §4·§8·§9` · PITFALLS **AC-112·121·140·141 · 170~172 · 190·191 · 210~213** · `docs/active/2026-09-21-C-quality-and-control.md`(앞 판 전체).
10. 칸: AC **214~219** 가 남았다(210~213 은 썼다) · DDL **0101~0109** 는 **통째로 비어 있다**(이번 판에 스키마 0).
