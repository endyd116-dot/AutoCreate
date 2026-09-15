/**
 * db/schema.ts — Drizzle 정본(append-only · B 전용). DDL 짝 = drizzle/0001-init.sql
 * 규칙: timestamp = UTC(without tz) · jsonb 쓰기는 sql.json · tenant_id 전수 (CLAUDE.md §4.4~4.6)
 */
import {
  pgTable, bigserial, bigint, varchar, text, boolean, integer, timestamp, date, jsonb, numeric, index, uniqueIndex,
} from "drizzle-orm/pg-core";

/* === Phase 0 · 테넌시·권한 === */
export const tenants = pgTable("tenants", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  key:         varchar("key", { length: 40 }).notNull().unique(),
  name:        varchar("name", { length: 120 }).notNull(),
  planKey:     varchar("plan_key", { length: 32 }).notNull().default("trial"),
  status:      varchar("status", { length: 16 }).notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at"),
  settings:    jsonb("settings").notNull().default({}),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id:                 bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:           bigint("tenant_id", { mode: "number" }).notNull(),
  email:              varchar("email", { length: 160 }).notNull().unique(),
  passwordHash:       varchar("password_hash", { length: 100 }).notNull(),
  name:               varchar("name", { length: 80 }),
  role:               varchar("role", { length: 16 }).notNull().default("owner"),
  emailVerifiedAt:    timestamp("email_verified_at"),
  verifyNonce:        varchar("verify_nonce", { length: 64 }),
  resetNonce:         varchar("reset_nonce", { length: 64 }),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  failedLogins:       integer("failed_logins").notNull().default(0),
  lockedUntil:        timestamp("locked_until"),
  lastLoginAt:        timestamp("last_login_at"),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("users_tenant_idx").on(t.tenantId) }));

export const operators = pgTable("operators", {
  id:                 bigserial("id", { mode: "number" }).primaryKey(),
  email:              varchar("email", { length: 160 }).notNull().unique(),
  passwordHash:       varchar("password_hash", { length: 100 }),
  name:               varchar("name", { length: 80 }),
  role:               varchar("role", { length: 16 }).notNull().default("operator"),
  ssoSub:             varchar("sso_sub", { length: 64 }),
  active:             boolean("active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  failedLogins:       integer("failed_logins").notNull().default(0),
  lockedUntil:        timestamp("locked_until"),
  lastLoginAt:        timestamp("last_login_at"),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  subjectType: varchar("subject_type", { length: 10 }).notNull(),
  subjectId:   bigint("subject_id", { mode: "number" }).notNull(),
  tokenHash:   varchar("token_hash", { length: 80 }).notNull().unique(),
  expiresAt:   timestamp("expires_at").notNull(),
  revokedAt:   timestamp("revoked_at"),
  ua:          varchar("ua", { length: 200 }),
  ip:          varchar("ip", { length: 64 }),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ subjectIdx: index("refresh_tokens_subject_idx").on(t.subjectType, t.subjectId) }));

export const auditLogs = pgTable("audit_logs", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }),
  actorType: varchar("actor_type", { length: 10 }),
  actorId:   bigint("actor_id", { mode: "number" }),
  action:    varchar("action", { length: 64 }).notNull(),
  target:    varchar("target", { length: 160 }),
  detail:    jsonb("detail"),
  riskLevel: varchar("risk_level", { length: 10 }).notNull().default("low"),
  ip:        varchar("ip", { length: 64 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("audit_logs_tenant_idx").on(t.tenantId, t.createdAt) }));

/* === Phase 0 · 플랜·결제·코인 === */
export const plans = pgTable("plans", {
  key:         varchar("key", { length: 32 }).primaryKey(),
  name:        varchar("name", { length: 60 }).notNull(),
  priceMonth:  integer("price_month").notNull().default(0),
  priceYear:   integer("price_year").notNull().default(0),
  limits:      jsonb("limits").notNull().default({}),
  features:    jsonb("features").notNull().default({}),
  public:      boolean("public").notNull().default(true),
  recommended: boolean("recommended").notNull().default(false),
  sort:        integer("sort").notNull().default(0),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export const planPriceEvents = pgTable("plan_price_events", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  planKey:     varchar("plan_key", { length: 32 }).notNull(),
  before:      jsonb("before").notNull(),
  after:       jsonb("after").notNull(),
  notifiedAt:  timestamp("notified_at"),
  effectiveAt: timestamp("effective_at"),
  operatorId:  bigint("operator_id", { mode: "number" }),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number" }).notNull(),
  planKey:     varchar("plan_key", { length: 32 }).notNull(),
  status:      varchar("status", { length: 16 }).notNull().default("active"),
  cycle:       varchar("cycle", { length: 8 }).notNull().default("month"),
  periodStart: timestamp("period_start").notNull(),
  periodEnd:   timestamp("period_end").notNull(),
  cancelAt:    timestamp("cancel_at"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("subscriptions_tenant_idx").on(t.tenantId) }));

export const billingKeys = pgTable("billing_keys", {
  id:         bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:   bigint("tenant_id", { mode: "number" }).notNull(),
  billingKey: varchar("billing_key", { length: 120 }).notNull(),
  cardLabel:  varchar("card_label", { length: 60 }),
  active:     boolean("active").notNull().default(true),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});

export const invoices = pgTable("invoices", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  kind:      varchar("kind", { length: 12 }).notNull().default("subscription"),
  period:    varchar("period", { length: 60 }).notNull(),
  amount:    integer("amount").notNull(),
  status:    varchar("status", { length: 12 }).notNull().default("pending"),
  pgRef:     varchar("pg_ref", { length: 120 }),
  paidAt:    timestamp("paid_at"),
  detail:    jsonb("detail"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ uq: uniqueIndex("invoices_tenant_kind_period_key").on(t.tenantId, t.kind, t.period) }));

export const coinLedger = pgTable("coin_ledger", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  kind:      varchar("kind", { length: 16 }).notNull(),
  bucket:    varchar("bucket", { length: 12 }).notNull(),
  delta:     integer("delta").notNull(),
  item:      varchar("item", { length: 24 }),
  ref:       varchar("ref", { length: 120 }),
  reason:    varchar("reason", { length: 200 }),
  expiresAt: timestamp("expires_at"),
  actorId:   bigint("actor_id", { mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("coin_ledger_tenant_idx").on(t.tenantId, t.createdAt) }));

export const coinOrders = pgTable("coin_orders", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  packId:    varchar("pack_id", { length: 24 }).notNull(),
  krw:       integer("krw").notNull(),
  coins:     integer("coins").notNull(),
  status:    varchar("status", { length: 12 }).notNull().default("pending"),
  orderNo:   varchar("order_no", { length: 60 }).notNull().unique(),
  pgRef:     varchar("pg_ref", { length: 120 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const promotions = pgTable("promotions", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  kind:      varchar("kind", { length: 20 }).notNull(),
  name:      varchar("name", { length: 80 }).notNull(),
  config:    jsonb("config").notNull().default({}),
  startsAt:  timestamp("starts_at"),
  endsAt:    timestamp("ends_at"),
  active:    boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const coupons = pgTable("coupons", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  code:      varchar("code", { length: 40 }).notNull().unique(),
  kind:      varchar("kind", { length: 16 }).notNull(),
  value:     integer("value").notNull(),
  planKeys:  jsonb("plan_keys"),
  maxUses:   integer("max_uses"),
  used:      integer("used").notNull().default(0),
  startsAt:  timestamp("starts_at"),
  endsAt:    timestamp("ends_at"),
  active:    boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const couponRedemptions = pgTable("coupon_redemptions", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  couponId:  bigint("coupon_id", { mode: "number" }).notNull(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ uq: uniqueIndex("coupon_redemptions_coupon_id_tenant_id_key").on(t.couponId, t.tenantId) }));

/* === Phase 0 · 채널·계정 === */
export const channelRegistry = pgTable("channel_registry", {
  key:        varchar("key", { length: 24 }).primaryKey(),
  label:      varchar("label", { length: 40 }).notNull(),
  category:   varchar("category", { length: 10 }).notNull(),
  publishVia: varchar("publish_via", { length: 10 }).notNull(),
  status:     varchar("status", { length: 12 }).notNull().default("planned"),
  bestHours:  jsonb("best_hours").notNull().default([]),
  monetize:   jsonb("monetize").notNull().default([]),
  sort:       integer("sort").notNull().default(0),
});

export const personas = pgTable("personas", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  name:      varchar("name", { length: 60 }).notNull(),
  profile:   jsonb("profile").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const accountGroups = pgTable("account_groups", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  channel:   varchar("channel", { length: 24 }).notNull(),
  name:      varchar("name", { length: 60 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id:                bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:          bigint("tenant_id", { mode: "number" }).notNull(),
  channel:           varchar("channel", { length: 24 }).notNull(),
  handle:            varchar("handle", { length: 120 }).notNull(),
  displayName:       varchar("display_name", { length: 120 }),
  authMethod:        varchar("auth_method", { length: 16 }).notNull().default("session"),
  groupId:           bigint("group_id", { mode: "number" }),
  personaId:         bigint("persona_id", { mode: "number" }),
  status:            varchar("status", { length: 16 }).notNull().default("disconnected"),
  healthScore:       integer("health_score").notNull().default(100),
  lastErrorKind:     varchar("last_error_kind", { length: 32 }),
  lastPostAt:        timestamp("last_post_at"),
  postsToday:        integer("posts_today").notNull().default(0),
  dailyCap:          integer("daily_cap").notNull().default(2),
  minGapMin:         integer("min_gap_min").notNull().default(180),
  goldenHours:       jsonb("golden_hours"),
  browserProfileKey: varchar("browser_profile_key", { length: 64 }),
  proxyUrl:          varchar("proxy_url", { length: 200 }),
  monetize:          jsonb("monetize").notNull().default({}),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("accounts_tenant_idx").on(t.tenantId, t.channel),
  uq: uniqueIndex("accounts_tenant_id_channel_handle_key").on(t.tenantId, t.channel, t.handle),
}));

export const accountCreds = pgTable("account_creds", {
  id:         bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:   bigint("tenant_id", { mode: "number" }).notNull(),
  accountId:  bigint("account_id", { mode: "number" }).notNull(),
  kind:       varchar("kind", { length: 16 }).notNull(),
  enc:        text("enc").notNull(),
  expiresAt:  timestamp("expires_at"),
  verifiedAt: timestamp("verified_at"),
  purgedAt:   timestamp("purged_at"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ accountIdx: index("account_creds_account_idx").on(t.accountId) }));

export const emotionProfiles = pgTable("emotion_profiles", {
  key:       varchar("key", { length: 40 }).primaryKey(),
  channel:   varchar("channel", { length: 24 }).notNull(),
  label:     varchar("label", { length: 60 }).notNull(),
  contract:  jsonb("contract").notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* === Phase 0 · 소재·제작·편성·발행 === */
export const topics = pgTable("topics", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number" }).notNull(),
  title:       text("title").notNull(),
  angle:       text("angle"),
  normKey:     varchar("norm_key", { length: 160 }).notNull(),
  channelHint: varchar("channel_hint", { length: 24 }),
  source:      varchar("source", { length: 24 }),
  factors:     jsonb("factors").notNull().default({}),
  score:       numeric("score", { precision: 8, scale: 3 }).notNull().default("0"),
  status:      varchar("status", { length: 12 }).notNull().default("candidate"),
  usedAt:      timestamp("used_at"),
  expiresAt:   timestamp("expires_at"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ idx: index("topics_tenant_status_idx").on(t.tenantId, t.status, t.score) }));

export const cadenceRules = pgTable("cadence_rules", {
  id:            bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number" }).notNull(),
  channel:       varchar("channel", { length: 24 }).notNull(),
  kind:          varchar("kind", { length: 16 }).notNull().default("post"),
  accountMode:   varchar("account_mode", { length: 8 }).notNull().default("auto"),
  accountId:     bigint("account_id", { mode: "number" }),
  every:         varchar("every", { length: 8 }).notNull().default("week"),
  count:         integer("count").notNull().default(3),
  weekdays:      jsonb("weekdays"),
  preferredHour: integer("preferred_hour"),
  formatHint:    varchar("format_hint", { length: 24 }),
  active:        boolean("active").notNull().default(true),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
});

export const slots = pgTable("slots", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:       bigint("tenant_id", { mode: "number" }).notNull(),
  ruleId:         bigint("rule_id", { mode: "number" }),
  slotDate:       date("slot_date").notNull(),
  channel:        varchar("channel", { length: 24 }).notNull(),
  kind:           varchar("kind", { length: 16 }).notNull().default("post"),
  accountId:      bigint("account_id", { mode: "number" }),
  topicId:        bigint("topic_id", { mode: "number" }),
  briefId:        bigint("brief_id", { mode: "number" }),
  pieceId:        bigint("piece_id", { mode: "number" }),
  publishAt:      timestamp("publish_at"),
  reviewDeadline: timestamp("review_deadline"),
  status:         varchar("status", { length: 20 }).notNull().default("planned"),
  origin:         varchar("origin", { length: 8 }).notNull().default("auto"),
  note:           text("note"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  dateIdx: index("slots_tenant_date_idx").on(t.tenantId, t.slotDate),
  statusIdx: index("slots_status_idx").on(t.status, t.publishAt),
}));

export const briefs = pgTable("briefs", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  topicId:   bigint("topic_id", { mode: "number" }),
  goal:      varchar("goal", { length: 16 }),
  pieces:    jsonb("pieces").notNull().default([]),
  reasons:   jsonb("reasons").notNull().default([]),
  mode:      varchar("mode", { length: 10 }).notNull().default("auto"),
  status:    varchar("status", { length: 12 }).notNull().default("proposed"),
  coinCost:  integer("coin_cost").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pieces = pgTable("pieces", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number" }).notNull(),
  briefId:      bigint("brief_id", { mode: "number" }),
  slotId:       bigint("slot_id", { mode: "number" }),
  topicId:      bigint("topic_id", { mode: "number" }),
  accountId:    bigint("account_id", { mode: "number" }),
  channel:      varchar("channel", { length: 24 }).notNull(),
  kind:         varchar("kind", { length: 16 }).notNull().default("post"),
  format:       varchar("format", { length: 24 }),
  title:        text("title"),
  body:         text("body"),
  blocks:       jsonb("blocks"),
  meta:         jsonb("meta").notNull().default({}),
  status:       varchar("status", { length: 20 }).notNull().default("generating"),
  scheduledFor: timestamp("scheduled_for"),
  publishedAt:  timestamp("published_at"),
  externalUrl:  text("external_url"),
  channelRef:   varchar("channel_ref", { length: 160 }),
  gateReport:   jsonb("gate_report"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  statusIdx: index("pieces_tenant_status_idx").on(t.tenantId, t.status),
  schedIdx: index("pieces_sched_idx").on(t.status, t.scheduledFor),
}));

export const pieceAssets = pgTable("piece_assets", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  pieceId:   bigint("piece_id", { mode: "number" }).notNull(),
  kind:      varchar("kind", { length: 12 }).notNull(),
  r2Key:     varchar("r2_key", { length: 240 }).notNull(),
  caption:   text("caption"),
  meta:      jsonb("meta"),
  sort:      integer("sort").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const posts = pgTable("posts", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number" }).notNull(),
  pieceId:      bigint("piece_id", { mode: "number" }).notNull(),
  accountId:    bigint("account_id", { mode: "number" }),
  channel:      varchar("channel", { length: 24 }).notNull(),
  externalUrl:  text("external_url"),
  channelRef:   varchar("channel_ref", { length: 160 }),
  publishedVia: varchar("published_via", { length: 10 }),
  stats:        jsonb("stats").notNull().default({}),
  publishedAt:  timestamp("published_at").notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("posts_tenant_idx").on(t.tenantId, t.publishedAt) }));

/* === Phase 0 · 러너 === */
export const runnerDevices = pgTable("runner_devices", {
  id:         bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:   bigint("tenant_id", { mode: "number" }),
  name:       varchar("name", { length: 80 }).notNull(),
  tokenHash:  varchar("token_hash", { length: 80 }).notNull().unique(),
  kind:       varchar("kind", { length: 10 }).notNull().default("own"),
  lastSeenAt: timestamp("last_seen_at"),
  version:    varchar("version", { length: 20 }),
  status:     varchar("status", { length: 10 }).notNull().default("offline"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});

export const runnerJobs = pgTable("runner_jobs", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  kind:      varchar("kind", { length: 32 }).notNull(),
  accountId: bigint("account_id", { mode: "number" }),
  pieceId:   bigint("piece_id", { mode: "number" }),
  payload:   jsonb("payload").notNull().default({}),
  status:    varchar("status", { length: 12 }).notNull().default("queued"),
  priority:  integer("priority").notNull().default(50),
  claimedBy: bigint("claimed_by", { mode: "number" }),
  claimedAt: timestamp("claimed_at"),
  attempts:  integer("attempts").notNull().default(0),
  result:    jsonb("result"),
  errorKind: varchar("error_kind", { length: 32 }),
  dueAt:     timestamp("due_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({ queueIdx: index("runner_jobs_queue_idx").on(t.status, t.priority, t.dueAt) }));

/* === Phase 0 · 수익 === */
export const revenueSources = pgTable("revenue_sources", {
  id:         bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:   bigint("tenant_id", { mode: "number" }).notNull(),
  source:     varchar("source", { length: 24 }).notNull(),
  accountId:  bigint("account_id", { mode: "number" }),
  method:     varchar("method", { length: 8 }).notNull().default("api"),
  credEnc:    text("cred_enc"),
  status:     varchar("status", { length: 12 }).notNull().default("connected"),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});

export const revenueDaily = pgTable("revenue_daily", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  source:    varchar("source", { length: 24 }).notNull(),
  accountId: bigint("account_id", { mode: "number" }),
  pieceId:   bigint("piece_id", { mode: "number" }),
  day:       date("day").notNull(),
  amountKrw: integer("amount_krw").notNull().default(0),
  currency:  varchar("currency", { length: 3 }).notNull().default("KRW"),
  fxRate:    numeric("fx_rate", { precision: 10, scale: 4 }),
  freshness: varchar("freshness", { length: 8 }).notNull().default("api"),
  raw:       jsonb("raw"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ dayIdx: index("revenue_daily_tenant_day_idx").on(t.tenantId, t.day) }));

export const affiliateLinks = pgTable("affiliate_links", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  pieceId:   bigint("piece_id", { mode: "number" }),
  provider:  varchar("provider", { length: 16 }).notNull(),
  subId:     varchar("sub_id", { length: 80 }).notNull(),
  url:       text("url").notNull(),
  product:   jsonb("product"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* === Phase 0 · CS·공지·알림 === */
export const tickets = pgTable("tickets", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number" }),
  userId:       bigint("user_id", { mode: "number" }),
  channel:      varchar("channel", { length: 12 }).notNull().default("app"),
  subject:      varchar("subject", { length: 160 }).notNull(),
  status:       varchar("status", { length: 12 }).notNull().default("open"),
  priority:     varchar("priority", { length: 8 }).notNull().default("normal"),
  tags:         jsonb("tags").notNull().default([]),
  assigneeId:   bigint("assignee_id", { mode: "number" }),
  context:      jsonb("context"),
  satisfaction: integer("satisfaction"),
  resolvedAt:   timestamp("resolved_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});

export const ticketMessages = pgTable("ticket_messages", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  ticketId:    bigint("ticket_id", { mode: "number" }).notNull(),
  authorType:  varchar("author_type", { length: 10 }).notNull(),
  authorId:    bigint("author_id", { mode: "number" }),
  body:        text("body").notNull(),
  attachments: jsonb("attachments"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export const macros = pgTable("macros", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  title:     varchar("title", { length: 80 }).notNull(),
  body:      text("body").notNull(),
  tags:      jsonb("tags").notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const faqs = pgTable("faqs", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  question:  varchar("question", { length: 200 }).notNull(),
  answer:    text("answer").notNull(),
  category:  varchar("category", { length: 40 }),
  sort:      integer("sort").notNull().default(0),
  public:    boolean("public").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const notices = pgTable("notices", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  kind:      varchar("kind", { length: 12 }).notNull().default("info"),
  title:     varchar("title", { length: 160 }).notNull(),
  body:      text("body"),
  active:    boolean("active").notNull().default(true),
  startsAt:  timestamp("starts_at"),
  endsAt:    timestamp("ends_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  kind:      varchar("kind", { length: 32 }).notNull(),
  title:     varchar("title", { length: 160 }).notNull(),
  body:      text("body"),
  link:      varchar("link", { length: 200 }),
  readAt:    timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("notifications_tenant_idx").on(t.tenantId, t.readAt, t.createdAt) }));

/* === Phase 0 · AI === */
export const aiModelOverrides = pgTable("ai_model_overrides", {
  role:      varchar("role", { length: 32 }).primaryKey(),
  chain:     jsonb("chain").notNull(),
  canaryPct: integer("canary_pct").notNull().default(100),
  appliedBy: bigint("applied_by", { mode: "number" }),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
  note:      text("note"),
});

export const aiUsage = pgTable("ai_usage", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }),
  purpose:   varchar("purpose", { length: 40 }).notNull(),
  model:     varchar("model", { length: 60 }).notNull(),
  inTokens:  integer("in_tokens").notNull().default(0),
  outTokens: integer("out_tokens").notNull().default(0),
  costUsd:   numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  ref:       varchar("ref", { length: 120 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ dayIdx: index("ai_usage_tenant_day_idx").on(t.tenantId, t.createdAt) }));

/* === Phase 2 R3 · 수익(P1R3-B · 2026-09-14 · drizzle/0002-r3-revenue.sql 과 동시) ===
 *   append-only(CLAUDE §4.4). 위 Phase 0 정의(revenueDaily·revenueSources)는 그대로 두고, 이번 라운드가 더한 칸·인덱스만 여기에 적는다.
 *   실제 DDL 은 표현식 유니크(COALESCE(account_id,0)·COALESCE(piece_id,0))라 drizzle 선언으로 온전히 표현되지 않는다 — SQL 파일이 정본이다.
 */
export const revenueDailyR3 = {
  /** updated_at timestamp NOT NULL DEFAULT now() — UPSERT 갱신 시각(신선도 «마지막 수집» 표시의 근거). */
  updatedAt: "updated_at",
  /** revenue_daily_uniq_idx ON (tenant_id, source, COALESCE(account_id,0), COALESCE(piece_id,0), day) — 멱등 UPSERT 의 근거(lib/revenue/upsert.ts 와 짝). */
  uniqIdx: "revenue_daily_uniq_idx",
  /** revenue_daily_piece_idx ON (tenant_id, piece_id) WHERE piece_id IS NOT NULL — 글별 TOP 5. */
  pieceIdx: "revenue_daily_piece_idx",
} as const;
export const revenueSourcesR3 = {
  lastError: "last_error",              // text — 마지막 실패 사유(사람말)
  lastErrorKind: "last_error_kind",     // varchar(16) — not_configured|auth|rate_limit|provider|parse
  failCount: "fail_count",              // integer NOT NULL DEFAULT 0 — 연속 실패(3 이상이면 status=error)
  lastOkAt: "last_ok_at",               // timestamp — 마지막 성공 수집(«없음»을 0 으로 안 쓰는 대신 남기는 시각 · AC-9)
  errorNotifiedAt: "error_notified_at", // timestamp — 오류 알림 24h 중복 방지
  config: "config",                     // jsonb NOT NULL DEFAULT '{}' — 사이트 id·채널 id·머천트 id(비밀 아님 · 비밀은 cred_enc)
  updatedAt: "updated_at",
  /** revenue_sources_uniq_idx ON (tenant_id, source, COALESCE(account_id,0)) — 소스 행은 (테넌트,소스,계정)당 하나. */
  uniqIdx: "revenue_sources_uniq_idx",
  /** status varchar(12)→varchar(16)(drizzle/0003) — 'not_configured'(14자)가 안 들어갔다(2026-09-14 스모크 22001). Phase 0 선언은 그대로 두고 여기서 폭만 기록한다. */
  statusWidth: 16,
} as const;

/* === Phase 1 R4 · 결제·구독·운영센터(P1R4-B · 2026-09-14 · drizzle/0004-r4-billing.sql · 0005-r4-ops.sql 과 동시 · B2 의 0006-r4-ops2.sql 선언 포함) ===
 *   append-only(CLAUDE §4.4). Phase 0 정의(tenants·subscriptions·invoices·billing_keys·coin_orders·promotions·coupons·tickets…)는 그대로 두고, 이번 라운드가 더한 칸·표·인덱스만 여기에 적는다.
 *   부분 유니크(WHERE …)·표현식 인덱스는 drizzle 선언으로 온전히 표현되지 않는다 — SQL 파일이 정본이다.
 */
/** subscriptions = 결제 주기 «장부»(정본은 tenants.status/plan_key/trial_ends_at · 계약 §0.1). */
export const subscriptionsR4 = {
  nextBillingAt: "next_billing_at",           // timestamp — 다음 정기 청구(재시도 중엔 next_retry_at 과 같음)
  billingDay: "billing_day",                  // integer — 약정일 1~28
  pendingPlanKey: "pending_plan_key",         // varchar(32) — 다운그레이드·주기 변경 예약(다음 주기부터)
  pendingCycle: "pending_cycle",              // varchar(8)
  cancelAtPeriodEnd: "cancel_at_period_end",  // boolean NOT NULL DEFAULT false
  discountPct: "discount_pct",                // integer NOT NULL DEFAULT 0 — 쿠폰 월할인(%)
  discountUntil: "discount_until",            // timestamp
  priceLockedKrw: "price_locked_krw",         // integer — 가입 시점 가격 고정(가격 개정 게이트가 존중)
  billingKeyMissingAt: "billing_key_missing_at", // timestamp — 활성인데 카드 없음(3일 뒤 정지)
  failCount: "fail_count",                    // integer NOT NULL DEFAULT 0 — 연속 청구 실패(3회 → suspended)
  lastChargeAt: "last_charge_at",             // timestamp
  couponCode: "coupon_code",                  // varchar(40) — krw 쿠폰은 다음 청구 1회 차감 뒤 비운다
  updatedAt: "updated_at",
  /** subscriptions_tenant_uniq ON (tenant_id) — 테넌트당 장부 1행(UPSERT 근거). */
  tenantUniq: "subscriptions_tenant_uniq",
} as const;
export const billingKeysR4 = {
  cardFp: "card_fp",       // varchar(64) — sha256(KICC 마스킹 번호) · 체험 재가입 남용 판정(tenants.trial_fp 와 짝)
  last4: "last4",          // varchar(4)
  brand: "brand",          // varchar(40)
  removedAt: "removed_at", // timestamp — 삭제 = 행 유지 + removed_at(active=false)
  fpIdx: "billing_keys_fp_idx",   // ON (card_fp) WHERE card_fp IS NOT NULL
} as const;
export const invoicesR4 = {
  vatKrw: "vat_krw",                 // integer NOT NULL DEFAULT 0 — 부가세(§12.0 별도 · amount = 공급가)
  totalKrw: "total_krw",             // integer — 청구액(NULL = 옛 행 · amount+vat 로 읽는다)
  refundedKrw: "refunded_krw",       // integer NOT NULL DEFAULT 0 — 환불 누계(total 기준)
  orderNo: "order_no",               // varchar(60) — AC-SUB-… / AC-COIN-…
  planKey: "plan_key",               // varchar(32)
  attempts: "attempts",              // integer NOT NULL DEFAULT 0
  nextRetryAt: "next_retry_at",      // timestamp — dunning D+3/D+7
  lastError: "last_error",           // text
  taxDocRequestedAt: "tax_doc_requested_at", // timestamp — 세금계산서/현금영수증 요청(실발급은 KICC 키 뒤 · detail.taxDoc)
  updatedAt: "updated_at",
} as const;
export const coinOrdersR4 = {
  vatKrw: "vat_krw", totalKrw: "total_krw",
  mode: "mode",              // varchar(10) — oneclick | auth
  error: "error",            // text — 실패 사유
  paidAt: "paid_at", refundedAt: "refunded_at", updatedAt: "updated_at",
  tenantPackIdx: "coin_orders_tenant_pack_idx",   // ON (tenant_id, pack_id, status) — pack_trial 1회 판정
} as const;
/** 코인 팩·단가표 DB 오버레이(코드 기본값 lib/coin-table.ts 는 그대로 · lib/billing/packs.ts 가 60초 캐시로 읽는다). */
export const coinPriceOverrides = pgTable("coin_price_overrides", {
  key:       varchar("key", { length: 40 }).primaryKey(),        // "pack:pack_50k" | "item:blog"
  kind:      varchar("kind", { length: 8 }).notNull(),           // pack | item
  value:     jsonb("value").notNull().default({}),                // pack { krw, coins, bonusPct, oncePerTenant, active } · item { coins }
  active:    boolean("active").notNull().default(true),
  updatedBy: bigint("updated_by", { mode: "number" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
/** 약관 동의 기록(§19 · 계약 §3.2 · lib/billing/consents.ts). */
export const consents = pgTable("consents", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number" }).notNull(),
  userId:    bigint("user_id", { mode: "number" }),
  kind:      varchar("kind", { length: 32 }).notNull(),           // terms | privacy | paid_terms | automation_notice | sanction_notice | creds_storage | marketing
  version:   varchar("version", { length: 20 }).notNull(),
  agreedAt:  timestamp("agreed_at").notNull().defaultNow(),
  ip:        varchar("ip", { length: 64 }),
  userAgent: varchar("user_agent", { length: 200 }),
}, (t) => ({ tenantIdx: index("consents_tenant_idx").on(t.tenantId, t.kind, t.agreedAt) }));
export const tenantsR4 = {
  readonlyAt: "readonly_at",     // timestamp — 체험 종료 → readonly 전환 시각(status "readonly" · varchar(16) 폭 확인 AC-21)
  suspendedAt: "suspended_at",   // timestamp — 청구 3회 실패/카드 없음 정지
  opsNote: "ops_note",           // text — 운영 메모
  trialFp: "trial_fp",           // varchar(64) — 체험을 쓴 카드 지문(같은 지문의 다른 테넌트가 체험이면 trial_ends_at=NOW())
  /** status 어휘 확장: trial | active | past_due | readonly | suspended | cancelled | closed */
  statuses: ["trial", "active", "past_due", "readonly", "suspended", "cancelled", "closed"],
} as const;
/* ── 0005-r4-ops.sql ── */
export const ticketsR4 = {
  autoKey: "auto_key",             // varchar(80) — 시스템 티켓 멱등 키(billing_fail:{tid}:{period} · runner_fail:{tid}:{week} · account_suspended:{tid}:{week})
  source: "source",                // varchar(12) NOT NULL DEFAULT "user" — user|app|system|ops (channel 과 별개)
  slaDueAt: "sla_due_at",          // timestamp — 생성 + SLA_HOURS[priority]
  firstReplyAt: "first_reply_at",  // timestamp — 첫 운영 답변(internal 제외)
  lastMessageAt: "last_message_at",
  closedAt: "closed_at",
  autoKeyUniq: "tickets_auto_key_uniq",   // UNIQUE (tenant_id, auto_key) WHERE auto_key IS NOT NULL
  statusIdx: "tickets_status_idx",        // ON (status, priority, created_at)
} as const;
export const ticketMessagesR4 = { internal: "internal" } as const;            // boolean NOT NULL DEFAULT false — 운영 메모(고객에게 안 보임)
export const macrosR4 = { sort: "sort", active: "active" } as const;
export const promotionsR4 = {
  conditions: "conditions",  // jsonb NOT NULL DEFAULT "{}" — { planKeys?, signupAfter?, channels? }(응답 target)
  uses: "uses",              // integer NOT NULL DEFAULT 0 — 적용 횟수(성과 used)
  updatedAt: "updated_at",
  /** kind 어휘(계약 §2.4(2)): trial_days | bonus_coin | referral — config { days } · { pct, packIds?, firstChargeOnly? } · { coins } */
  kinds: ["trial_days", "bonus_coin", "referral"],
} as const;
export const couponsR4 = {
  conditions: "conditions", months: "months", name: "name", updatedAt: "updated_at",
  /** kind 어휘(계약 §2.4(2)): pct | krw */
  kinds: ["pct", "krw"],
} as const;
export const couponRedemptionsR4 = { orderNo: "order_no", convertedAt: "converted_at" } as const;   // 성과: 이 쿠폰으로 청구 성공한 시각
export const planPriceEventsR4 = {
  noticeText: "notice_text", status: "status",   // varchar(12) — scheduled | noticed | applied | cancelled
  appliedAt: "applied_at", notifiedCount: "notified_count",
} as const;

/* === Phase 1 R4 · 운영센터 뒷단(P1R4-B2 · 2026-09-14 · drizzle/0006-r4-ops2.sql 과 동시 · B2 가 보낸 선언을 B 가 그대로 붙임) ===
 *   append-only(CLAUDE §4.4). 새 테이블은 pgTable, 기존 테이블에 더한 칸은 *R4 const 로만(위 정의 안 건드림).
 */
export const canaryRuns = pgTable("canary_runs", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  day:       date("day").notNull(),                       // KST 날짜
  channel:   varchar("channel", { length: 24 }).notNull(),
  ok:        boolean("ok"),                                // NULL = 판정 불가(AC-9)
  step:      varchar("step", { length: 40 }),
  detail:    text("detail"),
  shotKey:   varchar("shot_key", { length: 80 }),
  ranAt:     timestamp("ran_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  dayIdx:  index("canary_runs_day_idx").on(t.day, t.channel),
  uniqIdx: uniqueIndex("canary_runs_uniq_idx").on(t.day, t.channel),   // 하루·채널당 1행(멱등 UPSERT + '__eval__' 잠금)
}));

export const aiSettings = pgTable("ai_settings", {
  id:         varchar("id", { length: 16 }).primaryKey().default("global"),
  updateMode: varchar("update_mode", { length: 8 }).notNull().default("manual"),   // manual|auto
  costCapKrw: integer("cost_cap_krw"),                     // (미사용) 원가상한 정본은 tenants.settings.aiCostCapKrwPerDay(lib/billing/ai-cost-cap.ts) · 메인 결정 6
  candidates: jsonb("candidates").notNull().default([]),   // model_watch 후보 + 실측 4종
  watchedAt:  timestamp("watched_at"),
  updatedBy:  bigint("updated_by", { mode: "number" }),
  updatedAt:  timestamp("updated_at").notNull().defaultNow(),
});

/** ai_model_overrides 가 R4 에 더한 칸(Phase 0 aiModelOverrides 는 그대로) — 후보 카나리·롤백. */
export const aiModelOverridesR4 = {
  candidate:   "candidate",     // jsonb — 카나리 중인 새 체인(resolveChain 이 canary_pct% 라우팅)
  candidateAt: "candidate_at",  // timestamp — 카나리 시작(24h 자동 승격 게이트)
  prevChain:   "prev_chain",    // jsonb — 롤백용 직전 체인
  updatedAt:   "updated_at",
} as const;

/** notices 가 R4 에 더한 칸(Phase 0 notices 는 그대로) — 대상 플랜·채널·작성자. */
export const noticesR4 = {
  plans:     "plans",       // jsonb NOT NULL DEFAULT '[]' — 대상 플랜([]=전체)
  channels:  "channels",    // jsonb NOT NULL DEFAULT '[]' — incident 대상 채널
  createdBy: "created_by",  // bigint — operators.id
  updatedAt: "updated_at",
} as const;

/* === Phase 3 R5 · 영상 축·쇼츠 공장(P1R5-B · 2026-09-15 · drizzle/0008-r5-video.sql 과 동시) ===
 *   append-only(CLAUDE §4.4). 새 표 2(shorts_templates·feature_flags) + posts.status 칸 1. creative_assets 류는 만들지 않는다(계약 §0 두 척추 금지).
 */
export const shortsTemplates = pgTable("shorts_templates", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }),                 // NULL = 내장 템플릿
  name: varchar("name", { length: 80 }).notNull(),
  sourceUrl: text("source_url"),
  structure: jsonb("structure").notNull().default([]),               // [string] 서사 단계
  hookType: varchar("hook_type", { length: 24 }),                    // curiosity_gap|contrast|question|number|confession
  style: jsonb("style").notNull().default({}),                       // { visual, palette, caption, pace }
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const featureFlags = pgTable("feature_flags", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  key: varchar("key", { length: 40 }).notNull(),                     // 'video' = 영상 kill switch(계약 §1.6)
  tenantId: bigint("tenant_id", { mode: "number" }),                 // NULL = 전역
  enabled: boolean("enabled").notNull().default(true),
  note: text("note"),
  updatedBy: bigint("updated_by", { mode: "number" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const runnerDevicesR5 = {
  /** caps jsonb NOT NULL DEFAULT '{}' — 러너 능력 신고(P1R5 §2.4 · B2 가 DDL 적용 · B 가 선언 · CLAUDE §4.4): { ffmpeg:boolean, ffmpegVersion?:string, chromium?:boolean }.
   *  false 면 서버가 `render.video` 잡을 그 기기에 주지 않고 화면에 «ffmpeg 없음» 칩을 띄운다(조용한 0건 금지). */
  caps: "caps",
} as const;
export const postsR5 = {
  /** status varchar(20) NOT NULL DEFAULT 'published' — published|uploaded_private|processing(계약 §0.1-6 · AC-4 정직 표기). */
  status: "status",
} as const;

/* === P1R4 fix · KICC 이중 MID(2026-09-14 · drizzle/0009-kicc-mid.sql 과 동시 · 계약 §1.6) ===
 *   append-only(CLAUDE §4.4). KICC 는 **승인·취소·빌키 청구/삭제를 그 거래를 만든 MID 로만** 받는다(함께워크ON 실전 규칙).
 *   그래서 실제 사용한 mallId 를 남기고 취소·재청구가 그 값을 되쓴다(lib/kicc.ts `midOrDefault`·`secretForMid`).
 *   NULL = 이 칸이 없던 때의 결제 → 인증 MID(`KICC_MALL_ID`) 로 폴백 · 단일 MID 환경에서도 그대로 돈다.
 */
export const kiccMidR4 = {
  invoices: "pg_mid",      // varchar(40) — 이 청구를 승인한 MID(구독·코인 영수증 공용)
  coinOrders: "pg_mid",    // varchar(40) — 거래등록 MID(콜백 승인이 같은 MID 를 써야 한다 · 콜백엔 세션이 없다)
  billingKeys: "pg_mid",   // varchar(40) — 빌키를 발급한 MID(청구·삭제가 이 MID 로만 된다)
  /** 빌키 주문번호가 라인을 말한다: `AC-BK-…`(인증) · `AC-BKK-…`(비인증) — 빌키 행은 승인 뒤에야 생기기 때문. */
  billingKeyOrderPrefixes: ["AC-BK-", "AC-BKK-"],
} as const;

/** 운영센터 전역 설정(플랫폼 한 벌 · tenants.settings 와 다른 축). 첫 손님 = `payment` { keyinEnabled, keyinLabel?, keyinNotice? }. */
export const opsSettings = pgTable("ops_settings", {
  key:       varchar("key", { length: 40 }).primaryKey(),
  value:     jsonb("value").notNull().default({}),
  updatedBy: bigint("updated_by", { mode: "number" }),   // operators.id
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* === Phase 1 R7 · 러너 배포·묶기(P1R7-B2 · 2026-09-15 · drizzle/0012-runner-dist.sql 과 동시 · CLAUDE §4.4 append-only) ===
 *   러너를 **받을 수 있게** 만들면서 «한 벌 사서 열 명이 복사» 를 막는 칸들.
 *   잡 자체는 토큰의 테넌트 것만 가므로 복사본이 남의 글을 올릴 수는 없다 — 여기서 막는 건 **한 구독을 여럿이 나눠 쓰는 것**이다.
 */
export const runnerDevicesR7 = {
  /** fingerprint varchar(64) — 호스트명+MAC 의 sha256(러너가 해시해서 보낸다 · **원본은 서버에 오지 않는다**).
   *  처음 온 값을 그대로 묶고(기존 기기는 NULL 이라 다음 하트비트에 묶인다), 그 뒤 다른 값이 오면 401 + 알림. */
  fingerprint: "fingerprint",
  fingerprintAt: "fingerprint_at",
  /** 다른 지문으로 온 마지막 시각·횟수 — «다른 PC 에서 켜졌어요» 알림과 운영 화면이 읽는다. */
  fpMismatchAt: "fp_mismatch_at",
  fpMismatchCount: "fp_mismatch_count",
} as const;

/* === Phase 1 R6 · 관리형 러너 신청(P1R6-B2 · drizzle/0011-r6-b2-managed-runner.sql 과 짝 · 2026-09-15 전수조사 §14 🟠 수리 — DDL 과 칸·형 1:1) ===
 *   append-only(CLAUDE §4.4). B2 가 DDL 만 내고 선언은 B 몫이었는데 빠져 있던 것.
 */
export const managedRunnerRequests = pgTable("managed_runner_requests", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number" }).notNull(),
  devices:     integer("devices").notNull().default(1),                      // 몇 대를 맡기고 싶은가
  status:      varchar("status", { length: 12 }).notNull().default("requested"),   // requested | active | rejected | cancelled
  planKey:     varchar("plan_key", { length: 24 }),                          // 신청 시점 플랜
  amountKrw:   integer("amount_krw").notNull().default(0),                   // 대당 공급가(부가세 별도) 스냅샷
  vatKrw:      integer("vat_krw").notNull().default(0),
  totalKrw:    integer("total_krw").notNull().default(0),                    // devices 반영 합계
  note:        text("note"),                                                 // 고객 요청사항 · 운영 메모
  requestedBy: bigint("requested_by", { mode: "number" }),                   // users.id
  decidedBy:   bigint("decided_by", { mode: "number" }),                     // operators.id
  decidedAt:   timestamp("decided_at"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("managed_runner_requests_tenant_idx").on(t.tenantId, t.status) }));

/* === Phase 1 R6 · B(추천인 · 세금계산서 · 회사 정보 · 코인 이전 · P1R6-B · 2026-09-15 · drizzle/0013-r6-referral-tax.sql 과 동시 · CLAUDE §4.4 append-only) ===
 *   계약 docs/active/2026-09-15-P1R6-contract.md §1.1~§1.4. 새 표 없음 — 전부 추가 칸 + ops_settings 행.
 */
export const tenantsR6 = {
  /** referral_code varchar(8) — 테넌트당 1개 · 대문자+숫자(혼동 글자 0/O/1/I 제외) · 부분 유니크(NULL 제외) · 처음 `GET /api/referral` 때 발급. */
  referralCode: "referral_code",
  referralCodeUniq: "tenants_referral_code_uniq",
  /** referred_by bigint — 가입 때 넣은 추천인 테넌트 id(1회 · 바꾸지 않는다). NULL = 추천 없이 가입. */
  referredBy: "referred_by",
  referredByIdx: "tenants_referred_by_idx",
  /** referral_rewarded_at — 피추천인 첫 유료 결제 성공으로 **양쪽** 보상이 나간 시각(멱등 근거는 coin_ledger ref `referral:{inviter}:{invitee}`). */
  referralRewardedAt: "referral_rewarded_at",
  /** referral_blocked_at · referral_block_reason(card_fp|email_alias|email_domain) — 남용 판정으로 보상을 막은 기록. 한 번 막히면 끝(다음 결제에 다시 안 준다). */
  referralBlockedAt: "referral_blocked_at",
  referralBlockReason: "referral_block_reason",
  /** settings.taxProfile { bizNo, bizName, email } — 세금계산서 «다음부터 자동» 프로필(§1.2 · 새 칸 대신 settings jsonb). */
  taxProfileKey: "taxProfile",
} as const;
export const invoicesR6 = {
  /** tax_status varchar(12) NOT NULL DEFAULT 'none' — none | requested | issued. 요청 시각은 R4 의 tax_doc_requested_at 을 그대로 쓴다. */
  taxStatus: "tax_status",
  taxIssuedAt: "tax_issued_at",
  /** tax_url varchar(300) — 발행된 문서 주소(운영센터가 «발행됨» 처리하며 넣는다). */
  taxUrl: "tax_url",
  /** tax_biz jsonb { bizNo, bizName, email } — 요청 시점의 사업자 정보 스냅샷(프로필이 나중에 바뀌어도 이 청구서는 그때 값). */
  taxBiz: "tax_biz",
} as const;
/** ops_settings 행 이름(§1.3) — `company` { name, ceo, bizNo, mailOrderNo, address, email, phone } · 영수증·약관 하단·세금계산서가 모두 이 한 출처를 읽는다. */
export const opsSettingsKeysR6 = { company: "company", payment: "payment" } as const;

/* === Phase 1 R7 · B(탈퇴·파기 · 플랜 게이트 · 자격 동의 · 내부 테스트 구분 · P1R7-B · 2026-09-15 · drizzle/0014-r7-close-internal.sql 과 동시 · CLAUDE §4.4 append-only) ===
 *   계약 docs/active/2026-09-15-P1R7-contract.md §3.1~§3.5. 새 표 0 — tenants 추가 칸 + plans.limits(jsonb) 안의 값뿐.
 */
export const tenantsR7 = {
  /** closed_at · close_reason · close_prev_status — 탈퇴 신청(POST /api/account-close). 상태는 readonly 로 내리고 **되돌릴 수 있게** 직전 상태를 적어 둔다. */
  closedAt: "closed_at",
  closeReason: "close_reason",
  closePrevStatus: "close_prev_status",
  /** purge_at = closed_at + 30일 · purged_at = 실제 파기(크론 `tenant.purge`). 둘 다 있으면 묘비(status 'purged'). */
  purgeAt: "purge_at",
  purgedAt: "purged_at",
  purgeDueIdx: "tenants_purge_due_idx",
  /** 파기해도 tenants 행은 남긴다(묘비) — invoices(전자상거래법 5년)가 tenant_id 를 가리키기 때문. 이름·키는 마스킹된다. */
  purgedStatus: "purged",
  /** is_internal — 우리 테스트/하니스 집. 운영 대시보드·고객 목록·AI 원가·수익·MRR 의 **기본 집계에서 빠진다**(토글로 보인다). */
  isInternal: "is_internal",
  isInternalIdx: "tenants_is_internal_idx",
  /** internal_manual_at — 운영자가 is_internal 을 손으로 지정한 시각. 있으면 자동 규칙(크론)이 건드리지 않는다(손이 이긴다). */
  internalManualAt: "internal_manual_at",
} as const;
/** plans.limits.channels — 이 요금제가 **새로 연결**할 수 있는 채널(없으면 제한 없음). Starter = 글 채널 + youtube_shorts · Pro/Agency = 전부.
 *  🔴 소급 금지: 이미 연결한 계정은 이 목록과 무관하게 그대로 쓴다(lib/plans.ts requireChannel 은 «새로 추가»에서만 부른다). */
export const planLimitsR7 = { channels: "channels" } as const;
