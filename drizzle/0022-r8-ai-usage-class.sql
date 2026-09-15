-- P1R8-B · AI 원가 분류를 **행 자신이 갖게** 한다(메인 라이브 실측 2026-09-15) — 추가형·멱등.
--
-- 무엇이 문제였나: 운영 대시보드의 «내부 테스트 제외»가 `NOT EXISTS (tenants … is_internal)` 로 판정했다.
--   🔴 **부모(tenants)를 지우면 NOT EXISTS 가 참**이 되어, 그 집이 쓴 돈이 **«진짜 고객 비용»으로 넘어간다.**
--   우리는 «ai_usage 는 어떤 정리에서도 안 지운다»를 지켰는데, 지운 건 부모고 남은 건 자식이라 **분류만 조용히 반대편으로 갔다.**
--   실측: 400행 중 고아 103행 $9.98 이 고객 비용으로 세어지고 있었다(그중 $9.00 은 상한 시험용 가짜 행).
--
-- 그래서 두 칸을 행에 박는다:
--   · is_internal — 쓰는 **그 순간**의 «우리 집인가»(스냅샷). 부모가 사라져도 분류가 남는다.
--   · synthetic   — **실제 호출이 아닌 행**(하니스가 상한·정산을 시험하려고 적어 넣은 것). 지우지 않고 **표시**해서 기본 집계에서 뺀다
--                   (돈 기록은 안 지운다 · 그렇다고 가짜를 원가로 세지도 않는다).
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ai_usage_class_idx ON ai_usage (created_at) WHERE NOT is_internal AND NOT synthetic;
