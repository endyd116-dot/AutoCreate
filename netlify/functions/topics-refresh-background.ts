/**
 * POST /api/topics-refresh-background { tenantId, origin } — Netlify **background** 함수(파일명 -background · 202 즉시 · 15분).
 *   계약 v2.9 §6D. 호출 = `topics-refresh`(사람) · 크론 `slots.assign_topics`(자동) — 둘 다 서버 내부(`x-internal-secret`).
 *
 *   ⚠️ 왜 배경인가: 소재 뽑기는 LLM 1콜(후보 15개) + 네이버 검색량·트렌드 조회라 동기 한도(≈26초)를 넘길 수 있다.
 *      «재 보고 넘으면» 이 아니라 **처음부터** 배경으로 보낸다(CLAUDE §4.5b).
 *   멱등: 이미 도는 중이면 **즉시 끝낸다**(중복 실행 0). 판정은 `lib/topics-refresh-state`(10분 고아 규칙 포함).
 *   상태 기록: 시작 → `{ running:true, startedAt }` · 끝 → `{ running:false, finishedAt, added }` 또는 `{ ..., error }`(사람말 한 문장).
 */
import { refreshTopics } from "../../lib/topics";
import { readRefreshState, humanRefreshError } from "../../lib/topics-refresh-state";
import { mergeSettings } from "./tenant-settings";
import { writeAudit } from "../../lib/audit";
import { requireAiBudget } from "../../lib/billing/ai-cost-cap";

export const config = { path: "/api/topics-refresh-background" };

export default async (req: Request): Promise<Response> => {
  const secret = String(process.env.INTERNAL_SECRET ?? "").trim();
  if (!secret) { console.error("[topics-refresh-background] INTERNAL_SECRET 미설정"); return new Response(JSON.stringify({ ok: false, step: "config" }), { status: 500 }); }
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if ((req.headers.get("x-internal-secret") || "") !== secret) return new Response(JSON.stringify({ ok: false, step: "auth" }), { status: 401 });

  let body: { tenantId?: number; origin?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const tid = Number(body.tenantId || 0);
  const origin = body.origin === "cron" ? "cron" : "user";
  if (!tid) return new Response(JSON.stringify({ ok: false, step: "validate" }), { status: 400 });

  // 이미 도는 중이면 아무 것도 하지 않는다(중복 LLM 호출 = 중복 비용).
  const cur = await readRefreshState(tid);
  if (cur.running) { console.log(`[topics-refresh-background] tid=${tid} 이미 실행 중 — 건너뜀`); return new Response(JSON.stringify({ ok: true, skipped: "running" }), { status: 200 }); }

  // P1R4 §1.5 — AI 원가 일 상한: LLM 을 부르기 전에 잰다(초과면 상태에 사람말 사유를 남기고 끝 · 환율 없으면 막지 않는다).
  const budget = await requireAiBudget(tid);
  if (!budget.ok) {
    await mergeSettings(tid, { topicsRefresh: { running: false, finishedAt: new Date().toISOString(), error: budget.error, origin } });
    return new Response(JSON.stringify({ ok: false, step: "ai_cost_cap", error: budget.error }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const startedAt = new Date().toISOString();
  await mergeSettings(tid, { topicsRefresh: { running: true, startedAt, origin } });
  const t0 = Date.now();
  try {
    const r = await refreshTopics(tid);
    await mergeSettings(tid, { topicsRefresh: { running: false, startedAt, finishedAt: new Date().toISOString(), added: r.added, origin } });
    await writeAudit({ tenantId: tid, action: origin === "cron" ? "topics_refresh_cron" : "topics_refresh_done", actorType: "system",
      detail: { origin, added: r.added, skipped: r.skipped, volumesKnown: r.volumesKnown, growthKnown: r.growthKnown, ms: Date.now() - t0 } });
    console.log(`[topics-refresh-background] tid=${tid} origin=${origin} → added ${r.added} (${Math.round((Date.now() - t0) / 1000)}s)`);
    return new Response(JSON.stringify({ ok: true, added: r.added }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const error = humanRefreshError(e);   // 사람말 한 문장 — 화면이 그대로 띄운다
    await mergeSettings(tid, { topicsRefresh: { running: false, startedAt, finishedAt: new Date().toISOString(), error, origin } });
    await writeAudit({ tenantId: tid, action: "topics_refresh_failed", actorType: "system", riskLevel: "medium",
      detail: { origin, error, detail: String((e as Error)?.message ?? e).slice(0, 300), ms: Date.now() - t0 } });
    console.error(`[topics-refresh-background] tid=${tid} 실패`, e);
    return new Response(JSON.stringify({ ok: false, error }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
};

/**
 * startTopicsRefresh — 배경 함수를 깨운다(호출부 공용: 사람 경로 · 크론 경로).
 *   반환 `started:false, running:true` = 이미 도는 중(계약 v2.9 의 중복 요청 응답 모양 그대로).
 *   🔴 설정(INTERNAL_SECRET·SITE_URL)이 없으면 **정직하게 실패**를 돌려준다 — 폴백으로 동기 실행하지 않는다
 *      (동기로 돌리면 26초 벽에 걸려 «눌렀는데 아무 일도 안 일어난다»가 된다).
 */
export async function startTopicsRefresh(tid: number, origin: "user" | "cron"): Promise<{ started: boolean; running: boolean; error?: string }> {
  const cur = await readRefreshState(tid);
  if (cur.running) return { started: false, running: true };
  const secret = String(process.env.INTERNAL_SECRET ?? "").trim();
  const site = String(process.env.SITE_URL ?? "").replace(/\/$/, "");
  if (!secret || !site) {
    console.error("[topics-refresh] INTERNAL_SECRET 또는 SITE_URL 미설정 — 배경 호출 불가");
    return { started: false, running: false, error: "서버 설정이 아직이라 소재를 뽑지 못했어요." };
  }
  try {
    const r = await fetch(`${site}/api/topics-refresh-background`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ tenantId: tid, origin }),
    });
    if (r.status !== 202 && !r.ok) { console.error(`[topics-refresh] 배경 함수 호출 ${r.status}`); return { started: false, running: false, error: "소재 뽑기를 시작하지 못했어요. 잠시 뒤 다시 해 주세요." }; }
    return { started: true, running: true };
  } catch (e) {
    console.error("[topics-refresh] 배경 함수 호출 실패", String((e as Error)?.message ?? e));
    return { started: false, running: false, error: "소재 뽑기를 시작하지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}
