/**
 * lib/revenue/aggregate.ts — 수익 집계 한 벌(계약 §1.4·§1.4b(5)·§1.4c · DESIGN §9.3). `revenue-summary`·`revenue-daily`·`home-summary` 가 같은 식을 쓴다.
 *   🔴 KST: `day` 는 KST 날짜 칸이다 — «오늘»·«이번 달»·«어제» 경계는 SQL `(NOW() AT TIME ZONE 'Asia/Seoul')::date` 로 만든다(PITFALLS #4 · §0).
 *   🔴 오늘 확정/예상은 **합치지 않는다**(§1.4 v3.2): confirmed = CONFIRMED_SOURCES 의 오늘치 · estimated = 나머지(adpost·adfit·clip·youtube)의 오늘치.
 *   🔴 `days[]` 는 **행이 있는 날만**(0원도 행이면 싣는다 = 수집됐고 0원) · 행이 없는 날은 키가 없다 = «수집 안 됨»(§1.4c · AC-9).
 *   🔎 출처: AC 신규(계약 P1R3-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { utcDate } from "../db-util";
import { CONFIRMED_SOURCES, type Freshness } from "./types";
/* [R11-4 · R11-10] 🔴 축 판정은 **레지스트리 한 곳**(`axisOfChannel` 이 `TEXT_AXIS_KEYS`·`VIDEO_CHANNEL_KEYS` 를 읽는다).
   여기서 «네이버면 글»식 판정을 다시 적지 않는다 — 채널이 늘면 두 곳이 갈린다. */
import { axisOfChannel, axesOfChannels, channelMonetizable, type ChannelKindAxis } from "../channel-registry";
/* [R11-5] 추세 판정은 **순수 함수 한 곳**(`trend.ts`) — 여기서 «몇 %면 오름»을 다시 적지 않는다. 하니스가 그 함수를 실제로 돌린다(AC-99 ⑩). */
import { trendOf, trendSince, type Trend } from "./trend";

const n = (v: unknown) => Number(v || 0);
/** 확정 소스 목록을 SQL 인라인 리스트로 — 배열 파라미터(`ANY($1::text[])`)는 드리즐→postgres-js 경로에서 42846(cannot cast)로 죽는다(2026-09-14 실측). */
const CONFIRMED_IN = sql.join([...CONFIRMED_SOURCES].map((x) => sql`${x}`), sql`, `);
const kstToday = sql`(NOW() AT TIME ZONE 'Asia/Seoul')::date`;

export interface RevenueSummary {
  monthKrw: number; todayConfirmedKrw: number; todayEstimatedKrw: number; prevMonthKrw: number;
  /**
   * 🔴 `amountEstimated` 는 «**그 매체 표의 «예상» 열을 읽었다**»는 뜻이다(러너 `scrape.mjs` 가 찍는다).
   *    ⚠️ `todayEstimatedKrw` 의 «예상»과 **다른 말**이다 — 그쪽은 «어느 **소스**에서 왔나»(커넥터 확정치 `CONFIRMED_SOURCES` 가 아니다)이고,
   *    이쪽은 «그 소스 안에서 **어느 열**을 읽었나»다. 애드포스트는 소스로도 «예상»이고 열로도 «예상수입»이라 둘이 겹쳐 보이지만,
   *    애드핏이 «확정수익» 열을 주면 소스는 여전히 estimated 인데 이 도장은 **안 찍힌다**. 이름이 겹치면 다음 사람이 섞으니 칸을 갈라 둔다.
   *    `note` = 서버가 만드는 한 문장(러너 문구를 그대로 안 쓴다 — 화면 어휘는 한 곳에서 정한다 · 이모지 금지).
   */
  bySource: { source: string; krw: number; freshness: Freshness; lastSyncAt?: string; amountEstimated?: true; note?: string;
    /**
     * [R11-5 · 설계 R11 §4.1] 🔴 **최근 7일 ↔ 직전 7일**. 화면은 매체별 줄 **우측에 작은 글자 한 칸**으로 그린다(새 화면 0).
     *   🔴 **«내림»을 빨강으로 칠하지 않는다** — 수익 화면은 감소도 잉크 중립이다(§13.0b). 그건 화면 규칙이고, 서버는 `dir` 만 준다.
     *   🔴 표본이 모자라면 `dir:"unknown"` + «아직 몰라요»(AC-9). `basis` 가 **무엇을 셌는지** 말한다(편이냐 날이냐).
     */
    trend?: Trend }[];
  /** [P1R7 B3] 계정이 지워졌으면 `handle:"지운 계정"` + `deleted:true` · `channel` 은 빈 문자열(마크를 못 그린다). 금액은 그대로 센다 — 합계 = 내역. */
  byAccount: { accountId: number; handle: string; channel: string; krw: number; deleted?: boolean;
    /** [R12-6] 🔴 **이 채널은 수익이 안 붙어요**(당근 «새소식»). 0원이 **고장이 아니라는 걸** 화면이 말할 수 있게 서버가 실어 준다(AC-10). 붙거나 모르면 키가 없다. */
    noRevenueChannel?: true }[];
  /** [P1R7 B3] 글이 지워졌으면 `title:"지운 글"` + `deleted:true` · 제목이 비었으면 `"제목 없는 글"` + `untitled:true`. */
  topPieces: { pieceId: number; title: string; channel: string; krw: number; deleted?: boolean; untitled?: boolean }[];
  /**
   * [R11-4 · 설계 R11 §3.4] 🔴 **«어디서 났나» — 매체가 아니라 «그 돈이 어디서 나왔나»로 가른다.**
   *   매체로 가르면 **엑스**(글도 영상도 올린다) · **협찬** · **직접 입력**이 어느 쪽인지 영원히 모른다.
   *   3단: ① `piece_id` → 그 글의 채널 → 축(정확) ② 없으면 `account_id` → 그 계정의 채널 → 축(정확 · 계정은 채널마다 한 줄이다)
   *        ③ 🔴 둘 다 없거나 채널을 **표에서 못 찾으면** `other` = «그 밖» — **못 갈랐다고 적는다.**
   *   🔴 ③을 한쪽에 몰지 않는다 — 그게 폴백이 «모른다»를 «특정 값»으로 바꾸는 것이다(AC-92). 돈 이야기에서 제일 비싼 거짓말이다.
   *   `label`·`note` 는 **서버 정본**(AC-52 · 화면이 제 문장을 또 짓지 않는다). `other` 는 **0원이면 줄 자체를 안 싣는다**(0을 보여 주면 «뭔가 잘못됐나» 싶다).
   */
  byAxis: { axis: ChannelKindAxis | "other"; label: string; krw: number; note?: string }[];
  /**
   * [R11-4] 🔴 이 고객이 **가진 축**(연결한 계정의 채널에서 뽑는다 · 수익 행이 아니라 **계정** 기준).
   *   축이 하나뿐이면 화면은 «어디서 났나» 그룹을 **통째로 안 그린다** — 블로그만 하는 사람에게 «영상에서 0원»은 소음이다(설계 §2.3-1).
   *   🔴 수익 행으로 뽑으면 «이번 달에 아직 한 푼도 못 번 축»이 사라져 그룹이 오락가락한다 — 계정이 기준이다.
   */
  axes: ChannelKindAxis[];
  /**
   * [R12-6] 🔴 이 고객이 연결한 채널 중 **수익이 안 붙는 채널**(당근 «새소식»).
   *   왜 따로 싣나: `byAccount` 는 **수익 행이 있는 계정만** 나온다 — 당근 계정은 한 푼도 안 들어오니 **목록에 아예 안 뜬다.**
   *   그러면 «0원이 정상»이라고 말할 자리가 없다. 그래서 «이 채널은 원래 수익이 안 붙어요»를 **채널 단위로** 한 줄 실어 준다(AC-10).
   *   🔴 겁주지 않는다(§3) — 사실 한 줄이지 «못 번다»가 아니다. 문구 정본은 `NO_REVENUE_CHANNEL_NOTE`.
   */
  noRevenueChannels: string[];
}
export interface HomeRevenue { todayConfirmedKrw: number; todayEstimatedKrw: number; yesterdayKrw: number; monthKrw: number }

/** month 'YYYY-MM' → 그 달 1일(KST 날짜 문자열). 형식이 틀리면 이번 달. */
export function monthStart(month: string | null | undefined): string | null {
  return /^\d{4}-\d{2}$/.test(String(month ?? "")) ? `${month}-01` : null;
}

/** 홈 큰 숫자 4개(§1.4b(5)) — 오늘 확정·오늘 예상·어제 전체·이번 달. */
export async function homeRevenue(tid: number): Promise<HomeRevenue> {
  const [r] = await q(sql`SELECT
      COALESCE(SUM(amount_krw) FILTER (WHERE day = ${kstToday} AND source IN (${CONFIRMED_IN})), 0) AS today_confirmed,
      COALESCE(SUM(amount_krw) FILTER (WHERE day = ${kstToday} AND NOT (source IN (${CONFIRMED_IN}))), 0) AS today_estimated,
      COALESCE(SUM(amount_krw) FILTER (WHERE day = ${kstToday} - 1), 0) AS yesterday,
      COALESCE(SUM(amount_krw) FILTER (WHERE day >= date_trunc('month', ${kstToday})::date), 0) AS month
    FROM revenue_daily WHERE tenant_id = ${tid} AND day >= date_trunc('month', ${kstToday})::date - 1`);
  return { todayConfirmedKrw: n(r?.today_confirmed), todayEstimatedKrw: n(r?.today_estimated), yesterdayKrw: n(r?.yesterday), monthKrw: n(r?.month) };
}

/** 수익 탭 상단~TOP5(§1.4). month 가 없으면 이번 달(KST). */
export async function summary(tid: number, month?: string | null): Promise<RevenueSummary> {
  const ms = monthStart(month);
  const start = ms ? sql`${ms}::date` : sql`date_trunc('month', ${kstToday})::date`;
  const [tot] = await q(sql`SELECT
      COALESCE(SUM(amount_krw) FILTER (WHERE day >= ${start} AND day < (${start} + interval '1 month')::date), 0) AS month,
      COALESCE(SUM(amount_krw) FILTER (WHERE day >= (${start} - interval '1 month')::date AND day < ${start}), 0) AS prev,
      COALESCE(SUM(amount_krw) FILTER (WHERE day = ${kstToday} AND source IN (${CONFIRMED_IN})), 0) AS today_confirmed,
      COALESCE(SUM(amount_krw) FILTER (WHERE day = ${kstToday} AND NOT (source IN (${CONFIRMED_IN}))), 0) AS today_estimated
    FROM revenue_daily WHERE tenant_id = ${tid} AND day >= (${start} - interval '1 month')::date`);
  /* 🔴 `amount_estimated` — 그 소스의 그 기간 행 중 **하나라도** 매체 표의 «예상» 열에서 온 것이면 true.
     `amount_head` 는 그때 읽은 열 이름(**가장 최근 행** 것 하나 — 여러 날이 섞이면 최신이 지금 화면을 설명한다).
     BOOL_OR 은 행이 0개면 NULL 을 내므로 아래에서 `=== true` 로만 도장을 찍는다(모르면 안 찍는다 · AC-9). */
  const bySrc = await q(sql`SELECT d.source, COALESCE(SUM(d.amount_krw),0) AS krw, MAX(d.freshness) AS freshness, MAX(d.updated_at) AS last_upd,
      BOOL_OR(d.raw->>'amountEstimated' = 'true') AS amount_estimated,
      (array_agg(d.raw->>'amountHead' ORDER BY d.day DESC, d.id DESC)
         FILTER (WHERE d.raw->>'amountEstimated' = 'true' AND COALESCE(d.raw->>'amountHead','') <> ''))[1] AS amount_head,
      /* 러너가 «합계» 행을 몇 줄 뺐나(사실) — 문장은 아래에서 서버가 만든다. 숫자가 아니면 NULL 이라 안 센다. */
      MAX(NULLIF(d.raw->>'rowsDropped','')::int) AS rows_dropped,
      (SELECT MAX(s.last_ok_at) FROM revenue_sources s WHERE s.tenant_id = d.tenant_id AND s.source = d.source) AS last_ok
    FROM revenue_daily d WHERE d.tenant_id = ${tid} AND d.day >= ${start} AND d.day < (${start} + interval '1 month')::date
    GROUP BY d.tenant_id, d.source ORDER BY krw DESC`);
  /* [P1R7 B3] 🔴 **LEFT JOIN 이어야 한다** — 예전엔 INNER JOIN 이라 계정·글 행이 사라지면 그 돈이 «어느 계정이»·«잘 번 글»에서 **조용히 빠졌다**.
     합계(monthKrw)에는 남아 있으니 **합계 ≠ 내역**이 되고, 고객은 «없어진 돈»을 보게 된다. 수익 행은 주인이 사라져도 남는 것이 맞다(회계) —
     그러니 **«주인 없는 금액»을 서버가 이름 붙여 내려보낸다**(화면이 물음표를 그리지 않게 · 이름은 §RevenueSummary 주석). */
  const byAcc = await q(sql`SELECT d.account_id, a.handle, a.channel, COALESCE(SUM(d.amount_krw),0) AS krw
    FROM revenue_daily d LEFT JOIN accounts a ON a.id = d.account_id AND a.tenant_id = d.tenant_id
    WHERE d.tenant_id = ${tid} AND d.account_id IS NOT NULL AND d.day >= ${start} AND d.day < (${start} + interval '1 month')::date
    GROUP BY d.account_id, a.handle, a.channel ORDER BY krw DESC LIMIT 20`);
  /* [R11-4] 🔴 **축 가르기의 재료** — 한 쿼리로 «그 돈의 채널»까지 따라간다(글 → 계정 순 · 둘 다 없으면 NULL).
     `COALESCE(p.channel, a.channel)` 이 3단 그대로다: 글이 있으면 글의 채널, 없으면 계정의 채널, 둘 다 없으면 NULL = «그 밖».
     🔴 **LEFT JOIN 이어야 한다** — 글·계정 행이 지워져도 그 돈은 남는다(위 byAccount 주석과 같은 이유). 지워진 주인의 돈은 채널을 모르니 «그 밖»으로 간다.
        그게 맞다: 우리가 **정말로 못 가른** 돈이다(지운 계정의 축을 짐작해서 채우면 그게 AC-92 다). */
  const byAxisRows = await q(sql`SELECT COALESCE(p.channel, a.channel) AS ch, COALESCE(SUM(d.amount_krw),0) AS krw
    FROM revenue_daily d
      LEFT JOIN pieces p ON p.id = d.piece_id AND p.tenant_id = d.tenant_id
      LEFT JOIN accounts a ON a.id = d.account_id AND a.tenant_id = d.tenant_id
    WHERE d.tenant_id = ${tid} AND d.day >= ${start} AND d.day < (${start} + interval '1 month')::date
    GROUP BY 1`);
  /* 🔴 축 목록은 **계정**에서 뽑는다(수익 행이 아니라). 지운 계정은 뺀다 — 화면의 «축이 둘인가»는 «지금 무엇을 하고 있나»다. */
  const axisAccRows = await q(sql`SELECT DISTINCT channel FROM accounts WHERE tenant_id = ${tid} AND COALESCE(last_error_kind,'') <> 'removed'`).catch(() => [] as Record<string, unknown>[]);

  /* [R11-5 · 설계 §4.1] 🔴 **추세 재료 — 소스별 7일 창 넷**(28일). «언제부터»를 말하려면 창이 셋 이상이어야 한다(`trendSince`).
     🔴 «몇 편인가»는 소스마다 셀 수 있는 단위가 다르다 — 애드센스·애드포스트는 **계정 단위**로 들어와 `piece_id` 가 NULL 이다.
        그래서 **글 수와 날 수를 둘 다** 세고, 판정 쪽에서 «무엇을 셌는지»(`basis`)를 같이 내보낸다. 못 센 것을 «편»이라고 부르지 않는다(AC-92).
     🔴 창 경계는 **KST 오늘** 기준이다(`kstToday`) — UTC 로 끊으면 새벽에 «어제»가 지난주로 넘어간다(§4.5b). */
  const trendRows = await q(sql`SELECT source,
      (${kstToday} - day) / 7 AS w,
      COALESCE(SUM(amount_krw),0) AS krw,
      COUNT(DISTINCT piece_id)::int AS pieces,
      COUNT(DISTINCT day)::int AS days,
      MIN(day)::text AS from_day
    FROM revenue_daily
    WHERE tenant_id = ${tid} AND day > ${kstToday} - 28 AND day <= ${kstToday}
    GROUP BY 1, 2`).catch(() => [] as Record<string, unknown>[]);

  const top = await q(sql`SELECT d.piece_id, p.title, p.channel, COALESCE(SUM(d.amount_krw),0) AS krw
    FROM revenue_daily d LEFT JOIN pieces p ON p.id = d.piece_id AND p.tenant_id = d.tenant_id
    WHERE d.tenant_id = ${tid} AND d.piece_id IS NOT NULL AND d.day >= ${start} AND d.day < (${start} + interval '1 month')::date
    GROUP BY d.piece_id, p.title, p.channel ORDER BY krw DESC LIMIT 5`);
  return {
    monthKrw: n(tot?.month), prevMonthKrw: n(tot?.prev), todayConfirmedKrw: n(tot?.today_confirmed), todayEstimatedKrw: n(tot?.today_estimated),
    bySource: bySrc.map((r) => {
      const o: RevenueSummary["bySource"][number] = { source: String(r.source), krw: n(r.krw), freshness: (["api", "runner", "manual"].includes(String(r.freshness)) ? String(r.freshness) : "api") as Freshness };
      const at = utcDate(r.last_ok) ?? utcDate(r.last_upd); if (at) o.lastSyncAt = at.toISOString();
      /* 🔴 문구는 **서버가** 만든다(러너 문장을 그대로 흘리지 않는다 — 화면 어휘는 한 곳 · 이모지 금지 · UX 헌장 §3).
         러너는 `raw` 에 **사실**만 남긴다(`amountEstimated`·`amountHead`·`rowsDropped`) — 메인 판정 2026-09-15.
         «러너가 하는 말»을 저장하기 시작하면 그게 또 하나의 진실 원천이 된다. */
      const parts: string[] = [];
      if (r.amount_estimated === true) {
        o.amountEstimated = true;
        const head = String(r.amount_head ?? "").trim();
        parts.push(head ? `«${head}» 열로 읽었어요 — 확정 금액이 아니라 예상치예요` : "매체가 준 예상치예요 — 확정 금액이 아니에요");
      }
      const dropped = n(r.rows_dropped);
      // «합계» 행을 뺐다는 사실을 말해 준다 — 고객이 매체 화면과 숫자를 맞춰 볼 때 «왜 다르지»의 답이 된다.
      if (dropped > 0) parts.push(`매체 표의 합계 행 ${dropped}줄은 뺐어요(같은 돈을 두 번 세지 않으려고요)`);
      if (parts.length) o.note = parts.join(" · ");
      /* [R11-5] 🔴 추세는 **이번 달과 무관하게** 최근 28일에서 나온다 — 달을 넘겨 보고 있을 때 «지난주»가 사라지면 안 된다.
         🔴 이번 달이 **이번 달이 아닐 때**(고객이 지난달을 보고 있을 때)는 추세를 안 싣는다 — «9월을 보는데 추세는 이번 주»가 되면 화면이 거짓말을 한다. */
      if (!ms) { const t = trendForSource(trendRows, String(r.source)); if (t) o.trend = t; }
      return o;
    }),
    /* [P1R7 B3] 주인이 사라졌거나 이름이 비었으면 **서버가 사람말로 이름 붙인다**(화면이 «?»·«제목 없음»을 그리지 않게).
       `deleted`/`untitled` 는 화면이 «지운 계정»을 흐리게 그릴 재료 — 금액은 그대로 센다(회계). */
    byAccount: byAcc.map((r) => {
      const gone = r.handle === null || r.handle === undefined;
      const o: RevenueSummary["byAccount"][number] = { accountId: n(r.account_id), handle: gone ? "지운 계정" : String(r.handle), channel: String(r.channel ?? ""), krw: n(r.krw) };
      if (gone) o.deleted = true;
      /* [R12-6] 🔴 지운 계정엔 안 붙인다 — 채널이 빈 문자열이라 «수익이 없는 채널»인지 알 수 없다(모르면 안 말한다 · AC-9). */
      if (!gone && !channelMonetizable(r.channel)) o.noRevenueChannel = true;
      return o;
    }),
    topPieces: top.map((r) => {
      const gone = r.channel === null || r.channel === undefined;      // piece 행 자체가 없다(LEFT JOIN 미스)
      const title = String(r.title ?? "").trim();
      const o: RevenueSummary["topPieces"][number] = { pieceId: n(r.piece_id), title: gone ? "지운 글" : (title || "제목 없는 글"), channel: String(r.channel ?? ""), krw: n(r.krw) };
      if (gone) o.deleted = true; else if (!title) o.untitled = true;
      return o;
    }),
    byAxis: buildByAxis(byAxisRows.map((r) => ({ channel: r.ch, krw: n(r.krw) })), axesOfChannels(axisAccRows.map((r) => r.channel))),
    axes: axesOfChannels(axisAccRows.map((r) => r.channel)),
    noRevenueChannels: axisAccRows.map((r) => String(r.channel ?? "")).filter((c) => c && !channelMonetizable(c)),
  };
}

/** [R11-4] «어디서 났나» 줄 라벨 — 🔴 **서버 정본**(AC-52). 화면이 «글에서»를 제 손으로 또 적지 않는다. */
export const AXIS_LABEL: Readonly<Record<ChannelKindAxis | "other", string>> = Object.freeze({ text: "글에서", video: "영상에서", other: "그 밖" });
/** [R11-4] «그 밖»이 무엇인지 한 문장 — 🔴 겁주지 않는다(CLAUDE §3): 사실만 말하고 «잘못됐다»고 하지 않는다. */
export const AXIS_OTHER_NOTE = "계정이나 글에 연결되지 않은 수입이에요 — 협찬·직접 입력처럼요.";
/** [R12-6] 수익이 안 붙는 채널 한 문장 — 🔴 **사실만**(겁주지 않는다 · §3). «못 번다»가 아니라 «여기엔 광고가 안 붙는다»다. */
export const NO_REVENUE_CHANNEL_NOTE = "이 채널은 광고 수익이 붙지 않아요 — 0원인 게 맞아요. 글을 보고 찾아오는 손님이 값이에요.";

/**
 * [R11-4] 🔴 **순수 함수** — 채널별 합계 + 이 고객이 가진 축 → «어디서 났나» 줄들(계약 §4-4 «있나»가 아니라 «도나»를 재라 · AC-99 ⑩).
 *   · 채널을 **표에서 못 찾으면**(`axisOfChannel` 이 null) → `other`. 🔴 한쪽에 몰지 않는다(AC-92).
 *   · 고객이 **가진 축**은 0원이어도 줄을 낸다(«영상 0원»은 «아직 못 벌었다»라는 사실이다).
 *   · 🔴 **`other` 는 0원이면 줄을 안 낸다** — 0을 보여 주면 «뭔가 잘못됐나» 싶다(설계 §3.4).
 *   · 고객이 안 가진 축인데 돈이 있으면(계정을 지운 뒤) **그 줄도 낸다** — 합계 ≠ 내역이 되면 안 된다.
 */
/**
 * [R11-5] 소스 하나의 7일 창 넷 → 추세(순수 판정은 `trendOf`·`trendSince` 가 한다).
 *   창 0 = 최근 7일 · 창 1 = 직전 7일 · … 🔴 창이 **없으면 0원이 아니라 «행이 없다»** — 그래도 금액은 0으로 견준다(수집은 됐는데 0원인 것과 같다).
 *      표본(`samples`)은 **창 0 + 창 1** 을 합쳐 센다 — 견주는 두 창을 다 봐야 «견줄 만한가»를 말할 수 있다.
 */
export function trendForSource(rows: readonly Record<string, unknown>[], source: string): Trend | null {
  const mine = rows.filter((r) => String(r.source) === source);
  if (!mine.length) return null;
  const win = (w: number) => mine.find((r) => n(r.w) === w) ?? null;
  const w0 = win(0), w1 = win(1);
  const pieces = n(w0?.pieces) + n(w1?.pieces);
  /* 🔴 글 단위로 하나도 못 셌으면 «편»이라고 말하지 않는다 — 날 수로 세고 그 사실을 `basis` 에 적는다. */
  const basis = pieces > 0 ? "pieces" as const : "days" as const;
  const samples = basis === "pieces" ? pieces : n(w0?.days) + n(w1?.days);
  const windows = [0, 1, 2, 3].map((w) => { const r = win(w); return { from: String(r?.from_day ?? "").slice(0, 10), krw: n(r?.krw) }; }).filter((x) => x.from);
  const base = trendOf({ recentKrw: n(w0?.krw), prevKrw: n(w1?.krw), samples, basis });
  const since = trendSince(base.dir, windows);
  return since ? { ...base, since } : base;
}

export function buildByAxis(rows: readonly { channel: unknown; krw: number }[], ownedAxes: readonly ChannelKindAxis[]): RevenueSummary["byAxis"] {
  const sum: Record<ChannelKindAxis | "other", number> = { text: 0, video: 0, other: 0 };
  for (const r of rows) sum[axisOfChannel(r.channel) ?? "other"] += Math.trunc(Number(r.krw) || 0);
  const out: RevenueSummary["byAxis"] = [];
  for (const a of ["text", "video"] as const) {
    if (!ownedAxes.includes(a) && sum[a] === 0) continue;
    out.push({ axis: a, label: AXIS_LABEL[a], krw: sum[a] });
  }
  if (sum.other > 0) out.push({ axis: "other", label: AXIS_LABEL.other, krw: sum.other, note: AXIS_OTHER_NOTE });
  return out;
}

/** 일별 막대(§1.4c). 행이 있는 날만 — 0원도 행이면 싣는다 · 없는 날은 키 없음(«수집 안 됨»). */
export async function daily(tid: number, from: string, to: string): Promise<{ day: string; krw: number; freshness: Freshness; amountEstimated?: true }[]> {
  /* `amount_estimated` — 그 날 행 중 하나라도 매체 표의 «예상» 열에서 왔으면 true(§RevenueSummary.bySource 주석과 같은 뜻).
     날짜별로도 주는 이유: 어떤 날은 확정이 내려오고 어떤 날은 아직 예상일 수 있어, **그 막대만** 다르게 그릴 수 있어야 한다. */
  const rows = await q(sql`SELECT day::text AS d, COALESCE(SUM(amount_krw),0) AS krw,
      CASE WHEN COUNT(DISTINCT freshness) = 1 THEN MAX(freshness) ELSE 'api' END AS freshness,
      BOOL_OR(raw->>'amountEstimated' = 'true') AS amount_estimated
    FROM revenue_daily WHERE tenant_id = ${tid} AND day >= ${from}::date AND day <= ${to}::date GROUP BY day ORDER BY day`);
  return rows.map((r) => {
    const o: { day: string; krw: number; freshness: Freshness; amountEstimated?: true } = {
      day: String(r.d).slice(0, 10), krw: n(r.krw),
      freshness: (["api", "runner", "manual"].includes(String(r.freshness)) ? String(r.freshness) : "api") as Freshness,
    };
    if (r.amount_estimated === true) o.amountEstimated = true;   // 모르면(NULL) 안 찍는다 — AC-9
    return o;
  });
}

/**
 * 최근 30일 piece 수익(학습 되먹임 §1.6 재료). 표본 수(수익 행 수)도 같이 준다 — 5건 미만이면 호출부가 팩터를 건드리지 않는다.
 */
export async function pieceRevenue30d(tid: number): Promise<Map<number, { krw: number; samples: number }>> {
  const rows = await q(sql`SELECT piece_id, COALESCE(SUM(amount_krw),0) AS krw, COUNT(*)::int AS samples FROM revenue_daily
    WHERE tenant_id = ${tid} AND piece_id IS NOT NULL AND day >= ${kstToday} - 30 GROUP BY piece_id`);
  return new Map(rows.map((r) => [n(r.piece_id), { krw: n(r.krw), samples: n(r.samples) }]));
}
