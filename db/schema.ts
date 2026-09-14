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
  period:    varchar("period", { length: 20 }).notNull(),
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
