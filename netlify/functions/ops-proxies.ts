/**
 * 프록시(계정별 전용 IP) 운영 API — 계약 P1R7 §2.5-② · B 의 §3.6(계정 슬롯 구매)이 이 배정에 기댄다.
 *
 *   GET  /api/ops-proxies                                   → { ok, stock:{free,assigned,down}, stopped:{…}, proxies:[…] }
 *        🔴 `stopped` = fail-closed 로 **멈춰 선 계정**(전용 IP 가 없거나 죽어서). 계정·테넌트 **이름까지** 준다.
 *   POST /api/ops-proxies        { action:"add"|"status", … } → 등록 · 상태 변경
 *   POST /api/ops-proxy-assign   { accountId, proxyId? }      → 배정(자동/지정) · { action:"release" } 면 해제
 *
 *   🔴 **접속 주소는 어떤 응답에도 나가지 않는다.** `url_enc` 는 계정 자격과 같은 취급이고,
 *      푸는 자리는 러너 claim 한 곳뿐이다(`lib/runner-jobs.ts loadAccountForRunner` · DESIGN §7.1 평문 표면).
 *      운영 화면이 알아야 할 것은 «어디 것인지 · 살아 있는지 · 어느 계정이 쓰는지 · 얼마짜리인지»다.
 *   🔴 등록은 **super_admin 만**(IP 를 바꾸는 것은 곧 계정의 신원을 바꾸는 일이다).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { json, jsonError, badRequest } from "../../lib/response";
import { utcDate } from "../../lib/db-util";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { encryptObj } from "../../lib/creds-crypto";
import { assignProxy, releaseProxy, proxyStock, proxyStopped } from "../../lib/proxies";

export const config = { path: ["/api/ops-proxies", "/api/ops-proxy-assign"] };

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const STATUS = new Set(["active", "down", "expired"]);
const UNITS = new Set(["ip", "gb"]);

export default async (req: Request): Promise<Response> => {
  const path = new URL(req.url).pathname;
  try {
    const auth = await requireAdmin(req, ["admin", "super_admin"]);
    if (!auth.ok) return auth.res;

    /* ───────── 배정 ───────── */
    if (path.endsWith("/ops-proxy-assign")) {
      if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
      const b = await readJson<{ accountId?: unknown; proxyId?: unknown; action?: unknown }>(req);
      const accountId = n(b.accountId);
      if (!accountId) return badRequest("accountId");

      if (String(b.action ?? "") === "release") {
        const r = await releaseProxy(accountId);
        if (!r.ok) return json({ ok: false, step: "not_assigned", error: "이 계정에는 붙어 있는 IP 가 없어요." }, 404);
        await writeAudit({ tenantId: null, action: "ops_proxy_release", actorType: "operator", actorId: auth.ops.oid, target: `account:${accountId}`, detail: { proxyId: r.proxyId }, riskLevel: "medium" });
        return json({ ok: true, released: true, proxyId: r.proxyId });
      }

      const r = await assignProxy(accountId, { ...(n(b.proxyId) ? { proxyId: n(b.proxyId) } : {}) });
      if (!r.ok) return json({ ok: false, step: r.reason, error: r.message, ...(r.proxyId ? { proxyId: r.proxyId } : {}) }, r.reason === "account_not_found" ? 404 : 409);
      if ("pending" in r) return json({ ok: true, pending: true, reason: r.reason, message: r.message });
      await writeAudit({ tenantId: null, action: "ops_proxy_assign", actorType: "operator", actorId: auth.ops.oid, target: `account:${accountId}`, detail: { proxyId: r.proxyId, label: r.label }, riskLevel: "medium" });
      return json({ ok: true, proxyId: r.proxyId, label: r.label });
    }

    /* ───────── 목록 ───────── */
    if (req.method === "GET") {
      const rows = await q(sql`
        SELECT p.id, p.tenant_id, p.label, p.provider, p.product, p.kind, p.region, p.status,
               p.billing_unit, p.unit_price_krw, p.cost_krw_month, p.bandwidth_gb_month, p.sticky_guaranteed,
               p.last_exit_ip, p.last_check_at, p.expires_at, p.created_at,
               a.id AS account_id, a.handle AS account_handle, a.tenant_id AS account_tenant
          FROM proxies p LEFT JOIN accounts a ON a.proxy_id = p.id
         ORDER BY p.status, p.id DESC LIMIT 200`);
      return json({
        ok: true,
        stock: await proxyStock(),
        /* 🔴 **«몇 계정이 IP 가 없어 멈췄나»**(DESIGN §7.3b fail-closed · 2026-09-21 B).
           재고(`stock`)는 «우리가 가진 것»이고 이건 «그 때문에 못 나가고 있는 것»이다 — **둘은 다르다.**
           재고만 보면 «free 0» 은 그냥 숫자지만, 여기 계정 이름이 뜨면 «지금 이 사람 글이 안 올라가고 있다»가 된다.
           멈추는 것은 우리 판단이 아니라 **길이 없는 사실**이지만(§9 «없는 길»), 말해 주는 것은 우리 몫이다. */
        stopped: await proxyStopped(),
        // 🔴 `url_enc` 는 SELECT 에도 넣지 않았다 — 실수로 내보낼 여지를 아예 없앤다.
        proxies: rows.map((r) => ({
          id: n(r.id), label: String(r.label ?? ""), provider: r.provider ? String(r.provider) : null,
          product: r.product ? String(r.product) : null, kind: String(r.kind ?? "residential"),
          region: r.region ? String(r.region) : null, status: String(r.status ?? ""),
          billingUnit: String(r.billing_unit ?? "ip"), unitPriceKrw: n(r.unit_price_krw), costKrwMonth: n(r.cost_krw_month),
          bandwidthGbMonth: r.bandwidth_gb_month === null ? null : Number(r.bandwidth_gb_month),
          stickyGuaranteed: r.sticky_guaranteed === true,
          lastExitIp: r.last_exit_ip ? String(r.last_exit_ip) : null,
          /* 🔴 [2026-09-19 수리 3판 · C `verify-server-time`] `timestamp`(시간대 없음) 칸을 `new Date(글자)` 로 읽으면
             **프로세스 시간대**로 해석된다 — 프록시 «마지막 점검»·«만료»가 KST 프로세스에서 9시간 밀려 보인다. */
          lastCheckAt: utcDate(r.last_check_at)?.toISOString() ?? null,
          expiresAt: utcDate(r.expires_at)?.toISOString() ?? null,
          assignedTo: r.account_id ? { accountId: n(r.account_id), handle: String(r.account_handle ?? ""), tenantId: n(r.account_tenant) } : null,
        })),
      });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
    const b = await readJson<Record<string, unknown>>(req);
    const action = String(b.action ?? "add");

    /* ───────── 상태 변경 ───────── */
    if (action === "status") {
      const id = n(b.id); const status = String(b.status ?? "");
      if (!id) return badRequest("id");
      if (!STATUS.has(status)) return badRequest("status 는 active/down/expired", "status");
      const [row] = await q(sql`UPDATE proxies SET status = ${status}, updated_at = NOW() WHERE id = ${id} RETURNING id, label, status`);
      if (!row) return json({ ok: false, step: "not_found", error: "그 IP 를 찾을 수 없어요." }, 404);
      await writeAudit({ tenantId: null, action: "ops_proxy_status", actorType: "operator", actorId: auth.ops.oid, target: `proxy:${id}`, detail: { status }, riskLevel: "medium" });
      return json({ ok: true, proxy: { id: n(row.id), label: String(row.label ?? ""), status: String(row.status ?? "") } });
    }

    /* ───────── 등록 ───────── */
    if (action !== "add") return badRequest("action 은 add/status", "action");
    // 🔴 IP 를 들여오는 것은 계정의 신원을 정하는 일이라 super_admin 만.
    const sa = await requireAdmin(req, ["super_admin"]);
    if (!sa.ok) return sa.res;

    const label = String(b.label ?? "").trim().slice(0, 60);
    const url = String(b.url ?? "").trim();
    if (!label) return badRequest("이름을 입력해 주세요.", "label");
    if (!/^(https?|socks[45]?):\/\/[^\s]+$/i.test(url)) return badRequest("접속 주소가 올바르지 않아요(http://user:pass@host:port).", "url");
    const billingUnit = String(b.billingUnit ?? "ip");
    if (!UNITS.has(billingUnit)) return badRequest("billingUnit 은 ip/gb", "billingUnit");

    /* 🔴 주소는 **암호문으로만** 저장한다(보통 user:pass@host 라 평문이면 그게 곧 열쇠다).
       `CREDS_ENC_KEY` 가 없으면 encryptObj 가 던진다 — 폴백으로 평문 저장 같은 건 하지 않는다(CLAUDE §4.7). */
    const enc = encryptObj({ url });
    const [row] = await q(sql`
      INSERT INTO proxies (tenant_id, label, provider, product, kind, region, url_enc, sticky_key, status,
                           billing_unit, unit_price_krw, cost_krw_month, bandwidth_gb_month, sticky_guaranteed, expires_at, note)
      VALUES (${n(b.tenantId) || null}, ${label}, ${b.provider ? String(b.provider).slice(0, 40) : null},
              ${b.product ? String(b.product).slice(0, 60) : null}, ${String(b.kind ?? "residential").slice(0, 16)},
              ${b.region ? String(b.region).slice(0, 24) : null}, ${enc}, ${b.stickyKey ? String(b.stickyKey).slice(0, 80) : null}, 'active',
              ${billingUnit}, ${n(b.unitPriceKrw)}, ${n(b.costKrwMonth)},
              ${b.bandwidthGbMonth === undefined || b.bandwidthGbMonth === null ? null : Number(b.bandwidthGbMonth)},
              ${b.stickyGuaranteed === true}, ${b.expiresAt ? new Date(String(b.expiresAt)) : null},
              ${b.note ? String(b.note).slice(0, 500) : null})
      RETURNING id, label`);

    await writeAudit({
      tenantId: null, action: "ops_proxy_add", actorType: "operator", actorId: sa.ops.oid, target: `proxy:${n(row?.id)}`,
      // 🔴 감사에도 주소를 남기지 않는다 — 감사 열람 화면이 곧 유출 경로가 된다.
      detail: { label, provider: b.provider ?? null, billingUnit, stickyGuaranteed: b.stickyGuaranteed === true },
      riskLevel: "high",
    });
    return json({ ok: true, proxy: { id: n(row?.id), label: String(row?.label ?? label) } });
  } catch (err) {
    return jsonError("ops_proxies", err);
  }
};
