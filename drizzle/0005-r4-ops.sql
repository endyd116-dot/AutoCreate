-- P1R4-B · 운영센터(CS·이벤트·요금제 개정 · 계약 §2.1 · DESIGN §11.4) — 추가형·멱등.
-- Phase 0 에 tickets/ticket_messages/macros/faqs/promotions/coupons/coupon_redemptions/plan_price_events 표는 이미 있다 — 칸만 더한다.

-- ── tickets: 자동 티켓 멱등 키 · SLA · 출처 ──────────────────────────────────────────────────────
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS auto_key varchar(80);                                  -- 시스템 티켓 중복 방지(같은 사유 1건)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source varchar(12) NOT NULL DEFAULT 'user';            -- user | system | ops
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_due_at timestamp;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_reply_at timestamp;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_message_at timestamp;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_at timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS tickets_auto_key_uniq ON tickets (tenant_id, auto_key) WHERE auto_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (status, priority, created_at);
ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false;      -- 운영 메모(고객에게 안 보임)
ALTER TABLE macros ADD COLUMN IF NOT EXISTS sort integer NOT NULL DEFAULT 0;
ALTER TABLE macros ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- ── promotions / coupons: 대상 조건 · 성과 ──────────────────────────────────────────────────────
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '{}'::jsonb;    -- { signedUpAfter?, planKeys?, channels? }
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS uses integer NOT NULL DEFAULT 0;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS months integer;                                        -- 월할인 적용 개월(NULL = 1회)
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS name varchar(80);
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
ALTER TABLE coupon_redemptions ADD COLUMN IF NOT EXISTS order_no varchar(60);
ALTER TABLE coupon_redemptions ADD COLUMN IF NOT EXISTS converted_at timestamp;                     -- 성과: 이 쿠폰으로 유료 전환한 시각

-- ── plan_price_events: 가격 개정 게이트(고지 → effective_at 이후 첫 청구부터) ─────────────────────
ALTER TABLE plan_price_events ADD COLUMN IF NOT EXISTS notice_text text;
ALTER TABLE plan_price_events ADD COLUMN IF NOT EXISTS status varchar(12) NOT NULL DEFAULT 'scheduled';  -- scheduled | noticed | applied | cancelled  (계약 §2.4(3) 어휘 · quotePlan 은 noticed/applied 만 본다)
ALTER TABLE plan_price_events ADD COLUMN IF NOT EXISTS applied_at timestamp;
ALTER TABLE plan_price_events ADD COLUMN IF NOT EXISTS notified_count integer NOT NULL DEFAULT 0;
