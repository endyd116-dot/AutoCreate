-- P1R3-B · 수익 통합(DESIGN §9.2 · 계약 §-1·§0·§1.3) — 추가형·멱등(IF NOT EXISTS). scripts/neon-migrate.mjs 로 적용.
-- 🔴 파괴적 문장 0. 기존 행·칸을 바꾸지 않는다.

-- ── revenue_daily: 멱등 UPSERT 의 근거(유니크) + 갱신 시각 ──────────────────────────────
-- account_id·piece_id 는 NULL 일 수 있다(테넌트 전체 소스 · 글 귀속 안 된 수익). NULL 은 유니크에서 서로 다르므로
-- COALESCE(...,0) 표현식 인덱스로 «없음»을 0 으로 접어 (tenant,source,account,piece,day) 를 하나로 만든다.
-- lib/revenue/upsert.ts 의 ON CONFLICT 가 같은 식을 쓴다(둘이 어긋나면 UPSERT 가 죽는다 — 여기와 그 파일이 짝이다).
ALTER TABLE revenue_daily ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS revenue_daily_uniq_idx
  ON revenue_daily (tenant_id, source, COALESCE(account_id, 0), COALESCE(piece_id, 0), day);
CREATE INDEX IF NOT EXISTS revenue_daily_piece_idx ON revenue_daily (tenant_id, piece_id) WHERE piece_id IS NOT NULL;

-- ── revenue_sources: 실패 추적(«없음»을 0원으로 쓰지 않으려면 실패를 행이 아니라 여기 남긴다 · AC-9) ──
ALTER TABLE revenue_sources ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE revenue_sources ADD COLUMN IF NOT EXISTS last_error_kind varchar(16);
ALTER TABLE revenue_sources ADD COLUMN IF NOT EXISTS fail_count integer NOT NULL DEFAULT 0;
ALTER TABLE revenue_sources ADD COLUMN IF NOT EXISTS last_ok_at timestamp;
ALTER TABLE revenue_sources ADD COLUMN IF NOT EXISTS error_notified_at timestamp;
ALTER TABLE revenue_sources ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE revenue_sources ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
-- (tenant, source, account) 당 소스 행 하나 — 연결 버튼을 두 번 눌러도 행이 둘이 되지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS revenue_sources_uniq_idx
  ON revenue_sources (tenant_id, source, COALESCE(account_id, 0));
