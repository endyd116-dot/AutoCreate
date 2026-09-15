-- P1R8-B · 침해 통지 대응(DESIGN §5E.2 · 사장님 질문 2026-09-15) — 추가형·멱등.
--   🔴 우리가 만드는 것은 **(가) 우리 안에서 내리기**뿐이다: 재발행 차단 · 예약 중지 · 기한 통지 · 단계 정지.
--      «우리가 고객 동의 없이 남의 플랫폼 글을 내리기»(③)는 **만들지 않는다**(DESIGN §5E.1 · 되돌릴 수 없고 통지는 틀린 것도 온다).
--   고객이 «대신 내려 줘»를 누르면 B2 의 `publish.retract` 잡을 부른다(잡은 B2 몫 · 우리는 부르기만).
CREATE TABLE IF NOT EXISTS takedown_notices (
  id             bigserial PRIMARY KEY,
  tenant_id      bigint NOT NULL REFERENCES tenants(id),
  piece_id       bigint REFERENCES pieces(id),      -- 어느 글인가(없을 수도 있다 — 주소만 온 통지)
  post_id        bigint REFERENCES posts(id),       -- 그 글의 발행 행
  account_id     bigint REFERENCES accounts(id),
  channel        varchar(24),
  external_url   varchar(500),                      -- 통지가 가리키는 주소
  kind           varchar(16) NOT NULL DEFAULT 'copyright',  -- copyright | defamation | privacy | policy | other
  claimant       varchar(160),                      -- 통지한 쪽(회사·이름)
  evidence       text,                              -- 근거(링크·설명) — 운영자가 적는다
  reason         text,                              -- 🔴 고객에게 보이는 **사람말 사유**(«침해 통지»만 쓰면 뭘 해야 할지 모른다)
  content_hash   varchar(64),                       -- 원문 해시(같은 글 재생성·재발행 차단 기준)
  received_by    bigint,                            -- operators.id
  received_at    timestamp NOT NULL DEFAULT now(),
  due_at         timestamp NOT NULL,                -- 고객 기한(기본 +7일)
  -- open(접수) → customer_removed(고객이 내림) | retracted(대신 내림) | disconnected(계정 해제) | suspended(서비스 정지) | dismissed(통지 기각) | resolved
  status         varchar(16) NOT NULL DEFAULT 'open',
  disconnected_at timestamp,
  suspended_at   timestamp,
  resolved_at    timestamp,
  resolved_by    bigint,
  resolution     text,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS takedown_tenant_idx ON takedown_notices(tenant_id, status);
CREATE INDEX IF NOT EXISTS takedown_due_idx ON takedown_notices(due_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS takedown_piece_idx ON takedown_notices(piece_id) WHERE piece_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS takedown_hash_idx ON takedown_notices(content_hash) WHERE content_hash IS NOT NULL;

-- 발행 원장은 **지우지 않는다** — 내려간 사실만 적는다(수익 귀속·감사가 남아야 한다 · DESIGN §5E.3).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS retracted_at timestamp;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS retract_reason varchar(200);
