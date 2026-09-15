/**
 * lib/slots.ts — 편성 규칙(cadence_rules) · 변수(ScheduleSettings · DESIGN §5B.4 8개) · rollSlots(멱등) · coinsPerWeek. 계약 §5 v1.1.
 *   AM 관례: editorial-board-slots(슬롯 원장·(rule,date) 유일) · organic-cadence(주 N회 캡). AC 신규 구현(2026-09-14).
 *   rollSlots: 오늘(KST)~+horizonDays · 규칙마다 weekdays(비면 count 를 주 안에 균등 분산 · 결정론) · every month = count 를 달 안에 균등 분산 · every day = 매일 1개(같은 rule·date 1개가 원장 규칙)
 *              · quietDays 제외 · publish_at = best-time(계정 미정이면 채널 첫 후보 · 같은 채널 슬롯끼리 30분 간격) · bestTimeMode fixed 면 preferredHour 만 · status planned · origin auto.
 *   🔴 이 라운드는 슬롯 생성까지 — 소재 배정·D-3 제작·발행 크론은 R2. 슬롯 없는 자동 생성 금지(AC-2)는 R2 produce 스텝의 게이트.
 */
import { sql } from "drizzle-orm";
import { utcDate, jsonb } from "./db-util";
import { q } from "./accounts";
import { defaultImageCount } from "./writing-contracts";
import { coinCostOf, videoCoinItem } from "./coin-table";
import { candidatesFor, kstDateStr, kstToUtc, addDays, ACCOUNT_GAP_MIN } from "./best-time";
import { hourOf, kstHour } from "./cron/base";   // base 는 slots 를 type 으로만 import — 런타임 순환 없음(AC-17)

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
/** [P1R5 B-1 수정] kind 에 "shorts" 추가 — 편성표가 영상도 굴린다(계약 P1R5 §3 · DESIGN §5B.3 «글 · 쇼츠 · 카드뉴스»). 슬롯·크론은 이 값을 그대로 물려받는다. */
export type RuleKind = "post" | "shorts";
export interface Rule { id: number; channel: string; kind: RuleKind; accountMode: "auto" | "fixed"; accountId?: number; every: "day" | "week" | "month"; count: number; weekdays?: number[]; preferredHour?: number; formatHint?: string; active: boolean }
export function toRule(r: Row): Rule {
  const o: Rule = { id: n(r.id), channel: String(r.channel), kind: (String(r.kind) === "shorts" ? "shorts" : "post"), accountMode: r.account_mode === "fixed" ? "fixed" : "auto", every: (["day", "week", "month"].includes(String(r.every)) ? String(r.every) : "week") as Rule["every"], count: Math.max(1, n(r.count)), active: r.active !== false };
  if (r.account_id) o.accountId = n(r.account_id);
  if (Array.isArray(r.weekdays) && r.weekdays.length) o.weekdays = (r.weekdays as unknown[]).map(Number).filter((d) => d >= 0 && d <= 6);
  if (r.preferred_hour !== null && r.preferred_hour !== undefined) o.preferredHour = n(r.preferred_hour);
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
/** coinsPerWeek = Σ(활성 규칙 주환산 × 편당 코인). 글 = blog 1 + image×채널 기본 · [P1R5] 영상 = 길이 구간(기본 60초 = video_60). */
export function coinsPerWeek(rules: Rule[]): number {
  return Math.round(rules.filter((r) => r.active).reduce((a, r) => {
    const per = r.kind === "shorts" ? coinCostOf(videoCoinItem(60)) : coinCostOf("blog") + coinCostOf("image") * defaultImageCount(r.channel);
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
      const preferred = settings.bestTimeMode === "fixed" ? (r.preferredHour ?? null) : (r.preferredHour ?? null);
      const cands = candidatesFor(r.channel, accountId ? golden.get(accountId) ?? null : null, preferred);
      const tk = `${r.channel}:${date}`; const taken = takenBy.get(tk) ?? [];
      let at: Date | null = null;
      for (const c of cands) {
        for (let shift = 0; shift <= 3 && !at; shift++) {
          const t = new Date(kstToUtc(date, c.h, c.m).getTime() + shift * ACCOUNT_GAP_MIN * 60_000);
          if (t.getTime() < now.getTime() + 20 * 60_000) continue;
          if (taken.some((x) => Math.abs(x.getTime() - t.getTime()) < ACCOUNT_GAP_MIN * 60_000)) continue;
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
