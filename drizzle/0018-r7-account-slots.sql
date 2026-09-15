-- P1R7-B §3.6 · «계정 1개 + 전용 IP» 를 코인으로 산다(사장님 지시 2026-09-15) — 추가형·멱등.
--   상품값(24코인·50코인)은 코드 한 곳(lib/plans.ts ACCOUNT_SLOT_PRODUCTS · 원가 근거 docs/active/2026-09-15-proxy-cost.md).
--   🔴 **30일권 + 자동 갱신**: IP 가 월 과금이라 «한 번 사면 끝»으로 팔면 매달 손해다. 갱신은 크론 `slot.renew`.
--   🔴 **없는 걸 팔지 않는다**: 재고(proxies 풀)가 없으면 `waiting_ip` 로 두고 **코인은 배정되는 날 차감**한다.
CREATE TABLE IF NOT EXISTS account_slots (
  id               bigserial PRIMARY KEY,
  tenant_id        bigint NOT NULL REFERENCES tenants(id),
  kind             varchar(24) NOT NULL,                       -- account_slot | account_slot_managed
  status           varchar(16) NOT NULL DEFAULT 'waiting_ip',  -- waiting_ip(IP 대기·미차감) | active | paused(코인 부족 · 그 계정만 쉼) | cancelled
  coins_per_period integer NOT NULL,                           -- 구매 시점 가격 스냅샷(코인/30일) — 값이 바뀌어도 쓰던 사람 요금은 그대로
  account_id       bigint REFERENCES accounts(id),             -- 이 슬롯으로 늘린 계정(사용자가 계정을 만들면 붙는다)
  proxy_id         bigint REFERENCES proxies(id),              -- 배정된 전용 IP(B2 §2.5 풀에서)
  auto_renew       boolean NOT NULL DEFAULT true,              -- 끄면 만료일에 그냥 끝난다(환불 없음 · 구매 시트에 미리 적는다)
  started_at       timestamp,                                  -- 첫 차감(=개시) 시각 · waiting_ip 동안은 NULL
  expires_at       timestamp,                                  -- 이 시각까지 유효(30일권) · waiting_ip 동안은 NULL
  last_charged_at  timestamp,
  paused_at        timestamp,                                  -- 코인 부족으로 쉰 시각
  cancelled_at     timestamp,
  note             text,
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_slots_tenant_idx ON account_slots(tenant_id, status);
CREATE INDEX IF NOT EXISTS account_slots_due_idx ON account_slots(expires_at) WHERE status IN ('active','paused');
-- 한 계정에 슬롯 하나 · 한 IP 에 슬롯 하나(연좌제 방지 = B2 accounts_proxy_uniq 와 같은 규율)
CREATE UNIQUE INDEX IF NOT EXISTS account_slots_account_uniq ON account_slots(account_id) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_slots_proxy_uniq ON account_slots(proxy_id) WHERE proxy_id IS NOT NULL;

-- ── 기간 카운터(2026-09-15 스모크에서 잡은 구멍 2개의 최종 수리) ──
--   멱등 키를 «달(YYYYMM)» 로 하면 31일 달의 1일 구매가 같은 달 31일 갱신과 겹쳐 **한 달치를 공짜로** 준다.
--   «날짜(YYYYMMDD)» 로 해도 같은 날 안에서 개시·복구가 겹치면 이미 받은 키를 다시 만나 **안 받고 재개**된다.
--   그래서 기간에 **번호**를 붙인다: ref = `slot:{id}:{periods_charged+1}` — 기간마다 유일하고, 재시도는 같은 번호라 멱등이다.
ALTER TABLE account_slots ADD COLUMN IF NOT EXISTS periods_charged integer NOT NULL DEFAULT 0;
