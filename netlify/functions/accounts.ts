/**
 * 계정 API 묶음(계약 P1R1 §1 v1.1 · DESIGN §7):
 *   GET  /api/accounts-list                → { accounts:[AccountRow], channels:[ChannelInfo] }
 *   POST /api/accounts-add                 { channel, handle, loginId?, password?, siteUrl?, appPassword?, displayName?, agreeCredsStorage? }
 *   [P1R7 §3.2] 채널 게이트 — **새로 연결할 때만** 요금제를 본다(402 `step:"plan_channel"`). 🔴 이미 연결한 계정은 소급해서 막지 않는다.
 *   [P1R7 §3.3] 자격 보관 동의 — 아이디·비밀번호를 맡기는 채널(session·app_password)은 `agreeCredsStorage:true` 를 받아 `consents(creds_storage)` 1행.
 *     🔴 키 자체가 없는 옛 화면은 막지 않는다(가입 동의와 같은 관례) — 대신 감사 `account_add_no_consent` 를 남긴다. 화면이 보내기 시작하면 필수가 된다.
 *   POST /api/accounts-remove              { id }            — 소프트 삭제(creds purged_at · status disconnected · last_error_kind removed)
 *   POST /api/accounts-update              { id, displayName?, dailyCap?, minGapMin?, personaId?, proxyUrl?, goldenHours?, monetize?, groupName?|groupId?, avatarUrl?, defaultTier?, defaultStyleId?, reader?, openedAt? }
 *                                          🔴 [AC-201] `confirmBlogId?` — «이 블로그 주소가 맞아요»(러너가 실제로 본 주소만 · null = 승인 취소)
 *     · 🔴 [2026-09-21 · B] `openedAt` = **이 계정을 만든 날**(YYYY-MM-DD · `null`·`""` = 모름으로 되돌리기).
 *       워밍업이 «우리와 연결한 날» 대신 **이 날**을 먼저 본다(`lib/warmup.ts:57`) — 3년 된 블로그를 어제 연결해도 1주차로 묶이지 않게.
 *       🔴 읽는 곳이 **6곳**인데 **쓰는 길이 0곳**이었다(`scripts/verify-write-path-missing.mjs` 가 잡았다 · 라이브 92계정 전부 NULL).
 *       응답에도 `openedAt` 으로 함께 싣는다 — **안 실으면 «저장은 됐는데 다시 열면 비어 있다»** 가 된다(이 파일이 `reader` 에서 이미 겪은 그것).
 *     · [R11-8] `reader` = 이 계정의 독자(≤120자 · 채널 계약 `contract.reader` 를 덮어쓴다). 🔴 `null`·`""` = 벗기기 = 계약 값 그대로(지금과 같다).
 *     · [P1R8 §5.3] `avatarUrl` = 계정 사진(https 만 · 빈 문자열이면 지운다) · `groupName` 은 없으면 만들어 붙인다(같은 채널 안에서만).
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
import { planOf, checkLimit as planLimit, requireChannel } from "../../lib/plans";
import { recordConsents, hasConsent } from "../../lib/billing/consents";
import { attachAccountToSlot } from "../../lib/account-slots";
import { encryptObj, credsEncConfigured } from "../../lib/creds-crypto";
import { q, listAccounts, getAccount, listChannels, connectMethodOf, isChannel, type ChannelKey } from "../../lib/accounts";
import { COIN_TIER_LIST, COIN_TIER_NOTE, COIN_ITEM_LABEL, toCoinTier } from "../../lib/coin-table";
import { loadPacksAndTable } from "../../lib/billing/packs";   // 🔴 단가는 운영센터 오버레이 적용값 한 곳에서(사장님 지시 2026-09-21)   // [R10-9] 등급 표(글자 정본) · 계정 기본 등급 검증
import { isOAuthChannel, providerConfigured, signState, verifyState, authorizeUrl, exchangeCode } from "../../lib/oauth-providers";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/accounts-list", "/api/accounts-add", "/api/accounts-remove", "/api/accounts-update", "/api/accounts-oauth-start", "/api/accounts-oauth-return"] };
/** netlify dev 는 함수가 404 를 내면 같은 경로에 `.html`·`.htm`·`/index.html` 을 붙여 다시 부른다(마지막 시도의 응답이 클라이언트에 간다)(정적 폴백) — 그 재시도가 경로 매칭에서 빠지면 엉뚱한 405 가 보인다. 꼬리를 떼고 맞춘다. */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);
const s = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

/** [P1R7 §3.2] 채널 게이트 — 화면이 쓰는 이름(레지스트리 label)으로 사람말을 만든다. 통과면 null. */
async function checkChannel(tid: number, channel: string): Promise<Response | null> {
  const label = (await listChannels()).find((c) => c.key === channel)?.label;
  const g = await requireChannel(tid, channel, label);
  return g.ok ? null : g.res ?? null;
}
/**
 * [P1R7 B3] 연결 가능 게이트 — **아직 못 붙이는 채널에 붙이려는 시도**를 서버가 막는다(화면은 게이트가 아니다 · AC-29·AC-48).
 *   🔴 **기존 계정이 있으면 통과** — 채널을 껐다 켜는 사이에 «재연결»까지 막히면 멀쩡히 쓰던 고객이 갇힌다(그래서 조건이 둘이다).
 *   🔴 이 402 는 **돈 문제가 아니다** — `reason:"plan_limit"` 을 **싣지 않는다**(싣는 순간 화면이 요금제 업셀 시트를 띄운다 · `ui.js UI.gate`).
 *      플랜 게이트(`checkChannel`)가 **먼저** 돌고(메인 판정) 그다음이 이 게이트다: «이 요금제엔 없어요» 가 «아직 준비 중이에요» 보다 상위 사실이다.
 */
async function checkConnectable(tid: number, channel: string): Promise<Response | null> {
  const info = (await listChannels()).find((c) => c.key === channel);
  if (!info || info.connectable) return null;
  const [live] = await q(sql`SELECT COUNT(*)::int AS c FROM accounts WHERE tenant_id = ${tid} AND channel = ${channel} AND COALESCE(last_error_kind,'') <> 'removed'`);
  if (n(live?.c)) return null;                       // 이미 붙여 둔 계정이 있다 = 재연결·추가는 막지 않는다
  const label = info.label || channel;
  /* 조사(은/는)는 채널 이름 받침에 따라 달라진다(«네이버 클립은» · «유튜브 쇼츠는») — 쉼표로 끊어 **조사를 쓰지 않는다**(알림 문구와 같은 꼴). */
  const error = info.connectableReason === "not_open"
    ? `${label}, 아직 열지 않았어요. 준비되면 알려드릴게요.`
    : `${label}, 연결을 준비하고 있어요. 준비되면 알려드릴게요.`;   // no_provider_key · no_site_url — 고객에겐 같은 사실(우리가 준비 중)
  return json({ ok: false, step: "channel_not_connectable", channel, connectableReason: info.connectableReason, error }, 402);
}

/** [P1R7 §3.3] 자격 보관 동의 — true 면 기록(이미 있으면 그대로) · 키가 없으면 통과 + 감사. false 면 400. */
async function credsConsent(tid: number, uid: number, body: Record<string, unknown>, channel: string, meta: { ip?: string | null; ua?: string | null }): Promise<Response | null> {
  if (body.agreeCredsStorage === true) { if (!(await hasConsent(tid, "creds_storage"))) await recordConsents(tid, uid, ["creds_storage"], meta); return null; }
  if ("agreeCredsStorage" in body) return json({ ok: false, step: "creds_consent", error: "아이디·비밀번호 보관에 동의해 주세요." }, 400);
  await writeAudit({ tenantId: tid, action: "account_add_no_consent", actorType: "user", actorId: uid, riskLevel: "medium", detail: { channel, note: "agreeCredsStorage 키 없이 연결(옛 화면)" } });
  return null;
}

/** 플랜 한도 검사 — P1R4 §1.4: `lib/plans.checkLimit` 한 벌(402 `plan_limit` · used/limit/planKey · A 의 업셀 시트가 이 모양을 읽는다). R1 의 로컬 403 step:limit 은 폐기. */
async function checkLimit(tid: number): Promise<Response | null> {
  const c = await planLimit(tid, "accounts");
  return c.ok ? null : c.res ?? null;
}
void planOf;

/** 워드프레스 App Password 인증 확인 — GET {siteUrl}/wp-json/wp/v2/users/me (Basic). */
/**
 * [R17-B2 · 2026-09-23] 🔴 **워드프레스 연결이 왜 안 됐나를 갈라서 말한다.**
 *
 *   ══ 왜 ══
 *   `verifyWordpress` 는 실패를 **다섯 갈래**로 가르는데(`http_401`·`http_403`·`http_404`·`no_user`·연결 실패)
 *   고객에게는 전부 **«워드프레스 로그인 정보를 확인해 주세요»** 한 문장으로 나갔다.
 *   🔴 그 말은 404·연결 실패에서는 **거짓**이다 — 주소가 안 열리거나 REST 가 꺼진 건데 비밀번호를 다시 만들러 간다.
 *      «키 꽂으면 즉시 가동»의 ①(정직하게 말한다)이 서버 안에서만 지켜지고 **화면 앞에서 뭉개지던 자리**다.
 *
 *   ══ 어떻게 ══ §3 그대로 — ①**사실 한 줄**(무엇이 그런가) ②**어떻게 하면 되는지** ③(있으면) 우리가 대신 해 주는 것.
 *   🔴 겁주지 않는다: «안 됩니다»·«차단됐습니다»로 끝내지 않고 **다음 손**을 같이 준다.
 *   🔴 `field` 는 화면이 **어느 칸에 빨간 줄을 칠지**다 — 주소 문제를 비밀번호 칸에 칠하면 그것도 거짓 안내다.
 */
export function wpAuthSay(reason?: string): { error: string; field: "siteUrl" | "loginId" | "appPassword"; detail?: string } {
  const r = String(reason ?? "");
  if (r === "http_401") return { field: "appPassword", error: "아이디나 앱 비밀번호가 맞지 않아요. 워드프레스 관리자 → 사용자 → 프로필 → «응용 프로그램 비밀번호»에서 새로 만들어 붙여넣어 주세요(띄어쓰기는 그대로 두셔도 돼요)." };
  if (r === "http_403") return { field: "appPassword", error: "워드프레스가 요청을 막았어요. 보안 플러그인이 REST API 를 막고 있거나 앱 비밀번호 기능이 꺼져 있을 때 그래요. 플러그인에서 «REST API» 를 허용하거나 잠시 꺼 보고 다시 눌러 주세요." };
  if (r === "http_404") return { field: "siteUrl", error: "그 주소에서 워드프레스를 못 찾았어요. 주소가 맞는지(끝에 /wp 같은 게 붙는지) 보시고, 관리자 → 설정 → 고유주소를 «기본»이 아닌 것으로 한 번 저장해 주시면 대개 열려요." };
  if (r === "no_user") return { field: "loginId", error: "로그인은 됐는데 사용자 정보를 못 읽었어요. 그 아이디에 글쓰기 권한(편집자 이상)이 있는지 확인해 주세요." };
  if (/abort|timeout|ETIMEDOUT/i.test(r)) return { field: "siteUrl", error: "사이트가 제때 응답하지 않았어요. 주소가 맞는지 보시고 잠시 뒤에 다시 눌러 주세요.", detail: r.slice(0, 60) };
  /* 나머지(DNS·인증서·연결 거부 등) — 🔴 **모르는 것을 «비밀번호가 틀렸다»로 바꾸지 않는다**(AC-9). */
  return { field: "siteUrl", error: "사이트에 연결하지 못했어요. 주소를 https:// 부터 정확히 적었는지 확인해 주세요.", detail: r.slice(0, 60) };
}

export async function verifyWordpress(siteUrl: string, loginId: string, appPassword: string): Promise<{ ok: boolean; name?: string; reason?: string }> {
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
  const path = routeOf(req);

  /* ── OAuth 콜백(쿠키는 있지만 state 가 신원 정본) ── */
  if (path.endsWith("/accounts-oauth-return")) {
    const u = new URL(req.url);
    const back = (qs: string) => new Response(null, { status: 302, headers: { Location: `/app/accounts.html?${qs}`, "Cache-Control": "no-store" } });
    try {
      const stateRaw = u.searchParams.get("state") || "";
      const st = verifyState(stateRaw);
      const code = u.searchParams.get("code") || "";
      if (!st) return back("error=state");
      if (!code) return back(`error=${encodeURIComponent(u.searchParams.get("error") || "denied")}&channel=${st.channel}`);
      if (!credsEncConfigured()) return back("error=creds_key");
      const lim = await checkLimit(st.tid); if (lim) return back(`error=limit&channel=${st.channel}`);
      /* [P1R8 §3.4 · B2] 🔴 state 원문을 함께 넘긴다 — **X 만** 이걸로 PKCE verifier 를 다시 계산한다
         (저장소 없이 PKCE 를 성립시키는 자리 · `lib/oauth-providers.ts xPkceVerifier` 주석). 다른 채널은 무시한다. */
      const ex = await exchangeCode(st.channel, code, stateRaw);
      if (!ex.ok) { await writeAudit({ tenantId: st.tid, action: "account_oauth_fail", actorType: "user", actorId: st.uid, detail: { channel: st.channel, reason: ex.reason }, riskLevel: "medium" }); return back(`error=oauth&channel=${st.channel}`); }
      const handle = s(ex.token.handle, 120) || ex.token.externalId;
      let id = await upsertAccount(st.tid, st.channel, handle, ex.token.displayName || null, "oauth", "active");
      if (id === null) { const [row] = await q(sql`SELECT id FROM accounts WHERE tenant_id = ${st.tid} AND channel = ${st.channel} AND handle = ${handle}`); id = n(row?.id); await q(sql`UPDATE accounts SET status = 'active', last_error_kind = NULL, updated_at = NOW() WHERE id = ${id}`); }
      await saveCreds(st.tid, id, "oauth", { ...ex.token }, ex.token.expiresAt);
      /* [P1R8 §5.3] 프로필 사진 — 토큰 교환 응답에 **이미 들어 있을 때만** 넣는다(추가 호출 0 · 없으면 NULL 그대로).
         🔴 `COALESCE` 를 쓰지 않고 «있을 때만 UPDATE» 한다 — 고객이 직접 넣은 사진을 재연결이 덮어쓰지 않게. */
      if (ex.token.avatarUrl && /^https:\/\//i.test(ex.token.avatarUrl)) {
        await q(sql`UPDATE accounts SET avatar_url = ${ex.token.avatarUrl.slice(0, 400)}, updated_at = NOW()
          WHERE tenant_id = ${st.tid} AND id = ${id} AND avatar_url IS NULL`);
      }
      const oslot = await attachAccountToSlot(st.tid, id, st.uid);   // [P1R7 §3.6] 산 슬롯이 있으면 붙인다(세션 연결과 같은 규칙)
      await writeAudit({ tenantId: st.tid, action: "account_add", actorType: "user", actorId: st.uid, ip: clientIp(req), target: `account:${id}`, detail: { channel: st.channel, handle, method: "oauth", slotId: oslot?.id ?? null } });
      return back(`connected=${st.channel}`);
    } catch (err) { console.error("[accounts-oauth-return]", err); return back("error=server"); }
  }

  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  try {
    if (path.endsWith("/accounts-list")) {
      /* 🔴 [2026-09-21 B · 사장님 지시] **코인 단가를 같이 싣는다** —
         «모든 화면의 코인값은 변수로 지정해서, 운영센터에서 가격 바꾸면 다 같이 바뀌어서 보일 수 있게».
         이 문을 고른 까닭: 디렉터(`director.html:61`)·편성표(`schedule.html:78`)·만들기(`create.html:68`)가
         **이미 이 문을 부르고**, 디렉터는 **영상 상한도 여기서 받는다**(`channels[].video.maxSeconds` ·
         그 줄 주석이 «화면 상수 금지»라고 못 박아 뒀다). 왕복을 안 늘리고 같은 규율 자리에 얹는다.
         🔴 값은 `loadPacksAndTable()`(운영센터 오버레이 적용 · 60초 캐시) — `plans-list` 와 **같은 한 곳**이다.
            여기서 `COIN_TABLE` 을 직접 쓰면 그 순간 다시 두 벌이 된다. */
      const [accounts, channels, coins] = await Promise.all([listAccounts(tid), listChannels(), loadPacksAndTable()]);
      /* [R10-9] 등급 표를 같이 싣는다 — 계정 화면·디렉터·직접 쓰기가 다 accounts-list 를 이미 부른다(A 합의). 글자(label·say)는 서버 정본. */
      return json({ ok: true, accounts, channels, tiers: COIN_TIER_LIST, tierNote: COIN_TIER_NOTE,
        coins: { table: coins.table, labels: COIN_ITEM_LABEL } });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

    if (path.endsWith("/accounts-oauth-start")) {
      const b = await readJson<{ channel?: string; agreeCredsStorage?: boolean }>(req);
      const channel = s(b.channel, 24);
      if (!isOAuthChannel(channel)) return badRequest("이 채널은 아이디로 연결해요.", "channel");
      const gate = await checkChannel(tid, channel); if (gate) return gate;            // 🔴 [P1R7 §3.2] 요금제가 먼저 — «준비 중» 보다 «이 요금제엔 없어요» 가 정확한 이유다
      const openGate = await checkConnectable(tid, channel); if (openGate) return openGate;   // [P1R7 B3] 그다음이 «지금 붙일 수 있나»(레지스트리·앱 키)
      if (!providerConfigured(channel)) return json({ ok: false, step: "provider_not_configured", error: "준비 중이에요" });   // 위 게이트를 통과한 예외(기존 계정 보유)용 폴백
      const lim = await checkLimit(tid); if (lim) return lim;
      const consent = await credsConsent(tid, auth.user.uid, b as Record<string, unknown>, channel, { ip: clientIp(req), ua: req.headers.get("user-agent") });   // [P1R7 §3.3] OAuth 토큰도 «맡기는 자격»이다
      if (consent) return consent;
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
      // 🔴 [P1R7 §3.2] 요금제 게이트가 **가장 먼저**다 — 요금제에 없는 채널에 «OAuth 로 연결하세요»·«준비 중이에요» 를 먼저 말하면 거짓 안내가 된다.
      const gate = await checkChannel(tid, channel); if (gate) return gate;
      const openGate = await checkConnectable(tid, channel); if (openGate) return openGate;   // [P1R7 B3] «아직 못 붙이는 채널»에 «자격이 틀렸다»를 돌려주던 것을 바로잡는다
      const method = connectMethodOf(channel);
      if (method === "oauth") return json({ ok: false, step: "oauth_required", error: "이 채널은 «연결하기» 버튼으로 로그인해 주세요." }, 400);
      if (!credsEncConfigured()) return json({ ok: false, step: "creds_key", error: "계정 자격 암호화 키가 설정되지 않았어요. 운영팀에 알려 주세요." }, 500);
      const lim = await checkLimit(tid); if (lim) return lim;
      const consent = await credsConsent(tid, auth.user.uid, b, channel, { ip: clientIp(req), ua: req.headers.get("user-agent") });   // [P1R7 §3.3]
      if (consent) return consent;
      const displayName = s(b.displayName, 120) || null;
      const loginId = s(b.loginId, 160);

      if (method === "session") {
        const password = String(b.password ?? "");
        if (!loginId || !password) return badRequest("아이디와 비밀번호를 적어 주세요.", "creds");
        const id = await upsertAccount(tid, channel as ChannelKey, handle, displayName, "session", "pending_login");
        if (id === null) return json({ ok: false, step: "duplicate", error: "이미 연결한 계정이에요." }, 409);
        await saveCreds(tid, id, "password", { loginId, password });
        const slot = await attachAccountToSlot(tid, id, auth.user.uid);   // [P1R7 §3.6] 산 슬롯이 있으면 이 계정에 붙이고 IP 배정(B2)·첫 차감을 시도한다
        await writeAudit({ tenantId: tid, action: "account_add", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `account:${id}`, detail: { channel, handle, method: "session", slotId: slot?.id ?? null } });
        return json({ ok: true, account: await getAccount(tid, id), ...(slot ? { slot } : {}) }, 201);
      }
      // wordpress — App Password 인증 확인 후 active
      const siteUrl = s(b.siteUrl, 200).replace(/\/+$/, "");
      const appPassword = String(b.appPassword ?? "").trim();
      if (!/^https?:\/\//i.test(siteUrl) || !loginId || !appPassword) return badRequest("사이트 주소·아이디·앱 비밀번호를 적어 주세요.", "creds");
      const v = await verifyWordpress(siteUrl, loginId, appPassword);
      if (!v.ok) {
        await writeAudit({ tenantId: tid, action: "account_add_fail", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { channel, handle, reason: v.reason } });
        /* 🔴 [R17-B2] **다섯 갈래로 갈라서 말한다.** 종전엔 전부 «로그인 정보를 확인해 주세요» 한 문장이었는데,
           404(REST 가 꺼져 있다)·연결 실패(주소가 안 열린다)는 **로그인 문제가 아니다** — 그 말은 고객을
           아무 소용 없는 곳(비밀번호 다시 만들기)으로 보낸다. §3 그대로 «사실 한 줄 + 어떻게 하면 되는지»로 준다. */
        return json({ ok: false, step: "wp_auth", ...wpAuthSay(v.reason) }, 400);
      }
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
      /* [P1R8 §5.3] 계정 사진 — 고객이 직접 넣거나 지운다(빈 문자열 = 지우기).
         🔴 **https 만** 받는다: http 사진을 우리 화면(https)에 걸면 브라우저가 막아서 «넣었는데 안 보인다»가 된다. */
      if (b.avatarUrl !== undefined) {
        const av = s(b.avatarUrl, 400);
        if (av && !/^https:\/\//i.test(av)) return badRequest("사진 주소는 https 로 시작해야 해요.", "avatarUrl");
        sets.push(sql`avatar_url = ${av || null}`);
      }
      if (b.proxyUrl !== undefined) { const px = s(b.proxyUrl, 200); if (px && !/^(https?|socks5?):\/\//i.test(px)) return badRequest("프록시 주소 형식을 확인해 주세요.", "proxy"); sets.push(sql`proxy_url = ${px || null}`); }
      /* [R10-9] 🔴 계정 기본 등급 — 같은 사람이 수익 블로그는 프리미엄, 취미 계정은 간단히. null·"" = «안 고름»으로 되돌리기(= simple 로 만든다).
         모르는 값은 거절한다(조용히 simple 로 접으면 고객은 프리미엄을 골랐다고 믿는다 · AC-92). 어휘는 `COIN_TIER_KEYS` 한 곳. */
      if (b.defaultTier !== undefined) {
        const raw = b.defaultTier === null ? "" : String(b.defaultTier).trim();
        const t = raw ? toCoinTier(raw) : null;
        if (raw && !t) return badRequest("등급은 간단히·보통·프리미엄 중 하나예요.", "defaultTier");
        sets.push(sql`quality_tier = ${t}`);
      }
      /* [R11-8 · 설계 R11 §4.4] 🔴 **이 계정의 독자** — 채널 계약을 덮어쓴다. `null`·`""` = 벗기기(계약 값 그대로 · 지금과 같다).
         🔴 **허용 목록에 넣는 것까지가 «값을 만든 것»이다** — 2026-09-16 까지 네 곳에서 «저장은 200 인데 새로고침하면 사라졌다»가 났다.
            그래서 읽는 쪽(`ACCOUNT_SELECT`·`toAccountRow`·`content-gen` 프롬프트·검수 3축)을 **같은 커밋에** 넣었다.
         🔴 120자 상한은 DDL(varchar(120))과 같은 수다 — 넘치면 DB 가 거절하는 게 아니라 여기서 잘라 준다(고객이 «왜 안 되지»를 겪지 않게). */
      if (b.reader !== undefined) {
        const rd = s(b.reader, 120);
        sets.push(sql`reader = ${rd || null}`);
      }
      /* 🔴 [2026-09-21 · B] **계정을 만든 날** — 워밍업이 «우리와 연결한 날»보다 **먼저** 보는 값(`lib/warmup.ts:57`).
         읽는 곳이 여섯인데 **쓰는 길이 없어서** 라이브 92계정이 전부 NULL 이었다 — 오래 쓰던 블로그도 «1주차»로 묶였다.
         🔴 «모른다»를 **아무 날짜로 바꾸지 않는다**(AC-92): 빈 값이면 NULL 로 되돌리고, 워밍업은 다시 `created_at` 을 본다.
         받는 모양은 `YYYY-MM-DD` 하나뿐이다 — 칸이 `date` 라서 시각·시간대가 끼면 그때부터 «어느 날인가»가 갈린다(§4.5b). */
      if (b.openedAt !== undefined) {
        const raw = b.openedAt === null ? "" : String(b.openedAt).trim();
        if (raw) {
          if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) return badRequest("날짜는 2024-03-15 처럼 적어 주세요.", "openedAt");
          const t = Date.parse(`${raw}T00:00:00Z`);
          if (!Number.isFinite(t)) return badRequest("그런 날짜는 없어요. 다시 골라 주세요.", "openedAt");
          /* 오늘(KST)보다 뒤면 계정을 만든 날일 수 없다. 겁주지 않고 어떻게 하면 되는지만 말한다(§3). */
          const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
          if (raw > todayKst) return badRequest("아직 오지 않은 날이에요. 계정을 만든 날을 골라 주세요.", "openedAt");
          if (raw < "2000-01-01") return badRequest("2000년 이후로 골라 주세요.", "openedAt");
        }
        sets.push(sql`opened_at = ${raw || null}`);
      }
      /* [R10-4] 계정에 걸어 둔 스타일 — null = 벗기기. 남의 집 스타일·지운 스타일은 못 건다(교차 누수 · CLAUDE §4.6). */
      if (b.defaultStyleId !== undefined) {
        const sid = b.defaultStyleId === null || b.defaultStyleId === "" ? 0 : Math.floor(n(b.defaultStyleId));
        if (sid) { const [st] = await q(sql`SELECT id FROM text_styles WHERE tenant_id = ${tid} AND id = ${sid} AND deleted_at IS NULL`); if (!st) return badRequest("그 스타일을 찾지 못했어요.", "defaultStyleId"); }
        sets.push(sql`text_style_id = ${sid || null}`);
      }
      /* [P1R7-B2 §2.5-⑦] **계정 묶음** — 한 계정이 정지되면 예약을 같은 묶음의 다른 계정으로 넘긴다(`reassignSlots` 가 이 값을 본다).
         🔴 표(`account_groups`)와 칸(`accounts.group_id`)은 처음부터 있었는데 **값을 넣는 코드가 0건**이라
            승계 정렬 키가 늘 NULL — 그룹이 없는 것과 같았다(2026-09-15 grep 실측). 여기가 그 값을 넣는 자리다.
         이름을 주면 없을 때 만들어 붙인다(«묶음 먼저 만들고 계정에 붙이기» 2단계를 고객에게 시키지 않는다). */
      if (b.groupName !== undefined || b.groupId !== undefined) {
        let gid = n(b.groupId) || 0;
        const gname = s(b.groupName, 60);
        if (!gid && gname) {
          const [g] = await q(sql`SELECT id FROM account_groups WHERE tenant_id = ${tid} AND channel = ${acc.channel} AND name = ${gname} LIMIT 1`);
          gid = n(g?.id) || n((await q(sql`INSERT INTO account_groups (tenant_id, channel, name) VALUES (${tid}, ${acc.channel}, ${gname}) RETURNING id`))[0]?.id);
        } else if (gid) {
          // 🔴 남의 묶음·다른 채널 묶음에 붙이지 않는다(교차 누수 · CLAUDE §4.6).
          const [g] = await q(sql`SELECT id FROM account_groups WHERE tenant_id = ${tid} AND id = ${gid} AND channel = ${acc.channel}`);
          if (!g) return badRequest("그 묶음을 찾을 수 없어요(채널이 다를 수 있어요).", "group");
        }
        sets.push(sql`group_id = ${gid || null}`);
      }
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
      /* [AC-201 · B2 2026-09-21] 🔴 **«이 계정 주소가 맞아요»** — 러너가 «장부와 다른 블로그»를 보고 멈췄을 때
         고객이 한 번 눌러 주는 자리. 이걸 안 만들면 «한 번 묻기»가 **영원히 묻기**가 된다(§4.8 «고르는 UI 까지가 기능»).
         🔴 러너가 본 것(`identity.observed`/`posted`)을 **그대로** 승인하는 것만 받는다 — 임의 문자열을 받으면
            확인이라는 절차 자체가 무의미해지고, 오타 하나가 남의 블로그를 «승인»해 버린다.
         🔴 `confirmBlogId: null`(또는 "") = **승인 취소** — 되돌릴 길을 같이 둔다(§9-③). 그러면 다음 잡에서 다시 묻는다. */
      if (b.confirmBlogId !== undefined) {
        const [row] = await q(sql`SELECT to_jsonb(a) -> 'identity' AS idn FROM accounts a WHERE tenant_id = ${tid} AND id = ${id} LIMIT 1`);
        const prev = (row?.idn && typeof row.idn === "object" ? row.idn : {}) as Record<string, unknown>;
        const want = b.confirmBlogId === null ? "" : String(b.confirmBlogId).trim();
        if (!want) {
          const cleared = { ...prev }; delete cleared.confirmed; delete cleared.confirmedAt; delete cleared.confirmedBy;
          sets.push(sql`identity = ${jsonb(cleared)}`);
        } else {
          const seen = [String(prev.observed ?? "").trim(), String(prev.posted ?? "").trim()].filter(Boolean);
          if (!seen.includes(want)) {
            return badRequest("확인할 수 있는 주소는 저희가 실제로 본 주소예요. 계정 화면에 보이는 주소로 다시 눌러 주세요.", "confirmBlogId");
          }
          sets.push(sql`identity = COALESCE(identity, '{}'::jsonb) || ${jsonb({ confirmed: want, confirmedAt: new Date().toISOString(), confirmedBy: `user:${auth.user.uid}` })}`);
        }
      }
      if (!sets.length) return badRequest("바꿀 값이 없어요.");
      await q(sql`UPDATE accounts SET ${sql.join(sets, sql`, `)}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${id}`);
      if (mon) { const [chk] = await q(sql`SELECT jsonb_typeof(monetize) AS t FROM accounts WHERE id = ${id}`); if (chk?.t !== "object") console.error("[accounts-update] monetize jsonb_typeof !== object", chk); }
      /* 🔴 PITFALLS #1 — 「쓴 직후 `jsonb_typeof()` 확인까지가 쓰기다」. identity 도 같은 규율을 탄다. */
      if (b.confirmBlogId !== undefined) { const [chk] = await q(sql`SELECT jsonb_typeof(identity) AS t FROM accounts WHERE id = ${id}`); if (chk?.t !== "object") console.error("[accounts-update] identity jsonb_typeof !== object", chk); }
      await writeAudit({ tenantId: tid, action: "account_update", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `account:${id}`, detail: { keys: Object.keys(b).filter((k) => k !== "id" && k !== "monetize"), monetizeKeys: mon ? Object.keys(mon) : [] } });
      return json({ ok: true, account: await getAccount(tid, id) });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) {
    if ((err as { code?: string })?.code === "CREDS_ENC_KEY_MISSING") return json({ ok: false, step: "creds_key", error: "계정 자격 암호화 키가 설정되지 않았어요." }, 500);
    return jsonError("accounts", err);
  }
};
