-- P1R8-B · 발행 시각을 **분 단위로**(사장님 2026-09-15: «글1 A계정 10:00 · 글2 B계정 10:05 · 글3 A계정 11:00») — 추가형·멱등.
--   🔴 옛 칸 `preferred_hour`(정수 시)는 그대로 둔다. 분이 없으면 **00 분**으로 읽는다 — 지금 쓰는 규칙은 그대로 돈다(소급 0).
ALTER TABLE cadence_rules ADD COLUMN IF NOT EXISTS preferred_minute smallint;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cadence_rules_pref_min_chk')
  THEN ALTER TABLE cadence_rules ADD CONSTRAINT cadence_rules_pref_min_chk CHECK (preferred_minute IS NULL OR (preferred_minute >= 0 AND preferred_minute <= 59)); END IF; END $$;
COMMENT ON COLUMN cadence_rules.preferred_minute IS '규칙이 못 박은 «분»(0~59). NULL = 00분. preferred_hour 가 있을 때만 쓴다.';
