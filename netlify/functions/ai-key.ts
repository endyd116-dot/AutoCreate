/**
 * 고객이 **자기 AI 키**를 꽂는 자리(계약 P1R8-B §4.4 · DESIGN §3.3 · 메인 승인 2026-09-15).
 *   GET  /api/ai-keys                      → { ok, keys:[{ id, label, status, masked, lastOkAt, lastErrorKind, resting }], fallback, configured }
 *   POST /api/ai-key-add { key, label? }   → 201 { ok, id }  ·  400 { step:"invalid"|"quota"|"forbidden", error }(사람말)
 *   POST /api/ai-key-delete { id }         → { ok }
 *   POST /api/ai-key-fallback { on }       → { ok, fallback }   «내 키가 안 될 때 우리 키로 대신 돌리기»
 *
 *   🔴 **평문 키는 이 파일을 통과만 한다** — 저장은 AES-256-GCM(`CREDS_ENC_KEY` · 폴백 없음), 응답·로그·감사에는 **가려진 모양만**.
 *   🔴 **꽂을 때 그 키로 한 번 실제로 걸어 본다** — 안 되는 키를 «등록됨»으로 두면 그 집 공장이 **그날 밤 조용히 선다**(§4.9 와 같은 결).
 *      확인 호출은 **고객 키로만** 한다(우리가 남의 확인 비용을 내지 않는다).
 *   🔴 대신 돌리기는 **기본 꺼짐**이고, 켤 때 «무엇을 켜는지»를 화면이 말한다(§9-2). 켜 놓고 몰랐다는 게 제일 나쁘다.
 */
import { sql } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { credsEncConfigured } from "../../lib/creds-crypto";
import { listByoKeys, saveByoKey, deleteByoKey } from "../../lib/ai-key-byo";

export const config = { path: ["/api/ai-keys", "/api/ai-key-add", "/api/ai-key-delete", "/api/ai-key-fallback"] };
const n = (v: unknown) => Number(v || 0);
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");

export default async (req: Request): Promise<Response> => {
  const path = routeOf(req);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid; const uid = Number(auth.user.uid);
  try {
    if (path.endsWith("/ai-keys")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const [t] = await q(sql`SELECT ai_key_fallback FROM tenants WHERE id = ${tid}`);
      /* 🔴 `configured:false` = 우리가 **안전하게 보관할 수 없는 상태**(보관 열쇠 미설정). 그때는 꽂으라고 하면 안 된다. */
      return json({ ok: true, keys: await listByoKeys(tid), fallback: t?.ai_key_fallback === true, configured: credsEncConfigured() });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const w = await requireWritable(tid); if (!w.ok) return w.res;

    if (path.endsWith("/ai-key-add")) {
      const b = await readJson<{ key?: unknown; label?: unknown }>(req);
      const key = String(b.key ?? "").trim();
      if (!key) return badRequest("키를 넣어 주세요.", "key");
      const r = await saveByoKey(tid, key, b.label ? String(b.label) : undefined);
      if (!r.ok) {
        /* 🔴 실패 사유를 **셋으로 갈라** 준다 — «키가 틀림»·«한도»·«권한»은 고객이 할 일이 완전히 다르다. 값은 안 싣는다. */
        await writeAudit({ tenantId: tid, action: "ai_key_add_failed", actorType: "user", actorId: uid, ip: clientIp(req), detail: { kind: r.kind } });
        return json({ ok: false, step: r.kind, error: r.error }, r.kind === "not_configured" ? 503 : 400);
      }
      await writeAudit({ tenantId: tid, action: "ai_key_add", actorType: "user", actorId: uid, ip: clientIp(req), target: `ai_key:${r.id}`, detail: { verified: true } });
      return json({ ok: true, id: r.id, keys: await listByoKeys(tid) }, 201);
    }

    if (path.endsWith("/ai-key-delete")) {
      const b = await readJson<{ id?: unknown }>(req);
      const id = n(b.id); if (!id) return badRequest("어떤 키를 뺄지 골라 주세요.", "id");
      const gone = await deleteByoKey(tid, id);
      if (!gone) return json({ ok: false, error: "그 키를 찾을 수 없어요.", step: "not_found" }, 404);
      /* 🔴 그 키로 쓴 `ai_usage` 는 **남긴다** — 돈 쓴 기록은 어떤 정리에서도 안 지운다(행 자신이 `byo` 를 들고 있다 · AC-71). */
      await writeAudit({ tenantId: tid, action: "ai_key_delete", actorType: "user", actorId: uid, ip: clientIp(req), target: `ai_key:${id}`, detail: { usageKept: true } });
      return json({ ok: true, keys: await listByoKeys(tid) });
    }

    if (path.endsWith("/ai-key-fallback")) {
      const b = await readJson<{ on?: unknown }>(req);
      if (typeof b.on !== "boolean") return badRequest("켤지 끌지 알려 주세요.", "on");
      const [cur] = await q(sql`SELECT ai_key_fallback FROM tenants WHERE id = ${tid}`);
      if ((cur?.ai_key_fallback === true) !== b.on) {
        await q(sql`UPDATE tenants SET ai_key_fallback = ${b.on}, updated_at = NOW() WHERE id = ${tid}`);
        /* 🔴 **돈이 나가는 스위치**라 켜고 끈 것을 반드시 남긴다 — 나중에 «누가 켰지»가 답이 있어야 한다. */
        await writeAudit({ tenantId: tid, action: b.on ? "ai_key_fallback_on" : "ai_key_fallback_off", actorType: "user", actorId: uid, ip: clientIp(req), riskLevel: b.on ? "medium" : "low", detail: { on: b.on } });
      }
      return json({ ok: true, fallback: b.on,
        message: b.on
          ? "내 키가 안 될 때는 저희 키로 대신 만들어 드려요. 그때마다 알려 드릴게요."
          /* 🔴 [CLAUDE §3] «알려만 드려요» 는 **발을 빼는 말**이라 쓰지 않는다 — 우리가 무엇을 하는지로 말한다. */
          : "이제는 내 키로만 만들어요. 키가 안 될 때는 그 회차를 건너뛰고 바로 알려 드릴게요." });
    }

    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("ai_key", err); }
};
