/**
 * 계정 API 묶음(계약 P1R1 §1 v1.1 · DESIGN §7):
 *   GET  /api/accounts-list                → { accounts:[AccountRow], channels:[ChannelInfo] }
 *   POST /api/accounts-add                 { channel, handle, loginId?, password?, siteUrl?, appPassword?, displayName? }
 *   POST /api/accounts-remove              { id }            — 소프트 삭제(creds purged_at · status disconnected · last_error_kind removed)
 *   POST /api/accounts-update              { id, displayName?, dailyCap?, minGapMin?, personaId?, proxyUrl?, goldenHours?, monetize? }
 *   POST /api/accounts-oauth-start         { channel } → { url } | step provider_not_configured
 *   GET  /api/accounts-oauth-return?state&code → 302 /app/accounts.html?connected=<channel>
 *   🔴 자격 평문 0(응답·로그·감사). 암호화 = lib/creds-crypto(CREDS_ENC_KEY 폴백 없음 → 정직 500 step creds_key).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { jsonb } from "../../lib/db-util";
import { planOf } from "../../lib/plans";
import { encryptObj, credsEncConfigured } from "../../lib/creds-crypto";
import { q, listAccounts, getAccount, listChannels, connectMethodOf, isChannel, type ChannelKey } from "../../lib/accounts";
import { isOAuthChannel, providerConfigured, signState, verifyState, authorizeUrl, exchangeCode } from "../../lib/oauth-providers";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/accounts-list", "/api/accounts-add", "/api/accounts-remove", "/api/accounts-update", "/api/accounts-oauth-start", "/api/accounts-oauth-return"] };
const n = (v: unknown) => Number(v || 0);
const s = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

/** 플랜 한도 검사 — 살아 있는 계정 수 ≥ maxAccounts 면 한도 응답. */
async function checkLimit(tid: number): Promise<Response | null> {
  const [t] = await q(sql`SELECT plan_key FROM tenants WHERE id = ${tid}`);
  const plan = await planOf(String(t?.plan_key || "trial"));
  const [c] = await q(sql`SELECT COUNT(*) AS c FROM accounts WHERE tenant_id = ${tid} AND COALESCE(last_error_kind,'') <> 'removed'`);
  if (n(c?.c) >= plan.limits.maxAccounts) return json({ ok: false, step: "limit", error: `이 요금제에서는 계정을 ${plan.limits.maxAccounts}개까지 연결할 수 있어요.` }, 403);
  return null;
}

/** 워드프레스 App Password 인증 확인 — GET {siteUrl}/wp-json/wp/v2/users/me (Basic). */
async function verifyWordpress(siteUrl: string, loginId: string, appPassword: string): Promise<{ ok: boolean; name?: string; reason?: string }> {
  const base = siteUrl.replace(/\/+$/, "");
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(`${base}/wp-json/wp/v2/users/me?context=edit`, { headers: { Authorization: `Basic ${Buffer.from(`${loginId}:${appPassword}`).toString("base64")}` }, signal: ctrl.signal });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const j = (await r.json().catch(() => null)) as { id?: number; name?: string } | null;
    if (!j?.id) return { ok: false, reason: "no_user" };
    return { ok: true, name: j.name };
  } catch (e) { return { ok: false, reason: String((e as Error)?.message ?? e).slice(0, 80) }; }
  finally { clearTimeout(t); }
}

/** 계정 행 upsert — 삭제 표식 행이 있으면 되살린다. 반환 id. 중복(살아 있음)이면 null. */
async function upsertAccount(tid: number, channel: string, handle: string, displayName: string | null, authMethod: string, status: string): Promise<number | null> {
  const [ex] = await q(sql`SELECT id, last_error_kind FROM accounts WHERE tenant_id = ${tid} AND channel = ${channel} AND handle = ${handle} LIMIT 1`);
  if (ex) {
    if (String(ex.last_error_kind || "") !== "removed") return null;
    await q(sql`UPDATE accounts SET display_name = COALESCE(${displayName}, display_name), auth_method = ${authMethod}, status = ${status}, last_error_kind = NULL, health_score = 100, posts_today = 0, last_post_at = NULL, updated_at = NOW() WHERE id = ${n(ex.id)}`);
    await q(sql`UPDATE account_creds SET purged_at = NOW() WHERE account_id = ${n(ex.id)} AND purged_at IS NULL`);
    return n(ex.id);
  }
  const [row] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, display_name, auth_method, status)
    VALUES (${tid}, ${channel}, ${handle}, ${displayName}, ${authMethod}, ${status}) RETURNING id`);
  const id = n(row?.id);
  await q(sql`UPDATE accounts SET browser_profile_key = ${`t${tid}-a${id}`} WHERE id = ${id}`);
  return id;
}

async function saveCreds(tid: number, accountId: number, kind: string, obj: Record<string, unknown>, expiresAt?: string): Promise<void> {
  const enc = encryptObj(obj);
  await q(sql`UPDATE account_creds SET purged_at = NOW() WHERE account_id = ${accountId} AND kind = ${kind} AND purged_at IS NULL`);
  await q(sql`INSERT INTO account_creds (tenant_id, account_id, kind, enc, expires_at, verified_at)
    VALUES (${tid}, ${accountId}, ${kind}, ${enc}, ${expiresAt ? sql`${expiresAt}::timestamptz AT TIME ZONE 'UTC'` : null}, ${kind === "password" ? null : sql`NOW()`})`);
}

export default async (req: Request): Promise<Response> => {
  const path = new URL(req.url).pathname;

  /* ── OAuth 콜백(쿠키는 있지만 state 가 신원 정본) ── */
  if (path.endsWith("/accounts-oauth-return")) {
    const u = new URL(req.url);
    const back = (qs: string) => new Response(null, { status: 302, headers: { Location: `/app/accounts.html?${qs}`, "Cache-Control": "no-store" } });
    try {
      const st = verifyState(u.searchParams.get("state") || "");
      const code = u.searchParams.get("code") || "";
      if (!st) return back("error=state");
      if (!code) return back(`error=${encodeURIComponent(u.searchParams.get("error") || "denied")}&channel=${st.channel}`);
      if (!credsEncConfigured()) return back("error=creds_key");
      const lim = await checkLimit(st.tid); if (lim) return back(`error=limit&channel=${st.channel}`);
      const ex = await exchangeCode(st.channel, code);
      if (!ex.ok) { await writeAudit({ tenantId: st.tid, action: "account_oauth_fail", actorType: "user", actorId: st.uid, detail: { channel: st.channel, reason: ex.reason }, riskLevel: "medium" }); return back(`error=oauth&channel=${st.channel}`); }
      const handle = s(ex.token.handle, 120) || ex.token.externalId;
      let id = await upsertAccount(st.tid, st.channel, handle, ex.token.displayName || null, "oauth", "active");
      if (id === null) { const [row] = await q(sql`SELECT id FROM accounts WHERE tenant_id = ${st.tid} AND channel = ${st.channel} AND handle = ${handle}`); id = n(row?.id); await q(sql`UPDATE accounts SET status = 'active', last_error_kind = NULL, updated_at = NOW() WHERE id = ${id}`); }
      await saveCreds(st.tid, id, "oauth", { ...ex.token }, ex.token.expiresAt);
      await writeAudit({ tenantId: st.tid, action: "account_add", actorType: "user", actorId: st.uid, ip: clientIp(req), target: `account:${id}`, detail: { channel: st.channel, handle, method: "oauth" } });
      return back(`connected=${st.channel}`);
    } catch (err) { console.error("[accounts-oauth-return]", err); return back("error=server"); }
  }

  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  try {
    if (path.endsWith("/accounts-list")) {
      const [accounts, channels] = await Promise.all([listAccounts(tid), listChannels()]);
      return json({ ok: true, accounts, channels });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

    if (path.endsWith("/accounts-oauth-start")) {
      const b = await readJson<{ channel?: string }>(req);
      const channel = s(b.channel, 24);
      if (!isOAuthChannel(channel)) return badRequest("이 채널은 아이디로 연결해요.", "channel");
      if (!providerConfigured(channel)) return json({ ok: false, step: "provider_not_configured", error: "준비 중이에요" });
      const lim = await checkLimit(tid); if (lim) return lim;
      const url = authorizeUrl(channel, signState({ tid, channel, uid: auth.user.uid }));
      if (!url) return json({ ok: false, step: "provider_not_configured", error: "준비 중이에요" });
      return json({ ok: true, url });
    }

    if (path.endsWith("/accounts-add")) {
      const b = await readJson<Record<string, unknown>>(req);
      const channel = s(b.channel, 24);
      if (!isChannel(channel)) return badRequest("채널을 골라 주세요.", "channel");
      const handle = s(b.handle, 120);
      if (!handle) return badRequest("아이디(핸들)를 적어 주세요.", "handle");
      if (/쿠팡|coupang/i.test(handle) || /쿠팡|coupang/i.test(s(b.displayName, 120))) return json({ ok: false, step: "handle_policy", error: "채널 이름에 «쿠팡»을 쓸 수 없어요(파트너스 정책)." }, 400);
      const method = connectMethodOf(channel);
      if (method === "oauth") return json({ ok: false, step: "oauth_required", error: "이 채널은 «연결하기» 버튼으로 로그인해 주세요." }, 400);
      if (!credsEncConfigured()) return json({ ok: false, step: "creds_key", error: "계정 자격 암호화 키가 설정되지 않았어요. 운영팀에 알려 주세요." }, 500);
      const lim = await checkLimit(tid); if (lim) return lim;
      const displayName = s(b.displayName, 120) || null;
      const loginId = s(b.loginId, 160);

      if (method === "session") {
        const password = String(b.password ?? "");
        if (!loginId || !password) return badRequest("아이디와 비밀번호를 적어 주세요.", "creds");
        const id = await upsertAccount(tid, channel as ChannelKey, handle, displayName, "session", "pending_login");
        if (id === null) return json({ ok: false, step: "duplicate", error: "이미 연결한 계정이에요." }, 409);
        await saveCreds(tid, id, "password", { loginId, password });
        await writeAudit({ tenantId: tid, action: "account_add", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `account:${id}`, detail: { channel, handle, method: "session" } });
        return json({ ok: true, account: await getAccount(tid, id) }, 201);
      }
      // wordpress — App Password 인증 확인 후 active
      const siteUrl = s(b.siteUrl, 200).replace(/\/+$/, "");
      const appPassword = String(b.appPassword ?? "").trim();
      if (!/^https?:\/\//i.test(siteUrl) || !loginId || !appPassword) return badRequest("사이트 주소·아이디·앱 비밀번호를 적어 주세요.", "creds");
      const v = await verifyWordpress(siteUrl, loginId, appPassword);
      if (!v.ok) { await writeAudit({ tenantId: tid, action: "account_add_fail", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { channel, handle, reason: v.reason } }); return json({ ok: false, step: "wp_auth", error: "워드프레스 로그인 정보를 확인해 주세요." }, 400); }
      const id = await upsertAccount(tid, channel as ChannelKey, handle, displayName || v.name || null, "app_password", "active");
      if (id === null) return json({ ok: false, step: "duplicate", error: "이미 연결한 계정이에요." }, 409);
      await saveCreds(tid, id, "app_password", { siteUrl, loginId, appPassword });
      await writeAudit({ tenantId: tid, action: "account_add", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `account:${id}`, detail: { channel, handle, method: "app_password", siteUrl } });
      return json({ ok: true, account: await getAccount(tid, id) }, 201);
    }

    if (path.endsWith("/accounts-remove")) {
      const b = await readJson<{ id?: number }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const acc = await getAccount(tid, id);
      if (!acc || acc.lastErrorKind === "removed") return json({ ok: false, error: "계정을 찾을 수 없어요.", step: "not_found" }, 404);
      await q(sql`UPDATE account_creds SET purged_at = NOW() WHERE tenant_id = ${tid} AND account_id = ${id} AND purged_at IS NULL`);
      await q(sql`UPDATE accounts SET status = 'disconnected', last_error_kind = 'removed', updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${id}`);
      await writeAudit({ tenantId: tid, action: "account_remove", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `account:${id}`, detail: { channel: acc.channel, handle: acc.handle }, riskLevel: "medium" });
      return json({ ok: true });
    }

    if (path.endsWith("/accounts-update")) {
      const b = await readJson<Record<string, unknown>>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const acc = await getAccount(tid, id);
      if (!acc || acc.lastErrorKind === "removed") return json({ ok: false, error: "계정을 찾을 수 없어요.", step: "not_found" }, 404);
      const sets: ReturnType<typeof sql>[] = [];
      if (b.displayName !== undefined) { const dn = s(b.displayName, 120); if (/쿠팡|coupang/i.test(dn)) return json({ ok: false, step: "handle_policy", error: "채널 이름에 «쿠팡»을 쓸 수 없어요(파트너스 정책)." }, 400); sets.push(sql`display_name = ${dn || null}`); }
      if (b.dailyCap !== undefined) sets.push(sql`daily_cap = ${Math.max(0, Math.min(20, Math.trunc(n(b.dailyCap))))}`);
      if (b.minGapMin !== undefined) sets.push(sql`min_gap_min = ${Math.max(30, Math.min(1440, Math.trunc(n(b.minGapMin)) || 180))}`);
      if (b.personaId !== undefined) {
        const pid = n(b.personaId);
        if (pid) { const [p] = await q(sql`SELECT id FROM personas WHERE tenant_id = ${tid} AND id = ${pid}`); if (!p) return badRequest("페르소나를 찾을 수 없어요.", "persona"); }
        sets.push(sql`persona_id = ${pid || null}`);
      }
      if (b.proxyUrl !== undefined) { const px = s(b.proxyUrl, 200); if (px && !/^(https?|socks5?):\/\//i.test(px)) return badRequest("프록시 주소 형식을 확인해 주세요.", "proxy"); sets.push(sql`proxy_url = ${px || null}`); }
      if (b.goldenHours !== undefined) {
        const gh = Array.isArray(b.goldenHours) ? [...new Set((b.goldenHours as unknown[]).map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, c) => a - c) : [];
        sets.push(sql`golden_hours = ${gh.length ? jsonb(gh) : null}`);
      }
      const mon = (b.monetize && typeof b.monetize === "object" ? b.monetize : null) as Record<string, unknown> | null;
      if (mon) {
        const [cur] = await q(sql`SELECT monetize FROM accounts WHERE id = ${id}`);
        const m = { ...((cur?.monetize && typeof cur.monetize === "object" ? cur.monetize : {}) as Record<string, unknown>) };
        if (mon.adpostMediaId !== undefined) { const v = s(mon.adpostMediaId, 80); if (v) m.adpostMediaId = v; else delete m.adpostMediaId; }
        if (mon.adsensePub !== undefined) { const v = s(mon.adsensePub, 40); if (v) m.adsensePub = v; else delete m.adsensePub; }
        const ak = s(mon.coupangAccessKey, 120), sk = s(mon.coupangSecretKey, 120);
        if (ak || sk) {
          if (!ak || !sk) return badRequest("쿠팡 파트너스 액세스 키와 시크릿 키를 둘 다 적어 주세요.", "coupang");
          if (!credsEncConfigured()) return json({ ok: false, step: "creds_key", error: "계정 자격 암호화 키가 설정되지 않았어요." }, 500);
          await saveCreds(tid, id, "coupang", { accessKey: ak, secretKey: sk });
          m.coupang = true;
        } else if (mon.coupangAccessKey === null || mon.coupangAccessKey === "") {
          await q(sql`UPDATE account_creds SET purged_at = NOW() WHERE account_id = ${id} AND kind = 'coupang' AND purged_at IS NULL`);
          delete m.coupang;
        }
        sets.push(sql`monetize = ${jsonb(m)}`);
      }
      if (!sets.length) return badRequest("바꿀 값이 없어요.");
      await q(sql`UPDATE accounts SET ${sql.join(sets, sql`, `)}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${id}`);
      if (mon) { const [chk] = await q(sql`SELECT jsonb_typeof(monetize) AS t FROM accounts WHERE id = ${id}`); if (chk?.t !== "object") console.error("[accounts-update] monetize jsonb_typeof !== object", chk); }
      await writeAudit({ tenantId: tid, action: "account_update", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `account:${id}`, detail: { keys: Object.keys(b).filter((k) => k !== "id" && k !== "monetize"), monetizeKeys: mon ? Object.keys(mon) : [] } });
      return json({ ok: true, account: await getAccount(tid, id) });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) {
    if ((err as { code?: string })?.code === "CREDS_ENC_KEY_MISSING") return json({ ok: false, step: "creds_key", error: "계정 자격 암호화 키가 설정되지 않았어요." }, 500);
    return jsonError("accounts", err);
  }
};
