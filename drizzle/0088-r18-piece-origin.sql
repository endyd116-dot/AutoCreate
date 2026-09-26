-- 0088-r18-piece-origin.sql — [B · 2026-09-26 · R18] **한 번 만들어 여러 곳에**(영상 재사용)
--   번호: B 칸 `0088~0089`(트리거 §8 · docs/active/LANES.md). 🔴 `ls drizzle/` 로 눈으로 봤다 — 0087 다음 · 0091 은 B2 칸.
--
--   ══ 왜 ══
--     사장님(2026-09-24): «쇼츠로 만든 영상을 릴스·클립에도 똑같이 올려서 한 영상으로 최대 효율을 뽑자»
--     그런데 `pieces` 는 `account_id`·`channel` 을 **각 하나**만 갖는다(1:1) — 한 영상을 N곳에 보내려면 piece 가 N개여야 한다.
--     그 N개가 «같은 영상에서 왔다»를 적을 칸이 **없었다.** `origin` 칸은 «auto/manual/self»(만들어진 길)라 뜻이 다르다.
--
--   ══ 칸 ══
--     origin_piece_id   원본 piece id. 🔴 **NULL = 원본(또는 재사용과 무관한 글)** · 값이 있으면 파생.
--                       파생은 원본의 영상 파일(`piece_assets.r2_key`)을 **그대로 가리킨다** — 다시 굽지 않는다.
--                       파생은 코인 원장에 **0행**이다(DESIGN §4.7 «승계 무료»).
--
--   ══ 인덱스 ══
--     pieces_origin_piece_idx  (tenant_id, origin_piece_id) — 원본 화면이 «이 영상이 나간 곳»을 읽는다.
--     pieces_origin_channel_uq (origin_piece_id, channel)    — 🔴 **한 원본에서 한 채널로 파생은 하나.**
--                              승인이 두 번 불리거나(사람 + 마감 크론) 고객이 두 번 답해도 같은 채널에 두 번 안 생긴다(멱등).
--     둘 다 `WHERE origin_piece_id IS NOT NULL` 부분 인덱스 — 원본·일반 글(대부분)은 인덱스에 안 들어간다.
--
--   🔴 FK 를 걸지 않았다 — `pieces` 의 다른 참조 칸(brief_id·slot_id·topic_id)도 FK 가 없고,
--      디렉터 확정 롤백(`lib/director.ts rollback`)이 piece 행을 지우는 순서와 엮이지 않게 한다.
--   🔴 추가형만이다 — 기존 칸·행을 하나도 안 건드린다.

ALTER TABLE pieces ADD COLUMN IF NOT EXISTS origin_piece_id bigint;
COMMENT ON COLUMN pieces.origin_piece_id IS
  'R18 영상 재사용 — 원본 piece id. NULL = 원본(또는 무관). 값이 있으면 파생: 원본과 같은 r2_key 를 가리키고 코인 원장에 0행(DESIGN §4.7 승계 무료). origin 칸(auto/manual/self)과 뜻이 다르다.';

CREATE INDEX IF NOT EXISTS pieces_origin_piece_idx ON pieces (tenant_id, origin_piece_id) WHERE origin_piece_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pieces_origin_channel_uq ON pieces (origin_piece_id, channel) WHERE origin_piece_id IS NOT NULL;
