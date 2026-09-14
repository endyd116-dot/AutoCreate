/**
 * lib/cron/ai-model-watch.ts — AI 모델 자동 감시(계약 P1R4 §2.2 · DESIGN §10 전문). CronStep(hourly 우산 · KST 판정).
 *   §10 그대로:
 *     · (주 1회) `models.list` 를 우리 키로 불러(=API 가 이름을 준다 · 우리가 이름을 지어내지 않는다 · CLAUDE §4.9) 선언 모델과 **diff**.
 *     · 새 후보를 **실측 4종**(text·json강제·googleSearch·image)으로 우리 키로 돌려 본다 → `ai_settings.candidates` 에 저장 + 운영 알림.
 *       googleSearch·image 는 `callGemini` 래퍼가 노출하지 않아 **직접 fetch** 로 실측한다(200=지원·4xx=미지원·그 외=판정불가 null · AC-9 셋 가르기).
 *     · `updateMode='auto'` 면: 통과 후보(text+json)를 `high` 카나리 **10%** 로 올리고(candidate + canary_pct=10), 24h 뒤 `ai_usage`
 *       실측 실패율이 낮으면 **승격**(chain←candidate·prev_chain 보존·canary_pct=100), 높으면 **자동 롤백** + 운영 알림.
 *   🔴 모델 이름 문자열은 여기서 만들지 않는다 — 전부 `ALL_DECLARED_MODELS`·`CHAIN_HIGH`(코드) 와 `models.list`(API) 에서 온다.
 *   🔴 AC-17: publish·runner-jobs 를 최상단 import 하지 않는다(순수 SQL + Gemini + 알림).
 *   전역 스텝 — 발굴 잠금은 `ai_settings.watched_at`(원자적 UPDATE · 6일 안이면 skip). 승격 점검은 멱등(24h·canary_pct<100 행만).
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { jsonb } from "../db-util";
import { ALL_DECLARED_MODELS, CHAIN_HIGH } from "../ai-models";
import { verifyModel, type ModelTest } from "../ai-verify";
import { kstHour, type CronStep, type TenantCtx, type StepOutcome, NOOP } from "./base";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** models.list — API 가 주는 이름만(우리가 짓지 않는다). generateContent 지원 gemini 계열만. */
async function listRemoteModels(): Promise<string[]> {
  const key = String(process.env.GEMINI_API_KEY ?? "").trim();
  if (!key) return [];
  const out: string[] = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const url = `${GEMINI_BASE}?pageSize=200&key=${encodeURIComponent(key)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!r || !r.ok) break;
    const j = (await r.json().catch(() => null)) as { models?: { name?: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string } | null;
    for (const m of j?.models ?? []) {
      const name = String(m?.name ?? "").replace(/^models\//, "");
      if (name && /gemini/i.test(name) && (m.supportedGenerationMethods ?? []).includes("generateContent")) out.push(name);
    }
    if (!j?.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return [...new Set(out)];
}

/** 24h 지난 카나리 승격/롤백(auto 전용) — ai_usage 실측 실패율로 판정. 멱등(canary_pct<100 · candidate 있는 행만). */
async function promoteRipeCanaries(deadline: number): Promise<{ promoted: string[]; rolledBack: string[] }> {
  const promoted: string[] = [], rolledBack: string[] = [];
  const ripe = await q(sql`
    SELECT o.role, (o.candidate->>0) AS model,
      (SELECT COUNT(*) FROM ai_usage u WHERE u.model = (o.candidate->>0) AND u.created_at >= o.candidate_at AND u.purpose NOT LIKE '%:fail') AS ok,
      (SELECT COUNT(*) FROM ai_usage u WHERE u.model = (o.candidate->>0) AND u.created_at >= o.candidate_at AND u.purpose LIKE '%:fail')     AS fail
    FROM ai_model_overrides o
    WHERE o.candidate IS NOT NULL AND jsonb_typeof(o.candidate) = 'array' AND jsonb_array_length(o.candidate) > 0
      AND o.canary_pct < 100 AND o.candidate_at IS NOT NULL AND o.candidate_at <= NOW() - INTERVAL '24 hours'`);
  for (const r of ripe) {
    if (Date.now() > deadline) break;
    const role = String(r.role), model = String(r.model ?? "");
    const ok = Number(r.ok ?? 0), fail = Number(r.fail ?? 0), total = ok + fail;
    if (!model || total < 1) continue;                                   // 표본 없음 — 다음 주기까지 더 관찰
    const failRate = fail / total;
    if (ok >= 1 && failRate <= 0.34) {
      // 승격 — chain←candidate · prev_chain 에 직전 chain 보존(RHS=UPDATE 전 값) · 카나리 종료.
      const done = await q(sql`UPDATE ai_model_overrides
        SET chain = candidate, prev_chain = chain, candidate = NULL, candidate_at = NULL, canary_pct = 100, updated_at = NOW()
        WHERE role = ${role} AND candidate IS NOT NULL AND canary_pct < 100 RETURNING role`);
      if (done.length) { promoted.push(model); await writeAudit({ tenantId: null, action: "ai_candidate_promote", actorType: "system", target: `ai:${role}`, detail: { model, ok, fail }, riskLevel: "medium" }); }
    } else if (failRate >= 0.67) {
      // 자동 롤백 — 후보 폐기(chain=기존 baseline 유지). 운영 알림 high.
      const done = await q(sql`UPDATE ai_model_overrides
        SET candidate = NULL, candidate_at = NULL, canary_pct = 100, updated_at = NOW()
        WHERE role = ${role} AND candidate IS NOT NULL AND canary_pct < 100 RETURNING role`);
      if (done.length) { rolledBack.push(model); await writeAudit({ tenantId: null, action: "ai_candidate_rollback", actorType: "system", target: `ai:${role}`, detail: { model, ok, fail, reason: "canary_unhealthy" }, riskLevel: "high" }); }
    }
    // 0.34~0.67 = 한 주기 더 관찰(건드리지 않는다).
  }
  return { promoted, rolledBack };
}

export const aiModelWatchStep: CronStep = {
  key: "ai.model_watch",
  every: "hourly",
  needsAutoSchedule: false,
  async run(ctx: TenantCtx): Promise<StepOutcome> {
    const deadline = Math.min(ctx.deadline, Date.now() + 15_000);
    const [s] = await q(sql`SELECT update_mode FROM ai_settings WHERE id = 'global'`);
    const mode = String(s?.update_mode ?? "manual");

    // A. 카나리 승격/롤백 — auto 모드 · 매시간(24h 지난 카나리만 · 멱등).
    const promo = mode === "auto" ? await promoteRipeCanaries(deadline) : { promoted: [], rolledBack: [] };

    // B. 주간 발굴 게이트 — 월 06:00(KST) 근처 첫 테넌트만(watched_at 원자 잠금).
    if (kstHour(ctx.now) !== 6) {
      return promo.promoted.length || promo.rolledBack.length
        ? { changed: promo.promoted.length, skipped: promo.rolledBack.length, detail: { promote: promo } } : NOOP;
    }
    const lock = await q(sql`UPDATE ai_settings SET watched_at = NOW(), updated_at = NOW()
      WHERE id = 'global' AND (watched_at IS NULL OR watched_at < NOW() - INTERVAL '6 days') RETURNING id`);
    if (!lock.length) {
      return promo.promoted.length || promo.rolledBack.length
        ? { changed: promo.promoted.length, skipped: promo.rolledBack.length, detail: { promote: promo, discovery: "locked" } }
        : { changed: 0, skipped: 1, detail: { reason: "watched-within-7d" } };
    }

    const remote = await listRemoteModels();
    if (!remote.length) {
      await writeAudit({ tenantId: null, action: "ai_model_watch", actorType: "system", target: "ai", detail: { ok: false, reason: "models.list 실패(키 없음/오류)" }, riskLevel: "low" });
      return { changed: 0, skipped: 1, detail: { reason: "no-remote", promote: promo } };
    }
    const declared = new Set(ALL_DECLARED_MODELS.map((m) => m.toLowerCase()));
    const news = remote.filter((m) => !declared.has(m.toLowerCase()) && !/tts|embedding|aqa|learnlm/i.test(m)).slice(0, 12);

    // 새 후보 전건 기록(실측은 예산 안에서 최대 3종 · 나머지는 tested=null 로 남겨 다음 주에 마저 · 조용한 축소 0).
    const candidates: { model: string; tested: ModelTest | null; at: string }[] = [];
    let testedCount = 0;
    for (const m of news) {
      if (testedCount < 3 && Date.now() < deadline - 2_000) { candidates.push({ model: m, tested: await verifyModel(m, { deadline }), at: new Date().toISOString() }); testedCount++; }
      else candidates.push({ model: m, tested: null, at: new Date().toISOString() });
    }
    await q(sql`UPDATE ai_settings SET candidates = ${jsonb(candidates)}, updated_at = NOW() WHERE id = 'global'`);
    await writeAudit({ tenantId: null, action: "ai_model_watch", actorType: "system", target: "ai",
      detail: { remote: remote.length, newCandidates: news.length, tested: candidates.filter((c) => c.tested).map((c) => ({ model: c.model, ...c.tested })), mode },
      riskLevel: news.length ? "medium" : "low" });

    // auto: text·json 둘 다 통과한 첫 후보를 high 10% 카나리로(이미 카나리 중이면 건드리지 않는다).
    if (mode === "auto") {
      const good = candidates.find((c) => c.tested && c.tested.text === true && c.tested.json === true);
      if (good) {
        const started = await q(sql`INSERT INTO ai_model_overrides (role, chain, candidate, candidate_at, canary_pct, updated_at)
          VALUES ('high', ${jsonb(CHAIN_HIGH)}, ${jsonb([good.model])}, NOW(), 10, NOW())
          ON CONFLICT (role) DO UPDATE SET candidate = EXCLUDED.candidate, candidate_at = NOW(), canary_pct = 10,
            prev_chain = ai_model_overrides.chain, updated_at = NOW()
          WHERE ai_model_overrides.candidate IS NULL RETURNING role`);
        if (started.length) await writeAudit({ tenantId: null, action: "ai_candidate_canary", actorType: "system", target: "ai:high", detail: { model: good.model, canaryPct: 10, mode: "auto" }, riskLevel: "medium" });
      }
    }
    return { changed: candidates.length, skipped: promo.promoted.length + promo.rolledBack.length, detail: { newCandidates: news.length, tested: testedCount, promote: promo } };
  },
};
