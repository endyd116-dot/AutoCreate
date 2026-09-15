-- 0013 · 채널 상태 어휘를 한 벌로(계약 P1R7 §2.3 · B2 전수조사 ➖②) — B2 2026-09-15
--
-- 문제: 같은 칸을 두 어휘가 말하고 있었다.
--   · `drizzle/0001-init.sql:205` 주석 → `live|beta|planned|paused`
--   · 실제 코드·데이터    → `active|planned|down` (`netlify/functions/ops-channels.ts:24` · 라이브 10행)
-- 주석을 믿고 `live` 를 넣으면 고객 «계정 연결» 그리드는 `status === "active"` 만 그리므로
-- **그 채널이 화면에서 조용히 사라진다**(public/app/accounts.html:38). 오류도 안 난다 — 그래서 위험하다.
--
-- 🔴 주석만 고치면 다음 사람이 또 넣는다. **DB 가 거절하게** 만든다:
--    CHECK 제약 + 칸 주석. 지금 10행이 전부 active|planned 라 기존 데이터는 그대로 통과한다(파괴적 변경 0).
-- 추가형 전용(IF NOT EXISTS 상당 · 멱등) — 이미 있으면 건너뛴다.

-- ⚠️ `scripts/neon-migrate.mjs` 는 «;+줄바꿈» 으로 문장을 자른다(`:23`). DO 블록을 여러 줄로 쓰면
--    가운데서 잘려 «unterminated dollar-quoted string» 이 난다(실측). 그래서 **한 줄**로 둔다 — 보기엔 답답해도 이게 돈다.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channel_registry_status_chk') THEN ALTER TABLE channel_registry ADD CONSTRAINT channel_registry_status_chk CHECK (status IN ('active','planned','down')); END IF; END $$;

COMMENT ON COLUMN channel_registry.status IS
  'active = 고객 «계정 연결» 그리드에 보인다 · planned = 숨기고 온보딩엔 «곧 열려요» 칩 · down = 장애(운영자가 내린다). 이 셋뿐 — CHECK 로 강제.';
