-- 0023-r8-photo-source.sql — [R8 §5D.4 · B-1 2026-09-15] 사진 되짚기 색인(추가형 · 멱등)
--   🔴 왜: «이 사진이 문제다» 통지는 **사진 한 장**을 가리키며 온다. 그때 그 사진이 들어간 글을 **전부** 찾아야 한다.
--      `piece_assets.meta->'source'->>'key'` 로 찾는데, 색인이 없으면 글이 쌓일수록 전수 스캔이 된다.
--   표·칸을 더하지 않는다 — `meta` jsonb 는 이미 있다(표현식 색인만).

CREATE INDEX IF NOT EXISTS piece_assets_source_key_idx
  ON piece_assets ((meta->'source'->>'key'))
  WHERE meta->'source'->>'key' IS NOT NULL;

-- 한 글의 사진 목록(올린 순서) — 검수 화면이 매번 부르는 자리.
CREATE INDEX IF NOT EXISTS piece_assets_piece_kind_sort_idx
  ON piece_assets (tenant_id, piece_id, kind, sort);
