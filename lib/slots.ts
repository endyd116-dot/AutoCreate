/**
 * lib/slots.ts — 편성 규칙(cadence_rules) · 변수(ScheduleSettings · DESIGN §5B.4 8개) · rollSlots(멱등) · coinsPerWeek. 계약 §5 v1.1.
 *   AM 관례: editorial-board-slots(슬롯 원장·(rule,date) 유일) · organic-cadence(주 N회 캡). AC 신규 구현(2026-09-14).
 *   rollSlots: 오늘(KST)~+horizonDays · 규칙마다 weekdays(비면 count 를 주 안에 균등 분산 · 결정론) · every month = count 를 달 안에 균등 분산 · every day = 매일 1개(같은 rule·date 1개가 원장 규칙)
 *              · quietDays 제외 · publish_at = best-time(계정 미정이면 채널 첫 후보 · 같은 채널 슬롯끼리 30분 간격) · bestTimeMode fixed 면 preferredHour 만 · status planned · origin auto.
 *   🔴 이 라운드는 슬롯 생성까지 — 소재 배정·D-3 제작·발행 크론은 R2. 슬롯 없는 자동 생성 금지(AC-2)는 R2 produce 스텝의 게이트.
 *   🔎 AM 원본: ../AutoMarketing/lib/editorial-board-slots.ts · organic-cadence.ts (관례 이식 2026-09-14 · 표·변수는 AC §5B)
 */
import { sql } from "drizzle-orm";
import { utcDate, jsonb } from "./db-util";
import { q } from "./accounts";
import { defaultImageCount } from "./writing-contracts";
import { coinCostOf, videoCoinItem } from "./coin-table";
import { candidatesFor, kstDateStr, kstToUtc, addDays, ACCOUNT_GAP_MIN, isNightHour, jitterMinutes } from "./best-time";
import { hourOf, kstHour } from "./cron/base";   // base 는 slots 를 type 으로만 import — 런타임 순환 없음(AC-17)
import { gapMinFor } from "./publish-gap";   // [R8] 계정 간 간격 정책의 **정본**(B2) — 값을 여기 다시 적지 않는다

const n = (v: unknown) => Number(v || 0);
type Row = Record<string, unknown>;

/* ───────── ScheduleSettings(변수 8) ───────── */
export interface ScheduleSettings { autoSchedule: boolean; horizonDays: 7 | 14 | 30; topicLeadDays: number; produceLeadDays: number; produceHour: string; reviewPolicy: "silence_approves" | "require_confirm"; bestTimeMode: "auto" | "fixed"; weeklyCoinCap: number | null; quietDays: string[] }
export const SCHEDULE_DEFAULTS: ScheduleSettings = { autoSchedule: false, horizonDays: 14, topicLeadDays: 7, produceLeadDays: 3, produceHour: "06:00", reviewPolicy: "silence_approves", bestTimeMode: "auto", weeklyCoinCap: null, quietDays: [] };

export function scheduleSettingsOf(settings: Record<string, unknown> | null | undefined): ScheduleSettings {
  const s = settings || {};
  const hz = Number(s.horizonDays); const horizonDays = ([7, 14, 30] as const).includes(hz as 7 | 14 | 30) ? (hz as 7 | 14 | 30) : SCHEDULE_DEFAULTS.horizonDays;
  const clamp = (v: unknown, lo: number, hi: number, d: number) => { const x = Math.trunc(Number(v)); return Number.isFinite(x) && x >= lo && x <= hi ? x : d; };
  return {
    autoSchedule: s.autoSchedule === true,
    horizonDays,
    topicLeadDays: clamp(s.topicLeadDays, 3, 14, SCHEDULE_DEFAULTS.topicLeadDays),
    produceLeadDays: clamp(s.produceLeadDays, 1, 7, SCHEDULE_DEFAULTS.produceLeadDays),
    produceHour: /^\d{2}:\d{2}$/.test(String(s.produceHour)) ? String(s.produceHour) : SCHEDULE_DEFAULTS.produceHour,
    reviewPolicy: s.reviewPolicy === "require_confirm" ? "require_confirm" : "silence_approves",
    bestTimeMode: s.bestTimeMode === "fixed" ? "fixed" : "auto",
    weeklyCoinCap: s.weeklyCoinCap === null || s.weeklyCoinCap === undefined || s.weeklyCoinCap === "" ? null : (Number.isFinite(Number(s.weeklyCoinCap)) && Number(s.weeklyCoinCap) >= 0 ? Math.trunc(Number(s.weeklyCoinCap)) : null),
    quietDays: Array.isArray(s.quietDays) ? [...new Set((s.quietDays as unknown[]).map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort() : [],
  };
}
/** 화이트리스트 패치(rules-settings body) — 알 수 없는 키·값은 버린다. */
export function sanitizeSchedulePatch(b: Record<string, unknown>): Partial<ScheduleSettings> {
  const merged = scheduleSettingsOf({ ...SCHEDULE_DEFAULTS, ...b });
  const out: Partial<ScheduleSettings> = {};
  for (const k of Object.keys(SCHEDULE_DEFAULTS) as (keyof ScheduleSettings)[]) if (k in b) (out as Record<string, unknown>)[k] = merged[k];
  return out;
}
export async function readScheduleSettings(tid: number): Promise<ScheduleSettings> {
  const [t] = await q(sql`SELECT settings FROM tenants WHERE id = ${tid}`);
  return scheduleSettingsOf((t?.settings || {}) as Record<string, unknown>);
}

/* ───────── Rule ───────── */
/** [P1R5 B-1 수정] kind 에 "shorts" 추가 — 편성표가 영상도 굴린다(계약 P1R5 §3 · DESIGN §5B.3 «글 · 쇼츠 · 카드뉴스»). 슬롯·크론은 이 값을 그대로 물려받는다.
 *  [R8 §2.5] 🔴 **`cardnews` 추가** — DESIGN §5B.3 이 말한 세 가지 중 **하나가 통째로 없었다**(계약은 있는데 편성·생성·검수에 없었다).
 *  카드뉴스는 글 축이라 `content-gen` 으로 만들지만, 편성에서 «글 주 3회»와 «카드뉴스 주 3회»는 **다른 주문**이고 **코인 값도 다르다**. */
export type RuleKind = "post" | "shorts" | "cardnews";
/** 문자열 → RuleKind(모르는 값은 "post"). 읽는 자리가 여럿이라 한 곳에 둔다. */
export function toRuleKind(v: unknown): RuleKind {
  const x = String(v ?? "");
  return x === "shorts" ? "shorts" : x === "cardnews" ? "cardnews" : "post";
}
export interface Rule { id: number; channel: string; kind: RuleKind; accountMode: "auto" | "fixed"; accountId?: number; every: "day" | "week" | "month"; count: number; weekdays?: number[]; preferredHour?: number; preferredMinute?: number; formatHint?: string; active: boolean }
export function toRule(r: Row): Rule {
  const o: Rule = { id: n(r.id), channel: String(r.channel), kind: toRuleKind(r.kind), accountMode: r.account_mode === "fixed" ? "fixed" : "auto", every: (["day", "week", "month"].includes(String(r.every)) ? String(r.every) : "week") as Rule["every"], count: Math.max(1, n(r.count)), active: r.active !== false };
  if (r.account_id) o.accountId = n(r.account_id);
  if (Array.isArray(r.weekdays) && r.weekdays.length) o.weekdays = (r.weekdays as unknown[]).map(Number).filter((d) => d >= 0 && d <= 6);
  if (r.preferred_hour !== null && r.preferred_hour !== undefined) o.preferredHour = n(r.preferred_hour);
  if (r.preferred_minute !== null && r.preferred_minute !== undefined) o.preferredMinute = n(r.preferred_minute);   // [R8] 분까지 못 박기(옛 규칙은 없으면 00)
  if (r.format_hint) o.formatHint = String(r.format_hint);
  return o;
}
export async function listRules(tid: number): Promise<Rule[]> {
  return (await q(sql`SELECT * FROM cadence_rules WHERE tenant_id = ${tid} ORDER BY id`)).map(toRule);
}

/** 주당 횟수 환산: day → 7 · week → count · month → count×12/52. */
export function weeklyCount(r: Pick<Rule, "every" | "count" | "weekdays">): number {
  if (r.every === "day") return 7;
  if (r.every === "month") return r.count * 12 / 52;
  return r.weekdays?.length ? Math.min(r.count, r.weekdays.length) || r.weekdays.length : r.count;
}
/** coinsPerWeek = Σ(활성 규칙 주환산 × 편당 코인). 글 = blog 1 + image×채널 기본 · [P1R5] 영상 = 길이 구간(기본 60초 = video_60).
 *  [R8 §2.5] 🔴 카드뉴스 = **`cardnews` 한 값(카드 값이 그 안에 들어 있다)**. 여기와 `lib/director.ts pieceCoin` 이
 *  **같은 규칙**이어야 한다 — 갈리면 편성표가 말한 코인과 실제로 빠지는 코인이 달라진다(AC-74 «화면의 숫자도 서버가 정본»). */
export function coinsPerWeek(rules: Rule[]): number {
  return Math.round(rules.filter((r) => r.active).reduce((a, r) => {
    const per = r.kind === "shorts" ? coinCostOf(videoCoinItem(60))
      : r.kind === "cardnews" ? coinCostOf("cardnews")
      : coinCostOf("blog") + coinCostOf("image") * defaultImageCount(r.channel);
    return a + weeklyCount(r) * per;
  }, 0));
}

/** count 를 주 안에 균등 분산(결정론): 3 → 월·수·금 / 2 → 화·금 / 1 → 수 / 5 → 월~금. 0=일요일 기준 배열. */
export function spreadWeekdays(count: number): number[] {
  const c = Math.max(1, Math.min(7, Math.trunc(count)));
  if (c === 7) return [0, 1, 2, 3, 4, 5, 6];
  const order = [1, 2, 3, 4, 5, 6, 0];   // 월~일
  const out = new Set<number>();
  for (let i = 0; i < c; i++) out.add(order[Math.min(6, Math.round((i + 0.5) * 7 / c - 0.5))]);
  let k = 0; while (out.size < c) { if (!out.has(order[k])) out.add(order[k]); k++; }
  return [...out].sort();
}
/** count 를 달 안에 균등 분산(결정론 · 1-base 일). */
export function spreadMonthDays(count: number, daysInMonth: number): number[] {
  const c = Math.max(1, Math.min(daysInMonth, Math.trunc(count)));
  const out = new Set<number>();
  for (let i = 0; i < c; i++) out.add(Math.max(1, Math.min(daysInMonth, Math.round((i + 0.5) * daysInMonth / c))));
  let d = 1; while (out.size < c) { if (!out.has(d)) out.add(d); d++; }
  return [...out].sort((a, b) => a - b);
}
function weekdayOf(dateStr: string): number { const [y, m, d] = dateStr.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function daysInMonthOf(dateStr: string): number { const [y, m] = dateStr.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/** 규칙이 이 날짜에 슬롯을 내는가(결정론). */
export function ruleHitsDate(r: Rule, dateStr: string): boolean {
  const wd = weekdayOf(dateStr);
  if (r.every === "day") return !r.weekdays?.length || r.weekdays.includes(wd);
  if (r.every === "week") { const days = r.weekdays?.length ? r.weekdays.slice(0, Math.max(1, r.count)) : spreadWeekdays(r.count); return days.includes(wd); }
  const dom = Number(dateStr.slice(8, 10));
  return spreadMonthDays(r.count, daysInMonthOf(dateStr)).includes(dom);
}

/**
 * rollSlots — 오늘~+horizonDays 슬롯 생성(멱등 · (rule_id, slot_date) 중복 0 · quietDays 제외 · 오늘 지난 시각 제외).
 *   반환 = 새로 만든 수.
 */
export async function rollSlots(tid: number, horizonDays?: number, now: Date = new Date()): Promise<{ created: number; checked: number }> {
  const settings = await readScheduleSettings(tid);
  const horizon = Math.max(1, Math.min(31, horizonDays ?? settings.horizonDays));
  const rules = (await listRules(tid)).filter((r) => r.active);
  if (!rules.length) return { created: 0, checked: 0 };
  const today = kstDateStr(now);
  const end = addDays(today, horizon);
  const quiet = new Set(settings.quietDays);
  const existing = await q(sql`SELECT rule_id, slot_date::text AS d, channel, publish_at, status FROM slots WHERE tenant_id = ${tid} AND slot_date >= ${today}::date AND slot_date <= ${end}::date`);
  // ★C4 fix: 건너뛴(skipped) 슬롯도 «이미 있다»로 센다 — 빼면 다음 roll 이 사용자가 건너뛴 날을 되살린다(AC-2 «주 0회로 뒀는데 계속» 계열).
  const have = new Set(existing.filter((e) => e.rule_id).map((e) => `${n(e.rule_id)}:${String(e.d).slice(0, 10)}`));
  const takenBy = new Map<string, Date[]>();   // `${channel}:${date}` → 시각
  for (const e of existing) { if (String(e.status) === "skipped" || String(e.status) === "rejected") continue; const at = utcDate(e.publish_at); if (!at) continue; const k = `${e.channel}:${String(e.d).slice(0, 10)}`; takenBy.set(k, [...(takenBy.get(k) ?? []), at]); }   // [P1R7 B3] 버린(rejected) 자리도 건너뛴(skipped) 자리와 같이 — 그 시각을 점유하지 않는다
  const accounts = await q(sql`SELECT id, golden_hours FROM accounts WHERE tenant_id = ${tid} AND COALESCE(last_error_kind,'') <> 'removed'`);
  const golden = new Map(accounts.map((a) => [n(a.id), Array.isArray(a.golden_hours) ? (a.golden_hours as unknown[]).map(Number) : null]));
  /* [R8] 🔴 간격은 **`publish-gap.ts` 한 곳**에서 온다(계정마다 «우리가 무엇을 아는가»가 다르다).
     루프 안에서 매번 DB 를 치지 않게 **규칙에 고정된 계정만 미리 한 번씩** 읽어 둔다.
     🔴 값을 통째로 담는다 — `gapMin`(자동 기본)과 `floorMin`(고객이 못 박은 시각의 바닥)이 **둘 다** 필요하다. */
  const gapCache = new Map<number, Awaited<ReturnType<typeof gapMinFor>>>();
  for (const fixedId of new Set(rules.filter((r) => r.accountMode === "fixed" && r.accountId).map((r) => n(r.accountId)))) {
    if (!fixedId) continue;
    try { gapCache.set(fixedId, await gapMinFor(tid, fixedId)); } catch { /* 못 읽으면 기본(안전)을 쓴다 */ }
  }
  let created = 0, checked = 0;
  for (let d = 0; d <= horizon; d++) {
    const date = addDays(today, d);
    if (quiet.has(date)) continue;
    for (const r of rules) {
      if (!ruleHitsDate(r, date)) continue;
      checked++;
      const key = `${r.id}:${date}`;
      if (have.has(key)) continue;
      const accountId = r.accountMode === "fixed" && r.accountId ? r.accountId : null;
      const preferred = r.preferredHour ?? null;
      /* [R8 · B] 시:분 — 사장님 «10:00 / 10:05 / 11:00» 이 규칙 3개로 그대로 선다(옛 규칙은 분이 NULL = 00분 · 소급 0). */
      const cands = candidatesFor(r.channel, accountId ? golden.get(accountId) ?? null : null, preferred, r.preferredMinute ?? null);
      const tk = `${r.channel}:${date}`; const taken = takenBy.get(tk) ?? [];
      /* 🔴 [R8] 같은 채널 다른 계정과의 간격 = **정책 한 곳**(B2 `lib/publish-gap.ts gapMinFor`) — 여기에 30 을 다시 적지 않는다.
         **고객이 시각을 못 박은 규칙**은 `floorMin`(러너가 «실제로 재서» 출구 IP 가 다를 때만 5분까지) → 10:00 / 10:05 가 그대로 선다.
         계정을 안 정한 auto 규칙은 `gapMin`(누구로 나갈지 모르니 보수적). */
      const gap = accountId ? (gapCache.get(accountId) ?? await (async () => { const g = await gapMinFor(tid, accountId); gapCache.set(accountId, g); return g; })()) : null;
      const crossGap = Math.max(1, preferred !== null ? (gap?.floorMin ?? ACCOUNT_GAP_MIN) : (gap?.gapMin ?? ACCOUNT_GAP_MIN));
      /* 🔴 계정마다 **다른** 흔들림 · 같은 (계정·날짜·시각)이면 **늘 같은 값**
         (편성은 여러 번 돈다 — 돌 때마다 시각이 움직이면 «어제 본 시각»과 달라지고 슬롯이 두 번 잡힌다).
         🔴 **고객이 못 박은 시각은 흔들지 않는다** — 10:05 라고 적었는데 우리가 10:08 로 밀면 약속을 어긴 것이다. */
      const spread = accountId && preferred === null ? Math.max(0, Math.min(7, Math.floor(crossGap / 4))) : 0;
      let at: Date | null = null;
      for (const c of cands) {
        /* 🔴 새벽은 자동으로 잡지 않는다 — 다만 고객이 **규칙에 직접 적은 시각**(`preferred`)은 막지 않는다(말로만 알린다 · `nightRisk`). */
        if (preferred == null && isNightHour(c.h)) continue;
        const jit = spread ? jitterMinutes(`acc:${accountId}|${date}|${c.h}:${c.m}`, spread) : 0;
        for (let shift = 0; shift <= 3 && !at; shift++) {
          const t = new Date(kstToUtc(date, c.h, c.m).getTime() + (shift * crossGap + jit) * 60_000);
          if (t.getTime() < now.getTime() + 20 * 60_000) continue;
          if (taken.some((x) => Math.abs(x.getTime() - t.getTime()) < crossGap * 60_000)) continue;
          at = t;
        }
        if (at) break;
      }
      if (!at) continue;   // 오늘 후보가 전부 지났다 — 내일부터
      const reviewDeadline = new Date(kstToUtc(date, 2, 0).getTime());   // D-0 02:00 KST(silence_approves 마감 · §5B.7)
      await q(sql`INSERT INTO slots (tenant_id, rule_id, slot_date, channel, kind, account_id, publish_at, review_deadline, status, origin)
        VALUES (${tid}, ${r.id}, ${date}::date, ${r.channel}, ${r.kind}, ${accountId}, ${at.toISOString()}::timestamptz AT TIME ZONE 'UTC', ${reviewDeadline.toISOString()}::timestamptz AT TIME ZONE 'UTC', ${"planned"}, ${"auto"})`);
      have.add(key); takenBy.set(tk, [...taken, at]); created++;
    }
  }
  return { created, checked };
}

/* ───────── Slot 투영 ───────── */
export interface Slot { id: number; date: string; channel: string; kind: string; accountId?: number; accountHandle?: string; status: string; publishAt?: string; reviewDeadline?: string; topicTitle?: string; pieceId?: number; origin: "auto" | "manual"; skipReason?: "too_soon";
  /** [P1R7 B3] 그 자리에 서버가 남긴 사람말 한 줄(예: 규칙이 정한 구성을 못 썼을 때 · 실패 사유). 없으면 키를 안 싣는다. */
  note?: string;
  /** [P1R7 B3 · DESIGN §5B.2 D+1] 이 자리의 글이 **지금까지 번 돈**(원 · revenue_daily 의 piece 귀속 합). 0원이어도 값이 있으면 싣는다 — «아직 못 가져옴»과 «0원»은 다르다(AC-9). */
  revenueKrw?: number }

const KST_MS_LOCAL = 9 * 3600_000;
/**
 * 다음 제작 틱(KST produceHour · 크론 produce 가 도는 시각)을 UTC Date 로. 지금 KST 시 < produceHour 면 오늘, 아니면 내일(같은 시는 «이미 지났다» → 내일).
 *   «시» 판정은 lib/cron/base.ts kstHour/hourOf 그대로(CLAUDE §4.5b) — 크론과 같은 눈금.
 */
export function nextProduceTickUtc(settings: ScheduleSettings, now = new Date()): Date {
  const h = hourOf(settings.produceHour, 6);
  const k = new Date(now.getTime() + KST_MS_LOCAL);
  const dayOffset = kstHour(now) < h ? 0 : 1;
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + dayOffset, h, 0, 0) - KST_MS_LOCAL);
}
/** 아직 글이 없는 «만들어질 차례» 상태들 — 이것들만 «못 만드는 자리» 판정 대상. */
const SKIP_CANDIDATE_STATUS = new Set(["planned", "no_topic", "topic_assigned", "coin_short"]);

/**
 * listSlots — 편성표 자리 목록. `skipReason:"too_soon"` = **다음 제작 틱이 그 자리의 발행 시각보다 늦어 이번엔 못 만드는 자리**(서버 판정 · 화면은 «이번엔 건너뛰어요»).
 *   기준: T = 다음 제작 틱(nextProduceTickUtc) · P = publish_at(없으면 그 slot_date 의 KST 23:59) · `P <= T` 면 too_soon. 글이 있거나 만들어질 차례가 아닌 자리엔 키를 싣지 않는다.
 *   ⚠️ 화면이 «자리 날짜 − 오늘 < produceLeadDays» 로 그리던 것을 대체한다 — produce 크론의 창은 오늘~오늘+lead 라 lead 안의 자리는 **다음 틱에 만들어진다**(2026-09-15 설계 정정).
 *   autoSchedule 꺼짐은 여기서 표시하지 않는다(배너가 맡는다).
 */
export async function listSlots(tid: number, from: string, to: string, now = new Date()): Promise<Slot[]> {
  const settings = await readScheduleSettings(tid);
  const tick = nextProduceTickUtc(settings, now).getTime();
  /* [P1R7 B3 · §5B.2 D+1] 수익 되먹임 — 그 자리의 piece 에 귀속된 `revenue_daily` 합을 함께 읽는다(글별 TOP5 와 같은 원천 · lib/revenue/aggregate).
     🔴 수집 행이 하나도 없으면 SUM 이 NULL 이고, 그때는 키를 안 싣는다 — «아직 못 가져옴»을 «0원 벌었다»로 그리지 않게(AC-9). */
  const rows = await q(sql`SELECT s.*, s.slot_date::text AS d, a.handle, t.title AS topic_title,
      (SELECT SUM(rd.amount_krw)::int FROM revenue_daily rd WHERE rd.tenant_id = s.tenant_id AND rd.piece_id = s.piece_id) AS revenue_krw
    FROM slots s LEFT JOIN accounts a ON a.id = s.account_id LEFT JOIN topics t ON t.id = s.topic_id
    WHERE s.tenant_id = ${tid} AND s.slot_date >= ${from}::date AND s.slot_date <= ${to}::date ORDER BY s.slot_date, s.publish_at NULLS LAST, s.id`);
  return rows.map((r) => {
    const o: Slot = { id: n(r.id), date: String(r.d).slice(0, 10), channel: String(r.channel), kind: String(r.kind || "post"), status: String(r.status), origin: r.origin === "manual" ? "manual" : "auto" };
    if (r.account_id) o.accountId = n(r.account_id);
    if (r.handle) o.accountHandle = String(r.handle);
    const pa = utcDate(r.publish_at); if (pa) o.publishAt = pa.toISOString();
    const rd = utcDate(r.review_deadline); if (rd) o.reviewDeadline = rd.toISOString();
    if (r.topic_title) o.topicTitle = String(r.topic_title);
    if (r.piece_id) o.pieceId = n(r.piece_id);
    if (r.note) o.note = String(r.note).slice(0, 300);
    if (r.revenue_krw !== null && r.revenue_krw !== undefined) o.revenueKrw = n(r.revenue_krw);
    if (!r.piece_id && SKIP_CANDIDATE_STATUS.has(o.status)) {
      const [y, m, d] = o.date.split("-").map(Number);
      const publishMs = pa ? pa.getTime() : Date.UTC(y, m - 1, d, 23, 59, 0) - KST_MS_LOCAL;   // publish_at 없으면 그날 KST 23:59
      if (publishMs <= tick) o.skipReason = "too_soon";
    }
    return o;
  });
}
void jsonb;
