-- 0091-ac201-account-identity.sql — [AC-201 · B2 2026-09-21] 🔴 «이 계정의 **진짜** 블로그 주소»를 담는 칸
--   번호: B2 칸 `0091~0099`(2026-09-21 메인 배정). 쓰기 전에 `ls drizzle/` 로 눈으로 봤다(마지막 = 0083).
--
--   ══ 왜 ══
--     `runner/channels/naver-blog.mjs` 는 `accounts.handle` 을 **그대로 믿고** `blog.naver.com/{handle}/postwrite` 로 간다.
--     🔴 그 아이디가 틀리면 네이버는 **404 를 주지 않고 로그인한 사람의 블로그로 조용히 데려간다.**
--        AM 실사고(2026-09 NAVERPUB): 원장 `qj_academy`(없는 아이디) → 네이버가 자사 `with_walk_on_office` 로 리다이렉트
--        → **남의 블로그에 남의 글이 올라갔다.** 그리고 우리는 끝까지 «맞게 올렸다»고 알고 있었다.
--     이 자리만은 **되돌릴 수 없다** — §5E 에서 «우리가 고객 동의 없이 내리기(③)»를 안 만들기로 했으므로,
--     남의 블로그에 나간 글은 **우리가 못 내린다.**
--
--   ══ 🔴 왜 «막기»가 아니라 «한 번 묻기»인가 ══
--     네이버는 **로그인 아이디와 블로그 주소가 다를 수 있다.** 다르다고 막으면 **멀쩡한 계정이 영영 못 올린다**
--     (AM 의 가드가 딱 그렇게 생겼다 — 원장에 값이 있고 다르면 무조건 throw).
--     ⇒ 다르면 **한 번 묻고 그 답을 여기 적는다.** 그다음부터는 그 주소로 조용히 올라간다.
--     ⚠️ 이 «확인 대화»는 CLAUDE §9 의 게이트가 **아니다** — §9 가 스스로 «되돌릴 수 없는 동작의 확인은
--        고객을 위한 확인이지 우리 판단이 아니다»로 밖에 두었다.
--
--   ══ 칸 모양(jsonb 한 칸 · 컬럼 여럿을 만들지 않는다) ══
--     {
--       "observed":   "with_walk_on_office",   -- 러너가 마지막으로 **실제로 본** 블로그 주소
--       "observedAt": "2026-09-21T...Z",
--       "observedVia":"myblog" | "links" | "posted",   -- 어느 사다리로 봤나(증거의 질이 다르다)
--       "posted":     "endy1116",              -- 🔴 발행된 글 주소에서 회수한 것 = 가장 센 증거
--       "confirmed":  "with_walk_on_office",   -- 고객이 «이 주소 맞다»고 한 것 → claim 때 expectBlogId 로 내려간다
--       "confirmedAt":"...", "confirmedBy":"user:12",
--       "askedAt":    "..."                    -- 마지막으로 물어본 시각(«한 번만 묻는다»의 근거)
--     }
--   🔴 jsonb 인 이유 = 같은 표의 `monetize`·`golden_hours` 선례가 있고, 칸을 여섯 개 만들면 그중 다섯은 늘 NULL 이다.
--      DESIGN §5E 가 `stats.retract` 에 쓴 것과 같은 판단.
--   🔴 기본값 `'{}'` = «아직 아무것도 모른다». **«같다»가 아니다** — 비어 있으면 러너는 `expectBlogId` 없이 가고,
--      판정은 `unmeasured`/`match`/`mismatch` 중 하나가 된다(AC-9: 빈 값을 «통과»로 읽지 않는다).
--
--   ══ 🔴 안 걸어도 아무것도 안 죽는다(0081 과 반대) ══
--     읽는 곳(`lib/runner-jobs.ts loadAccountForRunner`)이 **선택 컬럼**으로 읽고, 없으면 `expectBlogId` 없이 간다.
--     그래도 **같은 호흡에 거는 것이 맞다** — 안 걸면 «고객이 확인해 준 주소»를 저장할 데가 없어서
--     `mismatch` 가 **매번** 뜬다(한 번 묻기가 영원히 묻기가 된다).
--
--   추가형만: ADD COLUMN IF NOT EXISTS. DROP·DELETE·RENAME 0.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS identity jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN accounts.identity IS
  '[AC-201] 이 계정의 실제 채널 신원. observed/observedVia/posted = 러너가 본 것 · confirmed = 고객이 «맞다»고 한 주소(claim 때 expectBlogId 로 내려간다) · askedAt = 마지막으로 물어본 때. 🔴 {} = «아직 모른다»이지 «맞다»가 아니다. 쓰는 곳: lib/runner-jobs.ts(claim·report) · 읽는 곳: runner/lib/auth-naver.mjs judgeBlogIdentity.';
