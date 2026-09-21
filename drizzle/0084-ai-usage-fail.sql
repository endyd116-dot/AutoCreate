-- 0084-ai-usage-fail.sql — [B · 2026-09-21] **돈이 나갔는데 원장에 한 줄도 없던 자리**를 세는 칸 둘
--   번호: B 칸 `0084~0089`(메인 지시 2026-09-21). 🔴 쓰기 전에 `ls drizzle/` 로 눈으로 봤다(마지막 0083).
--
--   ══ 왜 ══
--     `recordAiUsage` 가 **성공 경로에만** 있었다. 실패하면 그냥 `return`/`continue` 라 **한 줄도 안 남았다.**
--     그래서 ① 우리가 «몇 번 헛돌았나»를 셀 수 없고 ② `checkAiCostCap`(= `SUM(cost_usd)`)이 **그만큼을 못 본다.**
--     🔴 특히 «제공사는 다 만들어 줬는데 우리가 못 받아 온» 두 자리(다운로드 실패 · R2 저장 실패)는
--        **실패가 아니라 우리 쪽 사고**라 **확실히 청구된다.** 그게 통째로 안 보였다.
--
--   ══ 왜 `cost_usd` 를 안 쓰나 ══
--     🔴 메인 지시(2026-09-21): «**`checkAiCostCap` 의 합은 지금 건드리지 마라. 새 자리는 «세기만» 한다.**
--        관문을 움직일지는 숫자를 보고 사장님이 정한다.»
--     ⇒ 새 행은 `cost_usd = 0` 으로 들어가 **관문 합을 한 푼도 안 바꾼다.** 금액은 아래 `cost_usd_maybe` 에 따로 적는다.
--     ⚠️ 그래서 **지금은 «보이기만 하고 안 물린다».** 숫자가 쌓이면 사장님이 «이걸 관문에 넣을까»를 정한다.
--
--   ══ 🔴 «모름»을 «0원»으로 적지 않는다(AC-9) ══
--     `cost_usd_maybe` 는 **NULL 을 허용**한다. 세 사유의 뜻이 다르다:
--       · `provider_failed`  — 제공사가 **에러를 냈다**. 그들이 청구하는지 **우리는 모른다** ⇒ `cost_usd_maybe = NULL`(못 쟀음)
--       · `download_failed`  — 제공사가 **영상을 다 만들었는데** 우리가 못 받아 왔다 ⇒ 금액을 **안다**
--       · `store_failed`     — 다 받아 놓고 **R2 에 못 넣었다** ⇒ 금액을 **안다**
--     즉 **금액이 NULL 인 것과 0인 것은 다른 말**이다. NULL = 못 쟀다 · 0 = 안 나갔다(스텁).
--
--   ══ 이 칸을 읽는 자리 ══
--     `lib/ai.ts recordAiUsage`(쓰기 한 곳) · 운영 조회(사람이 SQL 로) · `scripts/verify-ai-usage-leaks.mjs`(자).
--     🔴 `checkAiCostCap` 은 **안 읽는다** — 위 «세기만» 지시 그대로다.

ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS fail_kind varchar(32);
COMMENT ON COLUMN ai_usage.fail_kind IS '실패 사유(provider_failed|download_failed|store_failed|empty|http|timeout). NULL = 성공한 호출.';

ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS cost_usd_maybe numeric(10,6);
COMMENT ON COLUMN ai_usage.cost_usd_maybe IS '나갔을 수 있는 돈(cost_usd 에는 안 넣는다 · 관문 합 무영향). NULL = 못 쟀음(0원이 아니다).';

-- 실패만 빨리 세기 위한 부분 인덱스(성공 행이 절대다수라 부분 인덱스가 싸다).
CREATE INDEX IF NOT EXISTS ai_usage_fail_idx ON ai_usage (purpose, fail_kind, created_at) WHERE fail_kind IS NOT NULL;
