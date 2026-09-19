/**
 * 운영센터 — AI 엔진(계약 P1R4 §2.2 · DESIGN §10 전문). 🔴 모델 무배포 갱신·카나리·자동/수동·원가 상한.
 *   GET  /api/ops-ai-models    → { ok, roles:[{ role, codeChain, chain, candidate, canaryPct, prevChain, candidateAt, appliedAt }], settings:{ updateMode, candidates },
 *                                  keys:{ count, perInstance:true, items:[{ label:"key#1", resting, restsUntilSec, rested, used }] } }   // [R8 §3.3] 키 로테이션 — 🔴 키 값은 안 싣는다
 *   POST /api/ops-ai-apply     { role, chain:[model], canaryPct }  → { ok, role, chain, candidate, canaryPct }   // canaryPct<100=카나리·=100=전량 적용
 *   POST /api/ops-ai-rollback  { role }                            → { ok, role, chain }                          // prev_chain 복원 + 후보 폐기
 *   POST /api/ops-ai-mode      { mode: "manual"|"auto" }           → { ok, updateMode }
 *   POST /api/ops-ai-cost-cap  { tenantId, costCapKrw:number|null } → { ok, tenantId, costCapKrw }
 *   POST /api/ops-ai-video-kill { enabled:boolean, tenantId?:number|null, note?:string } → { ok, enabled, tenantId, note }
 *        🔴 **영상 만들기 멈춤 스위치**(계약 §1.6 kill switch). `lib/video/cost.ts videoKillSwitchActive` 가 읽는 **그 칸**을 쓴다
 *           (`feature_flags(key='video')` · `tenant_id NULL` = 전 고객 · 숫자 = 그 고객만). 판정은 B 한 벌(여기선 칸만 쓴다).
 *        🔴 이 스위치는 **§9 의 «게이트»가 아니다** — 고객 계정을 우리 판단으로 막는 것이 아니라
 *           **우리 돈·우리 공급자를 우리가 끄는 손잡이**다. 2026-09-20 까지 이 손잡이가 **없었다**(읽는 코드만 있고 쓰는 길 0 ·
 *           `scripts/verify-write-path-missing.mjs` 가 잡았다). 이미 fail-closed 로 만들어 놓고 «끌 수는 없는데 고장 나면 잠기는» 모양이었다.
 *        🔴 B(lib/billing/ai-cost-cap.ts)의 판정 함수 checkAiCostCap 이 읽는 **그 키**를 쓴다 — `tenants.settings.aiCostCapKrwPerDay`(테넌트별 · null=플랜기본).
 *           판정 함수·환율(fxToKrw)은 B 한 벌만(이중 게이트 금지 · 메인 결정 6). 여기선 키만 세팅한다.
 *   권한: 조회 operator+ · 변경 **super_admin 전용**(AI 엔진은 플랫폼 설정 · DESIGN §11.4 는 admin 을 고객/이벤트/결제/CS 로 한정). 🔴 모델 이름은
 *        페이로드→오버레이(§4.9 «무배포 갱신»). 코드에 없던 모델명은 넣기 전 **우리 키로 불러 본다**(verifyChain · §4.9). ai-models.ts 밖 리터럴 금지.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { jsonb, utcDate } from "../../lib/db-util";
import { sql } from "drizzle-orm";
import { callGemini } from "../../lib/ai";
import { CHAIN_HIGH, CHAIN_LOW, CHAIN_DIRECTOR, CHAIN_LANDING_GEN, CHAIN_IMAGE, ALL_DECLARED_MODELS } from "../../lib/ai-models";
import { aiKeyCount, aiKeyStats } from "../../lib/ai-key";   // [R8 · §3.3] 키 로테이션 — 어느 키가 몇 번 쉬었나(키 값은 안 싣는다)

export const config = { path: ["/api/ops-ai-models", "/api/ops-ai-apply", "/api/ops-ai-rollback", "/api/ops-ai-mode", "/api/ops-ai-cost-cap", "/api/ops-ai-video-kill"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");

/** 역할 → 코드 기본 체인. 🔴 모델명은 ai-models.ts 에서만 온다(여기서 짓지 않는다). */
const CODE_CHAIN: Record<string, string[]> = { high: CHAIN_HIGH, low: CHAIN_LOW, director: CHAIN_DIRECTOR, landing: CHAIN_LANDING_GEN, image: CHAIN_IMAGE };
const AI_ROLES = Object.keys(CODE_CHAIN);

type Row = Record<string, unknown>;
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const cleanChain = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim()).filter(Boolean).map((s) => s.slice(0, 60)).slice(0, 6);
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);

/** §4.9 — 코드에 없던 모델은 넣기 전에 우리 키로 불러 본다. 하나라도 안 되면 거부(적용 안 함). */
async function verifyChain(chain: string[]): Promise<{ ok: boolean; badModel?: string; reason?: string }> {
  const declared = new Set(ALL_DECLARED_MODELS.map((m) => m.toLowerCase()));
  for (const m of chain) {
    if (declared.has(m.toLowerCase())) continue;   // 이미 코드에서 검증된 모델 — 재확인 생략
    const r = await callGemini({ purpose: "ops_verify", chain: [m], user: "한 단어로만 답: ok", timeoutMs: 15_000, budgetMs: 15_000 }).catch(() => null);
    if (!r || !r.ok) return { ok: false, badModel: m, reason: r?.reason ?? "no_response" };
  }
  return { ok: true };
}

export default async (req: Request): Promise<Response> => {
  const path = routeOf(req);
  try {
    if (path.endsWith("/ops-ai-models") && req.method === "GET") {
      const g = await requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
      const rows = await q(sql`SELECT role, chain, candidate, canary_pct, prev_chain, candidate_at, applied_at FROM ai_model_overrides`);
      const byRole = new Map(rows.map((r) => [String(r.role), r]));
      const roles = AI_ROLES.map((role) => {
        const r = byRole.get(role);
        return {
          role, codeChain: CODE_CHAIN[role],
          chain: r ? arr(r.chain) : CODE_CHAIN[role],
          candidate: r?.candidate ? arr(r.candidate) : null,
          canaryPct: r ? Number(r.canary_pct ?? 100) : 100,
          prevChain: r?.prev_chain ? arr(r.prev_chain) : null,
          candidateAt: utcDate(r?.candidate_at)?.toISOString() ?? null,
          appliedAt: utcDate(r?.applied_at)?.toISOString() ?? null,
        };
      });
      // 원가 상한은 테넌트별(tenants.settings.aiCostCapKrwPerDay · B 판정) — 전역 값을 여기 싣지 않는다.
      const [s] = await q(sql`SELECT update_mode, candidates FROM ai_settings WHERE id = 'global'`);
      /* [R8 · DESIGN §3.3] 🔴 **어느 키가 몇 번 쉬었나** — 운영이 보는 숫자.
         🔴 키 값도 끝 4자도 안 싣는다. 순번(`key#2`)이면 운영자가 `GEMINI_API_KEYS` 의 몇 번째인지 안다(`lib/ai-key.ts` 헤더).
         ⚠️ 이 숫자는 **이 함수 인스턴스가 본 것**이다(콜드 스타트마다 0). «전체 합계»가 아니라는 뜻이고, 화면도 그렇게 말해야 한다. */
      /* 🔴 영상 멈춤 스위치의 **지금 값** — 화면이 이걸 그려야 «켜고 끌 손잡이»가 된다(§4.8: 고르는 UI 까지가 그 기능).
         전역 한 줄 + 고객별로 따로 멈춘 수를 같이 싣는다(전역이 켜져 있어도 개별로 멈춘 고객이 있을 수 있다). */
      const flags = await q(sql`SELECT tenant_id, enabled, note, updated_at FROM feature_flags WHERE key = 'video'`).catch(() => [] as Row[]);
      const globalRow = flags.find((r) => r.tenant_id == null);
      const video = {
        enabled: globalRow ? globalRow.enabled !== false : true,          // 행이 없으면 켜짐(기본값)
        note: globalRow?.note == null ? null : String(globalRow.note),
        updatedAt: utcDate(globalRow?.updated_at)?.toISOString() ?? null,
        stoppedTenants: flags.filter((r) => r.tenant_id != null && r.enabled === false).map((r) => n(r.tenant_id)),
      };
      return json({ ok: true, roles, settings: { updateMode: String(s?.update_mode ?? "manual"), candidates: s?.candidates ?? [] },
        video,
        keys: { count: aiKeyCount(), perInstance: true, items: aiKeyStats() } });
    }

    // ── 여기부터 변경 = super_admin 전용(엔진은 플랫폼 설정 · 메인 결정 4) ──
    const g = await requireAdmin(req, ["super_admin"]); if (!g.ok) return g.res;
    if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
    const b = await readJson<Record<string, unknown>>(req);
    const oid = g.ops.oid;

    if (path.endsWith("/ops-ai-apply")) {
      const role = String(b.role ?? "");
      if (!AI_ROLES.includes(role)) return badRequest("role");
      const chain = cleanChain(b.chain);
      if (!chain.length) return badRequest("chain 이 비었어요", "chain");
      const pct = Math.max(1, Math.min(100, Math.trunc(Number(b.canaryPct ?? 100)) || 100));
      // §4.9 — 코드에 없던 모델은 우리 키로 불러 본다.
      const v = await verifyChain(chain);
      if (!v.ok) return json({ ok: false, error: `모델 «${v.badModel}» 을(를) 우리 키로 부를 수 없어요(${v.reason}). 적용을 취소했어요.`, step: "verify", detail: { badModel: v.badModel, reason: v.reason } }, 400);

      let row;
      if (pct >= 100) {
        // 전량 적용 — chain 교체 · 후보 없음 · prev_chain 에 직전 chain 보존.
        [row] = await q(sql`INSERT INTO ai_model_overrides (role, chain, candidate, candidate_at, canary_pct, prev_chain, applied_by, applied_at, updated_at)
          VALUES (${role}, ${jsonb(chain)}, NULL, NULL, 100, NULL, ${oid}, NOW(), NOW())
          ON CONFLICT (role) DO UPDATE SET chain = EXCLUDED.chain, candidate = NULL, candidate_at = NULL, canary_pct = 100,
            prev_chain = ai_model_overrides.chain, applied_by = ${oid}, applied_at = NOW(), updated_at = NOW()
          RETURNING role, chain, candidate, canary_pct`);
      } else {
        // 카나리 — baseline(chain)은 두고 candidate 를 pct% 로. 새 행이면 baseline=코드 기본.
        [row] = await q(sql`INSERT INTO ai_model_overrides (role, chain, candidate, candidate_at, canary_pct, prev_chain, applied_by, applied_at, updated_at)
          VALUES (${role}, ${jsonb(CODE_CHAIN[role])}, ${jsonb(chain)}, NOW(), ${pct}, NULL, ${oid}, NOW(), NOW())
          ON CONFLICT (role) DO UPDATE SET candidate = EXCLUDED.candidate, candidate_at = NOW(), canary_pct = ${pct},
            prev_chain = ai_model_overrides.chain, applied_by = ${oid}, applied_at = NOW(), updated_at = NOW()
          RETURNING role, chain, candidate, canary_pct`);
      }
      await writeAudit({ tenantId: null, action: "ops_ai_apply", actorType: "operator", actorId: oid, target: `ai:${role}`, detail: { chain, canaryPct: pct }, riskLevel: "high" });
      return json({ ok: true, role, chain: arr(row.chain), candidate: row.candidate ? arr(row.candidate) : null, canaryPct: Number(row.canary_pct ?? 100) });
    }

    if (path.endsWith("/ops-ai-rollback")) {
      const role = String(b.role ?? "");
      if (!AI_ROLES.includes(role)) return badRequest("role");
      const [row] = await q(sql`UPDATE ai_model_overrides
        SET chain = COALESCE(prev_chain, chain), candidate = NULL, candidate_at = NULL, canary_pct = 100,
            prev_chain = NULL, applied_by = ${oid}, applied_at = NOW(), updated_at = NOW()
        WHERE role = ${role} RETURNING role, chain`);
      if (!row) return json({ ok: false, error: "이 역할엔 되돌릴 오버레이가 없어요(코드 기본 사용 중).", step: "not_found" }, 404);
      await writeAudit({ tenantId: null, action: "ops_ai_rollback", actorType: "operator", actorId: oid, target: `ai:${role}`, detail: { chain: arr(row.chain) }, riskLevel: "high" });
      return json({ ok: true, role, chain: arr(row.chain) });
    }

    if (path.endsWith("/ops-ai-mode")) {
      const mode = String(b.mode ?? "");
      if (mode !== "manual" && mode !== "auto") return badRequest("mode 는 manual|auto", "mode");
      await q(sql`UPDATE ai_settings SET update_mode = ${mode}, updated_by = ${oid}, updated_at = NOW() WHERE id = 'global'`);
      await writeAudit({ tenantId: null, action: "ops_ai_mode", actorType: "operator", actorId: oid, target: "ai", detail: { mode }, riskLevel: "high" });
      return json({ ok: true, updateMode: mode });
    }

    if (path.endsWith("/ops-ai-cost-cap")) {
      // 🔴 B 가 읽는 키(tenants.settings.aiCostCapKrwPerDay)만 쓴다 — 판정·환율·게이트는 B 의 lib/billing/ai-cost-cap.ts 한 벌.
      const tenantId = n(b.tenantId);
      if (!tenantId) return badRequest("tenantId 가 필요해요(테넌트별 상한)", "tenant");
      const [t] = await q(sql`SELECT id FROM tenants WHERE id = ${tenantId} LIMIT 1`);
      if (!t) return json({ ok: false, error: "그 테넌트가 없어요.", step: "tenant" }, 404);
      const raw = b.costCapKrw;
      const capKrw = raw == null || raw === "" ? null : Math.max(0, Math.trunc(Number(raw)));
      if (capKrw != null && !Number.isFinite(capKrw)) return badRequest("costCapKrw", "cost_cap");
      // null = 오버라이드 제거(플랜 기본값으로 복귀) · 값 = 그 테넌트 하루 상한(원).
      if (capKrw == null) await q(sql`UPDATE tenants SET settings = settings - 'aiCostCapKrwPerDay', updated_at = NOW() WHERE id = ${tenantId}`);
      else await q(sql`UPDATE tenants SET settings = settings || ${jsonb({ aiCostCapKrwPerDay: capKrw })}, updated_at = NOW() WHERE id = ${tenantId}`);
      await writeAudit({ tenantId, action: "ops_ai_cost_cap", actorType: "operator", actorId: oid, target: `tenant:${tenantId}`, detail: { costCapKrw: capKrw }, riskLevel: "medium" });
      return json({ ok: true, tenantId, costCapKrw: capKrw });
    }

    if (path.endsWith("/ops-ai-video-kill")) {
      /* 🔴 **영상 만들기 멈춤 스위치.** `lib/video/cost.ts videoKillSwitchActive` 가 읽는 그 칸만 쓴다 —
         판정(무엇을 막나)은 거기 한 벌이다. 여기서 두 번째 문을 만들지 않는다. */
      if (typeof b.enabled !== "boolean") return badRequest("enabled 는 true(켜기)/false(멈춤) 예요.", "enabled");
      const enabled = b.enabled;
      const tenantId = b.tenantId == null || b.tenantId === "" ? null : n(b.tenantId);
      if (tenantId !== null) {
        if (!tenantId) return badRequest("tenantId 가 올바르지 않아요.", "tenant");
        const [t] = await q(sql`SELECT id FROM tenants WHERE id = ${tenantId} LIMIT 1`);
        if (!t) return json({ ok: false, error: "그 고객이 없어요.", step: "tenant" }, 404);
      }
      const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : null;
      /* 멱등 — 같은 칸을 두 번 눌러도 한 행이다. 유일 인덱스가 `(key, COALESCE(tenant_id, 0))` 라 충돌 대상도 그 식이다. */
      await q(sql`INSERT INTO feature_flags (key, tenant_id, enabled, note, updated_by, updated_at)
        VALUES ('video', ${tenantId}, ${enabled}, ${note}, ${oid}, NOW())
        ON CONFLICT (key, COALESCE(tenant_id, 0)) DO UPDATE SET enabled = EXCLUDED.enabled, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()`);
      /* 🔴 **감사에 남긴다**(메인 지시 2026-09-20) — 돈을 멈추는 손이다. 나중에 «누가 껐나»를 반드시 묻는다. */
      await writeAudit({
        tenantId, action: "ops_ai_video_kill", actorType: "operator", actorId: oid,
        target: tenantId ? `tenant:${tenantId}` : "video:global",
        detail: { enabled, scope: tenantId ? "tenant" : "global", note },
        riskLevel: "high",
      });
      return json({ ok: true, enabled, tenantId, note });
    }

    return json({ ok: false, error: "not_found", step: "route" }, 404);
  } catch (err) {
    return jsonError("ops_ai", err);
  }
};
