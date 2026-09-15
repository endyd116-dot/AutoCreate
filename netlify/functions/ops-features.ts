/**
 * 운영센터 · **기능 스위치**(플랫폼 한 벌 · `ops_settings.features`).
 *   GET  /api/ops-features            → { ok, features:{ byoAiKey }, updatedAt? }
 *   POST /api/ops-features { byoAiKey } → { ok, features }
 *
 *   ══ 왜 있나 ══
 *     «만들었는데 지금은 안 판다»를 다루는 자리다. 🔴 **코드를 지우면 다시 만들어야 한다** —
 *     그래서 CLAUDE §8 관례대로 **«키 꽂으면 즉시 가동» 상태로 재워 둔다**: 서버·표·검사는 그대로 두고 **입구만 닫는다**.
 *
 *   첫 손님 — `byoAiKey`(고객이 자기 AI 키를 꽂기 · §4.4):
 *     🔴 **기본 꺼짐.** 사장님 판단 2026-09-16 «수익 관점에서 BYO 안 하는 게 좋겠다».
 *     끄면 고객 화면 입구가 닫히고, **이미 꽂아 둔 키도 안 쓴다**(꺼진 기능이 뒤에서 도는 게 제일 나쁘다).
 *     🔴 **표의 키 행은 지우지 않는다** — 다시 켜면 그 자리에서 이어진다(고객이 다시 꽂게 만들지 않는다).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { readOpsSetting, writeOpsSetting } from "../../lib/ops/settings";
import { FEATURES_KEY, featureDefaults } from "../../lib/ops/features";

export const config = { path: "/api/ops-features" };

export default async (req: Request): Promise<Response> => {
  const o = await requireAdmin(req, ["super_admin"]); if (!o.ok) return o.res;
  try {
    if (req.method === "GET") return json({ ok: true, features: { ...featureDefaults(), ...(await readOpsSetting(FEATURES_KEY)) } });
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<{ byoAiKey?: unknown }>(req);
    const patch: Record<string, unknown> = {};
    if (typeof b.byoAiKey === "boolean") patch.byoAiKey = b.byoAiKey;
    if (!Object.keys(patch).length) return badRequest("바꿀 값이 없어요.");
    const before = await readOpsSetting(FEATURES_KEY, true);
    const after = await writeOpsSetting(FEATURES_KEY, patch, o.ops.oid);
    /* 🔴 제품이 켜지고 꺼지는 자리라 **높은 위험**으로 남긴다 — 나중에 «언제부터 안 보였지»의 답이 여기다. */
    await writeAudit({ tenantId: null, action: "ops_feature_toggle", actorType: "operator", actorId: o.ops.oid, ip: clientIp(req), riskLevel: "high",
      detail: { before: { byoAiKey: before.byoAiKey === true }, after: patch } });
    return json({ ok: true, features: { ...featureDefaults(), ...after } });
  } catch (err) { return jsonError("ops_features", err); }
};
