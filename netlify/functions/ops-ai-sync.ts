/**
 * 운영센터 · **정본 동기화**(계약 P1R8-B §4.5 E5 · DESIGN §890).
 *   GET  /api/ops-ai-sync  → { ok, drifted, rows:[…], canaryRoles, envMasked, configured }   🔴 읽기만
 *   POST /api/ops-ai-sync  → { ok, url, branch, changed }                                    🔴 **PR 을 연다. 머지는 사람이 한다.**
 *
 *   ══ 왜 ══
 *     모델 이름의 정본은 **파일 하나**인데(`lib/ai-models.ts`), 급할 때 DB 오버레이로 **배포 없이** 덮어쓴다.
 *     🔴 그대로 두면 **파일과 DB 가 갈라진 채 굳고**, 파일을 읽은 사람이 «이게 지금 쓰는 모델»이라 믿는다 — 그 순간 «파일이 정본»은 거짓말이다.
 *
 *   🔴 지키는 것 셋
 *     ① **PR 까지다** — 자동 머지 없음(모델을 바꾸는 건 되돌리기 어려운 쪽이다).
 *     ② **토큰이 없으면 503 `not_configured`** — 조용히 성공한 척하지 않는다(CLAUDE §8 «키 꽂으면 즉시»).
 *     ③ **누가 눌렀는지 감사에 남긴다** — 대외로 나가는 동작이다.
 */
import { json, jsonError } from "../../lib/response";
import { requireAdmin } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { driftReport, openSyncPr, githubCfg } from "../../lib/ai-models-sync";

export const config = { path: "/api/ops-ai-sync" };

export default async (req: Request): Promise<Response> => {
  const o = await requireAdmin(req, ["super_admin"]); if (!o.ok) return o.res;
  try {
    const drift = await driftReport();
    if (req.method === "GET") {
      /* 🔴 «등록됐나»까지만 — 토큰 값은 응답·로그·감사 어디에도 안 찍는다. */
      return json({ ok: true, ...drift, configured: !!githubCfg() });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

    const r = await openSyncPr(drift, o.ops.name || o.ops.email || `운영자 ${o.ops.oid}`);
    if (!r.ok) {
      if (r.step === "not_configured") return json({ ok: false, step: r.step, error: r.error, configured: false }, 503);
      if (r.step === "no_drift") return json({ ok: false, step: r.step, error: r.error }, 409);
      await writeAudit({ tenantId: null, action: "ops_ai_sync_failed", actorType: "operator", actorId: o.ops.oid, ip: clientIp(req), riskLevel: "medium",
        detail: { step: r.step, error: r.error, ...(r.detail ? { detail: r.detail } : {}) } });
      return json({ ok: false, step: r.step, error: r.error }, 502);
    }
    /* 🔴 대외로 나간 동작이라 **높은 위험**으로 남긴다 — 나중에 «이 PR 누가 열었지»의 답이 여기다. */
    await writeAudit({ tenantId: null, action: "ops_ai_sync_pr", actorType: "operator", actorId: o.ops.oid, ip: clientIp(req), riskLevel: "high",
      detail: { url: r.url, branch: r.branch, changed: r.changed, ...(r.missed.length ? { missed: r.missed } : {}) } });
    return json({ ok: true, url: r.url, branch: r.branch, changed: r.changed,
      message: "PR 을 만들었어요. 🔴 머지는 사람이 확인하고 해 주세요." });
  } catch (err) { return jsonError("ops_ai_sync", err); }
};
