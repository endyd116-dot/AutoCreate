/**
 * lib/text-style-store.ts — **계정의 옷장**(R10-4 · 설계 §3.6) 저장·목록·한도·추천(R10-10). DB 있음.
 *   🔎 출처: AC 신규(AM 원본 없음) · 순수 부분은 `lib/text-style.ts`.
 *
 *   ══ 규칙 ══
 *     · 🔴 저장은 **한 곳**(`createTextStyle`)이고 그 안에서 `sanitizeTextStyleForStorage` 를 지난다 — 문이 하나(§3.5). 쓴 직후 `jsonb_typeof` 확인까지가 쓰기다(PITFALLS #1).
 *     · 옷장은 **집(tenant) 단위**로 공유한다(같은 사람이 계정 여럿을 굴린다) · «어느 계정에서 배웠나»는 기록만.
 *     · 값은 코인 0 · **요금제 월 한도**만(`plans.limits.textStylesPerMonth`) — 감사 행(`style_reference`)이 곧 횟수(영상 레퍼런스 `topics_reference` 와 같은 패턴 · KST 달).
 *     · 지우기는 `deleted_at` — 원장(`piece_outcomes.features.styleId`)이 가리키므로 행은 안 지운다.
 *     · 🔴 추천(R10-10)은 **되먹임 원장의 첫 실사용** — 표본이 `MIN_SAMPLES` 미만이면 «아직 몰라요»(지어내지 않는다 · AC-9).
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { jsonb, utcDate } from "./db-util";
import { tenantPlan, textStylesPerMonthOf } from "./plans";
import { outcomeStats, MIN_SAMPLES } from "./outcomes";
import { sanitizeTextStyleForStorage, textStyleSummary, textStyleOutline, textStyleName, textStyleLeakProbe, type TextStyle, type LearnedFrom } from "./text-style";

type Row = Record<string, unknown>;
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

export interface TextStyleRow {
  id: number; name: string; source: LearnedFrom; sourceUrl: string | null; accountId: number | null; createdAt: string;
  style: TextStyle;
  /** 고객이 읽는 문장 배열(서버 정본 · 화면은 영어 키를 안 그린다). */
  summary: string[];
  /** 직접 쓰기가 «구성만 그 틀로» 빌릴 뼈대. */
  outline: { type: string; label: string }[];
  learned: TextStyle["learned"];
}

function toRow(r: Row): TextStyleRow {
  const style = (r.style && typeof r.style === "object" ? r.style : {}) as TextStyle;
  return {
    id: n(r.id), name: String(r.name ?? ""), source: (String(r.source ?? "url") as LearnedFrom), sourceUrl: r.source_url ? String(r.source_url) : null,
  /* 🔴 [2026-09-19 수리 3판 · C `verify-server-time`] `timestamp`(시간대 없음) 칸을 `new Date(글자)` 로 읽으면
     **프로세스 시간대**로 해석된다 — KST 에서 돌면 화면에 **9시간 밀린 시각**이 간다. `utcDate()` 로 못 박는다. */
    accountId: n(r.account_id) || null, createdAt: utcDate(r.created_at)?.toISOString() ?? "",
    style, summary: textStyleSummary(style), outline: textStyleOutline(style), learned: style.learned,
  };
}

/**
 * 저장 — 🔴 문이 하나. 여기서 소독하고, 저장물이 정말 «문장 0» 인지(`textStyleLeakProbe`) 한 번 더 재고, 쓴 직후 jsonb 모양을 확인한다.
 *   같은 주소를 이미 배웠으면(살아 있는 행) **다시 저장하지 않고 그 행을 돌려준다**(횟수·원가 0 · 멱등 · 영상과 같은 관례).
 */
export async function createTextStyle(a: { tenantId: number; accountId?: number | null; from: LearnedFrom; sourceUrl?: string | null; raw: unknown; shots?: number; name?: string | null }): Promise<{ ok: true; row: TextStyleRow; already?: boolean } | { ok: false; step: string; error: string }> {
  const url = String(a.sourceUrl ?? "").trim().slice(0, 400) || null;
  if (url) {
    const [dup] = await q(sql`SELECT * FROM text_styles WHERE tenant_id = ${a.tenantId} AND source_url = ${url} AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`);
    if (dup) return { ok: true, row: toRow(dup), already: true };
  }
  const style = sanitizeTextStyleForStorage(a.raw, a.from, a.shots);
  const probe = textStyleLeakProbe(style);
  /* 🔴 구조상 못 새지만 **재 보고** 남긴다 — «못 샌다»는 믿음이 아니라 측정이어야 한다(가장 긴 문자열이 8을 넘으면 이모지 칸이 뚫린 것). */
  if (probe.longest > 8 || probe.wordy > 0) { console.error("[text-style] 소독 뒤에도 문자열이 남았다 — 저장하지 않는다", probe); return { ok: false, step: "leak", error: "배운 내용을 안전한 모양으로 만들지 못했어요. 다시 해 주세요." }; }
  const name = String(a.name ?? "").trim().slice(0, 80) || textStyleName(a.from, url);
  const [row] = await q(sql`INSERT INTO text_styles (tenant_id, account_id, name, source, source_url, style)
    VALUES (${a.tenantId}, ${a.accountId ?? null}, ${name}, ${a.from}, ${url}, ${jsonb(style as unknown as Record<string, unknown>)}) RETURNING *`);
  if (!row?.id) return { ok: false, step: "insert", error: "스타일을 저장하지 못했어요." };
  const [chk] = await q(sql`SELECT jsonb_typeof(style) AS t FROM text_styles WHERE id = ${n(row.id)}`);
  if (chk?.t !== "object") { console.error("[text-style] style jsonb_typeof 이상", chk); return { ok: false, step: "jsonb", error: "스타일을 저장하지 못했어요." }; }
  return { ok: true, row: toRow(row) };
}

export async function listTextStyles(tid: number): Promise<TextStyleRow[]> {
  const rows = await q(sql`SELECT * FROM text_styles WHERE tenant_id = ${tid} AND deleted_at IS NULL ORDER BY id DESC LIMIT 100`);
  return rows.map(toRow);
}
export async function textStyleOf(tid: number, id: number): Promise<TextStyleRow | null> {
  if (!(id > 0)) return null;
  const [r] = await q(sql`SELECT * FROM text_styles WHERE tenant_id = ${tid} AND id = ${id} AND deleted_at IS NULL LIMIT 1`);
  return r ? toRow(r) : null;
}
/** 지우기 — 행은 남긴다(원장이 가리킨다). 계정 기본 스타일로 걸려 있으면 같이 벗긴다(지운 옷을 입고 나가지 않게). */
export async function deleteTextStyle(tid: number, id: number): Promise<boolean> {
  const rows = await q(sql`UPDATE text_styles SET deleted_at = NOW() WHERE tenant_id = ${tid} AND id = ${id} AND deleted_at IS NULL RETURNING id`);
  if (!rows.length) return false;
  await q(sql`UPDATE accounts SET text_style_id = NULL, updated_at = NOW() WHERE tenant_id = ${tid} AND text_style_id = ${id}`);
  return true;
}
/** 계정에 걸어 두기(null = 벗기기). 남의 집 스타일·지운 스타일은 못 건다. */
export async function setAccountStyle(tid: number, accountId: number, styleId: number | null): Promise<{ ok: true } | { ok: false; step: string; error: string }> {
  const [acc] = await q(sql`SELECT id FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId}`);
  if (!acc) return { ok: false, step: "account", error: "그 계정을 찾지 못했어요." };
  if (styleId) { const st = await textStyleOf(tid, styleId); if (!st) return { ok: false, step: "style", error: "그 스타일을 찾지 못했어요." }; }
  await q(sql`UPDATE accounts SET text_style_id = ${styleId ?? null}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${accountId}`);
  return { ok: true };
}

/** 이달(KST) 배운 횟수 — 감사 행이 곧 횟수(요청 전에 먼저 적는다 · 실패해도 AI 원가는 나갔다). */
export async function textStylesUsedThisMonth(tid: number): Promise<number> {
  const [r] = await q(sql`SELECT COUNT(*) AS c FROM audit_logs WHERE tenant_id = ${tid} AND action = 'style_reference'
    AND date_trunc('month', created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul') = date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul')`).catch(() => [] as Row[]);
  return Number(r?.c || 0);
}
export interface StyleQuota { used: number; limit: number; left: number; resetAt: string }
/** 한도 — 요금제 값(DB > 코드 기본). `resetAt` = 다음 달 1일 00:00 KST(UTC ISO). */
export async function textStyleQuota(tid: number): Promise<StyleQuota> {
  const [{ plan }, used] = await Promise.all([tenantPlan(tid), textStylesUsedThisMonth(tid)]);
  const limit = textStylesPerMonthOf(plan);
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 3600_000);
  const nextMonthKst = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() + 1, 1, 0, 0, 0) - 9 * 3600_000;
  return { used, limit, left: Math.max(0, limit - used), resetAt: new Date(nextMonthKst).toISOString() };
}

export interface StyleRecommendation { measured: boolean; styleId: number | null; line: string; samples: number; avgViews?: number | null }
/**
 * [R10-10] 🔴 되먹임 원장이 추천한다 — «이 스타일로 쓴 글이 반응이 좋았어요». 원장의 **첫 실사용**.
 *   표본이 `MIN_SAMPLES` 미만인 스타일은 후보가 아니다 · 조회를 못 잰 글은 평균에서 빠진다(`outcomeStats`) · 후보가 없으면 `measured:false` + «아직 몰라요».
 *   비교 기준은 평균 조회(없으면 평균 수익) — 스타일 없이 쓴 글(`(없음)`)보다 나은 스타일만 추천한다(«그냥 제일 큰 것»이 아니라 «안 쓴 것보다 나은 것»).
 */
export async function recommendTextStyle(tid: number, styles: readonly { id: number; name: string }[]): Promise<StyleRecommendation> {
  const buckets = await outcomeStats("styleId", { tenantId: tid }).catch(() => []);
  const total = buckets.reduce((a, b) => a + b.samples, 0);
  const none = buckets.find((b) => b.key === "(없음)");
  const cands = buckets
    .filter((b) => b.key !== "(없음)" && b.samples >= MIN_SAMPLES && (b.avgViews !== null || b.avgRevenue !== null))
    .map((b) => ({ ...b, id: n(b.key), score: b.avgViews ?? b.avgRevenue ?? 0 }))
    .filter((b) => styles.some((s) => s.id === b.id))
    .sort((a, b) => b.score - a.score);
  const best = cands[0];
  const baseline = none && none.samples >= MIN_SAMPLES ? (none.avgViews ?? none.avgRevenue ?? null) : null;
  if (!best || (baseline !== null && best.score <= baseline)) {
    const line = total < MIN_SAMPLES
      ? `아직 표본이 적어서 몰라요 — 지금 ${total}편이고 ${MIN_SAMPLES}편부터 말씀드릴게요.`
      : "아직 어느 스타일이 더 잘 되는지 갈리지 않았어요 — 조금 더 쌓이면 말씀드릴게요.";
    return { measured: false, styleId: null, line, samples: total };
  }
  const name = styles.find((s) => s.id === best.id)?.name ?? `스타일 ${best.id}`;
  const metric = best.avgViews !== null ? `평균 조회 ${Number(best.avgViews).toLocaleString("ko-KR")}회` : `평균 수익 ${Number(best.avgRevenue ?? 0).toLocaleString("ko-KR")}원`;
  return { measured: true, styleId: best.id, samples: best.samples, avgViews: best.avgViews,
    line: `«${name}» 스타일로 쓴 글이 반응이 좋았어요 — ${best.samples}편 기준 ${metric}${baseline !== null ? ` (스타일 없이 쓴 글보다 높아요)` : ""}.` };
}
