/**
 * 운영센터 — 채널 레지스트리 + 정책 문구(계약 P1R4 §2.2 · DESIGN §11.4·§16B).
 *   GET  /api/ops-channels                          → { ok, channels:[{ key,label,status,bestHours,monetize,clipOpen }] }
 *   POST /api/ops-channels   { key, status?, bestHours?, monetize?, label?, clipOpen? }  → { ok, channel }
 *        🔴 [R17-B2] `clipOpen:{from,to}` = 네이버 클립 **모집창**(KST 날짜 · `null` 로 보내면 지운다).
 *           종전엔 넣을 칸도 화면도 없어서 `lib/ad-eligibility.ts clipWindow()` 가 **언제나 null** 이었고
 *           D-7 «모집이 시작해요» 알림이 **구조적으로 한 번도 못 떴다**(오류 0이라 조용했다 · R16 실측).
 *           🔴 `monetize`(배열 = 수익 매체 목록)와 **다른 칸**이다(`monetize_meta` · drizzle/0092) —
 *           한 칸에 섞으면 칩을 저장할 때마다 모집창이 사라진다. 그게 종전 모양이었다.
 *   GET  /api/ops-disclosure                          → { ok, text, updatedAt, updatedBy:{ id, name } }
 *   POST /api/ops-disclosure { coupang?, generic? }   → { ok, text, updatedAt, updatedBy:{ id, name } }   // §16B DISCLOSURE_TEXT DB 오버라이드
 *        updatedBy 는 id 가 아니라 { id, name } — 화면이 «운영자 #1» 대신 이름을 쓴다(메인 소발주 2). 이름 없으면 이메일 → «운영자 #id».
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
import { CLIP_NOTICE_DAYS } from "../../lib/ad-eligibility";   // [R17-B2] D-7 알림 선행일수의 정본
import { sql } from "drizzle-orm";
import { jsonb, utcDate } from "../../lib/db-util";

export const config = { path: ["/api/ops-channels", "/api/ops-disclosure"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");

const STATUS = new Set(["active", "planned", "down"]);
/** 운영자 표시 참조 — 화면이 «운영자 #1» 대신 사람 이름을 쓰게(메인 소발주 2). 이름 없으면 이메일 → 그것도 없으면 «운영자 #id». */
const opRef = (id: unknown, name?: unknown, email?: unknown): { id: number; name: string } | undefined => {
  const oid = Math.floor(Number(id ?? 0)) || 0;
  if (!oid) return undefined;
  return { id: oid, name: String(name ?? "").trim() || String(email ?? "").trim() || `운영자 #${oid}` };
};
const arrNums = (v: unknown) => Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 23))] : null;
const arrStrs = (v: unknown) => Array.isArray(v) ? v.map((s) => String(s).slice(0, 24)).filter(Boolean).slice(0, 12) : null;
/** [R17-B2] `YYYY-MM-DD`(KST 날짜 문자열 · DESIGN §13.5) 만 받는다. 아니면 null. */
const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
/**
 * [R17-B2] 모집창 파싱 — `undefined`=안 바꾼다 · `null`=지운다 · `{from,to}`=넣는다.
 * 🔴 **from ≤ to 를 여기서 본다** — 뒤집힌 창을 넣으면 알림이 조용히 안 뜬다(막는 게 아니라 **되묻는** 자리 · §9).
 */
const clipWin = (v: unknown): { from: string; to: string } | null | undefined | "bad" => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "object") return "bad";
  const o = v as { from?: unknown; to?: unknown };
  const from = ymd(o.from), to = ymd(o.to);
  if (!from || !to || from > to) return "bad";
  return { from, to };
};
/**
 * [R17-B2] 한 행 → 화면이 받는 모양. 🔴 **GET 과 POST 가 같은 함수를 쓴다** — 두 곳에 따로 적으면
 * «저장한 뒤 돌려준 것»과 «다시 불러온 것»이 갈리고, 화면은 그걸 저장 실패로 읽는다(AC-52).
 * 🔴 `clipOpen` 은 **모양이 맞을 때만** 싣는다 — 반쪽짜리 값을 넘기면 화면이 «있다»고 그린다(AC-9 «모르면 안 말한다»).
 */
const chOut = (r: Record<string, unknown>) => {
  const cw = clipWin((r.monetize_meta as { clipOpen?: unknown } | null)?.clipOpen);
  return {
    key: String(r.key), label: String(r.label), status: String(r.status),
    bestHours: Array.isArray(r.best_hours) ? (r.best_hours as unknown[]).map(Number) : [],
    monetize: Array.isArray(r.monetize) ? (r.monetize as unknown[]).map(String) : [],
    ...(cw && cw !== "bad" ? { clipOpen: cw } : {}),
  };
};

export default async (req: Request): Promise<Response> => {
  const path = routeOf(req);
  try {
    /* ───────── 채널 레지스트리 ───────── */
    if (path.endsWith("/ops-channels")) {
      if (req.method === "GET") {
        const g = await requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
        const rows = await q(sql`SELECT key, label, status, best_hours, monetize, monetize_meta FROM channel_registry ORDER BY sort, key`);
        /* [R17-B2] 🔴 «며칠 전에 알리나»는 **서버가 정본**(`CLIP_NOTICE_DAYS`) — 화면이 7 을 베껴 적으면 정책이 바뀔 때 두 곳이 갈린다(§13 · AC-52). */
        return json({ ok: true, channels: rows.map(chOut), clipNoticeDays: CLIP_NOTICE_DAYS });
      }
      const g = await requireAdmin(req, ["super_admin"]); if (!g.ok) return g.res;   // 채널·고지문구 변경 = super_admin(플랫폼 설정 · 메인 결정 4)
      const b = await readJson<{ key?: unknown; status?: unknown; bestHours?: unknown; monetize?: unknown; label?: unknown; clipOpen?: unknown }>(req);
      const key = String(b.key ?? "").trim();
      if (!key) return badRequest("key");
      const [cur] = await q(sql`SELECT key, status FROM channel_registry WHERE key = ${key} LIMIT 1`);
      if (!cur) return json({ ok: false, error: "그 채널이 레지스트리에 없어요.", step: "not_found" }, 404);

      const sets = [];
      if (b.status !== undefined) { const s = String(b.status); if (!STATUS.has(s)) return badRequest("status 는 active/planned/down"); sets.push(sql`status = ${s}`); }
      const bh = arrNums(b.bestHours); if (bh) sets.push(sql`best_hours = ${jsonb(bh)}`);
      const mz = arrStrs(b.monetize); if (mz) sets.push(sql`monetize = ${jsonb(mz)}`);
      /* [R17-B2] 모집창 — 🔴 `monetize` 를 안 건드리고 **`monetize_meta` 를 병합**한다(`||`).
         통째 덮어쓰면 나중에 같은 칸에 다른 사실이 붙었을 때 그게 사라진다 — 종전 `monetize` 가 딱 그렇게 모집창을 지우고 있었다. */
      const cw = clipWin(b.clipOpen);
      if (cw === "bad") return badRequest("모집 기간은 시작일·종료일을 YYYY-MM-DD 로 적고, 시작일이 종료일보다 늦지 않아야 해요.", "clipOpen");
      if (cw !== undefined) sets.push(cw === null
        ? sql`monetize_meta = monetize_meta - 'clipOpen'`
        : sql`monetize_meta = COALESCE(monetize_meta, '{}'::jsonb) || ${jsonb({ clipOpen: cw })}`);
      if (b.label !== undefined) sets.push(sql`label = ${String(b.label).slice(0, 40)}`);
      if (!sets.length) return badRequest("바꿀 값이 없어요", "empty");
      await q(sql`UPDATE channel_registry SET ${sql.join(sets, sql`, `)} WHERE key = ${key}`);
      await writeAudit({ tenantId: null, action: "ops_channel_update", actorType: "operator", actorId: g.ops.oid,
        /* [R17-B2] 🔴 모집창도 남긴다 — 이 날짜가 **고객 알림을 움직인다**(D-7 «모집이 시작해요»). 누가 언제 무엇을 넣었는지 없으면 «왜 그때 알림이 갔나»를 못 푼다. */
        target: `channel:${key}`, detail: { from: String(cur.status), status: b.status ?? null, ...(cw !== undefined ? { clipOpen: cw } : {}) }, riskLevel: b.status ? "medium" : "low" });
      const [row] = await q(sql`SELECT key, label, status, best_hours, monetize, monetize_meta FROM channel_registry WHERE key = ${key}`);
      return json({ ok: true, channel: chOut(row) });
    }

    /* ───────── 정책 문구(§16B DISCLOSURE_TEXT 오버라이드) ───────── */
    if (path.endsWith("/ops-disclosure")) {
      const readText = async () => {
        // 오버라이드는 ai_model_overrides 옆의 범용 오버레이가 없으므로 notices 표를 안 쓰고 전용 단일 행을 audit 최신값으로 읽는다.
        // 마지막으로 바꾼 운영자의 «이름»까지 한 번에(조인) — 화면이 id 를 이름으로 못 바꾸게 하지 않는다.
        const [ov] = await q(sql`SELECT a.detail, a.actor_id, a.created_at, o.name AS actor_name, o.email AS actor_email
          FROM audit_logs a LEFT JOIN operators o ON o.id = a.actor_id
          WHERE a.action = 'ops_disclosure_set' ORDER BY a.id DESC LIMIT 1`);
        const d = (ov?.detail && typeof ov.detail === "object" ? ov.detail : {}) as Record<string, unknown>;
        return {
          coupang: String(d.coupang ?? DISCLOSURE_TEXT.coupang),
          generic: String(d.generic ?? DISCLOSURE_TEXT.generic),
          updatedAt: utcDate(ov?.created_at)?.toISOString(),
          updatedBy: opRef(ov?.actor_id, ov?.actor_name, ov?.actor_email),
        };
      };
      if (req.method === "GET") {
        const g = await requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
        const t = await readText();
        return json({ ok: true, text: { coupang: t.coupang, generic: t.generic }, updatedAt: t.updatedAt, updatedBy: t.updatedBy });
      }
      const g = await requireAdmin(req, ["super_admin"]); if (!g.ok) return g.res;   // 채널·고지문구 변경 = super_admin(플랫폼 설정 · 메인 결정 4)
      const b = await readJson<{ coupang?: unknown; generic?: unknown }>(req);
      const cur = await readText();
      const next = { coupang: b.coupang !== undefined ? String(b.coupang).slice(0, 300) : cur.coupang, generic: b.generic !== undefined ? String(b.generic).slice(0, 300) : cur.generic };
      if (!next.coupang.trim() || !next.generic.trim()) return badRequest("고지 문구는 비울 수 없어요");
      // 🔴 법 표면 — 변경을 audit high 로 박제(누가·언제·무엇을). 소비처(lib/disclosure)는 R5 에서 이 오버라이드를 읽게 잇는다(지금은 기록·표시).
      await writeAudit({ tenantId: null, action: "ops_disclosure_set", actorType: "operator", actorId: g.ops.oid,
        target: "disclosure", detail: { coupang: next.coupang, generic: next.generic, prev: { coupang: cur.coupang, generic: cur.generic } }, riskLevel: "high" });
      // 방금 바꾼 사람의 이름도 같은 모양으로 돌려준다(GET 과 응답 모양 일치 — 화면이 분기하지 않게).
      const [me] = await q(sql`SELECT name, email FROM operators WHERE id = ${g.ops.oid} LIMIT 1`);
      return json({ ok: true, text: next, updatedAt: new Date().toISOString(), updatedBy: opRef(g.ops.oid, me?.name, me?.email) });
    }

    return json({ ok: false, error: "not_found", step: "route" }, 404);
  } catch (err) {
    return jsonError("ops_channels", err);
  }
};
