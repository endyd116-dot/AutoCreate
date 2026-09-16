-- P1R6-B · 추천인(§1.1) · 세금계산서(§1.2) — 추가형·멱등(IF NOT EXISTS). 파괴적 문장 0.
-- 회사 정보(§1.3)는 ops_settings 'company' 행 · 세금계산서 프로필(§1.2)은 tenants.settings.taxProfile jsonb — 새 표 없음.

-- ── tenants: 추천 코드(테넌트당 1개 · 8자 대문자+숫자) · 누가 추천했나 · 보상 시각 ──
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_code varchar(8);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referred_by bigint;                     -- 추천인 테넌트 id(가입 때 1회 · 바꾸지 않는다)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_rewarded_at timestamp;         -- 첫 유료 결제 성공 → 양쪽 보상 지급 시각(멱등 근거는 coin_ledger ref)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_blocked_at timestamp;          -- 남용 판정으로 보상을 막은 시각(같은 card_fp 등) · 한 번 막히면 끝
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_block_reason varchar(24);      -- card_fp | email_alias | email_domain
CREATE UNIQUE INDEX IF NOT EXISTS tenants_referral_code_uniq ON tenants (referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS tenants_referred_by_idx ON tenants (referred_by) WHERE referred_by IS NOT NULL;

-- ── invoices: 세금계산서 상태(none|requested|issued) · 발급 시각 · 문서 주소 · 요청 시 사업자 정보 스냅샷 ──
--    요청 시각은 R4 의 tax_doc_requested_at 을 그대로 쓴다(중복 칸 금지).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_status varchar(12) NOT NULL DEFAULT 'none';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_issued_at timestamp;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_url varchar(300);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_biz jsonb;                         -- { bizNo, bizName, email }(요청 시점 스냅샷)
