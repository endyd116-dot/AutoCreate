/**
 * lib/derived-schedule.ts — 🔴 **한 영상의 파생을 시차를 두고 편성표에 얹는다**(R18 «한 번 만들어 여러 곳에» · B2 · 2026-09-26).
 *   🔎 출처: AC 신규. AM 에는 «한 영상 → 여러 채널» 이 없다.
 *
 *   ══ 누가 무엇을 ══
 *     B(`lib/video/reuse.ts deriveVideoPieces`) 가 파생 piece 를 **`scheduled` · `scheduled_for NULL` · `slot_id NULL`** 로 낳는다(계약 v1.2).
 *       🔴 `approved` 가 아닌 까닭(B): `approved` 는 화면 어느 칸에도 안 보이는 낱말이라(AC-178) 여기서 한 번 밀리면 파생이 **사라진 것처럼** 된다.
 *          발행 크론은 `scheduled_for IS NOT NULL` 만 줍는다(`lib/cron/publisher.ts`) — 시각을 박기 전엔 안 나간다.
 *     여기가 그 파생에 **시각과 자리**를 준다 — `scheduled_for` + `slots` 행(origin `derived`). 상태 전이는 없다.
 *     가족 키 = `pieces.origin_piece_id`(B · drizzle/0088) — 원본은 NULL · 파생은 원본 id.
 *
 *   ══ 🔴 지키는 것 넷(트리거 §6) ══
 *     ① **같은 분에 N곳 없음** — 한 가족(원본 + 파생) 안의 어느 두 시각도 `DERIVED_STAGGER_MIN` 안에 붙지 않는다.
 *        기존 캐던스는 «같은 계정»·«같은 채널 다른 계정» 두 축뿐이라 **채널이 다른 형제**는 아무도 안 봤다
 *        (틱톡·클립은 기본표 첫 후보가 둘 다 19:00 이다 — 그대로 두면 같은 분에 나간다).
 *     ② **캐던스**(§4.7) — 파생 계정의 하루 몫(워밍업 반영)·글 사이 간격·같은 채널 다른 계정 30분.
 *        🔴 최종 판정은 `checkCadenceAt` **한 곳**이다 — 여기 순수 함수는 «후보를 내는 자»이고, 판정자가 아니다(두 자가 다른 말을 하지 않게).
 *     ③ **유튜브 쿼터**(§2.2) — 가족당 유튜브 업로드 **최대 1건**. 그리고 파생이 유튜브로 가면 그날 테넌트 유튜브 수를
 *        `youtubeDailyCap()`(하나뿐인 문)으로 센다 — 5건 찬 날에 얹어 «내일 이어서»를 세 번 돌게 하지 않는다.
 *     ④ **길이**(트리거 §1②) — 채널에 안 들어가는 영상은 얹지 않는다(`lib/publish/video-fit.ts` 한 곳).
 *
 *   ══ 🔴 ③④ 는 B 의 `reuseFit` 이 이미 거른다 — 여기는 **새면 잡는 둘째 줄**이다 ══
 *     새서 여기 닿았다는 것 자체가 사고라 조용히 넘기지 않는다: 그 파생을 `failed` 로 두고(사유 한 줄) 감사 **high**.
 *     🔴 둘 다 게이트가 아니라 **없는 길**이다(CLAUDE §9 «이 규칙 밖») — 유튜브에 같은 세로 영상을 두 번 올리면
 *        긴 영상이 되지 않고 쇼츠가 하나 더 생기고(트리거 §3), 30초 채널에 60초는 올라가지 않는다.
 *
 *   ══ 🔴 막지 않는다 — 자리가 없으면 «기다린다»고 말한다(§9) ══
 *     14일 안에 캐던스가 맞는 자리가 없으면 시각 없이 그대로 두고 **알림 한 줄**(무엇이 · 왜 · 어떻게 하면 되는지 · 우리가 대신 하는 것).
 *     크론 `reuse.schedule`(매시)이 다시 줍는다 — 자리가 나면 저절로 얹힌다.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { jsonb, utcDate } from "./db-util";
import { writeAudit } from "./audit";
import { ACCOUNT_GAP_MIN, NIGHT_END_H, candidatesFor, isNightHour, kstDateStr, kstToUtc, addDays } from "./best-time";
import { checkCadenceAt, DAY_FREED_STATUSES, statusListSql } from "./cadence-check";
import { effectiveDailyCap, effectiveMinGapMin } from "./warmup";
import { gapMinFor } from "./publish-gap";
import { pausedAccountIds } from "./account-slots";
import { youtubeDailyCap } from "./publish/youtube";
import { videoFitsChannel } from "./publish/video-fit";
import { channelLabelKo } from "./channel-url";
import { notifyOnce } from "./cron/base";

const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const KST_MS = 9 * 3600_000;

/**
 * 🔴 한 가족 안 두 시각 사이 최소 간격(분). **새 숫자를 짓지 않았다** — «다른 계정끼리 30분»(`ACCOUNT_GAP_MIN`)과 같은 까닭이다:
 *   파생은 **다른 계정**이고, 같은 영상이 여러 곳에 **같은 분에** 뜨면 그 자체가 «자동으로 뿌린다»는 신호다.
 *   ⚠️ 그 상수처럼 **공식 근거는 없다**(best-time.ts 주석) — 안전한 쪽의 통설이다.
 */
export const DERIVED_STAGGER_MIN = ACCOUNT_GAP_MIN;
/** 지금부터 최소 몇 분 뒤에 잡나 — `pickPublishAt` 과 같은 20분(«방금 잡고 바로 나감» 방지). */
export const DERIVED_LEAD_MIN = 20;
/** 몇 날 앞까지 찾나 — `pickPublishAt maxDaysAhead` 와 같은 14일. */
export const DERIVED_HORIZON_DAYS = 14;
/** 🔴 유튜브 채널 — 쿼터가 **채널이 아니라 구글 프로젝트** 단위라 한 통으로 센다(`lib/publish/youtube.ts todayUploads` 와 같은 목록). */
export const YOUTUBE_CHANNELS: readonly string[] = ["youtube_shorts", "youtube_long"];
export const isYoutubeChannel = (ch: unknown): boolean => YOUTUBE_CHANNELS.includes(String(ch ?? ""));

/* ═══════════════════════════ 순수 — 후보를 낸다 ═══════════════════════════ */

/** 그날(KST) 몫 — `cap(날짜)` 까지 · `used` 는 이미 잡힌/나간 수. 🔴 같은 계정·같은 통이면 **같은 Map 객체**를 넘긴다(하나 잡으면 같이 준다). */
export interface DayBudget { cap: (kstDate: string) => number; used: Map<string, number> }

export interface StaggerTarget {
  pieceId: number;
  channel: string;
  accountId: number;
  /** 같은 계정의 다른 글 시각(나간 것 + 잡힌 것). */
  takenSameAccount: Date[];
  /** 같은 채널 **다른 계정**의 글 시각. */
  takenSameChannel: Date[];
  /** 같은 계정 글 사이 간격(분 · 워밍업 반영). */
  accountGapMin: number;
  /** 같은 채널 다른 계정과의 간격(분 · `gapMinFor().gapMin`). */
  channelGapMin: number;
  /** 계정의 하루 몫(없으면 세지 않는다). */
  day?: DayBudget;
  /** 테넌트 공용 하루 통(유튜브 쿼터) — 없으면 세지 않는다. */
  pool?: DayBudget;
  /** 이 시각보다 앞에는 잡지 않는다(캐던스 판정자가 «N시부터»라고 했을 때). */
  notBefore?: Date | null;
}

export interface StaggerInput {
  /** 원본이 나가는(나간) 시각. */
  originAt: Date;
  /** 이미 정해진 가족 시각(원본 포함). 🔴 안 넘기면 원본만 본다. */
  family?: Date[];
  targets: StaggerTarget[];
  now: Date;
  staggerMin?: number;
  horizonDays?: number;
}

export type StaggerPick =
  | { pieceId: number; channel: string; at: Date }
  | { pieceId: number; channel: string; at: null; why: "no_room" };

/**
 * 그 채널의 «아침 첫 좋은 시각»(새벽 뒤) — 밤에 걸리거나 하루 몫이 차면 여기로 넘어간다.
 *   🔴 후보는 `candidatesFor` **그대로**다 — 기본표에 없는 채널(`facebook_reels` 등)은 `pickPublishAt` 과 같은 09:00 이 된다.
 *      처음엔 `BEST_HOURS` 를 직접 읽고 없으면 `NIGHT_END_H`(06:00)로 떨어뜨려서 **페북 릴스가 새벽 6시**에 잡혔다(자 ① 밤 표본이 보여 줬다).
 */
export function morningOf(channel: string): { h: number; m: number } {
  const c = candidatesFor(channel).find((x) => x.h >= NIGHT_END_H);
  return c ?? { h: NIGHT_END_H, m: 0 };
}
const kstHourOf = (d: Date): number => new Date(d.getTime() + KST_MS).getUTCHours();
const ceilMinute = (ms: number): number => Math.ceil(ms / 60_000) * 60_000;

/**
 * staggerDerived — 파생마다 «원본 + k×시차» 뒤의 **첫 자리**를 낸다. 🔴 결정론(같은 입력 → 같은 답 · 편성은 여러 번 돈다).
 *   순서: 넘긴 `targets` 순서대로 하나씩 잡고, 잡은 시각을 **가족에 넣어** 다음 파생이 피하게 한다.
 *   한 자리가 걸리면(가족·계정·채널 간격) **걸린 창의 끝**으로 건너뛴다(5분씩 기지 않는다 — 정확하고 빠르다).
 *   밤(0~6시 KST) · 하루 몫이 찼다 → 그 채널의 아침 첫 좋은 시각으로.
 */
export function staggerDerived(inp: StaggerInput): StaggerPick[] {
  const stagger = Math.max(1, Math.floor(inp.staggerMin ?? DERIVED_STAGGER_MIN));
  const horizon = Math.max(1, Math.floor(inp.horizonDays ?? DERIVED_HORIZON_DAYS));
  const family: Date[] = [...(inp.family ?? []), inp.originAt];
  const floorMs = Math.max(inp.originAt.getTime() + stagger * 60_000, inp.now.getTime() + DERIVED_LEAD_MIN * 60_000);
  const endMs = Math.max(inp.now.getTime(), inp.originAt.getTime()) + horizon * 86400_000;
  /* 잡을 때마다 다른 파생의 «같은 계정 / 같은 채널» 목록에도 넣는다 — 원본은 파생끼리 이 둘이 겹칠 일이 없지만(UNIQUE(origin, channel)) 순수 함수는 그걸 가정하지 않는다. */
  const targets = inp.targets.map((t) => ({ ...t, takenSameAccount: [...t.takenSameAccount], takenSameChannel: [...t.takenSameChannel] }));
  const out: StaggerPick[] = [];
  for (const t of targets) {
    let ms = ceilMinute(Math.max(floorMs, t.notBefore ? t.notBefore.getTime() : 0));
    let at: Date | null = null;
    for (let guard = 0; guard < 2000 && ms <= endMs; guard++) {
      const cand = new Date(ms);
      const day = kstDateStr(cand);
      const nextMorning = (d: string) => kstToUtc(d, morningOf(t.channel).h, morningOf(t.channel).m).getTime();
      if (isNightHour(kstHourOf(cand))) { ms = Math.max(ms + 60_000, nextMorning(day)); continue; }
      if (t.day && (t.day.used.get(day) ?? 0) >= t.day.cap(day)) { ms = nextMorning(addDays(day, 1)); continue; }
      if (t.pool && (t.pool.used.get(day) ?? 0) >= t.pool.cap(day)) { ms = nextMorning(addDays(day, 1)); continue; }
      /* 걸린 창들 중 **가장 늦게 끝나는 것**의 끝으로 건너뛴다. */
      let jump = 0;
      const clash = (list: Date[], gapMin: number) => {
        for (const x of list) if (Math.abs(x.getTime() - ms) < gapMin * 60_000) jump = Math.max(jump, x.getTime() + gapMin * 60_000);
      };
      clash(family, stagger);
      clash(t.takenSameAccount, Math.max(1, t.accountGapMin));
      clash(t.takenSameChannel, Math.max(1, t.channelGapMin));
      if (jump) { ms = ceilMinute(Math.max(jump, ms + 60_000)); continue; }
      at = cand;
      break;
    }
    if (!at) { out.push({ pieceId: t.pieceId, channel: t.channel, at: null, why: "no_room" }); continue; }
    out.push({ pieceId: t.pieceId, channel: t.channel, at });
    family.push(at);
    const d = kstDateStr(at);
    if (t.day) t.day.used.set(d, (t.day.used.get(d) ?? 0) + 1);
    if (t.pool) t.pool.used.set(d, (t.pool.used.get(d) ?? 0) + 1);
    for (const o of targets) {
      if (o === t) continue;
      if (o.accountId === t.accountId) o.takenSameAccount.push(at);
      else if (o.channel === t.channel) o.takenSameChannel.push(at);
    }
  }
  return out;
}

/**
 * 가족 안에서 **시차가 깨진 쌍**을 센다(자·재배치가 같이 쓴다). 🔴 같은 분뿐 아니라 `staggerMin` 안이면 전부 센다.
 *   @returns 깨진 쌍 목록(없으면 빈 배열)
 */
export function staggerClashes(times: { pieceId: number; at: Date }[], staggerMin = DERIVED_STAGGER_MIN): { a: number; b: number; gapMin: number }[] {
  const out: { a: number; b: number; gapMin: number }[] = [];
  for (let i = 0; i < times.length; i++) for (let j = i + 1; j < times.length; j++) {
    const g = Math.abs(times[i].at.getTime() - times[j].at.getTime()) / 60_000;
    if (g < staggerMin) out.push({ a: times[i].pieceId, b: times[j].pieceId, gapMin: Math.round(g * 10) / 10 });
  }
  return out;
}

export interface FreshIn { pieceId: number; channel: string; durationMs: number }
export interface FreshDrop { pieceId: number; channel: string; why: "youtube_twice" | "too_long"; say: string; sec?: number; maxSec?: number }

/**
 * triageFresh — 새로 온 파생 중 **없는 길**을 가른다(순수 · B `reuseFit` 뒤의 둘째 줄).
 *   ④ 길이 먼저 — 채널에 안 들어가는 영상(`videoFitsChannel`). 🔴 길이로 빠진 유튜브 파생은 유튜브 자리를 **안 먹는다**(그래서 순서가 이렇다).
 *   ③ 유튜브는 가족당 한 건 — 원본이 `youtube_*` 이거나, 이미 자리를 가진 형제 중 `youtube_*` 가 있으면 새 유튜브 파생은 빠진다.
 *      둘 다 없으면 **넘긴 순서대로 첫 한 건만** 남는다.
 *   @param siblingChannels 이미 시각이 있는(또는 나간) 형제들의 채널 — 안 나가는 것(`failed`·`rejected`)은 부른 쪽이 뺀다.
 */
export function triageFresh(originChannel: string, siblingChannels: readonly string[], fresh: readonly FreshIn[]): { keep: FreshIn[]; drop: FreshDrop[] } {
  let youtubeTaken = isYoutubeChannel(originChannel) || siblingChannels.some(isYoutubeChannel);
  const keep: FreshIn[] = [], drop: FreshDrop[] = [];
  for (const f of fresh) {
    const fit = videoFitsChannel(f.channel, f.durationMs);
    if (!fit.fits) { drop.push({ pieceId: f.pieceId, channel: f.channel, why: "too_long", say: fit.say, sec: fit.sec, maxSec: fit.maxSec }); continue; }
    if (isYoutubeChannel(f.channel)) {
      if (youtubeTaken) {
        drop.push({ pieceId: f.pieceId, channel: f.channel, why: "youtube_twice",
          say: "같은 영상은 유튜브에 한 번만 올려요 — 한 번 더 올리면 긴 영상이 되지 않고 쇼츠가 하나 더 생겨요." });
        continue;
      }
      youtubeTaken = true;
    }
    keep.push(f);
  }
  return { keep, drop };
}

/* ═══════════════════════════ DB — 자리를 박는다 ═══════════════════════════ */

/** 원본이 이 상태면 «시각이 있다» — 파생을 얹을 수 있다. 🔴 검수 전(generating·draft·in_review)·버린 원본(rejected)에는 안 얹는다. */
/*   🔴 B 계약(dea5b50): «approved·scheduled·publishing·published 일 때만» — 원본을 **다시 만드는 사이**(generating·in_review) 옛 영상이 나가지 않게.
 *   여기에 둘을 더 둔다(B 에게 알림): `awaiting_manual` — **클립 원본은 늘 여기로 간다**(러너 스텁 → «앱에서 올려 주세요»)라 빼면 클립 원본의 파생이 영영 안 얹힌다.
 *   `pending_resume` — 쉬다 깬 원본(`releaseBacklog` 가 원본을 먼저 옮긴다). 🔴 `failed` 는 **뺐다** — 신고로 막힌 원본일 수 있다(`publishOne` takedown).
 *   다시 만드는 중인 파생은 상태가 아니라 `meta.reuse.waitOrigin` 으로 가른다(`isUnplaced`). */
const ORIGIN_READY: ReadonlySet<string> = new Set(["approved", "scheduled", "publishing", "published", "awaiting_manual", "pending_resume"]);
/** 가족 시각으로 치지 않는 상태(안 나간다). */
const NOT_GOING = ["failed", "rejected"] as const;
/** 🔴 B 계약 v1.2 — 파생은 **이 상태 + 시각 없음**으로 태어난다. 크론이 줍는 조건도 이 둘이다. */
export const UNPLACED_STATUS = "scheduled";
/** 원본을 **다시 만드는 중**이라 멈춰 둔 파생인가(B `holdDerivedFor("regenerate")` 가 찍는다 · 다시 승인되면 B 가 지우고 SEAM 으로 온다). */
export const waitsOrigin = (f: Record<string, unknown>): boolean =>
  ((((f.meta && typeof f.meta === "object" ? f.meta : {}) as Record<string, unknown>).reuse ?? {}) as Record<string, unknown>).waitOrigin === true;
/**
 * 시각이 **아직 없는** 파생인가(= 우리가 얹어야 할 것).
 *   🔴 `waitOrigin` 인 파생은 **아니다** — 같은 «scheduled ∧ 시각 없음»이지만 원본을 다시 만드는 중이라, 지금 얹으면 **옛 영상**이 나간다(B dea5b50).
 */
export const isUnplaced = (f: Record<string, unknown>): boolean => String(f.status) === UNPLACED_STATUS && !f.scheduled_for && !waitsOrigin(f);
/** SQL 판 — 크론이 줍는 조건. 🔴 `isUnplaced` 와 **같은 셋**이어야 한다(자 `verify-r18-stagger ⑤` 가 잰다). */
export const UNPLACED_SQL = sql`status = ${UNPLACED_STATUS} AND scheduled_for IS NULL AND COALESCE(meta->'reuse'->>'waitOrigin', '') <> 'true'`;
/** 시각을 다시 맞출 수 있는 상태 — 아직 안 나갔고(`publishing` 아님) 시각이 있는 것. */
const RESEATABLE: readonly string[] = ["scheduled", "pending_resume"];

export interface ScheduleDerivedResult {
  ok: boolean;
  originPieceId: number;
  /** 원본이 아직 시각이 없거나 쓸 수 없는 상태면 그 까닭(파생은 그대로 기다린다). */
  reason?: "no_origin" | "not_origin" | "origin_not_ready";
  placed: { pieceId: number; channel: string; at: string; slotId: number | null }[];
  /** 자리가 없어 기다리는 파생 — 크론이 다시 줍는다. */
  waiting: { pieceId: number; channel: string; say: string }[];
  /** 새서 여기서 잡은 파생(유튜브 두 번 · 길이) — `failed` 로 두었다. */
  dropped: { pieceId: number; channel: string; why: "youtube_twice" | "too_long"; say: string }[];
}

/** 기간 안 시각 목록(나간 글 + 잡힌 글). `where` 는 posts/pieces 공통 조건(계정 또는 채널). */
async function takenTimes(tid: number, fromIso: string, toIso: string, by: { accountId: number } | { channel: string; notAccountId: number }, excludePieceId: number): Promise<Date[]> {
  const acc = "accountId" in by;
  const rows = await q(sql`
    SELECT p.published_at AT TIME ZONE 'UTC' AS at FROM posts p ${acc ? sql`` : sql`JOIN accounts b ON b.id = p.account_id`}
     WHERE p.tenant_id = ${tid} AND p.published_at IS NOT NULL
       AND ${acc ? sql`p.account_id = ${(by as { accountId: number }).accountId}` : sql`b.channel = ${(by as { channel: string }).channel} AND p.account_id <> ${(by as { notAccountId: number }).notAccountId}`}
       AND p.published_at >= (${fromIso}::timestamptz AT TIME ZONE 'UTC') AND p.published_at <= (${toIso}::timestamptz AT TIME ZONE 'UTC')
    UNION ALL
    SELECT x.scheduled_for AT TIME ZONE 'UTC' AS at FROM pieces x ${acc ? sql`` : sql`JOIN accounts b ON b.id = x.account_id`}
     WHERE x.tenant_id = ${tid} AND x.id <> ${excludePieceId} AND x.status NOT IN (${statusListSql(NOT_GOING)}) AND x.scheduled_for IS NOT NULL
       AND ${acc ? sql`x.account_id = ${(by as { accountId: number }).accountId}` : sql`b.channel = ${(by as { channel: string }).channel} AND x.account_id <> ${(by as { notAccountId: number }).notAccountId}`}
       AND x.scheduled_for >= (${fromIso}::timestamptz AT TIME ZONE 'UTC') AND x.scheduled_for <= (${toIso}::timestamptz AT TIME ZONE 'UTC')`);
  return rows.map((r) => utcDate(r.at)).filter((d): d is Date => !!d);
}

/** 날짜(KST)별 «그날을 먹는» 수 — `checkCadenceAt ③` 과 **같은 셈**(나간 글 + `DAY_FREED` 가 아닌 잡힌 글). */
async function dayCounts(tid: number, fromIso: string, toIso: string, by: { accountId: number } | { channels: readonly string[] }, excludePieceId: number): Promise<Map<string, number>> {
  const acc = "accountId" in by;
  const chList = acc ? sql`` : sql.join((by as { channels: readonly string[] }).channels.map((c) => sql`${c}`), sql`, `);
  const rows = await q(sql`
    SELECT d, COUNT(*)::int AS c FROM (
      SELECT to_char((p.published_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d FROM posts p
       WHERE p.tenant_id = ${tid} AND p.published_at IS NOT NULL
         AND ${acc ? sql`p.account_id = ${(by as { accountId: number }).accountId}` : sql`p.channel IN (${chList})`}
         AND p.published_at >= (${fromIso}::timestamptz AT TIME ZONE 'UTC') AND p.published_at <= (${toIso}::timestamptz AT TIME ZONE 'UTC')
      UNION ALL
      SELECT to_char((x.scheduled_for AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d FROM pieces x
       WHERE x.tenant_id = ${tid} AND x.id <> ${excludePieceId} AND x.status NOT IN (${statusListSql(DAY_FREED_STATUSES)}) AND x.scheduled_for IS NOT NULL
         AND ${acc ? sql`x.account_id = ${(by as { accountId: number }).accountId}` : sql`x.channel IN (${chList})`}
         AND x.scheduled_for >= (${fromIso}::timestamptz AT TIME ZONE 'UTC') AND x.scheduled_for <= (${toIso}::timestamptz AT TIME ZONE 'UTC')
    ) t GROUP BY d`);
  return new Map(rows.map((r) => [String(r.d), n(r.c)]));
}

/** 파생의 영상 길이(ms) — 자기 `piece_assets(video)` 가 먼저, 없으면 원본 것(B 가 meta 를 통째로 복사하지만 옛 행 대비). 모르면 0. */
async function videoMsOf(tid: number, pieceId: number, originId: number): Promise<number> {
  const rows = await q(sql`SELECT piece_id, (meta->>'durationMs') AS ms FROM piece_assets
    WHERE tenant_id = ${tid} AND piece_id IN (${pieceId}, ${originId}) AND kind = 'video' ORDER BY (piece_id = ${pieceId}) DESC, id DESC`);
  for (const r of rows) { const v = Number(r.ms); if (Number.isFinite(v) && v > 0) return v; }
  return 0;
}

/** 새서 닿은 파생을 `failed` 로 — 사유 한 줄 + 감사 high(조용히 넘기지 않는다). */
async function dropDerived(tid: number, pieceId: number, originId: number, action: string, say: string, detail: Record<string, unknown>): Promise<void> {
  await q(sql`UPDATE pieces SET status = 'failed', meta = meta || ${jsonb({ failReason: say })}, updated_at = NOW()
    WHERE tenant_id = ${tid} AND id = ${pieceId} AND ${UNPLACED_SQL}`);
  await writeAudit({ tenantId: tid, action, actorType: "system", riskLevel: "high", target: `piece:${pieceId}`,
    detail: { originPieceId: originId, note: "B reuseFit 이 걸렀어야 하는 파생이 편성까지 왔다(둘째 줄에서 잡음)", ...detail } }).catch(() => {});
}

/** 파생 자리의 `slots.origin` 값 — varchar(8) 에 들어간다. 🔴 `listSlots` 는 이 값을 화면에 «자동»으로 보이고, 원본은 `reuseOf` 칸으로 따로 준다. */
export const DERIVED_SLOT_ORIGIN = "derived";

/**
 * scheduleDerived — 이 원본의 **아직 시각이 없는 파생**(`scheduled` · `scheduled_for NULL` · B 계약 v1.2)에 시각과 자리를 준다.
 *   멱등 — 이미 시각이 있는 것은 안 건드린다. 부르는 곳: B `deriveVideoPieces` 끝(«B2 SEAM») · 크론 `reuse.schedule`(매시).
 *   `reseat` — **이미 잡힌** 파생의 시각을 다시 맞출 때(원본을 옮겼다 · 잠깐 멈춤에서 깼다). 🔴 새 시각을 **먼저 찾고, 찾았을 때만** 옮긴다 —
 *     풀었다가 못 찾으면 글과 편성표 자리가 서로 다른 말을 한다. 못 찾은 것은 `waiting` 으로 돌려주고 **그대로 둔다**(부른 쪽이 정한다).
 */
export async function scheduleDerived(tid: number, originPieceId: number, opts: { now?: Date; reseat?: readonly number[] } = {}): Promise<ScheduleDerivedResult> {
  const now = opts.now ?? new Date();
  const res: ScheduleDerivedResult = { ok: true, originPieceId, placed: [], waiting: [], dropped: [] };
  const [o] = await q(sql`SELECT id, channel, status, title, scheduled_for, published_at, origin_piece_id FROM pieces WHERE tenant_id = ${tid} AND id = ${originPieceId}`);
  if (!o) return { ...res, ok: false, reason: "no_origin" };
  if (o.origin_piece_id) return { ...res, ok: false, reason: "not_origin" };
  const originAt = utcDate(o.published_at) ?? (ORIGIN_READY.has(String(o.status)) ? utcDate(o.scheduled_for) : null);
  if (!originAt) return { ...res, ok: false, reason: "origin_not_ready" };
  const title = String(o.title ?? "영상").slice(0, 40);

  const fam = await q(sql`SELECT id, channel, account_id, status, scheduled_for, published_at, meta FROM pieces
    WHERE tenant_id = ${tid} AND origin_piece_id = ${originPieceId} ORDER BY id`);
  const reseatIds = new Set((opts.reseat ?? []).map(n).filter((v) => v > 0));
  const todo = fam.filter((f) => isUnplaced(f) || (reseatIds.has(n(f.id)) && RESEATABLE.includes(String(f.status)) && !!f.scheduled_for));
  if (!todo.length) return res;
  /* 가족 시각 — 안 나가는 것(`failed`·`rejected`)과 **지금 맞출 것**(자기 옛 시각)은 뺀다. */
  const going = fam.filter((f) => !(NOT_GOING as readonly string[]).includes(String(f.status)));
  const family: Date[] = going.filter((f) => !todo.includes(f))
    .map((f) => utcDate(f.published_at) ?? utcDate(f.scheduled_for)).filter((d): d is Date => !!d);

  /* ③④ 새로 온 파생을 먼저 거른다(순수 `triageFresh` — 자가 이 함수를 그대로 돌린다). 새서 온 것은 `failed` + 감사 high. */
  const freshIn: FreshIn[] = [];
  for (const f of todo) if (isUnplaced(f)) freshIn.push({ pieceId: n(f.id), channel: String(f.channel), durationMs: await videoMsOf(tid, n(f.id), originPieceId) });
  const tri = triageFresh(String(o.channel), going.filter((f) => !isUnplaced(f)).map((f) => String(f.channel)), freshIn);
  for (const d of tri.drop) {
    await dropDerived(tid, d.pieceId, originPieceId, d.why === "youtube_twice" ? "reuse_youtube_twice" : "reuse_length_leak", d.say,
      { channel: d.channel, originChannel: String(o.channel), ...(d.sec ? { sec: d.sec, maxSec: d.maxSec } : {}) });
    res.dropped.push({ pieceId: d.pieceId, channel: d.channel, why: d.why, say: d.say });
  }
  const droppedIds = new Set(tri.drop.map((d) => d.pieceId));
  const paused = new Set(await pausedAccountIds(tid).catch(() => [] as number[]));
  const fromIso = new Date(now.getTime() - 86400_000).toISOString();
  const toIso = new Date(Math.max(now.getTime(), originAt.getTime()) + (DERIVED_HORIZON_DAYS + 1) * 86400_000).toISOString();
  /* 🔴 유튜브 하루 수는 `youtubeDailyCap()` **하나뿐인 문**으로 센다 — 여기 5 를 다시 적지 않는다. 맞추는 자기 옛 자리는 빼고 센다. */
  const ytSelf = todo.filter((f) => isYoutubeChannel(f.channel)).map((f) => n(f.id));
  const youtubePool: DayBudget | undefined = ytSelf.length
    ? { cap: () => youtubeDailyCap(), used: await dayCounts(tid, fromIso, toIso, { channels: YOUTUBE_CHANNELS }, ytSelf[0]) }
    : undefined;

  const targets: (StaggerTarget & { reseat: boolean })[] = [];
  for (const f of todo) {
    const pieceId = n(f.id), channel = String(f.channel), accountId = n(f.account_id);
    const label = channelLabelKo(channel);
    const reseat = !isUnplaced(f);
    if (droppedIds.has(pieceId)) continue;
    const [acc] = accountId ? await q(sql`SELECT id, handle, status, channel, daily_cap, min_gap_min, opened_at, warmup_off, created_at,
        (SELECT COUNT(*)::int FROM posts p WHERE p.account_id = a.id AND p.published_at > NOW() - interval '7 days') AS posts_this_week
      FROM accounts a WHERE a.tenant_id = ${tid} AND a.id = ${accountId}`) : [];
    if (!acc || String(acc.channel) !== channel || ["suspended", "disconnected"].includes(String(acc.status)) || paused.has(accountId)) {
      const say = `«${title}» 영상을 ${label}에 올릴 계정을 지금 쓸 수 없어 기다리고 있어요. 계정 화면에서 ${label} 계정을 확인해 주시면 자리가 나는 대로 올려 드려요.`;
      res.waiting.push({ pieceId, channel, say });
      /* 새로 얹으려다 기다리는 것은 **까닭이 무엇이든 같은 칸**에 남긴다(`pieces-get meta.reuseWaiting` — 파생 화면이 한 자리에서 읽는다). */
      if (!reseat) await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ reuseWaiting: { at: now.toISOString(), say } })}, updated_at = NOW()
        WHERE tenant_id = ${tid} AND id = ${pieceId}`).catch(() => []);
      continue;
    }
    const warm = { openedAt: (acc.opened_at as string | null) ?? null, createdAt: (acc.created_at as string | null) ?? null, off: acc.warmup_off === true, postsThisWeek: n(acc.posts_this_week) };
    const customerCap = n(acc.daily_cap) || 2;
    const gap = await gapMinFor(tid, accountId).catch(() => null);
    targets.push({
      pieceId, channel, accountId, reseat,
      takenSameAccount: await takenTimes(tid, fromIso, toIso, { accountId }, pieceId),
      takenSameChannel: await takenTimes(tid, fromIso, toIso, { channel, notAccountId: accountId }, pieceId),
      accountGapMin: effectiveMinGapMin(n(acc.min_gap_min) || 180, warm, now),
      channelGapMin: gap?.gapMin ?? ACCOUNT_GAP_MIN,
      /* 🔴 자동 경로는 워밍업을 **넘기지 않는다**(`CapOpts.override` 주석 «자동 편성은 절대 true 로 부르지 않는다»). */
      day: { cap: (d) => effectiveDailyCap(customerCap, warm, kstToUtc(d, 12, 0)), used: await dayCounts(tid, fromIso, toIso, { accountId }, pieceId) },
      ...(youtubePool && isYoutubeChannel(channel) ? { pool: youtubePool } : {}),
    });
  }

  /* ② 후보를 내고 → **판정자(`checkCadenceAt`)에게 묻는다.** 판정자가 «N시부터»라고 하면 거기서 다시 찾는다(최대 4번). */
  const placedTimes: Date[] = [];
  for (const t of targets) {
    let at: Date | null = null;
    let lastSay = "";
    for (let round = 0; round < 4; round++) {
      const [pick] = staggerDerived({ originAt, family: [...family, ...placedTimes], targets: [t], now });
      if (!pick || !pick.at) break;
      const v = await checkCadenceAt({ tenantId: tid, accountId: t.accountId, channel: t.channel, at: pick.at, excludePieceId: t.pieceId });
      if (v.ok) { at = pick.at; break; }
      lastSay = v.error;
      const d = kstDateStr(pick.at);
      t.notBefore = v.retryAt ? new Date(v.retryAt) : kstToUtc(addDays(d, 1), morningOf(t.channel).h, morningOf(t.channel).m);
      if (v.capped && t.day) t.day.used.set(d, Math.max(t.day.used.get(d) ?? 0, t.day.cap(d)));   // 판정자가 «그날 찼다»면 그날은 다시 안 본다
    }
    const label = channelLabelKo(t.channel);
    if (!at) {
      /* 🔴 §3 말투 — ①사실 ②어떻게 하면 되는지 ③우리가 대신 하는 것. «실패»·«불가» 0. */
      if (t.reseat) {
        res.waiting.push({ pieceId: t.pieceId, channel: t.channel,
          say: `«${title}» 영상의 ${label} 시각을 다시 맞출 자리가 없어 그대로 두었어요. 편성표에서 시각을 직접 옮기실 수 있어요.` });
        continue;
      }
      const say = `«${title}» 영상을 ${label}에 올릴 자리를 아직 못 잡았어요 — 그 계정의 하루 몫이 앞으로 ${DERIVED_HORIZON_DAYS}일 동안 차 있어요. `
        + `하루 몫을 늘리시면 바로 잡아 드리고, 그대로 두셔도 자리가 나면 저절로 잡아 드려요.`;
      res.waiting.push({ pieceId: t.pieceId, channel: t.channel, say });
      /* 파생 화면이 «왜 아직 시각이 없나»를 보여 줄 한 줄(`pieces-get meta.reuseWaiting`). 판정자의 원문은 감사에만 둔다(화면은 서버 문장 하나만). */
      await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ reuseWaiting: { at: now.toISOString(), say } })}, updated_at = NOW()
        WHERE tenant_id = ${tid} AND id = ${t.pieceId}`).catch(() => []);
      await writeAudit({ tenantId: tid, action: "reuse_waiting", actorType: "system", riskLevel: "low", target: `piece:${t.pieceId}`,
        detail: { originPieceId, channel: t.channel, cadence: lastSay || null } }).catch(() => {});
      continue;
    }
    /* 박는다 — 🔴 **조건부 한 줄이 곧 멱등**이다(새것은 «`scheduled` ∧ 시각 없음» · 맞추는 것은 «`scheduled|pending_resume` ∧ 시각 있음» 일 때만).
       두 손이 같이 와도 한 번만 잡히고, 그 사이 나가기 시작한 글(`publishing`)은 안 건드린다. 상태 전이는 없다(B 가 이미 `scheduled` 로 낳았다). */
    const iso = at.toISOString();
    const claimed = await q(sql`UPDATE pieces SET status = 'scheduled', scheduled_for = ${iso}::timestamptz AT TIME ZONE 'UTC',
        meta = (meta - 'reuseWaiting'), updated_at = NOW()
      WHERE tenant_id = ${tid} AND id = ${t.pieceId}
        AND ${t.reseat ? sql`status IN (${statusListSql(RESEATABLE)}) AND scheduled_for IS NOT NULL` : UNPLACED_SQL}
      RETURNING id, slot_id, topic_id, brief_id`);
    if (!claimed.length) continue;   // 다른 손이 먼저 잡았다
    const c = claimed[0];
    const date = kstDateStr(at);
    const note = `«${title}» 영상을 ${label}에도 올려요`;
    let slotId: number | null = n(c.slot_id) || null;
    try {
      if (slotId) {
        /* 이미 자리가 있다(다시 맞추는 경우 · 원본을 다시 만든 뒤 다시 얹는 경우) — 새로 만들지 않고 그 자리를 옮긴다(편성표가 글과 같은 말을 하게).
           🔴 문구도 새로 적는다 — 원본을 다시 만드는 동안 B 가 «다시 만드는 중»을 적어 둘 수 있고, 제목도 바뀌었을 수 있다. */
        await q(sql`UPDATE slots SET status = 'scheduled', publish_at = ${iso}::timestamptz AT TIME ZONE 'UTC', slot_date = ${date}::date, note = ${note}, updated_at = NOW()
          WHERE tenant_id = ${tid} AND id = ${slotId}`);
      } else {
        const [s] = await q(sql`INSERT INTO slots (tenant_id, rule_id, slot_date, channel, kind, account_id, topic_id, brief_id, piece_id, publish_at, status, origin, note)
          VALUES (${tid}, NULL, ${date}::date, ${t.channel}, ${"shorts"}, ${t.accountId}, ${c.topic_id ?? null}, ${c.brief_id ?? null}, ${t.pieceId},
                  ${iso}::timestamptz AT TIME ZONE 'UTC', ${"scheduled"}, ${DERIVED_SLOT_ORIGIN}, ${note})
          RETURNING id`);
        slotId = s ? n(s.id) : null;
        if (slotId) await q(sql`UPDATE pieces SET slot_id = ${slotId} WHERE tenant_id = ${tid} AND id = ${t.pieceId}`);
      }
    } catch (e) {
      /* 자리 쓰기가 실패해도 글은 이미 예약됐다 — 발행은 그대로 간다. 편성표에만 안 보인다는 사실을 남긴다(조용히 삼키지 않는다). */
      await writeAudit({ tenantId: tid, action: "reuse_slot_write_failed", actorType: "system", riskLevel: "medium", target: `piece:${t.pieceId}`,
        detail: { error: String((e as Error)?.message ?? e).slice(0, 200) } }).catch(() => {});
    }
    placedTimes.push(at);
    res.placed.push({ pieceId: t.pieceId, channel: t.channel, at: iso, slotId });
  }

  if (res.placed.length || res.dropped.length) {
    await writeAudit({ tenantId: tid, action: "reuse_scheduled", actorType: "system", riskLevel: "low", target: `piece:${originPieceId}`,
      detail: { originAt: originAt.toISOString(), staggerMin: DERIVED_STAGGER_MIN, reseat: [...reseatIds], placed: res.placed,
        dropped: res.dropped.map((d) => ({ pieceId: d.pieceId, channel: d.channel, why: d.why })), waiting: res.waiting.map((w) => w.pieceId) } }).catch(() => {});
  }
  /* 🔴 사람이 안 보는 경로에서도 닿게(§9 ②) — **새로 얹으려다 못 얹은 것**만 알린다(다시 맞추기는 부른 쪽이 화면에 말한다). */
  const freshWaiting = res.waiting.filter((w) => !reseatIds.has(w.pieceId));
  if (freshWaiting.length) {
    const more = freshWaiting.length > 1 ? ` 외 ${freshWaiting.length - 1}곳도 기다리고 있어요.` : "";
    await notifyOnce(tid, "reuse_waiting", "영상을 올릴 자리를 기다리고 있어요", `${freshWaiting[0].say}${more}`.slice(0, 300), "/app/schedule.html", { withinHours: 24 }).catch(() => false);
  }
  return res;
}

/**
 * restaggerFamily — 가족 시각이 **밖에서** 바뀌었을 때(고객이 원본·파생 시각을 옮김) 시차가 깨진 파생만 다시 맞춘다.
 *   🔴 고객이 **방금 옮긴 그 글은 건드리지 않는다**(`keepPieceId`) — 그건 고객이 고른 시각이다.
 *   🔴 나가는 중·나간 파생도 안 건드린다(`scheduled` ∧ 시각 있음 인 것만).
 *   🔴 막지 않는다(§9) — 자리가 없으면 그대로 두고 그 한 줄을 돌려준다(부른 쪽이 화면에 싣는다).
 */
export async function restaggerFamily(tid: number, anyPieceId: number, opts: { keepPieceId?: number | null; now?: Date } = {}): Promise<{ moved: number; say: string[] }> {
  const [p] = await q(sql`SELECT id, origin_piece_id FROM pieces WHERE tenant_id = ${tid} AND id = ${anyPieceId}`);
  if (!p) return { moved: 0, say: [] };
  const originId = n(p.origin_piece_id) || n(p.id);
  const rows = await q(sql`SELECT id, origin_piece_id, status, scheduled_for, published_at FROM pieces
    WHERE tenant_id = ${tid} AND (id = ${originId} OR origin_piece_id = ${originId})`);
  if (rows.length < 2) return { moved: 0, say: [] };
  const times = rows.filter((r) => !(NOT_GOING as readonly string[]).includes(String(r.status)))
    .map((r) => ({ pieceId: n(r.id), at: utcDate(r.published_at) ?? utcDate(r.scheduled_for) }))
    .filter((x): x is { pieceId: number; at: Date } => !!x.at);
  const clashes = staggerClashes(times);
  if (!clashes.length) return { moved: 0, say: [] };
  const keep = n(opts.keepPieceId);
  const movable = new Set(rows.filter((r) => n(r.origin_piece_id) === originId && String(r.status) === "scheduled" && !!r.scheduled_for && n(r.id) !== keep).map((r) => n(r.id)));
  const reseat = [...new Set(clashes.flatMap((c) => [c.a, c.b]))].filter((id) => movable.has(id));
  if (!reseat.length) return { moved: 0, say: [] };
  const r = await scheduleDerived(tid, originId, { now: opts.now, reseat });
  return { moved: r.placed.length, say: r.waiting.map((w) => w.say) };
}
