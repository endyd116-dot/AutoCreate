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
import { defaultImageCount, coinFormatOf, estimateVideoSeconds, estimateAiImagesFor } from "./writing-contracts";
import { pieceCoinCost, DEFAULT_COIN_TIER, toCoinTier, COIN_TIERS, type CoinTier } from "./coin-table";   // [R10-7] 등급 — 편성표 견적도 계정 등급으로 센다
import { candidatesFor, kstDateStr, kstToUtc, addDays, ACCOUNT_GAP_MIN, isNightHour, jitterMinutes } from "./best-time";
import { hourOf, kstHour } from "./cron/base";   // base 는 slots 를 type 으로만 import — 런타임 순환 없음(AC-17)
import { gapMinFor, crowdOf, ACCOUNT_GAP_MIN_DEFAULT, type Crowd } from "./publish-gap";   // [R8] 계정 간 간격 정책의 **정본**(B2) — 값을 여기 다시 적지 않는다 · [R11-7] «이날 겹쳐요»(세는 것 · 막지 않는다)
import { requireWritable } from "./guards";
import { bestHoursFor } from "./cron/learn";   // [R12-10] 🔴 배운 시각 — 이 줄이 그 함수의 **첫 제품 호출처**다(여태 0곳이었다)
import { produceWindowOf, type ProduceWindow } from "./produce-window";   // [R8] «언제 만들어지나»의 **정본** — 크론 produce 와 같은 잣대(AC-47/AC-70)

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
/** 테넌트 설정 jsonb 원본 — 편성 변수 8개 **밖**의 값(예: `videoSeconds`)도 봐야 하는 자리가 있다. */
export async function readSettingsRaw(tid: number): Promise<Record<string, unknown>> {
  const [t] = await q(sql`SELECT settings FROM tenants WHERE id = ${tid}`);
  return (t?.settings || {}) as Record<string, unknown>;
}
export async function readScheduleSettings(tid: number): Promise<ScheduleSettings> {
  return scheduleSettingsOf(await readSettingsRaw(tid));
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
/**
 * [R11-1 · B · 2026-09-17 · 🔴 **C 가 실측으로 고쳐 준 판** 2026-09-17] **글 하나의 «종류»를 화면 어휘(`RuleKind`)로 옮긴다** — 설계 R11 §1.2·§3.2.
 *   왜 필요한가: 화면 배지표(`UI.KIND_PILL`)가 아는 말은 편성표와 같은 **셋**(`post`·`shorts`·`cardnews`)인데
 *   «만든 것» 목록은 `UI.kindPill(p.kind)` 에 DB 값을 그대로 넣어 **영상도 카드뉴스도 이름표가 한 번도 안 붙었다.**
 *
 *   ══ 🔴 `pieces.kind` 는 **셋**이다 — 둘이 아니다 ══
 *     내 첫 판은 «`kind` 는 `post|video` 둘뿐»이라는 전제로 `format === "cardnews"` 만 봤다. **그 전제가 틀렸다.**
 *     `lib/director.ts:694` 가 실제로 넣는 값은 **`isVideo ? "video" : isCard ? "cardnews" : "post"`** 이고,
 *     `isCard` 는 **채널**에서 온다(`isCardnewsChannel(s.channel)` · `director.ts:676`) — **format 이 아니다.**
 *     그런데 인스타 카드뉴스 계약의 `formats` 는 **다섯**이다(`writing-contracts.ts:343`
 *     `["cardnews", "steps", "listicle", "compare", "qna"]` — 골격이 늘 같던 것을 R8 이 다섯으로 늘렸다).
 *     ⇒ 🔴 **인스타 카드뉴스 글의 format 은 5번 중 4번이 `cardnews` 가 아니다.** 내 첫 판은 그때 `post` 로 떨어졌고,
 *        **배지가 그대로 빈칸**이었다 — 설계 §1.2 가 «지금 틀린 것»이라고 부른 **바로 그 상태를 고치지 못했다.**
 *
 *   ══ 🔴 어느 쪽이 정본인가 — **`kind` 다** ══
 *     `kind` 는 만드는 자리(디렉터)가 **채널을 보고** 박은 값이라 «이 글이 무엇인가»의 답이다.
 *     `format === "cardnews"` 는 **옛 글 호환**으로 남긴다 — `kind` 에 `cardnews` 가 들어가기 전에 만들어진 글이 있다.
 *     둘이 어긋나면 `kind` 가 이긴다(그래서 순서가 이렇다).
 *
 *   🔴 **DB 값은 안 건드린다.** **보여 줄 말**만 여기 한 곳에서 정한다. **다섯 번째 «kind» 이름을 만들지 않는다**(AC-75).
 *   🔴 «가운데»는 여기다 — 읽는 쪽은 `netlify/functions/pieces.ts pieceRow` 의 `ruleKind` 칸 하나다.
 *
 *   ⚠️ 🔴 **왜 내 자가 못 잡았나**(AC-99 ⑨ · C 지적): `verify-r11-axis.mts` 격자에 **`format === "cardnews"` 경로만** 있었다.
 *      «잡아야 할 것»이 표본에 없으면 그 검사의 무력화는 **영영 안 보인다.** 이제 실제 다섯 format 을 전부 격자에 넣었다.
 */
export function ruleKindOfPiece(kind: unknown, format: unknown): RuleKind {
  const k = String(kind ?? "");
  if (k === "video") return "shorts";
  /* 🔴 `kind` 가 먼저다(정본) · `format` 은 옛 글 호환. 순서를 뒤집으면 둘이 어긋날 때 화면이 틀린 말을 한다. */
  if (k === "cardnews" || String(format ?? "") === "cardnews") return "cardnews";
  return "post";
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
/**
 * [R10-7 · R10-9] 규칙 → 그 규칙이 만들 글의 **코인 등급**. 계정이 못 박힌 규칙은 그 계정 등급 · 자동 배정 규칙은 **그 채널 계정들 중 제일 높은 등급**.
 *   🔴 왜 «제일 높은»인가: 견적은 «고객이 내는 값 ≤ 고객에게 말한 값»이어야 한다(C 의 자 · AC-93). 어느 계정에 갈지 모르는데 낮은 등급으로 말하면 «1 을 말하고 3 을 뺀다»가 조용히 생긴다.
 *   계정이 하나도 없으면 simple — 그건 «만들 수 없는 규칙»이라 어느 값이든 안 빠진다.
 */
export function ruleTierOf(r: Pick<Rule, "channel" | "accountMode" | "accountId">, accounts: readonly { id: number; channel: string; defaultTier: CoinTier | null }[]): CoinTier {
  if (r.accountMode === "fixed" && r.accountId) {
    const a = accounts.find((x) => x.id === r.accountId);
    return a?.defaultTier ?? DEFAULT_COIN_TIER;
  }
  let best: CoinTier = DEFAULT_COIN_TIER;
  for (const a of accounts) if (a.channel === r.channel && a.defaultTier && COIN_TIERS[a.defaultTier].coins > COIN_TIERS[best].coins) best = a.defaultTier;
  return best;
}

/** coinsPerWeek = Σ(활성 규칙 주환산 × 편당 코인). `tierOf` 를 안 넘기면 전부 simple(옛 호출 · 계정 등급을 모르는 자리는 낮게 말하는 쪽으로만 틀린다). */
export function coinsPerWeek(rules: Rule[], videoSeconds?: unknown, tierOf: (r: Rule) => CoinTier = () => DEFAULT_COIN_TIER): number {
  return Math.round(rules.filter((r) => r.active).reduce((a, r) => {
    /* [R8] 🔴 기본 경로는 «AI 1장 + 나머지 스톡» 이라 글 한 편이 **1코인**이다(사장님 승인값 2026-09-15).
       사진 총 장수(`defaultImageCount`)로 세면 7코인이 되어 **화면이 옛 값을 말하게** 된다.
       🔴 식은 `pieceCoinCost` **한 곳**에만 있다 — 여기서 다시 적으면 견적과 실제가 갈린다(카드뉴스·영상도 그 함수가 가른다). */
    /* 🔴 [2026-09-16] 영상은 **길이가 값을 가른다**(video_15 = 6 ↔ video_60 = 28 · 4.6배).
       종전엔 `seconds` 를 안 넘겨서 `pieceCoinCost` 안의 «없으면 60» 이 대신 답했고, 그래서
       **고객이 15초로 맞춰 놔도 편성표는 60초 값**을 적었다 — 클립 채널(상한 30초)은 28 이라 적고 12 를 뺐다.
       고른 값은 `tenants.settings.videoSeconds` 에 있었다. 이제 디렉터와 **같은 함수**로 잰다. */
    /* [R10-7] 🔴 등급도 넘긴다 — 안 넘기면 `pieceCoinCost` 가 simple 상한(1)으로 답해 프리미엄 계정의 편성표가 «1 을 말하고 3 을 뺀다»(C 의 자 ⑥이 이 자리를 잡는다). */
    const tier = tierOf(r);
    const per = pieceCoinCost(r.kind, estimateAiImagesFor(r.channel, tier), { format: coinFormatOf(r.channel), seconds: estimateVideoSeconds(r.channel, videoSeconds), tier });
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

/** [R8] 아직 안 넣은 자리 한 줄. 루프는 **무엇을 넣을지만** 정하고, 넣는 일은 아래 `insertSlots` 가 한 번에 한다. */
interface PendingSlot { ruleId: number; date: string; channel: string; kind: string; accountId: number | null; at: Date; reviewDeadline: Date }

/** 한 문장에 넣는 최대 행 수. 파라미터 상한(65535)에 닿지 않게 끊는다 — 행당 10개 × 500 = 5,000. */
const SLOT_INSERT_CHUNK = 500;

/**
 * insertSlots — 자리를 **한 문장으로** 넣는다(메인 승인 2026-09-15 · 왕복 N → 1).
 *
 *   ══ 왜 ══
 *   한 줄씩 넣으면 왕복이 자리 수만큼 난다. 규칙 3개 × 14일 = 45번이고, Pro·Agency 는 **규칙 무제한 + 30일**이라
 *   자리 수에 천장이 없다. 이 PC → Neon 왕복 192ms(실측)에서 이미 30초 벽에 닿았다.
 *
 *   ══ 🔴 안 바뀌는 것 ══
 *   **무엇을 넣을지는 하나도 안 바뀐다.** 멱등은 위 루프의 `have`(= 이미 있는 (rule_id, slot_date))가 걸렀고,
 *   같은 시각 점유는 `takenBy` 가 걸렀다. 여기서는 **넣는 방법만** 바꾼다. 순서도 루프가 만든 순서 그대로다.
 *
 *   ══ 바뀌는 것 하나(더 나은 쪽) ══
 *   실패하면 그 묶음은 **하나도 안 들어간다**(전에는 중간까지 들어가고 멈췄다 — 30초 벽에서 실제로 그랬다).
 *   반환은 «넣으라고 시킨 수»가 아니라 **실제로 들어간 행 수**(RETURNING).
 */
async function insertSlots(tid: number, rows: PendingSlot[]): Promise<number> {
  let created = 0;
  for (let i = 0; i < rows.length; i += SLOT_INSERT_CHUNK) {
    const chunk = rows.slice(i, i + SLOT_INSERT_CHUNK);
    const values = sql.join(
      chunk.map((r) => sql`(${tid}, ${r.ruleId}, ${r.date}::date, ${r.channel}, ${r.kind}, ${r.accountId}::bigint, ${r.at.toISOString()}::timestamptz AT TIME ZONE 'UTC', ${r.reviewDeadline.toISOString()}::timestamptz AT TIME ZONE 'UTC', ${"planned"}, ${"auto"})`),
      sql`, `,
    );
    const out = await q(sql`INSERT INTO slots (tenant_id, rule_id, slot_date, channel, kind, account_id, publish_at, review_deadline, status, origin)
      VALUES ${values} RETURNING 1 AS x`);
    created += out.length;
  }
  return created;
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
  /* [R12-10 · 설계 R12 §8] 🔴 **배운 시각을 편성이 읽는다** — `lib/cron/learn.ts bestHoursFor` 는 주석에 «편성이 읽는다»고 적혀 있었는데
     2026-09-17 실측에서 **부르는 곳이 0곳**이었다(AC-59 · 주석이 코드보다 앞서 나간 자리). 여기가 그 «읽는 곳»이다.
     🔴 **골든타임이 있으면 아무 일도 안 한다**(`candidatesFor` 가 그 순서를 지킨다) — 학습이 고객이 고른 시각을 이기지 않는다.
     🔴 못 읽으면 빈 Map = 기본표 순서 그대로(무회귀 · 편성이 학습 때문에 멈추지 않는다). */
  const learnedHours = await bestHoursFor(tid).catch(() => new Map<number, number[]>());
  /* [R8] 🔴 간격은 **`publish-gap.ts` 한 곳**에서 온다(계정마다 «우리가 무엇을 아는가»가 다르다).
     루프 안에서 매번 DB 를 치지 않게 **규칙에 고정된 계정만 미리 한 번씩** 읽어 둔다.
     🔴 값을 통째로 담는다 — `gapMin`(자동 기본)과 `floorMin`(고객이 못 박은 시각의 바닥)이 **둘 다** 필요하다. */
  const gapCache = new Map<number, Awaited<ReturnType<typeof gapMinFor>>>();
  for (const fixedId of new Set(rules.filter((r) => r.accountMode === "fixed" && r.accountId).map((r) => n(r.accountId)))) {
    if (!fixedId) continue;
    try { gapCache.set(fixedId, await gapMinFor(tid, fixedId)); } catch { /* 못 읽으면 기본(안전)을 쓴다 */ }
  }
  let checked = 0;
  const pending: PendingSlot[] = [];   // [R8] 모아서 한 문장으로 — 아래 `insertSlots`
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
      const cands = candidatesFor(r.channel, accountId ? golden.get(accountId) ?? null : null, preferred, r.preferredMinute ?? null,
        accountId ? learnedHours.get(accountId) ?? null : null);   // [R12-10] 계정이 정해진 규칙만 — auto 규칙은 누구로 나갈지 모르니 배운 시각도 못 고른다
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
      pending.push({ ruleId: r.id, date, channel: r.channel, kind: r.kind, accountId, at, reviewDeadline });
      have.add(key); takenBy.set(tk, [...taken, at]);   // 🔴 «이미 잡았다»는 **메모리에서** 바로 선다 — 다음 규칙·다음 날이 같은 자리를 또 잡지 않게(넣는 시점과 무관)
    }
  }
  const created = await insertSlots(tid, pending);
  return { created, checked };
}

/* ───────── Slot 투영 ───────── */
export interface Slot { id: number; date: string; channel: string; kind: string; accountId?: number; accountHandle?: string; status: string; publishAt?: string; reviewDeadline?: string; topicTitle?: string; pieceId?: number; origin: "auto" | "manual"; skipReason?: "too_soon";
  /** [P1R7 B3] 그 자리에 서버가 남긴 사람말 한 줄(예: 규칙이 정한 구성을 못 썼을 때 · 실패 사유). 없으면 키를 안 싣는다. */
  note?: string;
  /** [P1R7 B3 · DESIGN §5B.2 D+1] 이 자리의 글이 **지금까지 번 돈**(원 · revenue_daily 의 piece 귀속 합). 0원이어도 값이 있으면 싣는다 — «아직 못 가져옴»과 «0원»은 다르다(AC-9). */
  revenueKrw?: number;
  /** [R8] 이 자리의 글이 **언제 만들어지나** — `pending`(차례가 남았다) · `missed`(자동으론 더 안 만든다 = **지금 만들기가 유일한 길**) · `done`(이미 있다).
   *  🔴 잣대는 `lib/produce-window.ts` 한 곳이고 크론 `slots.produce` 가 같은 목록을 읽는다. 건너뜀·반려 자리엔 **키를 안 싣는다**(해당 없음). */
  produceWindow?: ProduceWindow;
  /** 그 판정의 **사람말 한 줄**. `missed` 는 반드시 «지금 할 수 있는 일»로 끝난다. */
  produceReason?: string;
  /** [R8] **아직 안 만든 자리**에만 싣는다 — «지금 만들기»를 누르면 들어갈 코인(`slots-produce-now` 가 실제로 차감하는 것과 **같은 식**).
   *  🔴 이미 만든 자리엔 안 싣는다(그 코인은 이미 나갔다 — «또 든다»로 읽히면 안 된다). */
  coinCost?: number;
  /** [R10-9] 이 자리가 만들 글의 코인 등급 — 계정 기본값(계정 미정이면 그 채널 계정 중 제일 높은 등급 · `ruleTierOf` 와 같은 규칙). `coinCost` 와 같이 실린다. */
  tier?: CoinTier;
  /**
   * [R11-7 · 설계 R11 §4.3] 🔴 **«이날 겹쳐요»** — 같은 계정·같은 날 몇 편인지 · 같은 채널 이웃과 몇 분인지 · 서버가 만든 한 문장.
   *   🔴 **막지 않는다**(CLAUDE §9 하드 게이트 0). 이 칸은 **세는 칸**이지 거절하는 칸이 아니다 — 화면은 문장을 보여 주고
   *      **«그래도 이 시각»** 과 **«시각 바꾸기»**(되돌릴 길)를 같이 준다.
   *   🔴 겹치는 게 없으면 **키 자체를 안 싣는다**(빈 문장을 내려보내 화면이 빈 줄을 그리지 않게).
   */
  crowd?: Crowd }

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
  const rawSettings = await readSettingsRaw(tid);          // 쿼리 수는 그대로(한 번) — 편성 변수 밖의 `videoSeconds` 도 봐야 한다
  const settings = scheduleSettingsOf(rawSettings);
  const tickAt = nextProduceTickUtc(settings, now);
  const tick = tickAt.getTime();
  /* [R8] «언제 만들어지나»를 말하려면 크론이 보는 것을 **똑같이** 봐야 한다 — 자동 편성 스위치(settings)와 집 상태(requireWritable).
     🔴 produce 스텝의 첫 두 줄(`needsAutoSchedule` · `requireWritable`)이 곧 이 판정이다. 여기서 다시 해석하지 않는다. */
  const w = await requireWritable(tid).catch(() => null);
  const blockedReason = w && !w.ok ? w.reason : null;
  const todayKst = kstDateStr(now);
  /* [R10-9] 계정 기본 등급 — 자리마다 «지금 만들기가 몇 코인»을 그 계정 등급으로 센다(한 번에 읽는다 · 계정 30개면 쿼리 30번이 아니라 1번). 못 읽으면 빈 목록 = 전부 simple(낮게 말하는 쪽). */
  const tierRows = await q(sql`SELECT id, channel, quality_tier FROM accounts WHERE tenant_id = ${tid} AND COALESCE(last_error_kind,'') <> 'removed'`).catch(() => [] as Row[]);
  const tierAccounts = tierRows.map((r) => ({ id: n(r.id), channel: String(r.channel), defaultTier: toCoinTier(r.quality_tier) }));
  /* 🔴 [2026-09-19 수리 ⑤] 한국어 문장 한가운데 «**AM 6:00**» 이 떴다(시나리오 A §8).
     `Intl` 의 `ko-KR` 은 **CLDR 이 바뀐 뒤 약식 오전/오후를 `AM`/`PM` 으로 준다**(Node 24 full-icu 실측 — 키 문제가 아니다).
     `produce-window.ts:41` 주석은 «사람말로(«오늘 **오전 6시**»)»라고 적어 뒀는데 코드가 그 말을 어기고 있었다(AC-59).
     ⇒ 로케일에 맡기지 말고 **우리가 적는다.** 시각 판정 자체는 그대로 KST(`hour12:false` 로 뽑아 쓴다 · §4.5b). */
  const tickHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(tickAt));
  const tickMin = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", minute: "2-digit" }).format(tickAt).padStart(2, "0");
  const ampm = tickHour < 12 ? "오전" : "오후";
  const h12 = tickHour % 12 === 0 ? 12 : tickHour % 12;
  const tickText = `${tickAt.getTime() < kstToUtc(addDays(todayKst, 1), 0, 0).getTime() ? "오늘" : "내일"} ${ampm} ${h12}시${tickMin === "00" ? "" : ` ${tickMin}분`}`;
  /* [P1R7 B3 · §5B.2 D+1] 수익 되먹임 — 그 자리의 piece 에 귀속된 `revenue_daily` 합을 함께 읽는다(글별 TOP5 와 같은 원천 · lib/revenue/aggregate).
     🔴 수집 행이 하나도 없으면 SUM 이 NULL 이고, 그때는 키를 안 싣는다 — «아직 못 가져옴»을 «0원 벌었다»로 그리지 않게(AC-9). */
  const rows = await q(sql`SELECT s.*, s.slot_date::text AS d, a.handle, t.title AS topic_title,
      (SELECT SUM(rd.amount_krw)::int FROM revenue_daily rd WHERE rd.tenant_id = s.tenant_id AND rd.piece_id = s.piece_id) AS revenue_krw
    FROM slots s LEFT JOIN accounts a ON a.id = s.account_id LEFT JOIN topics t ON t.id = s.topic_id
    WHERE s.tenant_id = ${tid} AND s.slot_date >= ${from}::date AND s.slot_date <= ${to}::date ORDER BY s.slot_date, s.publish_at NULLS LAST, s.id`);
  const out: Slot[] = rows.map((r) => {
    const o: Slot = { id: n(r.id), date: String(r.d).slice(0, 10), channel: String(r.channel), kind: String(r.kind || "post"), status: String(r.status), origin: r.origin === "manual" ? "manual" : "auto" };
    if (r.account_id) o.accountId = n(r.account_id);
    if (r.handle) o.accountHandle = String(r.handle);
    const pa = utcDate(r.publish_at); if (pa) o.publishAt = pa.toISOString();
    const rd = utcDate(r.review_deadline); if (rd) o.reviewDeadline = rd.toISOString();
    if (r.topic_title) o.topicTitle = String(r.topic_title);
    if (r.piece_id) o.pieceId = n(r.piece_id);
    if (r.note) o.note = String(r.note).slice(0, 300);
    if (r.revenue_krw !== null && r.revenue_krw !== undefined) o.revenueKrw = n(r.revenue_krw);
    const [y, m, d] = o.date.split("-").map(Number);
    const publishMs = pa ? pa.getTime() : Date.UTC(y, m - 1, d, 23, 59, 0) - KST_MS_LOCAL;   // publish_at 없으면 그날 KST 23:59
    if (!r.piece_id && SKIP_CANDIDATE_STATUS.has(o.status) && publishMs <= tick) o.skipReason = "too_soon";
    /* [R8] 🔴 같은 값(publishMs · tick)으로 «언제 만들어지나»까지 판정한다 — `skipReason` 과 `produceWindow` 가 **다른 눈금을 쓰면 안 된다**.
       판정 자체는 `lib/produce-window.ts`(크론 produce 와 공유)에 있고 여기서는 넘기기만 한다. */
    const pw = produceWindowOf({
      status: o.status, hasPiece: !!r.piece_id, slotDate: o.date, todayKst, publishAtMs: publishMs,
      nextTickMs: tick, nextTickText: tickText, leadDays: settings.produceLeadDays,
      autoSchedule: settings.autoSchedule, blockedReason, note: o.note ?? null,
    });
    if (pw) {
      o.produceWindow = pw.window; o.produceReason = pw.reason;
      /* «지금 만들기»가 얼마인지 — 누르기 전에 숫자로 안다(A 요청). 식은 `coin-table.pieceCoinCost` 한 곳이라 실제 차감과 갈릴 수 없다.
         [R10-9] 등급은 그 자리의 계정 기본값(계정 미정이면 채널 계정 중 제일 높은 등급) — `ruleTierOf` 와 같은 규칙. */
      if (pw.window !== "done") {
        const tier = ruleTierOf({ channel: o.channel, accountMode: o.accountId ? "fixed" : "auto", accountId: o.accountId }, tierAccounts);
        o.tier = tier;
        o.coinCost = pieceCoinCost(o.kind, estimateAiImagesFor(o.channel, tier), { format: coinFormatOf(o.channel), seconds: estimateVideoSeconds(o.channel, rawSettings.videoSeconds), tier });
      }
    }
    return o;
  });
  /* ══ [R11-7] 🔴 «이날 겹쳐요» — **한 번에** 잰다 ══
     자리마다 쿼리를 또 던지지 않는다(자리 200개면 쿼리 200번이 된다). 이미 읽어 온 `rows` 가 곧 «다른 예약»이다.
     🔴 셀 대상에서 빼는 것: 건너뛴·실패·승계된 자리(안 나간다) · 시각이 없는 자리(견줄 좌표가 없다) · **자기 자신**.
     🔴 간격은 `publish-gap` 의 기본값을 쓴다 — 자리마다 `gapMinFor`(DB 조회)를 부르면 200번이 되고, 여기서 다른 숫자를 지어내면 정본이 둘이 된다.
        **고객이 실제로 시각을 바꿀 때**는 `slots-reschedule` 이 그 계정의 진짜 값(`gapMinFor`)으로 다시 말해 준다. */
  const alive = out.filter((x) => x.publishAt && !["skipped", "failed", "reassigned"].includes(x.status));
  const others = alive.map((x) => ({ accountId: x.accountId ?? null, channel: x.channel, atMs: Date.parse(x.publishAt!) }));
  alive.forEach((o, i) => {
    /* 🔴 **자기 자신을 이웃으로 세지 않는다** — 세면 «0분 안에 붙어요»가 전 자리에 뜬다(같은 인덱스를 뺀다). */
    const rest = others.filter((_, j) => j !== i);
    const c = crowdOf({ atMs: others[i].atMs, accountId: o.accountId ?? null, handle: o.accountHandle ?? null, others: rest, channel: o.channel, gapMin: ACCOUNT_GAP_MIN_DEFAULT });
    if (c.say) o.crowd = c;
  });
  return out;
}
void jsonb;
