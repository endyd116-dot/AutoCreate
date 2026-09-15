-- 0029-r8-piece-outcomes.sql — [R8 §5F · B-1 2026-09-15] 되먹임 원장 ① «모으기»(추가형 · 멱등)
--   🔴 왜 지금: **지난 글의 «어떻게 썼나»는 나중에 복원할 수 없다.** 발행 0건이어도 자리를 먼저 만든다.
--      원장이 없으면 반년 뒤 «왜 저 글이 잘 됐나»에 답할 재료 자체가 없다.
--   🔴 성과는 **여기에 복사하지 않는다** — 조회는 `posts.stats`, 수익은 `revenue_daily.piece_id` 에 이미 있다.
--      두 곳에 같은 상태를 쓰면 반드시 갈라진다(계약 §10). 읽을 때 join 한다.
--   칸 셋: `features`(만들 때의 모습) · `risks`(나갈 때의 게이트 결과 · §9 로 막지 않게 되면서 생긴 값) · 묶음 키(channel·origin).

CREATE TABLE IF NOT EXISTS piece_outcomes (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint      NOT NULL,
  piece_id    bigint      NOT NULL UNIQUE,          -- 글 하나에 한 행(다시 만들면 갱신)
  channel     varchar(24) NOT NULL,
  account_id  bigint,
  origin      varchar(8)  NOT NULL DEFAULT 'auto',  -- auto · manual · self ← 사람 글과 AI 글을 가르는 칸
  features    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  risks       jsonb,
  created_at  timestamp   NOT NULL DEFAULT NOW(),
  updated_at  timestamp   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS piece_outcomes_tenant_idx  ON piece_outcomes (tenant_id, id DESC);
CREATE INDEX IF NOT EXISTS piece_outcomes_origin_idx  ON piece_outcomes (origin, channel);
-- 특징으로 묶어 세는 질의(집계 되먹임 ②가 쓸 자리) — 표현식 색인 둘만 미리.
CREATE INDEX IF NOT EXISTS piece_outcomes_group_idx   ON piece_outcomes ((features->>'topicGroup'));
CREATE INDEX IF NOT EXISTS piece_outcomes_goal_idx    ON piece_outcomes ((features->>'goal'));
