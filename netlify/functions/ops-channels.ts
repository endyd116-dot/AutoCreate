/**
 * 운영센터 — 채널 레지스트리 + 정책 문구(계약 P1R4 §2.2 · DESIGN §11.4·§16B).
 *   GET  /api/ops-channels                          → { ok, channels:[{ key,label,status,bestHours,monetize }] }
 *   POST /api/ops-channels   { key, status?, bestHours?, monetize?, label? }  → { ok, channel }
 *   GET  /api/ops-disclosure                          → { ok, text, updatedAt, updatedBy }
 *   POST /api/ops-disclosure { coupang?, generic? }   → { ok, text, updatedAt, updatedBy }   // §16B DISCLOSURE_TEXT DB 오버라이드
 *
 *   🔴 status(active/planned/down) 를 바꾸면 고객 그리드·온보딩(accounts-list channels[])에 즉시 반영된다(같은 channel_registry 를 읽으므로).
 *   🔴 정책 문구 변경은 audit high — 고지 문구는 법(공정위·쿠팡) 표면이라 «누가 언제 무엇을» 이 남아야 한다.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { DISCLOSURE_TEXT } from "../../lib/disclosure";
import { sql } from "drizzle-orm";
import { jsonb, utcDate } from "../../lib/db-util";

export const config = { path: ["/api/ops-channels", "/api/ops-disclosure"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");

const STATUS = new Set(["active", "planned", "down"]);
const arrNums = (v: unknown) => Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 23))] : null;
const arrStrs = (v: unknown) => Array.isArray(v) ? v.map((s) => String(s).slice(0, 24)).filter(Boolean).slice(0, 12) : null;

export default async (req: Request): Promise<Response> => {
  const path = routeOf(req);
  try {
    /* ───────── 채널 레지스트리 ───────── */
    if (path.endsWith("/ops-channels")) {
      if (req.method === "GET") {
        const g = requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
        const rows = await q(sql`SELECT key, label, status, best_hours, monetize FROM channel_registry ORDER BY sort, key`);
        return json({ ok: true, channels: rows.map((r) => ({
          key: String(r.key), label: String(r.label), status: String(r.status),
          bestHours: Array.isArray(r.best_hours) ? (r.best_hours as unknown[]).map(Number) : [],
          monetize: Array.isArray(r.monetize) ? (r.monetize as unknown[]).map(String) : [],
        })) });
      }
      const g = requireAdmin(req, ["super_admin"]); if (!g.ok) return g.res;   // 채널·고지문구 변경 = super_admin(플랫폼 설정 · 메인 결정 4)
      const b = await readJson<{ key?: unknown; status?: unknown; bestHours?: unknown; monetize?: unknown; label?: unknown }>(req);
      const key = String(b.key ?? "").trim();
      if (!key) return badRequest("key");
      const [cur] = await q(sql`SELECT key, status FROM channel_registry WHERE key = ${key} LIMIT 1`);
      if (!cur) return json({ ok: false, error: "그 채널이 레지스트리에 없어요.", step: "not_found" }, 404);

      const sets = [];
      if (b.status !== undefined) { const s = String(b.status); if (!STATUS.has(s)) return badRequest("status 는 active/planned/down"); sets.push(sql`status = ${s}`); }
      const bh = arrNums(b.bestHours); if (bh) sets.push(sql`best_hours = ${jsonb(bh)}`);
      const mz = arrStrs(b.monetize); if (mz) sets.push(sql`monetize = ${jsonb(mz)}`);
      if (b.label !== undefined) sets.push(sql`label = ${String(b.label).slice(0, 40)}`);
      if (!sets.length) return badRequest("바꿀 값이 없어요", "empty");
      await q(sql`UPDATE channel_registry SET ${sql.join(sets, sql`, `)} WHERE key = ${key}`);
      await writeAudit({ tenantId: null, action: "ops_channel_update", actorType: "operator", actorId: g.ops.oid,
        target: `channel:${key}`, detail: { from: String(cur.status), status: b.status ?? null }, riskLevel: b.status ? "medium" : "low" });
      const [row] = await q(sql`SELECT key, label, status, best_hours, monetize FROM channel_registry WHERE key = ${key}`);
      return json({ ok: true, channel: { key: String(row.key), label: String(row.label), status: String(row.status),
        bestHours: Array.isArray(row.best_hours) ? (row.best_hours as unknown[]).map(Number) : [],
        monetize: Array.isArray(row.monetize) ? (row.monetize as unknown[]).map(String) : [] } });
    }

    /* ───────── 정책 문구(§16B DISCLOSURE_TEXT 오버라이드) ───────── */
    if (path.endsWith("/ops-disclosure")) {
      const readText = async () => {
        // 오버라이드는 ai_model_overrides 옆의 범용 오버레이가 없으므로 notices 표를 안 쓰고 전용 단일 행을 audit 최신값으로 읽는다.
        const [ov] = await q(sql`SELECT detail, actor_id, created_at FROM audit_logs WHERE action = 'ops_disclosure_set' ORDER BY id DESC LIMIT 1`);
        const d = (ov?.detail && typeof ov.detail === "object" ? ov.detail : {}) as Record<string, unknown>;
        return {
          coupang: String(d.coupang ?? DISCLOSURE_TEXT.coupang),
          generic: String(d.generic ?? DISCLOSURE_TEXT.generic),
          updatedAt: utcDate(ov?.created_at)?.toISOString(),
          updatedBy: ov?.actor_id ? Number(ov.actor_id) : undefined,
        };
      };
      if (req.method === "GET") {
        const g = requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
        const t = await readText();
        return json({ ok: true, text: { coupang: t.coupang, generic: t.generic }, updatedAt: t.updatedAt, updatedBy: t.updatedBy });
      }
      const g = requireAdmin(req, ["super_admin"]); if (!g.ok) return g.res;   // 채널·고지문구 변경 = super_admin(플랫폼 설정 · 메인 결정 4)
      const b = await readJson<{ coupang?: unknown; generic?: unknown }>(req);
      const cur = await readText();
      const next = { coupang: b.coupang !== undefined ? String(b.coupang).slice(0, 300) : cur.coupang, generic: b.generic !== undefined ? String(b.generic).slice(0, 300) : cur.generic };
      if (!next.coupang.trim() || !next.generic.trim()) return badRequest("고지 문구는 비울 수 없어요");
      // 🔴 법 표면 — 변경을 audit high 로 박제(누가·언제·무엇을). 소비처(lib/disclosure)는 R5 에서 이 오버라이드를 읽게 잇는다(지금은 기록·표시).
      await writeAudit({ tenantId: null, action: "ops_disclosure_set", actorType: "operator", actorId: g.ops.oid,
        target: "disclosure", detail: { coupang: next.coupang, generic: next.generic, prev: { coupang: cur.coupang, generic: cur.generic } }, riskLevel: "high" });
      return json({ ok: true, text: next, updatedAt: new Date().toISOString(), updatedBy: g.ops.oid });
    }

    return json({ ok: false, error: "not_found", step: "route" }, 404);
  } catch (err) {
    return jsonError("ops_channels", err);
  }
};
