-- P1R7-B §3 · 탈퇴·개인정보 파기(§3.1) · 내부 테스트 구분(§3.4) — 추가형·멱등(IF NOT EXISTS). 파괴적 문장 0.
--   플랜 채널 게이트(§3.2)는 plans.limits(jsonb) 안에 사는 값이라 DDL 이 없다 · 자격 보관 동의(§3.3)는 R4 의 consents 표를 그대로 쓴다.

-- ── tenants: 탈퇴 예약(30일) · 파기 ──
--   흐름: account-close → status readonly + closed_at + purge_at(=now+30d) · account-restore → close_prev_status 로 되돌림
--         크론 tenant.purge → 기한 지난 곳의 데이터 삭제 + tenants 는 **묘비**로 남긴다(status purged · purged_at · 이름 마스킹).
--   묘비를 남기는 이유: invoices(전자상거래법 5년 보존)가 tenant_id 를 가리킨다 — 행을 지우면 보존해야 할 결제 이력이 함께 끊긴다.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS closed_at timestamp;                     -- 탈퇴 신청 시각(NULL = 쓰는 중)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS close_reason varchar(200);               -- 고객이 적은 사유(선택 · 개인식별정보 아님)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS close_prev_status varchar(16);           -- 탈퇴 직전 상태(되돌리기용 · trial|active|readonly…)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS purge_at timestamp;                      -- 이 시각 뒤 파기(= closed_at + 30일)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS purged_at timestamp;                     -- 실제 파기 시각(묘비 · 두 번 파기하지 않는다)
CREATE INDEX IF NOT EXISTS tenants_purge_due_idx ON tenants (purge_at) WHERE purge_at IS NOT NULL AND purged_at IS NULL;

-- ── tenants: 내부 테스트 구분(운영 숫자에서 뺀다) ──
--   우리 도메인 메일·하니스 키(verify-·smoke-·r6-…)는 자동 true(lib/ops/internal.ts) · 운영자가 손으로 켜고 끌 수도 있다.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS tenants_is_internal_idx ON tenants (is_internal) WHERE is_internal = true;
