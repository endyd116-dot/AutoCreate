-- 0092-r17-channel-monetize-meta.sql — [R17-B2 · 2026-09-23] 🔴 클립 모집창을 **담을 칸이 없었다**.
--
-- ══ 무엇이 잘못돼 있었나(R16 재측정 실측) ══
--   `lib/ad-eligibility.ts:57` 이 `SELECT monetize->'clipOpen'` 으로 **객체 칸**을 읽는데,
--   `channel_registry.monetize` 는 `0001-init.sql:208` 부터 **배열**(`jsonb NOT NULL DEFAULT '[]'`)이었고
--   `netlify/functions/ops-channels.ts:58` 은 그 칸을 **배열로 통째 덮어쓴다**(수익 매체 칩 목록).
--   ⇒ 라이브 실측 `jsonb_typeof(monetize)=array` · `monetize->'clipOpen'` 이 **언제나 NULL**
--     ⇒ D-7 «클립 크리에이터 모집이 시작해요» 알림이 **구조적으로 안 뜬다.**
--   🔴 «운영자가 안 넣었다»가 아니라 **넣을 칸도 넣을 화면도 없었다.** 9일 동안 조용했다(오류 0).
--
-- ══ 왜 새 칸인가 ══
--   `monetize`(배열 = «이 채널에 붙는 수익 매체 목록»)는 **뜻이 이미 정해져 있고 운영 화면이 그 뜻으로 쓴다.**
--   거기에 객체를 섞으면 칩을 한 번 저장할 때마다 모집창이 사라진다 — 지금이 딱 그 모양이다.
--   ⇒ **운영자가 손으로 넣는 «수익 관련 사실»** 은 따로 둔다. 지금은 `clipOpen` 하나지만
--     같은 성질의 것(모집·신청 기간 같은 날짜 창)이 더 생기면 여기 붙는다.
--
-- 모양: { "clipOpen": { "from": "2026-10-01", "to": "2026-10-31" } }   (KST 날짜 문자열 · DESIGN §13.5)
-- 추가형·멱등(IF NOT EXISTS) · 기존 행은 기본값 '{}' 라 읽는 쪽이 그대로 «없음»으로 본다(소급 0).
-- 🔴 `monetize` 는 **안 건드린다** — 지우지도 옮기지도 않는다(배열 그대로가 정본).

ALTER TABLE channel_registry ADD COLUMN IF NOT EXISTS monetize_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN channel_registry.monetize_meta IS
  '운영자가 손으로 넣는 수익 관련 «사실» — 지금은 clipOpen:{from,to}(네이버 클립 모집창 · KST 날짜). 수익 매체 «목록»은 monetize(배열) 쪽이고 둘은 다른 칸이다. 읽는 곳 lib/ad-eligibility.ts clipWindow() · 쓰는 곳 ops-channels.ts + public/ops/channels.html.';
