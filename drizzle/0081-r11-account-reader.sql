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

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS reader varchar(120);

COMMENT ON COLUMN accounts.reader IS
  '[R11-8] 이 계정의 독자 — 채널 계약(writing-contracts contract.reader)을 덮어쓴다. 🔴 NULL = 안 골랐다(계약 값 그대로 · 지금과 같다). 읽는 곳: lib/content-gen.ts 프롬프트 ①칸 · netlify/functions/pieces.ts 검수 3축.';
