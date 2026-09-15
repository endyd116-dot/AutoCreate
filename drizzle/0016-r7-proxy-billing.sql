-- 0016 · 프록시 «얼마짜리인가»를 운영 화면이 말할 수 있게(계약 P1R7 §2.5 · 메인 요청 2026-09-15) — B2
--
-- 0015 는 «어디로 나가나»(url_enc·출구 IP·상태)까지만 담았다. 운영이 실제로 묻는 질문은 하나 더 있다:
-- «이 계정 IP 가 한 달에 얼마짜리냐.» 그걸 답하려면 **공급사·상품·과금 단위**가 필요하다 —
-- IP 과금(고정)과 GB 과금(쓴 만큼)은 원가 계산식 자체가 다르기 때문이다(B2 실측: 글 계정은 월 1GB 미만).
-- 추가형 전용 · 멱등.

ALTER TABLE proxies ADD COLUMN IF NOT EXISTS product varchar(60);
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS billing_unit varchar(8) NOT NULL DEFAULT 'ip';
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS unit_price_krw integer NOT NULL DEFAULT 0;
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS bandwidth_gb_month numeric(10,3);
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS sticky_guaranteed boolean NOT NULL DEFAULT false;
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS expires_at timestamp;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proxies_billing_unit_chk') THEN ALTER TABLE proxies ADD CONSTRAINT proxies_billing_unit_chk CHECK (billing_unit IN ('ip','gb')); END IF; END $$;

COMMENT ON COLUMN proxies.billing_unit IS 'ip = 월 고정(IP 당) · gb = 쓴 만큼. 원가 계산식이 갈리므로 반드시 채운다.';
COMMENT ON COLUMN proxies.unit_price_krw IS 'billing_unit 에 맞는 단가(ip = 월/IP · gb = 1GB). cost_krw_month 는 여기서 계산한 월 예상 원가.';
COMMENT ON COLUMN proxies.sticky_guaranteed IS '공급사가 같은 출구 IP 유지를 보장하나. 🔴 false 면 계정-IP 1:1 이 깨질 수 있어 GB 과금 상품을 쓰면 안 된다.';
