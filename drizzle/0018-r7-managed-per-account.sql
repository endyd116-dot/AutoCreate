-- 0017 · 관리형 러너를 «대당»에서 «계정당»으로(사장님 결정 4 · 계약 P1R7 §2.4) — B2 2026-09-15
--
-- 사장님 결정: **«관리형 = 기본 · 계정당 월요금 · 프록시 요금 포함»**.
-- 지금 표는 «몇 대를 맡기고 싶은가»(`devices`)로 되어 있는데, 고객이 세는 단위는 **대수가 아니라 계정 수**다.
-- («PC 두 대»는 우리 사정이고, 고객은 «내 블로그 계정 5개를 맡긴다»고 생각한다.)
--
-- 🔴 `devices` 칸을 **지우지 않는다** — 이미 들어온 신청 행의 뜻이 사라진다(소급 0).
--    새 칸 `accounts` 를 두고 앞으로는 그걸 쓴다. 옛 행은 `devices` 가 남아 있어 그대로 읽힌다.
-- 추가형 전용 · 멱등.

ALTER TABLE managed_runner_requests ADD COLUMN IF NOT EXISTS accounts int;
-- 옛 행은 «대수»를 그대로 계정 수로 본다(1대=1계정으로 신청한 것이 사실상 전부다 · 지금 신청 행 자체가 거의 없다).
UPDATE managed_runner_requests SET accounts = devices WHERE accounts IS NULL;

COMMENT ON COLUMN managed_runner_requests.accounts IS '맡길 **계정** 수(사장님 결정 4 · 계정당 월요금). devices 는 옛 칸(대수) — 새 코드는 accounts 를 쓴다.';
COMMENT ON COLUMN managed_runner_requests.amount_krw IS '**계정당** 공급가(부가세 별도) 스냅샷. 프록시 요금 포함가다.';
COMMENT ON COLUMN managed_runner_requests.total_krw IS 'accounts 반영 합계(부가세 포함).';
