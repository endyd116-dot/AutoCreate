-- P1R6-B2 · 관리형 러너 «신청»(§3.1) — 추가형·멱등. scripts/neon-migrate.mjs 로 적용.
-- 🔴 파괴적 문장 0. schema.ts 선언은 B 몫(계약 §5 «db/schema.ts 는 B 만 · B2 는 SQL 만»).
-- ⚠️ 번호: R5 에서 0008 이 둘이었다(B2 caps · B-1 영상). 그 뒤 0009·0010 을 B 가 쓰므로 여기는 0011.

-- ── managed_runner_requests: «우리가 대신 돌려 주세요» 신청 ──
-- 🔴 실기기 프로비저닝은 이번 범위 밖이다(계약 §3.1). 그래서 이 표는 **신청서**지 기기가 아니다 —
--    기기는 `runner_devices(kind='managed')` 이고, 운영자가 «러너 팜»에서 수동으로 배정한다(ops-runner-assign).
--    그 둘을 한 표에 섞으면 «신청했는데 기기가 있는 것처럼» 보이는 화면이 나온다.
-- 가격은 **신청 시점 스냅샷**을 남긴다(플랜 요금이 나중에 바뀌어도 «그때 얼마로 신청했는지»가 증거로 남아야 한다).
CREATE TABLE IF NOT EXISTS managed_runner_requests (
  id           bigserial PRIMARY KEY,
  tenant_id    bigint NOT NULL REFERENCES tenants(id),
  devices      int NOT NULL DEFAULT 1,              -- 몇 대를 맡기고 싶은가
  status       varchar(12) NOT NULL DEFAULT 'requested',  -- requested | active | rejected | cancelled
  plan_key     varchar(24),                         -- 신청 시점 플랜
  amount_krw   int NOT NULL DEFAULT 0,              -- 대당 공급가(부가세 별도) 스냅샷
  vat_krw      int NOT NULL DEFAULT 0,
  total_krw    int NOT NULL DEFAULT 0,              -- devices 반영 합계
  note         text,                                -- 고객 요청사항 · 운영 메모
  requested_by bigint,                              -- users.id
  decided_by   bigint,                              -- operators.id
  decided_at   timestamp,
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS managed_runner_requests_tenant_idx ON managed_runner_requests (tenant_id, status);
-- 테넌트당 **열린 신청은 하나**(중복 신청으로 운영 목록이 지저분해지지 않게). 닫힌 건은 여러 개 남아도 된다.
CREATE UNIQUE INDEX IF NOT EXISTS managed_runner_requests_open_idx
  ON managed_runner_requests (tenant_id) WHERE status = 'requested';
