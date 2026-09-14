-- P1R4-B · 결제·구독·체험(계약 §0.1 정본 결정 · DESIGN §12) — 추가형·멱등. scripts/neon-migrate.mjs 로 적용.
-- 🔴 파괴적 문장 0. 칸 폭은 어휘를 다시 재서 정했다(AC-21): tenants.status varchar(16) ⊇ 'readonly'(8)·'suspended'(9) — 확장 불필요.

-- ── subscriptions = 결제 주기 «장부»(정본은 tenants.status/plan_key/trial_ends_at · §0.1) ──────────────
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS next_billing_at timestamp;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_day integer;                              -- 약정일(1~28)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pending_plan_key varchar(32);                    -- 다운그레이드 예약(다음 주기부터)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pending_cycle varchar(8);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS discount_pct integer NOT NULL DEFAULT 0;         -- 쿠폰 월할인(%)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS discount_until timestamp;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS price_locked_krw integer;                        -- 가입 시점 가격 고정(가격 개정 게이트가 존중)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_key_missing_at timestamp;                -- 활성인데 카드 없음(사각 감시)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS fail_count integer NOT NULL DEFAULT 0;           -- 연속 청구 실패(dunning)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_charge_at timestamp;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS coupon_code varchar(40);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
-- 테넌트당 장부 1행(UPSERT 근거).
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_tenant_uniq ON subscriptions (tenant_id);

-- ── billing_keys: 카드 지문(재가입 남용 §12.3) · 표시용 ──────────────────────────────────────────
ALTER TABLE billing_keys ADD COLUMN IF NOT EXISTS card_fp varchar(64);                              -- sha256(KICC 마스킹 번호)
ALTER TABLE billing_keys ADD COLUMN IF NOT EXISTS last4 varchar(4);
ALTER TABLE billing_keys ADD COLUMN IF NOT EXISTS brand varchar(40);
ALTER TABLE billing_keys ADD COLUMN IF NOT EXISTS removed_at timestamp;
CREATE INDEX IF NOT EXISTS billing_keys_fp_idx ON billing_keys (card_fp) WHERE card_fp IS NOT NULL;

-- ── invoices: 부가세 별도(§12.0) · 환불 누계 · 재시도 ─────────────────────────────────────────────
-- amount = 공급가(기존 의미 유지) · vat_krw · total_krw 를 따로 둔다(화면에 합쳐서 하나로 주지 않는다).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_krw integer NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_krw integer;                                    -- NULL = 옛 행(amount 만)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refunded_krw integer NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_no varchar(60);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS plan_key varchar(32);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS next_retry_at timestamp;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_doc_requested_at timestamp;                       -- 세금계산서/현금영수증 요청(실발급은 키 후)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

-- ── coin_orders: 부가세·결제 방식·실패 사유 ────────────────────────────────────────────────────
ALTER TABLE coin_orders ADD COLUMN IF NOT EXISTS vat_krw integer NOT NULL DEFAULT 0;
ALTER TABLE coin_orders ADD COLUMN IF NOT EXISTS total_krw integer;
ALTER TABLE coin_orders ADD COLUMN IF NOT EXISTS mode varchar(10);                                  -- oneclick | auth
ALTER TABLE coin_orders ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE coin_orders ADD COLUMN IF NOT EXISTS paid_at timestamp;
ALTER TABLE coin_orders ADD COLUMN IF NOT EXISTS refunded_at timestamp;
ALTER TABLE coin_orders ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS coin_orders_tenant_pack_idx ON coin_orders (tenant_id, pack_id, status);

-- ── coin_price_overrides: 코인 팩·단가표 DB 오버레이(운영센터 요금제 · 코드 기본값은 lib/coin-table.ts) ──
CREATE TABLE IF NOT EXISTS coin_price_overrides (
  key        varchar(40) PRIMARY KEY,             -- 'pack:pack_50k' | 'item:blog'
  kind       varchar(8) NOT NULL,                 -- pack | item
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- pack: { krw, coins, bonusPct, oncePerTenant, active } · item: { coins }
  active     boolean NOT NULL DEFAULT true,
  updated_by bigint,
  updated_at timestamp NOT NULL DEFAULT now()
);

-- ── consents: 약관 동의 기록(§19 · 계약 §3.2) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consents (
  id         bigserial PRIMARY KEY,
  tenant_id  bigint NOT NULL,
  user_id    bigint,
  kind       varchar(32) NOT NULL,                -- terms | privacy | paid_terms | sanction_notice | creds_storage | marketing
  version    varchar(20) NOT NULL,
  agreed_at  timestamp NOT NULL DEFAULT now(),
  ip         varchar(64),
  user_agent varchar(200)
);
CREATE INDEX IF NOT EXISTS consents_tenant_idx ON consents (tenant_id, kind, agreed_at);

-- ── tenants: readonly/suspended 시각 · 운영 메모 · 체험 지문 ──────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS readonly_at timestamp;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_at timestamp;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ops_note text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_fp varchar(64);                                  -- 체험을 쓴 카드 지문(재가입 남용 판정)
