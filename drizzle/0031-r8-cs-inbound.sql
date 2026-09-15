-- 0031 · CS 바깥 유입(이메일·카카오) — 계약 P1R8-B §4.3 · DESIGN §11.4 «앱 내 문의·이메일·카카오 채널 유입을 한 목록으로»
--
-- 지금 상태: `tickets.channel` 에 'email'|'kakao' 칸은 **있는데 그 길로 들어올 문이 없다.**
--   · 앱 «문의하기» → `support.ts` ✅
--   · 운영자가 손으로 만들기 → `ops-ticket-create` ✅
--   · 🔴 **고객이 우리 답변 메일에 답장하면 그건 어디에도 안 남는다** — 대표 메일함에서 끝난다.
--     설계가 «한 목록»이라 적어 둔 그 목록에 **바깥에서 온 것만 빠져 있었다.**
--
-- 이 DDL 이 더하는 것 넷 — 전부 추가형·멱등.
--   ① `tickets.external_ref`   = 바깥 대화의 실타래 id(메일 스레드·카카오 방). 같은 실타래는 **한 티켓에 이어 붙인다.**
--   ② `tickets.from_email`·`from_name` = 🔴 **우리 고객이 아닌 사람도 버리지 않는다.** 테넌트를 못 찾으면 tenant_id 를 비우고
--      보낸 사람만 적어 둔다(운영자가 나중에 «이 집 사람이네» 하고 붙인다). 버리면 그 사람은 답을 영영 못 받는다.
--   ③ `ticket_messages.external_id` = 🔴 **멱등의 전부.** 메일·카카오 웹훅은 **같은 것을 여러 번 보낸다**(재시도가 규격이다).
--      이 칸의 유일 제약이 없으면 고객 문의 한 통이 티켓에 세 번 붙는다.
--   ④ `ticket_messages.source`  = 그 말이 어디로 들어왔나(app|email|kakao|ops). 한 티켓 안에 길이 섞일 수 있다
--      (앱으로 물어보고 메일로 답장하는 사람이 있다). 섞인 채로 **순서대로** 보여 주려면 줄마다 출처가 있어야 한다.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_ref varchar(190);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS from_email   varchar(190);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS from_name    varchar(120);

ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS external_id varchar(190);
ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS source      varchar(10);

-- 🔴 같은 바깥 메시지를 두 번 적지 않는다. NULL(앱·운영 경로)은 제약 밖이라 종전 행은 그대로다(소급 0).
CREATE UNIQUE INDEX IF NOT EXISTS ticket_messages_external_uniq ON ticket_messages(external_id) WHERE external_id IS NOT NULL;
-- 실타래로 티켓 찾기(열린 것부터).
CREATE INDEX IF NOT EXISTS tickets_external_ref_idx ON tickets(external_ref) WHERE external_ref IS NOT NULL;
-- «주인 없는 문의»를 운영자가 한 눈에(테넌트 미확인 + 열림).
CREATE INDEX IF NOT EXISTS tickets_unclaimed_idx ON tickets(status, created_at) WHERE tenant_id IS NULL;

COMMENT ON COLUMN tickets.external_ref IS '바깥 대화의 실타래 id(메일 스레드·카카오 방). 같은 값이면 같은 티켓에 이어 붙인다.';
COMMENT ON COLUMN tickets.from_email IS '테넌트를 못 찾은 유입의 보낸 사람. 🔴 못 찾았다고 버리지 않는다 — 운영자가 나중에 테넌트를 붙인다.';
COMMENT ON COLUMN ticket_messages.external_id IS '공급사 메시지 id. 웹훅 재시도가 규격이라 이 유일 제약이 멱등의 전부다.';
COMMENT ON COLUMN ticket_messages.source IS '그 말이 들어온 길(app|email|kakao|ops). 한 티켓 안에 길이 섞일 수 있어 줄마다 적는다.';
