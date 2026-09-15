-- 0024-r8-piece-origin.sql — [R8 §5D · B-1 2026-09-15] 글이 만들어진 **길**을 piece 에 남긴다(추가형 · 멱등)
--   🔴 왜: DESIGN §5D 의 세 길(auto 편성표 · manual 사람이 «만들기» · self **사람이 직접 씀**)을 글마다 구분해야
--      ①검수 화면이 «내가 쓴 글»로 그리고 ②AI 티 축을 그 글에만 안 걸고 ③성과 원장(§5F)이 «사람 글 vs AI 글»을 가를 수 있다.
--   `slots.origin` 은 이미 있는데 `pieces` 에는 없었다 — 자리의 출처와 글의 출처는 다른 값이다
--   (자동으로 잡힌 자리에 사람이 직접 쓴 글을 꽂을 수 있다).
--   옛 글은 전부 'auto' 로 둔다(그때는 그 길뿐이었다 — 지어낸 값이 아니다).

ALTER TABLE pieces ADD COLUMN IF NOT EXISTS origin varchar(8) NOT NULL DEFAULT 'auto';

CREATE INDEX IF NOT EXISTS pieces_tenant_origin_idx ON pieces (tenant_id, origin);
