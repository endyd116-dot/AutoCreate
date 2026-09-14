/**
 * 수익 API(계약 P1R3 §1.4 · §1.4b · §1.4c · DESIGN §9.3):
 *   GET  /api/revenue-summary?month=YYYY-MM → { ok, monthKrw, todayConfirmedKrw, todayEstimatedKrw, prevMonthKrw, bySource, byAccount, topPieces }
 *   GET  /api/revenue-daily?from&to          → { ok, days:[{day,krw,freshness}] }   // 0원인 날도 행 · 없는 날 = 수집 안 됨
 *   GET  /api/revenue-sources                → { ok, sources:[{id,source,accountId?,method,status,lastSyncAt?,lastError?}] }
 *   POST /api/revenue-sources { action:"connect"|"key"|"disconnect", source, accountId?, key? } → { ok:true, url? }
 *        connect(adsense·youtube) = 구글 동의 URL 을 `url` 로 돌려준다(화면이 이동) · key = 키 저장(암호화) · disconnect = 자격 폐기
 *   POST /api/revenue-manual { source, day, amountKrw, accountId?, pieceId? } → { ok:true }   // freshness manual
 *   GET  /api/revenue-oauth-start?source=adsense|youtube&accountId= → 302 구글
 *   GET  /api/revenue-oauth-return?code&state                          → 302 /app/ad-media.html?connected=<source>
 *
 *   🔴 키(평문)는 요청 본문에서 `saveSourceCreds` 로 곧장 암호문이 된다 — 응답·로그·감사 detail 어디에도 평문 0.
 *   🔴 KST: day 는 KST 날짜(§0). 미래 날짜·30일 밖 과거는 수동 입력을 막는다(오타 방지).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { utcDate } from "../../lib/db-util";
import { kstDateStr, addDays } from "../../lib/best-time";
import { summary, daily } from "../../lib/revenue/aggregate";
import { upsertRevenueRows } from "../../lib/revenue/upsert";
import { asSource, ensureSourceRow, listSourceRows, saveSourceCreds } from "../../lib/revenue/index";
import { FRESHNESS_OF, type RevenueSource } from "../../lib/revenue/types";
import { exchangeRevenueCode, googleAppConfigured, revenueAuthorizeUrl, signRevenueState, verifyRevenueState, type RevenueGoogleKind } from "../../lib/revenue/google-oauth";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/revenue-summary", "/api/revenue-daily", "/api/revenue-sources", "/api/revenue-manual", "/api/revenue-oauth-start", "/api/revenue-oauth-return"] };
/** netlify dev 정적 폴백 대비 — 꼬리를 떼고 맞춘다(AC-7). */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const OAUTH_SOURCES = new Set(["adsense", "youtube"]);
/** 키 입력 소스의 필드 순서 — 화면(ad-media.html KEYED)이 `key` 를 이 순서로 «:» 연결해 보낸다. 객체로 보내도 받는다. */
const KEY_FIELDS: Record<string, string[]> = { coupang: ["accessKey", "secretKey"], aliexpress: ["appKey", "appSecret", "trackingId"], linkprice: ["affiliateId", "authKey"] };
const MANUAL_SOURCES = new Set(["meta", "tiktok", "x", "sponsor", "manual"]);
const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const url = new URL(req.url); const path = routeOf(req);
  try {
    /* ───────── 집계 ───────── */
    if (path.endsWith("/revenue-summary")) return json({ ok: true, ...(await summary(tid, url.searchParams.get("month"))) });
    if (path.endsWith("/revenue-daily")) {
      const today = kstDateStr(new Date());
      const from = DAY_RE.test(url.searchParams.get("from") || "") ? url.searchParams.get("from")! : addDays(today, -29);
      const to = DAY_RE.test(url.searchParams.get("to") || "") ? url.searchParams.get("to")! : today;
      if (to < from) return badRequest("기간을 확인해 주세요.", "range");
      return json({ ok: true, days: await daily(tid, from, to), range: { from, to } });
    }

    /* ───────── 구글 동의(애드센스·유튜브) ───────── */
    if (path.endsWith("/revenue-oauth-start")) {
      const source = url.searchParams.get("source");
      if (source !== "adsense" && source !== "youtube") return badRequest("source 는 adsense 또는 youtube 예요.");
      const accountId = n(url.searchParams.get("accountId")) || null;
      const to = revenueAuthorizeUrl(source, signRevenueState({ tid, uid: auth.user.uid, kind: source, accountId }));
      if (!to) return json({ ok: false, step: "provider_not_configured", error: "구글 연결 준비가 아직이에요. 준비되면 바로 연결할 수 있어요." }, 503);
      return redirect(to);
    }
    if (path.endsWith("/revenue-oauth-return")) {
      const st = verifyRevenueState(url.searchParams.get("state") || "");
      if (!st || st.tid !== tid) return redirect("/app/ad-media.html?error=state");
      const code = url.searchParams.get("code") || "";
      if (!code) return redirect(`/app/ad-media.html?error=${encodeURIComponent(url.searchParams.get("error") || "denied")}`);
      const ex = await exchangeRevenueCode(code);
      if (!ex.ok) { console.error("[revenue-oauth-return]", ex.reason); return redirect("/app/ad-media.html?error=exchange"); }
      const id = await saveSourceCreds(tid, st.kind, st.accountId, ex.token as unknown as Record<string, unknown>, { googleAccount: ex.token.handle || "" });
      await writeAudit({ tenantId: tid, action: "revenue_source_connect", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `revenue_source:${id}`, detail: { source: st.kind, accountId: st.accountId, via: "oauth" } });
      return redirect(`/app/ad-media.html?connected=${st.kind}`);
    }

    /* ───────── 소스 목록 ───────── */
    if (path.endsWith("/revenue-sources") && req.method === "GET") {
      const rows = await listSourceRows(tid);
      return json({ ok: true, sources: rows.map((s) => {
        const o: Record<string, unknown> = { id: s.id, source: s.source, method: s.method, status: s.status };
        if (s.accountId) o.accountId = s.accountId;
        if (s.lastSyncAt) o.lastSyncAt = s.lastSyncAt;
        if (s.lastError && s.status !== "connected") o.lastError = s.lastError;
        const cfg = s.config; if (cfg?.googleAccount) o.label = String(cfg.googleAccount);
        return o;
      }) });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<Record<string, unknown>>(req);

    /* ───────── 소스 연결·키·끊기 ───────── */
    if (path.endsWith("/revenue-sources")) {
      const source = asSource(b.source); if (!source) return badRequest("어디서 번 돈인지 골라 주세요.", "source");
      const accountId = n(b.accountId) || null;
      if (accountId) { const [a] = await q(sql`SELECT id FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId}`); if (!a) return badRequest("그 계정이 없어요.", "account"); }
      const action = String(b.action ?? "");

      if (action === "disconnect") {
        await q(sql`UPDATE revenue_sources SET cred_enc = NULL, status = 'disconnected', fail_count = 0, last_error = NULL, last_error_kind = NULL, updated_at = NOW()
          WHERE tenant_id = ${tid} AND source = ${source} AND COALESCE(account_id, 0) = ${accountId ?? 0}`);
        await writeAudit({ tenantId: tid, action: "revenue_source_disconnect", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { source, accountId } });
        return json({ ok: true });
      }
      if (action === "connect") {
        if (OAUTH_SOURCES.has(source)) {
          if (!googleAppConfigured()) return json({ ok: false, step: "provider_not_configured", error: "구글 연결 준비가 아직이에요. 준비되면 바로 연결할 수 있어요." }, 503);
          const to = revenueAuthorizeUrl(source as RevenueGoogleKind, signRevenueState({ tid, uid: auth.user.uid, kind: source as RevenueGoogleKind, accountId }));
          return json({ ok: true, url: to });
        }
        // 러너·수동 소스의 «연결» = 소스 행만 만든다(자격은 계정 세션/직접 입력이 담당).
        const id = await ensureSourceRow(tid, source, accountId, { status: FRESHNESS_OF[source] === "api" ? "not_configured" : "connected" });
        await writeAudit({ tenantId: tid, action: "revenue_source_connect", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `revenue_source:${id}`, detail: { source, accountId, via: FRESHNESS_OF[source] } });
        return json({ ok: true });
      }
      if (action === "key") {
        const fields = KEY_FIELDS[source];
        if (!fields) return badRequest(`${source} 는 키로 연결하는 매체가 아니에요.`, "source");
        // 객체({accessKey,...}) 또는 «:» 연결 문자열(화면 KEYED 순서) 둘 다 받는다.
        const creds: Record<string, string> = {};
        if (b.creds && typeof b.creds === "object") for (const f of fields) { const v = String((b.creds as Record<string, unknown>)[f] ?? "").trim(); if (v) creds[f] = v; }
        else { const parts = String(b.key ?? "").split(":").map((s) => s.trim()); fields.forEach((f, i) => { if (parts[i]) creds[f] = parts[i]; }); }
        const required = fields.filter((f) => f !== "trackingId");
        const missing = required.filter((f) => !creds[f]);
        if (missing.length) return badRequest(`키를 모두 넣어 주세요(${missing.join(", ")}).`, "key");
        const config: Record<string, unknown> = {};
        if (Number.isFinite(Number(b.fxRate)) && Number(b.fxRate) > 0) config.fxRate = Number(b.fxRate);
        const id = await saveSourceCreds(tid, source, accountId, creds, config);
        await writeAudit({ tenantId: tid, action: "revenue_source_key", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `revenue_source:${id}`, detail: { source, accountId, fields: Object.keys(creds) } });   // 값은 절대 싣지 않는다
        return json({ ok: true });
      }
      return badRequest("action 은 connect·key·disconnect 중 하나예요.", "action");
    }

    /* ───────── 수동 입력 ───────── */
    if (path.endsWith("/revenue-manual")) {
      const source = asSource(b.source);
      if (!source || !MANUAL_SOURCES.has(source)) return badRequest("어디서 번 돈인지 골라 주세요(메타·틱톡·엑스·협찬·기타).", "source");
      const day = String(b.day ?? "");
      if (!DAY_RE.test(day)) return badRequest("날짜를 골라 주세요.", "day");
      const today = kstDateStr(new Date());
      if (day > today) return badRequest("오늘보다 뒤 날짜는 넣을 수 없어요.", "day");
      if (day < addDays(today, -365)) return badRequest("1년 안의 날짜만 넣을 수 있어요.", "day");
      const krw = Number(b.amountKrw);
      if (!Number.isFinite(krw) || krw < 0) return badRequest("금액을 숫자로 넣어 주세요.", "amountKrw");
      const accountId = n(b.accountId) || undefined, pieceId = n(b.pieceId) || undefined;
      if (accountId) { const [a] = await q(sql`SELECT id FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId}`); if (!a) return badRequest("그 계정이 없어요.", "account"); }
      if (pieceId) { const [p] = await q(sql`SELECT id FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId}`); if (!p) return badRequest("그 글이 없어요.", "piece"); }
      const r = await upsertRevenueRows(tid, [{ source, day, amountKrw: Math.round(krw), ...(accountId ? { accountId } : {}), ...(pieceId ? { pieceId } : {}), raw: { by: "user", memo: String(b.memo ?? "").slice(0, 200) || undefined } }], "manual");
      if (!r.written) return json({ ok: false, step: "write", error: "저장하지 못했어요." + (r.rejectedReasons[0] ? ` (${r.rejectedReasons[0]})` : "") }, 500);
      await ensureSourceRow(tid, source as RevenueSource, accountId ?? null, { status: "connected" });
      await q(sql`UPDATE revenue_sources SET last_sync_at = NOW(), last_ok_at = NOW(), updated_at = NOW() WHERE tenant_id = ${tid} AND source = ${source} AND COALESCE(account_id, 0) = ${accountId ?? 0}`);
      await writeAudit({ tenantId: tid, action: "revenue_manual", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { source, day, amountKrw: Math.round(krw), accountId: accountId ?? null, pieceId: pieceId ?? null } });
      return json({ ok: true });
    }

    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("revenue", err); }
};

void utcDate;
