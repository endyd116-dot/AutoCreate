/**
 * 페르소나(계약 §1 · DESIGN §5C.2 «넣는 것»):
 *   GET  /api/personas-list  → { personas:[Persona] }
 *   POST /api/personas-save  { id?, name, profile } → { persona }
 *   Persona.profile = { region?, family?, job?, home?, brands?:[string], tone?, interests?:[string], banned?:[string], signature? }
 *   profile 은 화이트리스트 키만 저장(내부 메모 유입 차단 · PITFALLS #18).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { jsonb } from "../../lib/db-util";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/personas-list", "/api/personas-save"] };
const n = (v: unknown) => Number(v || 0);

export interface PersonaProfile { region?: string; family?: string; job?: string; home?: string; brands?: string[]; tone?: string; interests?: string[]; banned?: string[]; signature?: string }
const STR_KEYS = ["region", "family", "job", "home", "tone", "signature"] as const;
const ARR_KEYS = ["brands", "interests", "banned"] as const;

export function sanitizeProfile(p: unknown): PersonaProfile {
  const src = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  const out: PersonaProfile = {};
  for (const k of STR_KEYS) { const v = String(src[k] ?? "").trim().slice(0, 200); if (v) out[k] = v; }
  for (const k of ARR_KEYS) {
    const v = Array.isArray(src[k]) ? (src[k] as unknown[]).map((x) => String(x ?? "").trim().slice(0, 60)).filter(Boolean).slice(0, 20) : [];
    if (v.length) out[k] = v;
  }
  return out;
}
const toPersona = (r: Record<string, unknown>) => ({ id: n(r.id), name: String(r.name), profile: sanitizeProfile(r.profile) });

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith("/personas-list")) {
      const rows = await q(sql`SELECT id, name, profile FROM personas WHERE tenant_id = ${tid} ORDER BY id`);
      return json({ ok: true, personas: rows.map(toPersona) });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<{ id?: number; name?: string; profile?: unknown }>(req);
    const name = String(b.name ?? "").trim().slice(0, 60);
    if (!name) return badRequest("이름을 적어 주세요.", "name");
    const profile = sanitizeProfile(b.profile);
    const id = n(b.id);
    let row: Record<string, unknown> | undefined;
    if (id) {
      [row] = await q(sql`UPDATE personas SET name = ${name}, profile = ${jsonb(profile)} WHERE tenant_id = ${tid} AND id = ${id} RETURNING id, name, profile`);
      if (!row) return json({ ok: false, error: "페르소나를 찾을 수 없어요.", step: "not_found" }, 404);
    } else {
      [row] = await q(sql`INSERT INTO personas (tenant_id, name, profile) VALUES (${tid}, ${name}, ${jsonb(profile)}) RETURNING id, name, profile`);
    }
    const [chk] = await q(sql`SELECT jsonb_typeof(profile) AS t FROM personas WHERE id = ${n(row.id)}`);
    if (chk?.t !== "object") console.error("[personas-save] jsonb_typeof !== object", chk);
    await writeAudit({ tenantId: tid, action: id ? "persona_update" : "persona_create", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `persona:${n(row.id)}`, detail: { keys: Object.keys(profile) } });
    return json({ ok: true, persona: toPersona(row) });
  } catch (err) { return jsonError("personas", err); }
};
