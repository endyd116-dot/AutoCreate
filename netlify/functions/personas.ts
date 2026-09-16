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
import { toAgeBand, type AgeBand } from "../../lib/slang-whitelist";   // [2026-09-16] 나이대 — 값은 다섯뿐(자유문자열이 아니다)
import { clientIp } from "../../lib/auth";
import { jsonb } from "../../lib/db-util";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/personas-list", "/api/personas-save"] };
/** netlify dev 는 함수가 404 를 내면 같은 경로에 `.html`·`.htm`·`/index.html` 을 붙여 다시 부른다(마지막 시도의 응답이 클라이언트에 간다)(정적 폴백) — 그 재시도가 경로 매칭에서 빠지면 엉뚱한 405 가 보인다. 꼬리를 떼고 맞춘다. */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);

export interface PersonaProfile { region?: string; family?: string; job?: string; home?: string; brands?: string[]; tone?: string; interests?: string[]; banned?: string[]; signature?: string;
  /** 🔴 [2026-09-16] 나이대 — 값은 다섯뿐(`10s`~`50s`). 자유문자열이 아니다. */
  ageBand?: AgeBand }
const STR_KEYS = ["region", "family", "job", "home", "tone", "signature"] as const;
const ARR_KEYS = ["brands", "interests", "banned"] as const;

export function sanitizeProfile(p: unknown): PersonaProfile {
  const src = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  const out: PersonaProfile = {};
  /* 🔴 [2026-09-16 · A2 가 화면 만들기 전에 찾음] `ageBand` 가 없어서 **저장할 때도 돌려줄 때도 잘려 나갔다** —
     이 함수가 양쪽에서 돌기 때문이다. 넣어도 안 남고 남아도 화면에 안 오는 상태였다.
     🔴 `STR_KEYS` 에 그냥 넣지 않는다 — 그러면 200자 자유문자열이 된다. 값은 **다섯뿐**이라 목록으로 검사한다.
     🔴 아니면 **키를 아예 안 싣는다** — «모름»과 «30대»는 다르다(AC-57). */
  const ab = toAgeBand(src.ageBand);
  if (ab) out.ageBand = ab;
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
  const path = routeOf(req);
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
