-- AutoCreate 스키마 v1 (Phase 0 · 2026-09-14) — 추가형·멱등. 정본 짝 = db/schema.ts
-- 규칙: timestamp = UTC(without tz) · jsonb 쓰기는 sql.json · tenant_id 전수.

-- ═══ 테넌시·권한 ═══
CREATE TABLE IF NOT EXISTS tenants (
  id            bigserial PRIMARY KEY,
  key           varchar(40) NOT NULL UNIQUE,
  name          varchar(120) NOT NULL,
  plan_key      varchar(32) NOT NULL DEFAULT 'trial',
  status        varchar(16) NOT NULL DEFAULT 'trial',      -- trial|active|past_due|readonly|closed
  trial_ends_at timestamp,
  settings      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id                   bigserial PRIMARY KEY,
  tenant_id            bigint NOT NULL REFERENCES tenants(id),
  email                varchar(160) NOT NULL UNIQUE,
  password_hash        varchar(100) NOT NULL,
  name                 varchar(80),
  role                 varchar(16) NOT NULL DEFAULT 'owner',    -- owner|member
  email_verified_at    timestamp,
  verify_nonce         varchar(64),
  reset_nonce          varchar(64),
  must_change_password boolean NOT NULL DEFAULT false,
  failed_logins        int NOT NULL DEFAULT 0,
  locked_until         timestamp,
  last_login_at        timestamp,
  created_at           timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id);

CREATE TABLE IF NOT EXISTS operators (
  id                   bigserial PRIMARY KEY,
  email                varchar(160) NOT NULL UNIQUE,
  password_hash        varchar(100),
  name                 varchar(80),
  role                 varchar(16) NOT NULL DEFAULT 'operator',  -- super_admin|admin|operator
  sso_sub              varchar(64),
  active               boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  failed_logins        int NOT NULL DEFAULT 0,
  locked_until         timestamp,
  last_login_at        timestamp,
  created_at           timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           bigserial PRIMARY KEY,
  subject_type varchar(10) NOT NULL,          -- user|operator
  subject_id   bigint NOT NULL,
  token_hash   varchar(80) NOT NULL UNIQUE,
  expires_at   timestamp NOT NULL,
  revoked_at   timestamp,
  ua           varchar(200),
  ip           varchar(64),
  created_at   timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_subject_idx ON refresh_tokens(subject_type, subject_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint,
  actor_type  varchar(10),                    -- user|operator|system
  actor_id    bigint,
  action      varchar(64) NOT NULL,
  target      varchar(160),
  detail      jsonb,
  risk_level  varchar(10) NOT NULL DEFAULT 'low',
  ip          varchar(64),
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_idx ON audit_logs(tenant_id, created_at);

-- ═══ 플랜·결제·코인 ═══
CREATE TABLE IF NOT EXISTS plans (
  key          varchar(32) PRIMARY KEY,
  name         varchar(60) NOT NULL,
  price_month  int NOT NULL DEFAULT 0,
  price_year   int NOT NULL DEFAULT 0,
  limits       jsonb NOT NULL DEFAULT '{}',   -- maxAccounts·coinsIncluded·runnerDevices·teamSeats·horizonDays·maxRules
  features     jsonb NOT NULL DEFAULT '{}',   -- directorEdit·autoSchedule·failover·managedRunner·runnerRevenue
  public       boolean NOT NULL DEFAULT true,
  recommended  boolean NOT NULL DEFAULT false,
  sort         int NOT NULL DEFAULT 0,
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_price_events (
  id            bigserial PRIMARY KEY,
  plan_key      varchar(32) NOT NULL,
  before        jsonb NOT NULL,
  after         jsonb NOT NULL,
  notified_at   timestamp,
  effective_at  timestamp,
  operator_id   bigint,
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id             bigserial PRIMARY KEY,
  tenant_id      bigint NOT NULL REFERENCES tenants(id),
  plan_key       varchar(32) NOT NULL,
  status         varchar(16) NOT NULL DEFAULT 'active',  -- active|past_due|canceled
  cycle          varchar(8) NOT NULL DEFAULT 'month',    -- month|year
  period_start   timestamp NOT NULL,
  period_end     timestamp NOT NULL,
  cancel_at      timestamp,
  created_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_tenant_idx ON subscriptions(tenant_id);

CREATE TABLE IF NOT EXISTS billing_keys (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  billing_key varchar(120) NOT NULL,
  card_label  varchar(60),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  kind        varchar(12) NOT NULL DEFAULT 'subscription',  -- subscription|coin|setup
  period      varchar(20) NOT NULL,                          -- 'YYYY-MM' | 'COIN-<orderId>'
  amount      int NOT NULL,
  status      varchar(12) NOT NULL DEFAULT 'pending',        -- pending|paid|failed|refunded
  pg_ref      varchar(120),
  paid_at     timestamp,
  detail      jsonb,
  created_at  timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, period)
);

-- 코인 원장 — AM coin-ledger 계약 그대로(잔액 = 합산 · 음수 불가 · (tenant,kind,ref,bucket) 멱등)
CREATE TABLE IF NOT EXISTS coin_ledger (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  kind        varchar(16) NOT NULL,      -- grant|revoke|purchase|consume|monthly_grant|expire|quota
  bucket      varchar(12) NOT NULL,      -- included|purchased
  delta       int NOT NULL,
  item        varchar(24),
  ref         varchar(120),
  reason      varchar(200),
  expires_at  timestamp,
  actor_id    bigint,
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coin_ledger_idem ON coin_ledger(tenant_id, kind, ref, bucket) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS coin_ledger_tenant_idx ON coin_ledger(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS coin_orders (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  pack_id     varchar(24) NOT NULL,
  krw         int NOT NULL,
  coins       int NOT NULL,
  status      varchar(12) NOT NULL DEFAULT 'pending',  -- pending|paid|failed|refunded
  order_no    varchar(60) NOT NULL UNIQUE,
  pg_ref      varchar(120),
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotions (
  id          bigserial PRIMARY KEY,
  kind        varchar(20) NOT NULL,        -- trial_days|bonus_coins|plan_discount|referral
  name        varchar(80) NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}',
  starts_at   timestamp,
  ends_at     timestamp,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coupons (
  id            bigserial PRIMARY KEY,
  code          varchar(40) NOT NULL UNIQUE,
  kind          varchar(16) NOT NULL,       -- percent|krw|coins
  value         int NOT NULL,
  plan_keys     jsonb,
  max_uses      int,
  used          int NOT NULL DEFAULT 0,
  starts_at     timestamp,
  ends_at       timestamp,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id          bigserial PRIMARY KEY,
  coupon_id   bigint NOT NULL REFERENCES coupons(id),
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  created_at  timestamp NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, tenant_id)
);

-- ═══ 채널·계정 ═══
CREATE TABLE IF NOT EXISTS channel_registry (
  key          varchar(24) PRIMARY KEY,
  label        varchar(40) NOT NULL,
  category     varchar(10) NOT NULL,        -- text|video
  publish_via  varchar(10) NOT NULL,        -- api|runner|manual
  status       varchar(12) NOT NULL DEFAULT 'planned',  -- live|beta|planned|paused
  best_hours   jsonb NOT NULL DEFAULT '[]',
  monetize     jsonb NOT NULL DEFAULT '[]',
  sort         int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS personas (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  name        varchar(60) NOT NULL,
  profile     jsonb NOT NULL DEFAULT '{}',  -- 지역·가족·직업·말투·관심사·금지어·서명
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_groups (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  channel     varchar(24) NOT NULL,
  name        varchar(60) NOT NULL,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id                  bigserial PRIMARY KEY,
  tenant_id           bigint NOT NULL REFERENCES tenants(id),
  channel             varchar(24) NOT NULL,
  handle              varchar(120) NOT NULL,
  display_name        varchar(120),
  auth_method         varchar(16) NOT NULL DEFAULT 'session',   -- oauth|session|api_key|app_password
  group_id            bigint,
  persona_id          bigint,
  status              varchar(16) NOT NULL DEFAULT 'disconnected', -- active|cooldown|limited|suspended|disconnected|pending_login
  health_score        int NOT NULL DEFAULT 100,
  last_error_kind     varchar(32),
  last_post_at        timestamp,
  posts_today         int NOT NULL DEFAULT 0,
  daily_cap           int NOT NULL DEFAULT 2,
  min_gap_min         int NOT NULL DEFAULT 180,
  golden_hours        jsonb,
  browser_profile_key varchar(64),
  proxy_url           varchar(200),
  monetize            jsonb NOT NULL DEFAULT '{}',
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, handle)
);
CREATE INDEX IF NOT EXISTS accounts_tenant_idx ON accounts(tenant_id, channel);

CREATE TABLE IF NOT EXISTS account_creds (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  account_id  bigint NOT NULL REFERENCES accounts(id),
  kind        varchar(16) NOT NULL,        -- cookies|password|oauth|api_key
  enc         text NOT NULL,               -- AES-256-GCM(iv:tag:ct base64)
  expires_at  timestamp,
  verified_at timestamp,
  purged_at   timestamp,
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_creds_account_idx ON account_creds(account_id);

CREATE TABLE IF NOT EXISTS emotion_profiles (
  key         varchar(40) PRIMARY KEY,
  channel     varchar(24) NOT NULL,
  label       varchar(60) NOT NULL,
  contract    jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamp NOT NULL DEFAULT now()
);

-- ═══ 소재·제작·편성·발행 ═══
CREATE TABLE IF NOT EXISTS topics (
  id           bigserial PRIMARY KEY,
  tenant_id    bigint NOT NULL REFERENCES tenants(id),
  title        text NOT NULL,
  angle        text,
  norm_key     varchar(160) NOT NULL,
  channel_hint varchar(24),
  source       varchar(24),
  factors      jsonb NOT NULL DEFAULT '{}',   -- volume·growth·competition·intent·seasonal·performance
  score        numeric(8,3) NOT NULL DEFAULT 0,
  status       varchar(12) NOT NULL DEFAULT 'candidate',  -- candidate|picked|used|expired
  used_at      timestamp,
  expires_at   timestamp,
  created_at   timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS topics_tenant_status_idx ON topics(tenant_id, status, score);

CREATE TABLE IF NOT EXISTS cadence_rules (
  id             bigserial PRIMARY KEY,
  tenant_id      bigint NOT NULL REFERENCES tenants(id),
  channel        varchar(24) NOT NULL,
  kind           varchar(16) NOT NULL DEFAULT 'post',   -- post|shorts|cardnews
  account_mode   varchar(8) NOT NULL DEFAULT 'auto',    -- auto|fixed
  account_id     bigint,
  every          varchar(8) NOT NULL DEFAULT 'week',    -- day|week|month
  count          int NOT NULL DEFAULT 3,
  weekdays       jsonb,
  preferred_hour int,
  format_hint    varchar(24),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slots (
  id              bigserial PRIMARY KEY,
  tenant_id       bigint NOT NULL REFERENCES tenants(id),
  rule_id         bigint,
  slot_date       date NOT NULL,
  channel         varchar(24) NOT NULL,
  kind            varchar(16) NOT NULL DEFAULT 'post',
  account_id      bigint,
  topic_id        bigint,
  brief_id        bigint,
  piece_id        bigint,
  publish_at      timestamp,
  review_deadline timestamp,
  status          varchar(20) NOT NULL DEFAULT 'planned', -- planned|topic_assigned|producing|in_review|approved|scheduled|publishing|published|awaiting_manual|awaiting_runner|reassigned|skipped|failed|coin_short|no_topic
  origin          varchar(8) NOT NULL DEFAULT 'auto',     -- auto|manual
  note            text,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slots_tenant_date_idx ON slots(tenant_id, slot_date);
CREATE INDEX IF NOT EXISTS slots_status_idx ON slots(status, publish_at);

CREATE TABLE IF NOT EXISTS briefs (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  topic_id    bigint,
  goal        varchar(16),
  pieces      jsonb NOT NULL DEFAULT '[]',
  reasons     jsonb NOT NULL DEFAULT '[]',
  mode        varchar(10) NOT NULL DEFAULT 'auto',       -- auto|reviewed
  status      varchar(12) NOT NULL DEFAULT 'proposed',   -- proposed|confirmed|producing|done
  coin_cost   int NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pieces (
  id            bigserial PRIMARY KEY,
  tenant_id     bigint NOT NULL REFERENCES tenants(id),
  brief_id      bigint,
  slot_id       bigint,
  topic_id      bigint,
  account_id    bigint,
  channel       varchar(24) NOT NULL,
  kind          varchar(16) NOT NULL DEFAULT 'post',
  format        varchar(24),
  title         text,
  body          text,                          -- HTML(글) / 대본 JSON(영상)
  blocks        jsonb,                         -- 구성 템플릿 블록 시퀀스
  meta          jsonb NOT NULL DEFAULT '{}',   -- tags·seo·disclosure·affiliate·coinItem
  status        varchar(20) NOT NULL DEFAULT 'generating', -- generating|draft|in_review|approved|scheduled|publishing|published|awaiting_manual|failed|rejected
  scheduled_for timestamp,
  published_at  timestamp,
  external_url  text,
  channel_ref   varchar(160),
  gate_report   jsonb,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pieces_tenant_status_idx ON pieces(tenant_id, status);
CREATE INDEX IF NOT EXISTS pieces_sched_idx ON pieces(status, scheduled_for);

CREATE TABLE IF NOT EXISTS piece_assets (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  piece_id    bigint NOT NULL REFERENCES pieces(id),
  kind        varchar(12) NOT NULL,          -- image|video|thumb|audio
  r2_key      varchar(240) NOT NULL,
  caption     text,
  meta        jsonb,
  sort        int NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id           bigserial PRIMARY KEY,
  tenant_id    bigint NOT NULL REFERENCES tenants(id),
  piece_id     bigint NOT NULL,
  account_id   bigint,
  channel      varchar(24) NOT NULL,
  external_url text,
  channel_ref  varchar(160),
  published_via varchar(10),                 -- api|runner|manual
  stats        jsonb NOT NULL DEFAULT '{}',   -- views·likes·comments·lastSyncAt
  published_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_tenant_idx ON posts(tenant_id, published_at);

-- ═══ 러너 ═══
CREATE TABLE IF NOT EXISTS runner_devices (
  id            bigserial PRIMARY KEY,
  tenant_id     bigint REFERENCES tenants(id),        -- null = 관리형 러너 팜
  name          varchar(80) NOT NULL,
  token_hash    varchar(80) NOT NULL UNIQUE,
  kind          varchar(10) NOT NULL DEFAULT 'own',   -- own|managed
  last_seen_at  timestamp,
  version       varchar(20),
  status        varchar(10) NOT NULL DEFAULT 'offline',
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runner_jobs (
  id            bigserial PRIMARY KEY,
  tenant_id     bigint NOT NULL REFERENCES tenants(id),
  kind          varchar(32) NOT NULL,        -- publish.naver_blog|render.video|session.login|revenue.adpost|...
  account_id    bigint,
  piece_id      bigint,
  payload       jsonb NOT NULL DEFAULT '{}',
  status        varchar(12) NOT NULL DEFAULT 'queued',  -- queued|claimed|done|failed|released
  priority      int NOT NULL DEFAULT 50,
  claimed_by    bigint,
  claimed_at    timestamp,
  attempts      int NOT NULL DEFAULT 0,
  result        jsonb,
  error_kind    varchar(32),
  due_at        timestamp,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runner_jobs_queue_idx ON runner_jobs(status, priority, due_at);

-- ═══ 수익 ═══
CREATE TABLE IF NOT EXISTS revenue_sources (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  source      varchar(24) NOT NULL,          -- adsense|adpost|adfit|youtube|clip|coupang|ali|linkprice|manual
  account_id  bigint,
  method      varchar(8) NOT NULL DEFAULT 'api',  -- api|runner|manual
  cred_enc    text,
  status      varchar(12) NOT NULL DEFAULT 'connected',
  last_sync_at timestamp,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS revenue_daily (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  source      varchar(24) NOT NULL,
  account_id  bigint,
  piece_id    bigint,
  day         date NOT NULL,
  amount_krw  int NOT NULL DEFAULT 0,
  currency    varchar(3) NOT NULL DEFAULT 'KRW',
  fx_rate     numeric(10,4),
  freshness   varchar(8) NOT NULL DEFAULT 'api',  -- api|runner|manual
  raw         jsonb,
  created_at  timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source, account_id, piece_id, day)
);
CREATE INDEX IF NOT EXISTS revenue_daily_tenant_day_idx ON revenue_daily(tenant_id, day);

CREATE TABLE IF NOT EXISTS affiliate_links (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  piece_id    bigint,
  provider    varchar(16) NOT NULL,
  sub_id      varchar(80) NOT NULL,
  url         text NOT NULL,
  product     jsonb,
  created_at  timestamp NOT NULL DEFAULT now()
);

-- ═══ CS·공지·알림 ═══
CREATE TABLE IF NOT EXISTS tickets (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint REFERENCES tenants(id),
  user_id     bigint,
  channel     varchar(12) NOT NULL DEFAULT 'app',   -- app|email|kakao|system
  subject     varchar(160) NOT NULL,
  status      varchar(12) NOT NULL DEFAULT 'open',  -- open|progress|hold|resolved
  priority    varchar(8) NOT NULL DEFAULT 'normal',
  tags        jsonb NOT NULL DEFAULT '[]',
  assignee_id bigint,
  context     jsonb,                                -- 플랜·러너 상태·최근 오류 자동 첨부
  satisfaction int,
  resolved_at timestamp,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id          bigserial PRIMARY KEY,
  ticket_id   bigint NOT NULL REFERENCES tickets(id),
  author_type varchar(10) NOT NULL,     -- user|operator|system
  author_id   bigint,
  body        text NOT NULL,
  attachments jsonb,
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS macros (
  id          bigserial PRIMARY KEY,
  title       varchar(80) NOT NULL,
  body        text NOT NULL,
  tags        jsonb NOT NULL DEFAULT '[]',
  updated_at  timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS faqs (
  id          bigserial PRIMARY KEY,
  question    varchar(200) NOT NULL,
  answer      text NOT NULL,
  category    varchar(40),
  sort        int NOT NULL DEFAULT 0,
  public      boolean NOT NULL DEFAULT true,
  updated_at  timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notices (
  id          bigserial PRIMARY KEY,
  kind        varchar(12) NOT NULL DEFAULT 'info',   -- info|incident
  title       varchar(160) NOT NULL,
  body        text,
  active      boolean NOT NULL DEFAULT true,
  starts_at   timestamp,
  ends_at     timestamp,
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id),
  kind        varchar(32) NOT NULL,
  title       varchar(160) NOT NULL,
  body        text,
  link        varchar(200),
  read_at     timestamp,
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_tenant_idx ON notifications(tenant_id, read_at, created_at);

-- ═══ AI ═══
CREATE TABLE IF NOT EXISTS ai_model_overrides (
  role        varchar(32) PRIMARY KEY,      -- high|low|director|image|tts|...
  chain       jsonb NOT NULL,
  canary_pct  int NOT NULL DEFAULT 100,
  applied_by  bigint,
  applied_at  timestamp NOT NULL DEFAULT now(),
  note        text
);
CREATE TABLE IF NOT EXISTS ai_usage (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint,
  purpose     varchar(40) NOT NULL,
  model       varchar(60) NOT NULL,
  in_tokens   int NOT NULL DEFAULT 0,
  out_tokens  int NOT NULL DEFAULT 0,
  cost_usd    numeric(10,6) NOT NULL DEFAULT 0,
  ref         varchar(120),
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_tenant_day_idx ON ai_usage(tenant_id, created_at);
