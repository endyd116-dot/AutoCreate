-- 0015 · 계정 하나 = IP 하나(계약 P1R7 §2.5 · 사장님 지시 2026-09-15) — B2
--
-- 사장님 말씀: «한 IP 에서 여러 계정을 굴리다 하나 정지되면 그 IP 를 쓴 계정이 **연좌제처럼 다 죽는다.**»
-- 지금까지는 `accounts.proxy_url` 칸 하나에 사람이 손으로 주소를 적는 것이 전부였고,
-- ①주소가 깨지면 러너가 **조용히 프록시 없이** 나갔고 ②**실제로 어느 IP 로 나갔는지 아무도 몰랐다.**
-- 코드 쪽 ①②는 같은 커밋에서 막았고, 이 DDL 은 그걸 **관리할 수 있게** 만든다.
--
-- 🔴 접속 주소(`url_enc`)는 **계정 자격과 같은 취급**이다 — AES-256-GCM 암호문만 저장하고 평문 칸을 두지 않는다.
--    프록시 주소에는 보통 아이디·비밀번호가 들어 있다(user:pass@host). 평문으로 두면 그게 곧 열쇠다.
-- 🔴 추가형 전용(IF NOT EXISTS · 멱등). 기존 `accounts.proxy_url` 은 **지우지 않는다** —
--    쓰던 계정이 그대로 돌아야 한다(소급 0). 새 배정은 `proxy_id` 를 쓰고, 러너에 내려보낼 때 둘 중 있는 것을 쓴다.

CREATE TABLE IF NOT EXISTS proxies (
  id             bigserial PRIMARY KEY,
  tenant_id      bigint REFERENCES tenants(id),        -- NULL = 우리(관리형) 풀 · 값 있으면 그 고객이 넣은 것
  label          varchar(60) NOT NULL,                 -- 사람이 알아볼 이름(«주거-KR-1»)
  provider       varchar(40),                          -- 공급사(원가표와 맞춘다)
  kind           varchar(16) NOT NULL DEFAULT 'residential',  -- residential|mobile|datacenter
  region         varchar(24),                          -- 'KR' 등
  url_enc        text NOT NULL,                        -- 🔴 AES-256-GCM 암호문(평문 칸 없음)
  sticky_key     varchar(80),                          -- 같은 출구 IP 를 유지하기 위한 세션 키(공급사 규격)
  status         varchar(12) NOT NULL DEFAULT 'active',-- active|down|expired
  last_check_at  timestamp,
  last_exit_ip   varchar(45),                          -- 마지막으로 확인된 출구 IP(IPv6 까지 45자)
  cost_krw_month integer NOT NULL DEFAULT 0,           -- 월 원가(관리형 요금 산정의 입력)
  note           text,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proxies_tenant_idx ON proxies(tenant_id, status);

-- 계정 ↔ 프록시 = 1:1. 🔴 유일 제약이 이 설계의 전부다 — 두 계정이 한 프록시를 쓰면 그게 곧 연좌제다.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS proxy_id bigint REFERENCES proxies(id);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_proxy_uniq ON accounts(proxy_id) WHERE proxy_id IS NOT NULL;

-- 실제로 나간 IP(러너가 잡마다 확인해 보고한다) — «프록시를 걸었다»가 아니라 «그 IP 로 나갔다»의 증거.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_exit_ip varchar(45);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_exit_ip_at timestamp;

COMMENT ON TABLE  proxies IS '계정별 출구 IP. url_enc 는 계정 자격과 같은 취급(암호문만).';
COMMENT ON COLUMN accounts.proxy_id IS '이 계정이 쓰는 프록시(1:1 · 유일 제약). NULL 이면 직결(소급 0).';
COMMENT ON COLUMN accounts.last_exit_ip IS '러너가 잡 시작 때 실제로 확인한 출구 IP. 기대값과 다르면 발행을 멈춘다.';
