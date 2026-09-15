/**
 * lib/outcomes.ts — **어떻게 쓴 글이 잘 되나**를 나중에 답할 수 있게, 글마다 «만들 때의 모습»을 한 행으로 남긴다
 *   (DESIGN §5F · 사장님 지시 2026-09-15 «데이터는 우리가 가져오자» · B-1).
 *
 *   ══ 🔴 왜 «지금» 만드나 — 발행 0건인데 ══
 *     **지난 글의 «어떻게 썼나»는 나중에 복원할 수 없다.** 원장을 안 만들고 반년 뒤에 «왜 저 글이 잘 됐나»를 물으면
 *     답할 재료 자체가 없다. 실발행이 시작되기 전에 자리를 만들어야 한다(메인 판단).
 *     🔴 **되먹임은 아직 0 이다.** 이 파일은 «모으기»만 한다 — 집계 되먹임(②)은 표본 수백 건 뒤, 모델(③)은 수천 건 뒤다.
 *        표본이 적을 때 모델을 돌리면 **우연히 잘 된 글 세 편이 전 고객의 글 모양을 정한다.**
 *
 *   ══ 🔴 무엇을 남기고 무엇을 안 남기나 ══
 *     남긴다: **특징**(만들 때의 모습) · **위험**(나갈 때의 게이트 결과).
 *     🔴 **성과는 여기에 복사하지 않는다** — 조회·좋아요는 `posts.stats`, 수익은 `revenue_daily.piece_id` 에 **이미 있다**.
 *        두 곳에 같은 상태를 쓰면 반드시 갈라진다(계약 §10). 여기서는 **join 으로 읽는다**(`outcomeRows`).
 *     🔴 특징은 **«만들 때»** 박는다(§5F.3-2) — 발행 뒤 piece 에서 되읽으면 그 사이 수정·재생성으로 달라진다.
 *        **그때 그 글이 어떤 모양이었나**가 원장의 값이다.
 *
 *   ══ 🔴 교차 테넌트 ══
 *     A 고객 글이 B 고객 글에 영향을 주는 구조다. 그래서 집계(`outcomeStats`)는 **숫자만** 돌려준다 —
 *     제목·본문·계정·테넌트 id 는 한 칸도 나가지 않는다(§5F.3-3). 되먹이는 것은 «경험담 골격이 1.4배» 같은 **수**이지 글이 아니다.
 *     그리고 **표본 수를 같이** 돌려준다(§5F.3-6) — «3편 기준»과 «300편 기준»을 같은 얼굴로 말하면 안 된다.
 *   🔎 출처: AC 신규(DESIGN §5F · B-1 · 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { jsonb } from "./db-util";
import type { GateReport } from "./ai-tell-gate";
import type { StructurePrint } from "./structure-print";

const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 🔴 집계가 답하기를 **거부하는** 표본 바닥 — 이보다 적으면 수를 주지 않고 «아직 모른다»고 말한다. */
export const MIN_SAMPLES = 30;

/**
 * 글 한 편의 «어떻게 썼나». **만들 때** 채운다.
 *   🔴 모르는 칸은 **넣지 않는다**(`undefined`) — 0 이나 기본값으로 채우면 나중에 «쟀는데 0» 과 구별이 안 된다(AC-9).
 */
export interface FeatureSnapshot {
  channel: string;
  origin: string;                       // auto · manual · self — 🔴 «사람이 쓴 글»과 «AI 가 쓴 글»을 가르는 칸(§5F 핵심)
  format?: string | null;               // 직접 쓴 글은 null(우리가 고른 적이 없다)
  topicGroup?: string | null;
  goal?: string | null;
  goalSource?: string | null;
  /** 이 글이 노린 **검색어** — 소재 제목이 아니라 실제로 검색량이 큰 문구(B-1(신) §라 가 채운다). 못 찾았으면 없다. */
  keyword?: string | null;
  /** 골격 — 지문과 해시(`lib/structure-print.ts`). */
  structureHash?: string;
  structure?: Pick<StructurePrint, "seq" | "h2" | "h3" | "images" | "toc" | "ending" | "blocks">;
  /** 분량 — 잰 값과 그때의 계약 폭(하한 대비 몇 %였나를 나중에 물을 수 있게). */
  chars?: number;
  lengthMin?: number;
  lengthMax?: number;
  /** 사진이 어디서 왔나 — 장수만(`ai`·`stock`·`customer`·`failed`). 🔴 **추정 금지**: 실제로 붙은 것만 센다. */
  photoMix?: { ai?: number; stock?: number; customer?: number; failed?: number };
  /** 대가 3종 — 광고성 글인가(성과가 다르게 나오는 큰 갈래다). */
  paid?: { affiliate?: boolean; sponsored?: boolean; gift?: boolean };
  /** 구성을 어떻게 골랐나(§2.2) — 골격이 최근 글과 얼마나 닮았었나. */
  formatPick?: { overlap?: number; compared?: number; switched?: boolean };
  /** 다시 썼나 · 어느 모델이 썼나. */
  rewritten?: boolean;
  model?: string;
  /** [R10-7] 어느 코인 등급으로 썼나(simple|standard|premium). 옛 글엔 없다. */
  tier?: string;
  /** [R10-10] 어느 스타일(`text_styles.id`)로 썼나 — 되먹임 원장의 **첫 실사용**(«이 스타일로 쓴 글이 반응이 좋았어요»)이 이 칸으로 묶는다. 없으면 «스타일 없이». */
  styleId?: number;
}

/**
 * 나갈 때의 **위험** — 🔴 §9 로 막는 게이트가 0개가 되면서 «위험을 안고 나간 글»이 생긴다.
 *   그 글이 **실제로 정지됐나**를 나중에 대조할 수 있으면, **우리 위험 판단이 맞았는지**를 처음으로 알게 된다(메인).
 *   실패한 축만 담는다(통과는 «없음»으로 충분하고, 전부 담으면 행이 무겁다).
 */
export interface RiskSnapshot {
  ok: boolean;
  /** 실패한 축 — 무게가 큰 것이 앞에 온다. */
  failed: { key: string; weight?: string; detail?: string }[];
  /** 안 잰 축(직접 쓴 글의 AI 티 축 등) — «통과»와 구별한다. */
  skipped?: string[];
  high: number;                         // 무게 high 로 실패한 수 — 한 눈에 보는 값
}

export function riskOf(gate: GateReport | null | undefined): RiskSnapshot {
  const checks = gate?.checks ?? [];
  const failed = checks.filter((c) => !c.pass && !c.skipped)
    .map((c) => ({ key: c.key, ...(c.weight ? { weight: c.weight } : {}), ...(c.detail ? { detail: String(c.detail).slice(0, 160) } : {}) }))
    .sort((a, b) => (a.weight === "high" ? -1 : 0) - (b.weight === "high" ? -1 : 0));
  const skipped = checks.filter((c) => c.skipped).map((c) => c.key);
  return { ok: gate?.ok === true, failed, high: failed.filter((f) => f.weight === "high").length, ...(skipped.length ? { skipped } : {}) };
}

/**
 * 원장 한 행을 남긴다(있으면 갱신). **글을 만든 직후**에 부른다.
 *   🔴 실패해도 글 만들기를 멈추지 않는다 — 원장은 «있으면 좋은 것»이지 «없으면 못 만드는 것»이 아니다.
 *      다만 **조용히 넘기지 않는다**(AC-58): 못 남겼으면 로그에 크게 적는다.
 */
export async function recordOutcome(a: {
  tenantId: number; pieceId: number; accountId?: number | null;
  features: FeatureSnapshot; risk?: RiskSnapshot | null;
}): Promise<boolean> {
  /* 🔴 **주인 없는 행을 만들지 않는다** — `piece_id` 에 외래키가 없어서, 0 이나 잘못된 값도 그냥 들어간다.
     원장은 «어느 글이었나»가 전부인 표라, 주인을 모르는 행은 **쓰레기이면서 집계를 오염시킨다**.
     (되짚기에서 걸렸다: 없는 piece 로 불러도 조용히 true 가 나왔다.) */
  if (!(a.tenantId > 0) || !(a.pieceId > 0) || !a.features?.channel) {
    console.error(`[outcomes] 원장 기록 거절 — tenant ${a.tenantId} · piece ${a.pieceId} · channel «${a.features?.channel ?? ""}»`);
    return false;
  }
  try {
    await q(sql`INSERT INTO piece_outcomes (tenant_id, piece_id, channel, account_id, origin, features, risks)
      VALUES (${a.tenantId}, ${a.pieceId}, ${a.features.channel}, ${a.accountId ?? null}, ${a.features.origin},
              ${jsonb(a.features)}, ${a.risk ? jsonb(a.risk) : null})
      ON CONFLICT (piece_id) DO UPDATE SET features = EXCLUDED.features, risks = EXCLUDED.risks,
        channel = EXCLUDED.channel, account_id = EXCLUDED.account_id, origin = EXCLUDED.origin, updated_at = NOW()`);
    /* 쓴 직후 확인까지가 쓰기다(PITFALLS #1) — jsonb 가 문자열로 들어가면 집계가 영영 못 읽는다. */
    const [chk] = await q(sql`SELECT jsonb_typeof(features) AS t FROM piece_outcomes WHERE piece_id = ${a.pieceId}`);
    if (chk?.t !== "object") { console.error("[outcomes] features jsonb_typeof 이상", chk); return false; }
    return true;
  } catch (e) {
    console.error(`[outcomes] piece ${a.pieceId} 원장 기록 실패 — 글은 그대로 간다`, String((e as Error)?.message ?? e).slice(0, 200));
    return false;
  }
}

export interface OutcomeRow {
  pieceId: number; channel: string; origin: string;
  features: FeatureSnapshot; risks: RiskSnapshot | null;
  publishedAt: string | null;
  views: number | null; likes: number | null; comments: number | null;   // null = **못 쟀다**(0 과 다르다 · AC-9)
  revenueKrw: number;
}

/**
 * 한 집의 원장 — 성과는 **join 으로** 읽는다(복사해 두지 않는다).
 *   🔴 `views` 가 `null` 이면 «조회 0회»가 아니라 **«아직 못 쟀다»** 다(`lib/cron/learn.ts` 가 그 둘을 이미 가른다).
 */
export async function outcomeRows(tid: number, limit = 200): Promise<OutcomeRow[]> {
  const rows = await q(sql`
    SELECT o.piece_id, o.channel, o.origin, o.features, o.risks,
           po.published_at, po.stats,
           COALESCE((SELECT SUM(r.amount_krw) FROM revenue_daily r WHERE r.piece_id = o.piece_id), 0)::int AS revenue_krw
      FROM piece_outcomes o
      LEFT JOIN LATERAL (SELECT x.published_at, x.stats FROM posts x WHERE x.piece_id = o.piece_id ORDER BY x.id DESC LIMIT 1) po ON TRUE
     WHERE o.tenant_id = ${tid}
     ORDER BY o.id DESC LIMIT ${Math.min(1000, Math.max(1, limit))}`);
  return rows.map((r) => {
    const st = (r.stats && typeof r.stats === "object" ? r.stats : {}) as Record<string, unknown>;
    const num = (v: unknown) => (v === null || v === undefined ? null : n(v));
    return {
      pieceId: n(r.piece_id), channel: String(r.channel ?? ""), origin: String(r.origin ?? "auto"),
      features: (r.features ?? {}) as FeatureSnapshot,
      risks: (r.risks ?? null) as RiskSnapshot | null,
      publishedAt: r.published_at ? String(r.published_at) : null,
      views: num(st.views), likes: num(st.likes), comments: num(st.comments),
      revenueKrw: n(r.revenue_krw),
    };
  });
}

export interface StatBucket { key: string; samples: number; avgViews: number | null; avgRevenue: number | null }

/**
 * 🔴 **집계 — 숫자만 나간다.** 제목·본문·계정·테넌트는 한 칸도 싣지 않는다(§5F.3-3).
 *   `by` 가 가리키는 특징 칸으로 묶어 «표본 수 · 평균 조회 · 평균 수익»을 돌려준다.
 *   🔴 표본이 `MIN_SAMPLES` 미만인 묶음은 **평균을 주지 않는다**(`null`) — 수는 그대로 보여 준다.
 *      «3편 기준»과 «300편 기준»을 같은 얼굴로 말하지 않기 위해서다(§5F.3-6).
 *   🔴 **조회를 못 잰 글은 평균에서 뺀다** — 0 으로 세면 «아직 안 재진 글»이 평균을 끌어내린다(AC-9).
 */
export async function outcomeStats(by: "origin" | "channel" | "topicGroup" | "goal" | "format" | "styleId" | "tier", opts: { tenantId?: number | null } = {}): Promise<StatBucket[]> {
  const col = by === "origin" ? sql`o.origin` : by === "channel" ? sql`o.channel` : sql`o.features->>${by}`;
  const scope = opts.tenantId ? sql`AND o.tenant_id = ${opts.tenantId}` : sql``;
  const rows = await q(sql`
    SELECT COALESCE(${col}, '(없음)') AS k,
           COUNT(*)::int AS samples,
           AVG((po.stats->>'views')::numeric) FILTER (WHERE po.stats ? 'views') AS avg_views,
           AVG(rv.krw) FILTER (WHERE rv.krw IS NOT NULL) AS avg_revenue
      FROM piece_outcomes o
      LEFT JOIN LATERAL (SELECT x.stats FROM posts x WHERE x.piece_id = o.piece_id ORDER BY x.id DESC LIMIT 1) po ON TRUE
      LEFT JOIN LATERAL (SELECT SUM(r.amount_krw) AS krw FROM revenue_daily r WHERE r.piece_id = o.piece_id) rv ON TRUE
     WHERE TRUE ${scope}
     GROUP BY 1 ORDER BY 2 DESC`);
  return rows.map((r) => {
    const samples = n(r.samples);
    const enough = samples >= MIN_SAMPLES;
    return {
      key: String(r.k ?? "(없음)"), samples,
      avgViews: enough && r.avg_views !== null && r.avg_views !== undefined ? Math.round(Number(r.avg_views)) : null,
      avgRevenue: enough && r.avg_revenue !== null && r.avg_revenue !== undefined ? Math.round(Number(r.avg_revenue)) : null,
    };
  });
}
