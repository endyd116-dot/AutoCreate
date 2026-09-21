# [A] 재부팅 대기 쪽지 — 2026-09-21

**브랜치** `feature/a-keyin-notice` · **머리** `bd4e800` · **작업 폴더 깨끗함(미커밋 0)** · **push 안 함**

## 어디까지 했나 — 두 판 다 끝내고 커밋했다(미완성 아님)
1. `2685d5c` **AC-180/181/182** — 운영 콘솔 둘(`public/ops/takedowns.html`·`public/ops/proxies.html`)을 새로 냈고, 고객 수익 연결의 «나가는 길»을 `public/app/ad-media.html` 맨 위에 냈다. 서버는 R8 부터 다 있었고 **부르는 화면만 0개**였다.
2. `bd4e800` **AC-183/184/185** — 영상이 «어디에도 안 나타나던» 까닭은 화면이 `tenant-settings.kinds` 를 안 본 것이었다. 홈에 «영상도 만들어 드릴까요?» 한 줄(`UI.askKindsSheet`) · 만들기·편성표가 `kinds` 를 본다 · 계정 없이 만든 영상에 «직접 올리는 길».

## 다음 한 걸음
- **메인의 다음 트리거를 기다린다.** 내가 먼저 손댈 것은 없다.
- 재개하면 먼저 돌릴 것: `node scripts/verify-video-path-flow.mjs` · `node scripts/verify-ops-console-flow.mjs` · `node scripts/verify-hand-on-button.mjs` (마지막 상태: 9/9 · 8/8 · 51장 482단추 0/0).

## 막힌 것 — 없다. 다만 **B 몫 셋**을 메인에게 올려 뒀다
- `GET /api/ops-proxies` 의 `stock` 에 **`stock.noProxy`**·**`stock.stalled`** (지금은 화면이 `proxies[]` 를 훑어 세는데 서버 `LIMIT 200` 이라 넘치면 덜 센다).
- 🔴 `lib/runner-jobs.ts:602` 가 `p.status AS p_status` 를 **SELECT 만 하고 안 읽는다** — DESIGN §7.3b fail-closed 의 «죽은 IP면 멈춘다» 쪽이 안 돈다.
- `GET /api/rules-list` 에 **`kinds`** 를 실어 주면 편성표의 왕복 하나가 없어진다(급하지 않다).
- `/api/revenue-oauth-start`(GET 302)는 여전히 화면 0곳 — 지울지 메일·딥링크 입구로 둘지는 메인·B 판단(`docs/rules/api-callers.json` 에 적어 뒀다).

## 손대던 파일(둘 다 커밋됨)
`public/ops/_tpl.txt` · `public/app/_tpl.txt` · `public/app/home.html` · `public/js/ui.js` · `public/js/mock.js` · `public/js/mock-ops.js` · `scripts/build-pages.mjs` · `scripts/verify-{r8-deadends,cta-bound,api-callers…}` · 새 자 `scripts/verify-{ops-console-mutants,ops-console-flow,video-path-flow}.mjs`

🔴 **`_shots/` 는 git 밖이다** — 거기 만든 스샷 자(`shot-ac180.mjs`·`shot-ac183.mjs`·`shot-ac180-sheets.mjs`)는 재부팅 뒤에 남아 있어도 다음 창이 모른다. 잰 값은 위 커밋 메시지에 다 적어 뒀다.
