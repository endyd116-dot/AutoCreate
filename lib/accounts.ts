/**
 * lib/accounts.ts — 계정 행 투영(AccountRow · 계약 §1 v1.1) + 채널 연결 방식 + 공용 조회. DESIGN §7.1.
 *   🔴 응답·로그 어디에도 자격 평문 0 — hasCreds(boolean)·monetize 불리언만. proxyUrl 은 호스트만.
 *   «삭제»는 소프트: status disconnected + last_error_kind 'removed'(자격 purged_at). 같은 핸들 재연결 시 그 행을 되살린다.
 *   🔎 출처: AC 신규(계약 P1R1-B3 · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { db } from "../db/index";
import { sql, type SQL } from "drizzle-orm";
import { utcDate } from "./db-util";
import { maskProxyUrl } from "./creds-crypto";
import { providerConfigured, providerMissing } from "./oauth-providers";
import { connectMethodOf as registryConnectMethodOf, isKnownChannel, TEXT_CHANNEL_KEYS, CHANNEL_KEYS, type ConnectMethod } from "./channel-registry";   // [P1R8 §5.2] 채널 «성질» 정본(순수 리프 · 순환 0)
import { videoChannelSpec } from "./writing-contracts";   // [P1R6 §2.3] 영상 채널 규격 정본(순수 표 · 순환 0)
import { warmupState, effectiveDailyCap, effectiveMinGapMin, warmupRisk } from "./warmup";   // [P1R7 §2.6] 워밍업 계산의 단일 출처
import { toCoinTier, type CoinTier } from "./coin-table";   // [R10-9] 계정 기본 등급(표는 coin-table 한 곳 · 순수 리프)

type Row = Record<string, unknown>;
export const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

/* [P1R8 §5.2] 🔴 채널의 «성질»은 이제 `lib/channel-registry.ts` 한 곳이다 — 여기 있던 세 벌(목록·연결 방식·글 채널)은
   그 표를 읽는 **얇은 래퍼**로 남긴다(이름·시그니처 그대로라 호출부 40여 곳 무회귀).
   왜 옮겼나: 채널 하나를 켜려면 네 파일을 맞춰야 했고, 빠뜨리면 조용히 틀린 값이 나왔다(그 파일 헤더에 실측 근거). */
export type { ConnectMethod } from "./channel-registry";
/* 🔴 [P1R8 §3.4] **표에서 파생한다** — 여기에 채널 이름을 다시 적지 않는다.
   종전엔 손으로 적은 열 개짜리 배열이었고, R8 에서 채널을 여섯 개 늘리자마자 이 목록만 **옛 열 개로 남았다**.
   이 배열은 `listChannels()` 의 폴백(레지스트리 표가 비었을 때)에 쓰이므로, 어긋나면 «DB 가 비면 새 채널이 사라지는»
   조용한 결함이 된다 — 정본이 둘이면 언젠가 갈라진다(이 파일이 §5.2 에서 이미 배운 것). */
export const ALL_CHANNELS = CHANNEL_KEYS;
export type ChannelKey = string;
export function isChannel(v: unknown): v is ChannelKey { return isKnownChannel(v); }

/** 연결 방식(계약 §0) — 정본은 `lib/channel-registry.ts CHANNELS`. */
export const connectMethodOf = registryConnectMethodOf;
/** 글 채널(이 라운드 생성 대상) — 표의 `axis: "text"` 에서 파생. */
export const TEXT_CHANNELS: ReadonlySet<string> = new Set(TEXT_CHANNEL_KEYS);

export interface AccountRow {
  id: number; channel: string; handle: string; displayName: string | null;
  /** [P1R8 §5.3] 프로필 사진(https) — **없으면 null**. 예전엔 타입부터 `null` 로 굳어 있어 값이 들어갈 자리가 없었다(전수조사 ④7). */
  avatar: string | null;
  status: string;
  healthScore: number; postsToday: number;
  /** 🔴 **유효** 하루 상한 — 워밍업 중이면 낮아진 값이다(게이트는 이걸 본다). */
  dailyCap: number;
  /** 고객이 정한 원래 상한(워밍업 중일 때만 실린다) — 화면이 «원래 2건인데 지금은 1건»을 말할 수 있게. */
  dailyCapBase?: number;
  minGapMin: number;
  /** 워밍업 중일 때만(§2.6). 화면은 `label` 을 그대로 쓰면 된다. */
  /** [P1R7 §2.6 · R8 §9] 워밍업 중일 때만. 🔴 `blockedThisWeek`·`canOverride`·`risk` 는
      «막지 않고 말한다»를 화면이 그릴 재료다 — 워밍업은 **우리 추정**이지 규칙이 아니다(CLAUDE §9). */
  warmup?: {
    week: number; weeklyQuota: number | null; label: string; postsThisWeek: number;
    /** 이번 주 권장량을 다 썼다 — **자동 편성은 멈춘다**. */
    blockedThisWeek?: boolean;
    /** 🔴 고객이 «이번만 넘길래»를 누를 수 있나(끄는 게 아니라 **그 회차만**). */
    canOverride?: boolean;
    /** 넘길 때 보여 줄 위험 한 줄. */
    risk?: string;
  };
  goldenHours?: number[]; lastPostAt?: string; lastErrorKind?: string; groupId?: number;
  /** 🔴 `pending_login` 인데 **아직 한 번도 로그인한 적이 없다**(«풀린» 것이 아니라 «처음 붙인» 것). */
  neverLoggedIn?: true;
  /** [P1R8 §5.3] 묶음 **이름** — 화면이 id 만 받고 이름을 또 물으러 가지 않게 같이 싣는다(승계 단위 · §7.2). */
  groupName?: string;
  personaId?: number;
  proxyUrl?: string; browserProfileKey: string; hasCreds: boolean;
  monetize: { coupang: boolean; adpost: boolean; adsense: boolean };
  /** [R10-9] 🔴 계정 기본 코인 등급(simple|standard|premium). **null = 안 고름**(서버는 simple 로 만든다 — 오늘까지의 글값과 같아서 기본값이지 날조가 아니다 · AC-93). 화면은 null 을 «아직 안 골랐어요»로 그린다. */
  defaultTier: CoinTier | null;
  /** [R10-4] 계정에 걸어 둔 글 스타일(`text_styles.id`). null = 없음. */
  defaultStyleId: number | null;
}

/** SELECT 조각 — accounts a + 자격 존재 여부 서브쿼리. */
export const ACCOUNT_SELECT = sql`
  a.id, a.channel, a.handle, a.display_name, a.status, a.health_score, a.posts_today, a.daily_cap, a.min_gap_min, a.golden_hours,
  a.last_post_at, a.last_error_kind, a.group_id, a.persona_id, a.proxy_url, a.browser_profile_key, a.monetize, a.avatar_url,
  a.quality_tier, a.text_style_id,   /* [R10-9 · R10-4] 계정 기본 등급 · 계정에 걸어 둔 스타일(drizzle/0035) — 없으면 NULL(«안 고름») */
  (SELECT g.name FROM account_groups g WHERE g.id = a.group_id AND g.tenant_id = a.tenant_id) AS group_name,
  a.created_at, a.opened_at, a.warmup_off,
  /* 워밍업(§2.6)이 보는 «이번 주 몇 건 올렸나» — 주는 **KST 월요일 시작**이다(DESIGN §13.5 · UTC 로 세면 월요일 새벽이 지난주가 된다). */
  (SELECT COUNT(*) FROM posts p WHERE p.account_id = a.id
     AND (p.published_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
         >= (date_trunc('week', (NOW() AT TIME ZONE 'Asia/Seoul'))::date)) AS posts_this_week,
  EXISTS(SELECT 1 FROM account_creds c WHERE c.account_id = a.id AND c.purged_at IS NULL AND c.kind IN ('password','app_password','oauth','cookies')) AS has_creds,
  EXISTS(SELECT 1 FROM account_creds c WHERE c.account_id = a.id AND c.purged_at IS NULL AND c.kind = 'coupang') AS has_coupang`;

export function toAccountRow(r: Row): AccountRow {
  const mon = (r.monetize && typeof r.monetize === "object" ? r.monetize : {}) as Record<string, unknown>;
  const o: AccountRow = {
    id: Number(r.id), channel: String(r.channel), handle: String(r.handle), displayName: (r.display_name as string) ?? null,
    status: String(r.status), healthScore: Number(r.health_score ?? 100), postsToday: Number(r.posts_today ?? 0), dailyCap: Number(r.daily_cap ?? 2), minGapMin: Number(r.min_gap_min ?? 180),
    avatar: r.avatar_url ? String(r.avatar_url) : null,
    browserProfileKey: String(r.browser_profile_key || `t0-a${r.id}`), hasCreds: r.has_creds === true,
    monetize: { coupang: r.has_coupang === true, adpost: !!mon.adpostMediaId, adsense: !!mon.adsensePub },
    defaultTier: toCoinTier(r.quality_tier),            // 모르는 값·NULL → null(«안 고름»)
    defaultStyleId: Number(r.text_style_id) > 0 ? Number(r.text_style_id) : null,
  };
  /* 🔴 워밍업(§2.6) — **`dailyCap` 을 유효값으로 바꿔서 내보낸다.**
     캐던스를 보는 자리가 셋(director·director-auto·account-health)이라 게이트를 하나 더 만들면 넷이 된다.
     대신 **게이트가 읽는 값 자체**를 유효값으로 만들면 그 셋이 코드를 안 고쳐도 워밍업을 따른다.
     고객이 정한 원래 값은 `dailyCapBase` 로 함께 내보낸다 — 화면은 «원래 2건인데 지금은 1건»을 말할 수 있어야 한다. */
  const wIn = { openedAt: r.opened_at as string | null, createdAt: r.created_at as string | null,
    off: r.warmup_off === true, postsThisWeek: Number(r.posts_this_week ?? 0) };
  const w = warmupState(wIn);
  if (w.active) {
    o.dailyCapBase = o.dailyCap;
    o.dailyCap = effectiveDailyCap(o.dailyCap, wIn);
    o.minGapMin = effectiveMinGapMin(o.minGapMin, wIn);
    /* 🔴 화면이 «왜 지금 못 만드나»를 말할 수 있어야 한다(CLAUDE §9 — 막을 거면 이유를 보여 준다).
       `blockedThisWeek` = 이번 주 권장량을 다 썼다(자동 편성은 멈춘다) ·
       `canOverride` = 🔴 **고객이 «이번만 넘길래»를 누를 수 있다**(끄는 게 아니라 그 회차만) ·
       `risk` = 넘길 때 보여 줄 한 줄. 문구는 경우마다 다르다. */
    const blockedThisWeek = o.dailyCap === 0 && (o.dailyCapBase ?? 0) > 0;
    o.warmup = {
      week: w.week, weeklyQuota: w.weeklyQuota, label: w.label, postsThisWeek: wIn.postsThisWeek,
      blockedThisWeek,
      /* 고객이 daily_cap 을 0 으로 뒀으면 넘길 것이 없다 — 그건 우리 추정이 아니라 **고객의 뜻**이다. */
      canOverride: blockedThisWeek,
      risk: warmupRisk(wIn) ?? undefined,
    };
  }
  if (Array.isArray(r.golden_hours) && r.golden_hours.length) o.goldenHours = (r.golden_hours as unknown[]).map(Number).filter((n) => Number.isFinite(n));
  const lp = utcDate(r.last_post_at); if (lp) o.lastPostAt = lp.toISOString();
  if (r.last_error_kind) o.lastErrorKind = String(r.last_error_kind);
  /* 🔴 [2026-09-16] «**처음 붙였다**»와 «**로그인이 풀렸다**»는 `status` 가 **같은 값**(`pending_login`)이라 화면이 못 가른다.
     그래서 «아직 한 번도 로그인 안 함»을 서버가 **이름 붙여** 준다 — 화면이 `lastErrorKind` 유무로 **추측하게 두지 않는다**.
     근거: `pending_login` 을 만드는 길은 둘뿐이다 —
       · 처음 연결(`accounts.ts` 의 `upsertAccount(..., "pending_login")`) → `last_error_kind` **없음**
       · 로그인 실패·캡차(`applyAccountSignal`) → `last_error_kind` 를 **반드시 함께 적는다**
     🔴 이 문장이 사장님이 첫 발행 자리에서 읽으실 첫 줄이다 — «다시 로그인»이라고 하면 «언제 했다고?»가 된다. */
  if (String(r.status) === "pending_login" && !r.last_error_kind) o.neverLoggedIn = true;
  if (r.group_id) o.groupId = Number(r.group_id);
  if (r.group_name) o.groupName = String(r.group_name);
  if (r.persona_id) o.personaId = Number(r.persona_id);
  const px = maskProxyUrl(r.proxy_url as string); if (px) o.proxyUrl = px;
  return o;
}

/** 테넌트의 살아 있는 계정(삭제 표식 제외). */
export async function listAccounts(tid: number, channel?: string): Promise<AccountRow[]> {
  const rows = await q(sql`SELECT ${ACCOUNT_SELECT} FROM accounts a WHERE a.tenant_id = ${tid}
    AND COALESCE(a.last_error_kind,'') <> 'removed' ${channel ? sql`AND a.channel = ${channel}` : sql``} ORDER BY a.channel, a.id`);
  return rows.map(toAccountRow);
}
export async function getAccount(tid: number, id: number): Promise<AccountRow | null> {
  const rows = await q(sql`SELECT ${ACCOUNT_SELECT} FROM accounts a WHERE a.tenant_id = ${tid} AND a.id = ${id} LIMIT 1`);
  return rows[0] ? toAccountRow(rows[0]) : null;
}

export interface ChannelInfo {
  key: string; label: string; category: string; publishVia: string; status: string; connectMethod: ConnectMethod; configured: boolean;
  /**
   * [P1R7 B3] **지금 이 채널에 계정을 붙일 수 있나** — 화면은 이 한 칸만 보면 된다(`status`·`configured` 를 화면이 조합하지 않는다).
   *   🔴 «레지스트리가 켜졌다»와 «붙일 수 있다»는 다르다: 라이브 `blogger` 는 `status='active'` 인데 `GOOGLE_OAUTH_CLIENT_ID` 가 없어
   *      그리드에 떠 있고 **눌러도 안 붙는다**(2026-09-15 실측 · AC-52 «말과 실제가 다름»). 그 상태를 서버가 사유와 함께 말한다.
   *   `reason`: `not_open`(레지스트리가 아직 planned/down) · `no_provider_key`(켜졌는데 우리 앱 키가 없다 — 우리가 할 일) ·
   *             `no_site_url`(SITE_URL 미설정 — 콜백 주소를 못 만든다).
   */
  connectable: boolean;
  connectableReason?: "not_open" | "no_provider_key" | "no_site_url";
  /** [P1R6 §2.3] 영상 채널이면 규격 — 🔴 **화면이 숫자를 갖지 않는다**(«클립은 30초까지» 를 화면에 적지 않는다).
   *  `maxSeconds` = 채널 상한(naver_clip 30 · 나머지 60 · 릴스 90 은 Phase 5) · `formats[].maxSeconds` = 채널·포맷 상한 중 작은 쪽.
   *  정본은 `lib/writing-contracts.ts VIDEO_CHANNEL_MAX_SEC`·`VIDEO_FORMAT_MAX_SEC` 한 곳. */
  video?: { maxSeconds: 15 | 30 | 60; formats: { key: string; label: string; maxSeconds: 15 | 30 | 60 }[] };
}
/** channel_registry + 연결 방식 + 앱 키 존재. 레지스트리가 비어 있으면 코드 목록으로. */
export async function listChannels(): Promise<ChannelInfo[]> {
  let rows: Row[] = [];
  try { rows = await q(sql`SELECT key, label, category, publish_via, status FROM channel_registry ORDER BY sort, key`); } catch { rows = []; }
  if (!rows.length) rows = ALL_CHANNELS.map((k) => ({ key: k, label: k, category: /shorts|clip|reels|tiktok/.test(k) ? "video" : "text", publish_via: connectMethodOf(k) === "session" ? "runner" : "api", status: "planned" }));
  return rows.map((r) => {
    const key = String(r.key);
    const video = videoChannelSpec(key);
    const status = String(r.status);
    /* [P1R7 B3] 붙일 수 있나 = 레지스트리가 열렸고(active) **우리 앱 키까지** 있을 때. 둘 중 하나라도 아니면 사유를 싣는다. */
    const missing = providerMissing(key);
    const open = status === "active";
    const connectable = open && !missing;
    const reason: ChannelInfo["connectableReason"] = !open ? "not_open" : (missing ?? undefined);
    return { key, label: String(r.label), category: String(r.category), publishVia: String(r.publish_via), status,
      connectMethod: connectMethodOf(key), configured: providerConfigured(key), connectable,
      ...(reason ? { connectableReason: reason } : {}), ...(video ? { video } : {}) };
  });
}
