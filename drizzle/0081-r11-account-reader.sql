-- 0081-r11-account-reader.sql — [R11-8 · 설계 R11 §4.4 · B] 계정마다 «누구에게 쓰나»(독자)를 계약 위에 덮어쓰는 칸
--   번호: B 칸 `0081~0089`(계약 §6 · 2026-09-17). 🔴 쓰기 전에 `ls drizzle/` 로 눈으로 봤다.
--
--   ══ 왜 ══
--     지금 독자는 **채널 계약에 고정**이다(`lib/writing-contracts.ts` 의 `contract.reader` — «내 블로그 이웃» · «검색으로 들어온 사람»).
--     그런데 같은 네이버라도 «살림 검증» 계정과 «작은 돈 재테크» 계정은 **읽는 사람이 다르다.** 계정이 계약을 덮어쓸 칸 하나가 필요하다.
--
--   ══ 🔴 비우면 지금과 똑같다 ══
--     NULL = «안 골랐다» = 계약 값 그대로. 기본값을 넣지 않는다 — 넣는 순간 **전 계정의 독자가 조용히 바뀐다**(무회귀 파괴).
--
--   ══ 🔴 허용 목록까지가 이 칸을 «만든 것»이다 ══
--     2026-09-16 까지 **네 곳**에서 저장은 200 인데 새로고침하면 사라졌다(`ALLOWED_SETTINGS`·`sanitizeProfile`·`pieces-get meta`·`styleApplied`).
--     이 칸이 다섯 번째가 되지 않게 **읽는 쪽을 같은 커밋에 넣었다**: `accounts-update`(쓰기) · `ACCOUNT_SELECT`+`toAccountRow`(읽기) ·
--     `lib/content-gen.ts`(프롬프트 ①칸 «독자:») · `netlify/functions/pieces.ts`(검수 «왜 이렇게 생겼나» 의 contract.reader).
--
--   추가형만: ADD COLUMN IF NOT EXISTS. DROP·DELETE·RENAME 0.
--
--   ══ 🔴 **이 파일은 «머지와 같은 호흡»에 걸어야 한다 — 늦으면 제품이 거의 통째로 멈춘다** ══
--     `lib/accounts.ts ACCOUNT_SELECT` 가 `a.reader` 를 **읽는다.** 컬럼이 없으면 Postgres 가 **42703** 으로 거절하고 **폴백이 없다**.
--     그 조각을 지나는 자리를 전수로 셌다(2026-09-17 · C 가 러너까지임을 짚어 줘서 다시 셌다):
--       계정(accounts) · 편성 규칙(rules) · 🔴 **러너 API(runner — 잡을 못 집는다)** · 공유 카드 · 글 스타일 배우기 ·
--       🔴 **디렉터(director) · 자동 편성 크론(director-auto)** · 소재(topics)
--     ⇒ «계정 화면이 죽는다»가 아니라 **계정·편성·러너·디렉터·자동 생성이 같이 죽는다.** 순서는 CLAUDE §4.5 그대로 **B → DDL → A**.
--     ⚠️ 같은 라운드의 `0082`(당근 행)는 **반대다** — 안 걸어도 아무것도 안 죽는다(화면에 안 뜰 뿐 · 정본은 코드).

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS reader varchar(120);

COMMENT ON COLUMN accounts.reader IS
  '[R11-8] 이 계정의 독자 — 채널 계약(writing-contracts contract.reader)을 덮어쓴다. 🔴 NULL = 안 골랐다(계약 값 그대로 · 지금과 같다). 읽는 곳: lib/content-gen.ts 프롬프트 ①칸 · netlify/functions/pieces.ts 검수 3축.';
