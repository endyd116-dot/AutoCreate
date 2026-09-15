-- P1R7 · 웹푸시 구독(메인 발주 2026-09-15 · A 는 화면·sw.js 를 이미 만들어 뒀고 서버만 없었다) — 추가형·멱등.
--   🔴 구독은 «기기» 단위다(한 사람이 폰·노트북 각각 구독). endpoint 가 그 기기의 주소 = 유일 키.
--   🔴 죽은 구독(410/404)은 **지운다** — 안 지우면 매번 실패하는 곳에 영원히 쏜다.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         bigserial PRIMARY KEY,
  tenant_id  bigint NOT NULL REFERENCES tenants(id),
  user_id    bigint REFERENCES users(id),
  endpoint   text NOT NULL,
  p256dh     varchar(200) NOT NULL,          -- 구독 공개키(브라우저가 준다)
  auth       varchar(100) NOT NULL,          -- 구독 인증 비밀(브라우저가 준다)
  user_agent varchar(200),
  last_sent_at timestamp,
  fail_count integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uniq ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS push_subscriptions_tenant_idx ON push_subscriptions(tenant_id);

-- 알림함 1행 = 푸시 1번(두 번 쏘지 않는다). NULL = 아직 안 쐈다 · 값 = 쏜 시각.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_at timestamp;
CREATE INDEX IF NOT EXISTS notifications_push_pending_idx ON notifications (created_at) WHERE pushed_at IS NULL;
