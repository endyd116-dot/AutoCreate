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
import { connectMethodOf as registryConnectMethodOf, isKnownChannel, TEXT_CHANNEL_KEYS, CHANNEL_KEYS, axisOfChannel, channelMonetizable, maxPhotosOf, type ConnectMethod, type ChannelKindAxis } from "./channel-registry";   // [P1R8 §5.2] 채널 «성질» 정본(순수 리프 · 순환 0) · [R11-10 · R12-6] 축·수익 유무·사진 수
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
  /** [AC-201] 러너가 **실제로 본** 블로그 주소(`seen`)와 고객이 «맞다»고 한 주소(`confirmed`).
   *  🔴 **본 적이 없으면 키 자체가 없다**(«{}» 를 내보내면 화면이 빈 칸을 그린다 · AC-9).
   *  `matchesHandle` — `seen` 이 `handle` 과 같은가. `null` = 못 쟀다. */
  identity?: { seen?: string; confirmed?: string; matchesHandle: boolean | null };
  /** [P1R8 §5.3] 프로필 사진(https) — **없으면 null**. 예전엔 타입부터 `null` 로 굳어 있어 값이 들어갈 자리가 없었다(전수조사 ④7). */
  avatar: string | null;
  status: string;
  healthScore: number; postsToday: number;
  /**
   * 🔴 **보여 줄 값** — 지금 실제로 걸리는 하루 상한(워밍업 중이면 낮아진 값 · 게이트는 이걸 본다).
   * ⚠️ **이 값을 편집 칸에 미리 채우지 마라.** 아래 `dailyCapBase` 가 «고칠 값»이다.
   */
  dailyCap: number;
  /**
   * 🔴 **고칠 값** — 고객이 정한 원래 상한(`accounts.daily_cap` 그대로).
   *
   *   [2026-09-21 · B] 종전엔 **워밍업 중일 때만** 실렸다. 그래서 화면은 «있으면 쓰고 없으면 `dailyCap`» 으로 짤 수밖에 없었고,
   *   워밍업이 도는 동안 설정 시트를 **열었다 저장만 해도 고객 값이 워밍업 값으로 덮어써졌다.**
   *   🔴 실제로 메인이 그걸로 `min_gap` 180 → 360 을 부쉈다(계정 466 · 되돌렸다).
   *   ⇒ **언제나 싣는다.** 한 칸이 «보여 줄 값»과 «고칠 값»을 겸하면 언젠가 반드시 덮어쓴다.
   */
  dailyCapBase: number;
  /** 🔴 **보여 줄 값** — 지금 걸리는 글 간격(워밍업 중이면 늘어난 값). 편집 칸에 미리 채우지 마라. */
  minGapMin: number;
  /** 🔴 **고칠 값** — 고객이 정한 원래 간격(`accounts.min_gap_min` 그대로). 이 칸이 없어서 180 이 360 으로 덮어써졌다. */
  minGapBase: number;
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
  /** [R17 · §7.1] 계정 사진 — 🔴 `ACCOUNT_SELECT` 는 `avatar_url` 을 **읽고 있었는데** 응답에만 안 실렸다.
   *  그래서 화면을 만들어도 칸이 **늘 비어 보였을 것**이다(저장은 되는데 다시 열면 사라진다 · A 가 `openedAt` 에서 밟은 그 병). */
  avatarUrl?: string;
  personaId?: number;
  proxyUrl?: string; browserProfileKey: string; hasCreds: boolean;
  monetize: { coupang: boolean; adpost: boolean; adsense: boolean };
  /** [R10-9] 🔴 계정 기본 코인 등급(simple|standard|premium). **null = 안 고름**(서버는 simple 로 만든다 — 오늘까지의 글값과 같아서 기본값이지 날조가 아니다 · AC-93). 화면은 null 을 «아직 안 골랐어요»로 그린다. */
  defaultTier: CoinTier | null;
  /** [R10-4] 계정에 걸어 둔 글 스타일(`text_styles.id`). null = 없음. */
  defaultStyleId: number | null;
  /**
   * [R11-8 · 설계 R11 §4.4] 🔴 **이 계정의 독자** — 채널 계약(`contract.reader`)을 덮어쓴다.
   *   `null` = **안 골랐다** = 계약 값 그대로(지금과 똑같다). 화면은 비워 두고 «비우면 채널 기본 그대로예요»라고 말한다.
   *   🔴 «계약 값이 무엇인지»는 여기서 안 채운다 — 채우면 화면이 «고객이 고른 값»과 «기본값»을 구별하지 못한다(AC-92).
   */
  reader: string | null;
  /**
   * 🔴 [2026-09-21 · B] **이 계정을 만든 날**(`YYYY-MM-DD` · 모르면 `null`) — 고객이 알면 적는 값이다.
   *   워밍업이 «우리와 연결한 날»(`created_at`)보다 **먼저** 본다(`lib/warmup.ts:57`) — 3년 된 블로그를 어제 연결해도 1주차로 묶이지 않게.
   *   🔴 읽는 곳이 여섯인데 **쓰는 길이 0곳**이라 라이브 92계정이 전부 NULL 이었다(`verify-write-path-missing` 가 잡았다).
   *   «모른다»를 아무 날짜로 **바꾸지 않는다**(AC-92) — 비면 `null` 이고 워밍업은 다시 `created_at` 을 본다.
   */
  openedAt: string | null;
}

/** SELECT 조각 — accounts a + 자격 존재 여부 서브쿼리. */
export const ACCOUNT_SELECT = sql`
  a.id, a.channel, a.handle, a.display_name, a.status, a.health_score, a.posts_today, a.daily_cap, a.min_gap_min, a.golden_hours,
  a.last_post_at, a.last_error_kind, a.group_id, a.persona_id, a.proxy_url, a.browser_profile_key, a.monetize, a.avatar_url,
  a.quality_tier, a.text_style_id,   /* [R10-9 · R10-4] 계정 기본 등급 · 계정에 걸어 둔 스타일(drizzle/0035) — 없으면 NULL(«안 고름») */
  a.reader,                          /* [R11-8] 이 계정의 독자(drizzle/0081) — NULL 이면 채널 계약 값 그대로 */
  /* [AC-201] 계정 신원(drizzle/0091) — 러너가 본 블로그 주소와 고객이 확인해 준 주소.
     🔴 to_jsonb 로 꺼낸다: 이 SELECT 는 **여덟 자리가 지나가는 목**이라(0081 이 셌다) 컬럼이 없으면 42703 으로
        공장이 통째로 선다. 이렇게 쓰면 컬럼이 없는 순간에도 그냥 NULL 이고 화면만 한 칸 비운다.
     ⚠️ 이 주석 안에 백틱을 쓰지 마라 — 여기는 sql 템플릿 **안**이라 백틱 하나가 템플릿을 끊는다(방금 겪었다). */
  to_jsonb(a) -> 'identity' AS identity,
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
    status: String(r.status), healthScore: Number(r.health_score ?? 100), postsToday: Number(r.posts_today ?? 0),
    /* 🔴 **네 칸을 한 번에 채운다** — 「보여 줄 값」 둘과 「고칠 값」 둘. 아래에서 워밍업이 앞의 둘만 바꾼다. */
    dailyCap: Number(r.daily_cap ?? 2), dailyCapBase: Number(r.daily_cap ?? 2),
    minGapMin: Number(r.min_gap_min ?? 180), minGapBase: Number(r.min_gap_min ?? 180),
    avatar: r.avatar_url ? String(r.avatar_url) : null,
    browserProfileKey: String(r.browser_profile_key || `t0-a${r.id}`), hasCreds: r.has_creds === true,
    monetize: { coupang: r.has_coupang === true, adpost: !!mon.adpostMediaId, adsense: !!mon.adsensePub },
    defaultTier: toCoinTier(r.quality_tier),            // 모르는 값·NULL → null(«안 고름»)
    defaultStyleId: Number(r.text_style_id) > 0 ? Number(r.text_style_id) : null,
    reader: String(r.reader ?? "").trim() || null,          // [R11-8] 빈 문자열도 «안 고름»으로 — 화면이 «"" 라는 독자»를 그리지 않게
    /* 🔴 [2026-09-21 · B] 계정을 만든 날 — **쓰는 길을 냈으면 읽는 길도 같은 커밋에**(이 파일이 `reader` 에서 겪은 그것:
       «저장은 200 인데 새로고침하면 사라졌다»). 칸이 `date` 라 `YYYY-MM-DD` 열 자만 내보낸다(시각이 붙으면 날이 갈린다 · §4.5b). */
    openedAt: r.opened_at ? String(r.opened_at).slice(0, 10) : null,
  };
  /* [AC-201] 🔴 «우리가 실제로 본 블로그 주소»와 «고객이 확인해 준 주소» — 화면이 «이 주소가 맞나요»를 물으려면
     본 것을 보여 줘야 한다. 🔴 **본 것이 없으면 키 자체를 안 싣는다**(«{}» 를 내보내면 화면이 빈 칸을 그린다 · AC-9).
     `confirmed` 는 있는데 `observed` 와 같으면 «확인됨»이고, 다르면 화면이 «다시 확인해 주세요»를 띄울 수 있다. */
  {
    const idn = (r.identity && typeof r.identity === "object" ? r.identity : {}) as Record<string, unknown>;
    const seen = String(idn.posted ?? idn.observed ?? "").trim();
    const conf = String(idn.confirmed ?? "").trim();
    if (seen || conf) {
      o.identity = {
        ...(seen ? { seen } : {}),
        ...(conf ? { confirmed: conf } : {}),
        matchesHandle: seen ? seen.toLowerCase() === String(r.handle ?? "").replace(/^@/, "").trim().toLowerCase() : null,
      };
    }
  }
  /* 🔴 워밍업(§2.6) — **`dailyCap` 을 유효값으로 바꿔서 내보낸다.**
     캐던스를 보는 자리가 셋(director·director-auto·account-health)이라 게이트를 하나 더 만들면 넷이 된다.
     대신 **게이트가 읽는 값 자체**를 유효값으로 만들면 그 셋이 코드를 안 고쳐도 워밍업을 따른다.
     고객이 정한 원래 값은 `dailyCapBase` 로 함께 내보낸다 — 화면은 «원래 2건인데 지금은 1건»을 말할 수 있어야 한다. */
  const wIn = { openedAt: r.opened_at as string | null, createdAt: r.created_at as string | null,
    off: r.warmup_off === true, postsThisWeek: Number(r.posts_this_week ?? 0) };
  const w = warmupState(wIn);
  if (w.active) {
    /* 🔴 **「보여 줄 값」만 바꾼다.** `dailyCapBase`·`minGapBase` 는 고객이 정한 값 그대로 둔다 —
       그 둘이 편집 시트가 미리 채우는 칸이다(2026-09-21 · 여기를 겸하게 두어 고객 값이 덮어써졌다). */
    o.dailyCap = effectiveDailyCap(o.dailyCapBase, wIn);
    o.minGapMin = effectiveMinGapMin(o.minGapBase, wIn);
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
  if (r.avatar_url) o.avatarUrl = String(r.avatar_url);   /* [R17] 응답에 실어야 화면 칸이 채워진다 */
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
  video?: { maxSeconds: VideoSecondsUi; formats: { key: string; label: string; maxSeconds: VideoSecondsUi }[] };
  /** [R11-10] 🔴 이 채널이 **글 축이냐 영상 축이냐** — 화면이 «배워 올 곳»·종류 칩을 고를 재료. 표에 없는 채널이면 키를 안 싣는다(모르면 안 말한다 · AC-9). */
  axis?: ChannelKindAxis;
  /** [R12-6] 🔴 **수익이 안 붙는 채널**(당근)일 때만 `false` — 수익 화면의 0원이 고장으로 보이지 않게. 붙거나 모르면 키를 안 싣는다. */
  monetizable?: false;
  /** [R12-6] 한 글에 올릴 수 있는 사진 수(당근 10). 🔴 **안 재 본 채널엔 키가 없다** — 화면이 수를 지어내지 않는다. */
  maxPhotos?: number;
}
/** 화면이 그리는 영상 길이 칩 값 — 정본은 `lib/video/types.ts VideoSeconds`(R12-7 에서 90 이 들어왔다). */
type VideoSecondsUi = 15 | 30 | 60 | 90;
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
    /* [R11-10 · R12-6] 🔴 채널의 «성질» 셋을 화면에 실어 준다 — 축 · 수익 유무 · 사진 수.
       화면이 «네이버면 글»·«당근은 10장»을 **베껴 적으면** 채널이 늘 때마다 두 곳이 갈린다(AC-52). 모르는 것은 **키를 안 싣는다**(AC-9). */
    const axis = axisOfChannel(key);
    const maxPhotos = maxPhotosOf(key);
    return { key, label: String(r.label), category: String(r.category), publishVia: String(r.publish_via), status,
      connectMethod: connectMethodOf(key), configured: providerConfigured(key), connectable,
      ...(reason ? { connectableReason: reason } : {}), ...(video ? { video } : {}),
      ...(axis ? { axis } : {}), ...(channelMonetizable(key) ? {} : { monetizable: false as const }), ...(maxPhotos ? { maxPhotos } : {}) };
  });
}
