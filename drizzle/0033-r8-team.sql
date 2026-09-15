-- 0033 · 팀 시트(팀원 초대·역할) — 계약 P1R8-B §4.5 «팀 축 4행» · DESIGN §11 «팀 시트: 소유자가 «팀원 초대»(이메일 링크) → 같은 테넌트 member»
--
-- 지금 상태: `plans.limits.teamSeats`(1/2/5) 가 **선언만 돼 있고**, `checkLimit(tid,"teamSeats")` 도 세고는 있는데
--   🔴 **팀원을 늘릴 길이 없다.** 한 집에 사람은 늘 한 명이고, `users.role`(owner|member)은 **아무 데서도 안 쓰인다.**
--   ⇒ «Agency 는 팀 시트 5개»가 요금표에만 있고 **기능이 없는 상태**였다(팔고 있는데 못 쓰는 줄).
--
-- ① team_invites — 소유자가 보낸 초대. 🔴 **토큰은 해시로만 저장한다**(비밀번호와 같은 취급).
--    표에 평문이 있으면 DB 를 보는 사람이 남의 집에 들어갈 수 있다. 메일로 나간 원문은 우리도 다시 못 본다.
-- ② 🔴 같은 이메일로 **살아 있는 초대는 하나**(부분 유니크) — 두 번 눌러 두 통이 가면 둘 다 살아서 자리를 두 개 먹는다.
-- ③ users.invited_by — 누가 데려왔나(감사·«마지막 소유자»를 못 지우게 하는 판정에는 안 쓴다 · 기록용).
CREATE TABLE IF NOT EXISTS team_invites (
  id           bigserial PRIMARY KEY,
  tenant_id    bigint NOT NULL REFERENCES tenants(id),
  email        varchar(160) NOT NULL,
  role         varchar(16) NOT NULL DEFAULT 'member',   -- 🔴 owner 는 초대로 만들지 않는다(양도는 따로)
  token_hash   varchar(64) NOT NULL,                    -- sha256 hex · 🔴 평문 없음
  invited_by   bigint,
  expires_at   timestamp NOT NULL,
  accepted_at  timestamp,
  accepted_uid bigint,
  revoked_at   timestamp,
  created_at   timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_invites_tenant_idx ON team_invites(tenant_id, accepted_at, revoked_at);
CREATE UNIQUE INDEX IF NOT EXISTS team_invites_token_uniq ON team_invites(token_hash);
-- 🔴 살아 있는 초대는 이메일당 하나. 끝난 것(수락·철회)은 이 제약 밖이라 다시 보낼 수 있다.
CREATE UNIQUE INDEX IF NOT EXISTS team_invites_pending_uniq ON team_invites(tenant_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by bigint;

COMMENT ON TABLE  team_invites IS '팀원 초대. 🔴 token_hash 는 sha256 만 — 평문은 메일로 한 번 나가고 우리도 다시 못 본다.';
COMMENT ON COLUMN team_invites.role IS 'member 만. 🔴 owner 는 초대로 만들지 않는다 — 집주인이 둘이면 «누가 정하나»가 사라진다.';
COMMENT ON COLUMN users.invited_by IS '누가 데려왔나(기록용). 권한 판정에는 쓰지 않는다.';
