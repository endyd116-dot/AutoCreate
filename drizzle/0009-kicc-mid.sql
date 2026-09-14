-- P1R4-B(fix/kicc-multi-mid) · KICC 이중 MID(인증/비인증) — 거래를 만든 MID 를 남긴다. 추가형·멱등(IF NOT EXISTS).
-- 🔴 파괴적 문장 0. 기존 행·칸을 바꾸지 않는다. 값이 NULL 인 옛 행 = 인증 MID(midOrDefault 폴백)라 단일 MID 환경 그대로 돈다.
-- 배경: KICC 는 **승인·취소·빌키 청구/삭제를 그 거래를 만든 MID 로만** 받는다(함께워크ON 실전 규칙).
--       그래서 승인·발급 시 실제 사용한 mallId 를 남기고, 취소·재청구는 저장된 값으로 한다(lib/kicc.ts midOrDefault·secretForMid).

ALTER TABLE invoices     ADD COLUMN IF NOT EXISTS pg_mid varchar(40);   -- 이 청구를 승인한 MID(구독·코인 영수증 공용)
ALTER TABLE coin_orders  ADD COLUMN IF NOT EXISTS pg_mid varchar(40);   -- 거래등록 시 MID — 콜백 승인이 같은 MID 를 써야 한다
ALTER TABLE billing_keys ADD COLUMN IF NOT EXISTS pg_mid varchar(40);   -- 빌키를 발급한 MID — 청구·삭제가 이 MID 로만 된다

-- ── 운영센터 전역 설정(키·값) — 테넌트 설정(tenants.settings)과 다른 축: 플랫폼 한 벌. ──
-- 첫 손님 = 결제 라인 정책 `payment` { keyinEnabled(기본 false) · keyinLabel? · keyinNotice? }(계약 §1.6 · lib/pay-route.ts 가 읽는다).
CREATE TABLE IF NOT EXISTS ops_settings (
  key        varchar(40) PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by bigint,                                   -- operators.id
  updated_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO ops_settings (key, value) VALUES ('payment', '{"keyinEnabled": false}'::jsonb) ON CONFLICT (key) DO NOTHING;
