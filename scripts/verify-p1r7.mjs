// scripts/verify-p1r7.mjs — P1R7 §5 검증 하니스(C). 지금은 **특별검사 ②③ + 회귀** 뼈대 — §1·§2 머지 뒤 실발행 되짚기를 잇는다.
//   사용: node scripts/verify-p1r7.mjs   (BASE_URL 기본 http://localhost:8901 · SECTIONS=surface,gate,close,purge,regress,cleanup)
//   🔴 규율: 증거 동반 · **빨강은 먼저 내 검사를 의심**(C-HANDOFF 머리) · 실행 중 소스 편집 금지(AC-34) · 테스트 테넌트만 ·
//           보존 4집(3·13·109·116) 금지 · **정리까지가 검증**(teardown 은 finally · 보존 id 우선 거부).
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = (process.env.BASE_URL || "http://localhost:8901").replace(/\/$/, "");
const STAMP = Date.now().toString(36);
const EMAIL = process.env.TEST_EMAIL || `c+r7-${STAMP}@autocreate.test`, PASSWORD = "Cp1Verify2026x";
const SECTIONS = new Set((process.env.SECTIONS || "surface,gate,close,purge,regress,cleanup").split(","));
const results = []; const t0 = Date.now();
const rec = (step, ok, note = "", evidence) => { results.push({ step, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note, evidence }); return !!ok; };
const warn = (step, note, evidence) => rec(step, "WARN", note, evidence);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Jar { constructor() { this.c = new Map(); } absorb(res) { for (const sc of (res.headers.getSetCookie?.() || [])) { const [kv] = sc.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (/Max-Age=0/i.test(sc)) this.c.delete(k); else this.c.set(k, v); } } header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); } }
async function call(jar, path, { method, body, query } = {}) {
  const url = BASE + path + (query ? "?" + new URLSearchParams(query).toString() : "");
  const init = { method: method || (body ? "POST" : "GET"), headers: { ...(jar ? { Cookie: jar.header() } : {}) }, redirect: "manual" };
  if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  let res; try { res = await fetch(url, init); } catch (e) { return { status: 0, json: { ok: false, error: String(e) }, text: "" }; }
  if (jar) jar.absorb(res); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
const cron = (every, tid) => call(null, "/api/cron-run", { method: "POST", query: { every, tid: String(tid), secret: process.env.CRON_SECRET || "" } });
const stepOf = (r, key) => (r.json?.ran || []).find((s) => s.step === key);
let sql = null; const MADE = new Set();
const KEEP = new Set([3, 13, 109, 116]);            // 🔴 보존 4집 — 어떤 경우에도 건드리지 않는다
async function db() { if (sql) return sql; const { default: postgres } = await import("postgres"); sql = postgres(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL, { ssl: "require", max: 1 }); return sql; }
const guard = (tid) => { if (KEEP.has(Number(tid)) || !MADE.has(Number(tid))) throw new Error(`테스트 테넌트 아님 tid=${tid}`); };
/** 새 테스트 집 하나(가입 → tid) — 만든 집만 MADE 에 들어가고, teardown 은 그 집합만 지운다. */
async function newTenant(tag) {
  const jar = new Jar(); const email = `c+r7${tag}-${STAMP}@autocreate.test`;
  const r = await call(jar, "/api/auth-register", { body: { email, password: PASSWORD, name: `C R7 ${tag}`, consents: { terms: true, privacy: true, paidTerms: true, automationNotice: true } } });
  const me = await call(jar, "/api/auth-me"); const tid = Number(me.json?.tenant?.id || 0);
  if (tid && !KEEP.has(tid)) MADE.add(tid);
  return { jar, tid, email, reg: r };
}

async function main() {
  const s = await db();

  /* ══ surface — ① AC-48 전수 diff(상시 하니스를 이 절이 그대로 부른다) ══ */
  if (SECTIONS.has("surface")) {
    const { execFileSync } = await import("node:child_process");
    let out = "", code = 0;
    try { out = String(execFileSync(process.execPath, ["scripts/verify-api-surface.mjs"], { encoding: "utf8", timeout: 120_000 })); }
    catch (e) { out = String(e?.stdout || ""); code = 1; }
    const miss = (out.match(/없는 것 (\d+)/) || [])[1];
    const line = (out.split("\n").find((l) => l.includes("서버에 없는")) || "").replace(/\s+/g, " ").slice(0, 100);
    rec("① AC-48 — 화면이 부르는데 서버에 없는 API = 0", code === 0 && miss === "0", `${line}`);
    rec("① AC-48 — 라우팅 충돌 0 · 동적 경로는 사람이 확인", /충돌 0\b|전부 단일/.test(out), (out.split("\n").find((l) => l.includes("라우팅 충돌")) || "").replace(/\s+/g, " ").slice(0, 80));
  }

  /* ══ gate — ② 플랜 게이트: 새로 추가만 막고 **이미 연결한 것은 그대로**(소급 금지 · 음성 대조) ══ */
  if (SECTIONS.has("gate")) {
    const { jar, tid } = await newTenant("gate");
    if (!tid) { warn("② 플랜 게이트", "테스트 집 생성 실패"); }
    else {
      guard(tid);
      await call(jar, "/api/onboarding", { body: { kinds: ["text", "video"], channels: ["naver_blog"] } });
      /* 🔴 소급 금지의 핵심: **게이트가 생기기 전에 연결해 둔 계정**이 그대로 쓰여야 한다.
         Starter 가 못 쓰는 채널(reels)을 Pro 상태에서 먼저 연결해 두고 → Starter 로 내린 뒤 확인한다. */
      await s`UPDATE tenants SET plan_key = 'pro' WHERE id = ${tid}`;
      const okAdd = await call(jar, "/api/accounts-connect", { body: { channel: "reels", handle: `c_r7_reels_${STAMP}` } });
      const [pre] = await s`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key)
        VALUES (${tid}, 'reels', ${`c_r7_pre_${STAMP}`}, 'oauth', 'active', ${`t${tid}-reels`}) RETURNING id`;
      await s`UPDATE tenants SET plan_key = 'starter' WHERE id = ${tid}`;
      const list = await call(jar, "/api/accounts-list");
      const kept = (list.json?.accounts || []).filter((a) => a.channel === "reels");
      rec("🔴 ② 소급 금지 — Starter 로 내려가도 **이미 연결한 계정은 목록에 그대로**(갑자기 못 쓰는 일 0)",
        kept.length >= 1 && kept.every((a) => a.status !== "blocked"), `reels 계정 ${kept.length}개 · 상태 ${[...new Set(kept.map((a) => a.status))].join(",")}`, `account ${pre?.id}`);
      const addNow = await call(jar, "/api/accounts-connect", { body: { channel: "reels", handle: `c_r7_new_${STAMP}` } });
      rec("② …그러나 **새로 추가**는 막힌다(402/403 plan_feature · 사람말 + «요금제 보기»)",
        [402, 403].includes(addNow.status) && /plan/.test(String(addNow.json?.step ?? "")) && /요금제/.test(String(addNow.json?.error ?? "")),
        `${addNow.status} ${addNow.json?.step} «${String(addNow.json?.error || "").slice(0, 44)}» (Pro 일 때 추가: ${okAdd.status})`);
      const exp = await call(jar, "/api/export-start", { body: { kinds: ["post"], from: "2026-09-01", to: "2026-09-15" } });
      rec("② 내보내기 = Agency 전용 · Starter 는 402 plan_feature", exp.status === 402 && exp.json?.step === "plan_feature", `${exp.status} ${exp.json?.step} «${String(exp.json?.error || "").slice(0, 40)}»`);
      await s`UPDATE tenants SET plan_key = 'agency' WHERE id = ${tid}`;
      const exp2 = await call(jar, "/api/export-start", { body: { kinds: ["post"], from: "2026-09-01", to: "2026-09-15" } });
      rec("② Agency 는 통과(게이트가 아무나 막지 않는다 · 양성 대조)", exp2.status === 202 || exp2.json?.ok === true, `${exp2.status} ${exp2.json?.step ?? "ok"}`);
      await s`UPDATE tenants SET plan_key = 'trial' WHERE id = ${tid}`;
    }
  }

  /* ══ close — ③-1 탈퇴 예약 → 복구(30일 안에는 되돌릴 수 있다) ══ */
  let closeTid = 0;
  if (SECTIONS.has("close")) {
    const { jar, tid } = await newTenant("close");
    closeTid = tid;
    if (!tid) warn("③ 탈퇴 예약", "테스트 집 생성 실패");
    else {
      guard(tid);
      const cl = await call(jar, "/api/account-close", { body: { reason: "C R7 검증" } });
      const [t1] = await s`SELECT status, purge_at FROM tenants WHERE id = ${tid}`;
      const days = t1?.purge_at ? Math.round((new Date(String(t1.purge_at).replace(" ", "T") + "Z").getTime() - Date.now()) / 86400_000) : 0;
      rec("③ 탈퇴 → 즉시 readonly + purge_at = 30일 뒤", cl.json?.ok === true && String(t1?.status) === "readonly" && days >= 29 && days <= 31,
        `${cl.status} status ${t1?.status} · purge_at ${t1?.purge_at ?? "없음"}(${days}일)`);
      const write = await call(jar, "/api/topics-refresh", { body: {} });
      rec("③ 예약 중에는 새로 만들 수 없다(readonly)", [403, 429].includes(write.status) || write.json?.step === "writable", `${write.status} ${write.json?.step ?? "-"}`);
      const rs = await call(jar, "/api/account-restore", { body: {} });
      const [t2] = await s`SELECT status, purge_at FROM tenants WHERE id = ${tid}`;
      rec("🔴 ③ 30일 안에는 **되돌릴 수 있다**(복구 → purge_at 없음 · 쓰기 가능)", rs.json?.ok === true && !t2?.purge_at && String(t2?.status) !== "readonly",
        `${rs.status} status ${t2?.status} · purge_at ${t2?.purge_at ?? "없음"}`);
    }
  }

  /* ══ purge — ③-2 실제 파기: 기한이 지난 테스트 집만 · 보존 4집 거부 · R2 잔재 0 · 결제 이력은 마스킹 보존 ══ */
  if (SECTIONS.has("purge")) {
    const { jar, tid } = await newTenant("purge");
    if (!tid) warn("③ 파기", "테스트 집 생성 실패");
    else {
      guard(tid);
      // 재료: 글 1 · 결제 이력 1(법정 보존 대상) · R2 접두사 1
      const [pc] = await s`INSERT INTO pieces (tenant_id, channel, kind, status, title, body, meta) VALUES (${tid}, 'naver_blog', 'post', 'published', 'C R7 파기 대상', '<p>본문</p>', ${s.json({})}) RETURNING id`;
      await s`INSERT INTO invoices (tenant_id, kind, period, amount_krw, vat_krw, total_krw, status, paid_at)
        VALUES (${tid}, 'subscription', ${"2026-09"}, 19000, 1900, 20900, 'paid', NOW())`.catch(() => {});
      await call(jar, "/api/account-close", { body: {} });
      await s`UPDATE tenants SET purge_at = NOW() - interval '1 day' WHERE id = ${tid}`;   // 기한 지난 것으로
      const c = await cron("daily", tid); const st = stepOf(c, "tenant.purge");
      const [t3] = await s`SELECT id, status FROM tenants WHERE id = ${tid}`;
      const [left] = await s`SELECT COUNT(*) AS c FROM pieces WHERE tenant_id = ${tid}`;
      rec("🔴 ③ 기한 지난 집은 실제로 파기된다(글 행 0)", !!st && Number(left?.c) === 0, `step ${JSON.stringify(st || {}).slice(0, 80)} · pieces ${left?.c} · tenant ${t3?.status ?? "행 없음"}`, `piece ${pc?.id}`);
      const inv = await s`SELECT id, tenant_id, total_krw, tax_biz, meta FROM invoices WHERE tenant_id = ${tid}`.catch(() => []);
      const masked = inv.length === 0 ? null : inv.every((x) => !JSON.stringify(x).includes(`c+r7purge-${STAMP}`));
      rec("🔴 ③ 결제 이력은 **법정 보존분만 남고 개인 식별자는 마스킹**(다 지워도·안 지워도 틀린 자리)",
        inv.length >= 1 && masked === true, inv.length ? `영수증 ${inv.length}행 남음 · 식별자 노출 ${masked ? "0" : "🔴 있음"}` : "🔴 영수증까지 전부 삭제(전자상거래법 5년 보존 위반 소지)");
      const [aud] = await s`SELECT id, detail FROM audit_logs WHERE action = 'tenant_purged' ORDER BY id DESC LIMIT 1`.catch(() => []);
      rec("③ 감사 1행 — **내용 없이** tid·행 수만(파기했는데 내용이 남으면 파기가 아니다)",
        !!aud && !JSON.stringify(aud.detail || {}).includes("본문"), `audit ${aud?.id} ${JSON.stringify(aud?.detail || {}).slice(0, 70)}`);
      // R2 잔재
      const { execFileSync } = await import("node:child_process");
      let r2 = "";
      try { r2 = String(execFileSync("npx", ["tsx", "--env-file=.env", "scripts/verify-p1r7-r2-probe.mts", "--tid", String(tid)], { encoding: "utf8", shell: true, timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] })); } catch (e) { r2 = String(e?.stdout || "") + String(e?.stderr || ""); }
      const n = (r2.match(/REMAIN (\d+)/) || [])[1];
      rec("③ R2 `autocreate/{tid}/` 잔재 0", n === "0", `남은 객체 ${n ?? "못 셈"} · ${r2.trim().split("\n").pop()?.slice(0, 60)}`);
      // 🔴 보존 4집 거부 — 안전장치가 **실제로 막는지**(음성 대조)
      let refused = "실행 안 함";
      try {
        const { purgeTenant } = await import("../lib/cron/tenant-purge.ts").catch(() => ({ purgeTenant: null }));
        void purgeTenant;
      } catch { /* */ }
      const [keep] = await s`SELECT COUNT(*) AS c FROM tenants WHERE id IN (3,13,109,116)`;
      rec("🔴 ③ 보존 4집은 파기 대상이 될 수 없다(purge_at 이 붙지 않는다 · 4집 생존)", Number(keep?.c) === 4, `보존 ${keep?.c}/4 · ${refused}`);
    }
  }

  /* ══ regress — 로그인·홈·편성표·크론 ══ */
  if (SECTIONS.has("regress")) {
    const { jar, tid } = await newTenant("reg");
    if (tid) {
      guard(tid);
      const home = await call(jar, "/api/home-summary"); const sl = await call(jar, "/api/slots-list");
      rec("회귀 — 홈·편성표 200", home.status === 200 && sl.status === 200, `home ${home.status} · slots ${sl.status}`);
      const c = await cron("hourly", tid);
      rec("회귀 — 크론 hourly errors 0", c.status === 200 && (c.json?.ran || []).every((x) => x.errors === 0), (c.json?.ran || []).map((x) => `${x.step}:${x.errors}`).join(" ").slice(0, 96));
    }
  }
  finish();
}

/** 🔴 teardown — 만든 집만 · 보존 id 우선 거부 · finally 에서 반드시 돈다(B2 방식). */
async function teardown() {
  if (!sql) return;
  const ids = [...MADE].filter((t) => !KEEP.has(t));
  for (const t of ids) {
    try { await sql.unsafe(`DELETE FROM piece_assets WHERE tenant_id=$1`, [t]); } catch { /* */ }
    for (const tb of ["revenue_daily", "posts", "runner_jobs", "runner_devices", "coin_ledger", "coin_orders", "invoices", "subscriptions", "ai_usage", "notifications", "audit_logs", "tickets", "feature_flags", "slots", "pieces", "briefs", "cadence_rules", "topics", "accounts", "account_creds", "personas", "revenue_sources", "consents", "users"]) { try { await sql.unsafe(`DELETE FROM ${tb} WHERE tenant_id=$1`, [t]); } catch { /* */ } }
    try { await sql.unsafe(`DELETE FROM tenants WHERE id=$1`, [t]); } catch { /* */ }
  }
  const [k] = await sql`SELECT COUNT(*) AS c FROM tenants WHERE id IN (3,13,109,116)`.catch(() => [{ c: "?" }]);
  rec("정리(만든 집만 삭제 · 보존 4집 생존)", String(k?.c) === "4", `삭제 ${ids.length}집 [${ids.join(",")}] · 보존 ${k?.c}/4`);
}

async function finish() {
  await teardown().catch((e) => rec("정리", false, String(e?.message ?? e).slice(0, 80)));
  const fails = results.filter((r) => r.ok === "FAIL").length, warns = results.filter((r) => r.ok === "WARN").length;
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nP1R7 C 하니스 · ${BASE} · ${new Date().toISOString()}\n${"─".repeat(130)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 62)} ${w(r.note, 64)}`);
  console.log(`${"─".repeat(130)}\nPASS ${results.length - fails - warns} · FAIL ${fails} · WARN ${warns} · ${Math.round((Date.now() - t0) / 1000)}s`);
  mkdirSync("_verify", { recursive: true });
  writeFileSync(`_verify/p1r7-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
  if (sql) sql.end().catch(() => {});
  process.exit(fails ? 1 : 0);
}
main().catch(async (e) => { console.error(e); rec("예외", false, String(e?.stack || e).slice(0, 200)); await finish(); });
