// scripts/verify-live-c6r4.mjs — C6-R4 라이브 검증(짧게): ① 체험 D-3 알림 크론 멱등 ② operator 요금제 403+감사 ③ 원격접속(배너·결제 403·종료 알림) ④ 채널 토글 즉시 반영·복구 ⑥ 정리
//   BASE_URL=https://autocreate-endyd.netlify.app node scripts/verify-live-c6r4.mjs   (OPS_PASS · CRON_SECRET)
//   🔴 임시 super_admin 금지 — operator 1명만 만들고 끝에 삭제 · admin 세션은 조회 + 운영자 초대/채널 토글(복구)만.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = (process.env.BASE_URL || "https://autocreate-endyd.netlify.app").replace(/\/$/, "");
const STAMP = Date.now().toString(36); const EMAIL = `c+c6r4-${STAMP}@autocreate.test`, PASSWORD = "Cp1Verify2026x";
const CRON_SECRET = process.env.CRON_SECRET || ""; const OPS_USER = process.env.OPS_USER || "admin", OPS_PASS = process.env.OPS_PASS || "admin1234";
const results = []; const rec = (step, ok, note = "", evidence) => { results.push({ step, ok: ok ? "PASS" : "FAIL", note, evidence }); return !!ok; };
class Jar { constructor() { this.c = new Map(); } absorb(res) { for (const sc of (res.headers.getSetCookie?.() || [])) { const [kv] = sc.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (/Max-Age=0/i.test(sc)) this.c.delete(k); else this.c.set(k, v); } } header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); } }
async function call(jar, path, { method, body, query } = {}) {
  const url = BASE + path + (query ? "?" + new URLSearchParams(query).toString() : "");
  const init = { method: method || (body ? "POST" : "GET"), headers: { ...(jar ? { Cookie: jar.header() } : {}) }, redirect: "manual" };
  if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  let res; try { res = await fetch(url, init); } catch (e) { return { status: 0, json: null, text: String(e) }; }
  if (jar) jar.absorb(res); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
const cron = (every, tid) => call(null, "/api/cron-run", { method: "POST", query: { every, tid: String(tid), secret: CRON_SECRET } });
const { default: postgres } = await import("postgres");
const s = postgres(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL, { ssl: "require", max: 1 });
const kstHH = () => String(new Date(Date.now() + 9 * 3600e3).getUTCHours()).padStart(2, "0");
let opId = 0, TID = 0;
try {
  const jar = new Jar();
  const reg = await call(jar, "/api/auth-register", { body: { email: EMAIL, password: PASSWORD, name: "C6R4", consents: { terms: true, privacy: true, paidTerms: true, automationNotice: true } } });
  const me = await call(jar, "/api/auth-me"); TID = Number(me.json?.tenant?.id || 0);
  rec("라이브 가입(consents 4) → trial", reg.status === 201 && me.json?.tenant?.planKey === "trial" && TID > 0, `${reg.status} tid ${TID}`, `tenant ${TID}`);
  /* ① 체험 D-3 알림 · 멱등 */
  await s`UPDATE tenants SET settings = settings || ${s.json({ trialNoticeHour: `${kstHH()}:00` })}, trial_ends_at = ((NOW() AT TIME ZONE 'Asia/Seoul')::date + 3 + interval '23 hours') AT TIME ZONE 'Asia/Seoul' AT TIME ZONE 'UTC' WHERE id = ${TID}`;
  const c1 = await cron("hourly", TID); await cron("hourly", TID);
  const [nd3] = await s`SELECT COUNT(*) AS c, MIN(id) AS id FROM notifications WHERE tenant_id = ${TID} AND kind = 'trial_d3'`;
  const stepTe = (c1.json?.ran || []).find((x) => x.step === "trial.expire");
  rec("① 라이브 cron trial.expire → trial_d3 알림 1건(2회 멱등)", c1.status === 200 && Number(nd3?.c) === 1, `${c1.status} ${JSON.stringify(stepTe || {}).slice(0, 100)} · 알림 ${nd3?.c}`, `notifications id=${nd3?.id}`);
  await s`UPDATE tenants SET settings = settings - 'trialNoticeHour', trial_ends_at = NOW() + interval '14 days' WHERE id = ${TID}`;
  /* ② operator → 요금제 403 + ops_forbidden 감사 */
  const oj = new Jar(); const lg = await call(oj, "/api/ops-login", { body: { email: OPS_USER, password: OPS_PASS } });
  rec("admin ops-login(조회용)", lg.json?.ok === true, `${lg.status} role ${lg.json?.role}`);
  const op = await call(oj, "/api/ops-operators", { body: { email: `c-live-op-${STAMP}@ops.local`, name: "C 라이브 운영자", role: "operator" } }); opId = op.json?.operator?.id || 0;
  const { default: bcrypt } = await import("bcryptjs");
  if (opId) await s`UPDATE operators SET password_hash = ${await bcrypt.hash("Cr4LiveOp2026x", 10)}, must_change_password = false WHERE id = ${opId}`;
  const ojo = new Jar(); const lo = await call(ojo, "/api/ops-login", { body: { email: `c-live-op-${STAMP}@ops.local`, password: "Cr4LiveOp2026x" } });
  const pl = await call(ojo, "/api/ops-plans"); const dash = await call(ojo, "/api/ops-dashboard"); const cs = await call(ojo, "/api/ops-tickets");
  const [fa] = await s`SELECT id FROM audit_logs WHERE action = 'ops_forbidden' AND actor_id = ${opId} ORDER BY id DESC LIMIT 1`;
  rec("② operator: 요금제 403 + ops_forbidden 감사 · 대시보드/CS 200", lo.json?.ok === true && pl.status === 403 && !!fa && dash.status === 200 && cs.status === 200, `login ${lo.status} · plans ${pl.status} · audit ${fa?.id} · dash ${dash.status} cs ${cs.status}`, `audit_logs id=${fa?.id}`);
  /* ③ 원격접속 */
  const imp = await call(ojo, "/api/ops-impersonate", { body: { id: TID } });
  const ij = new Jar(); ij.c.set("ac_user", ojo.c.get("ac_user") || "");
  const meI = await call(ij, "/api/auth-me"); const pay = await call(ij, "/api/coin-purchase-start", { body: { packId: "pack_trial", agreePaidTerms: true } });
  const end = await call(ojo, "/api/ops-impersonate-end", { method: "POST" });
  const [endN] = await s`SELECT id, title FROM notifications WHERE tenant_id = ${TID} AND (title LIKE '%운영자%' OR body LIKE '%운영자%') ORDER BY id DESC LIMIT 1`;
  rec("③ 원격접속 시작 → auth-me impersonation → 결제 403 → 종료 고객 알림", imp.json?.ok === true && !!meI.json?.impersonation && pay.status === 403 && pay.json?.step === "impersonation" && end.json?.ok === true && !!endN, `imp ${imp.status} · me imp ${!!meI.json?.impersonation} · pay ${pay.status} ${pay.json?.step} · end ${end.status} · 알림 ${endN?.id} «${endN?.title}»`, `notifications id=${endN?.id}`);
  /* ④ 채널 토글 → 고객 그리드 즉시 → 복구 */
  const before = (await call(oj, "/api/ops-channels")).json?.channels?.find((c) => c.key === "threads");
  const t1 = await call(oj, "/api/ops-channels", { body: { key: "threads", status: "active" } });
  const g1 = (await call(jar, "/api/accounts-list")).json?.channels?.find((c) => c.key === "threads");
  const t2 = await call(oj, "/api/ops-channels", { body: { key: "threads", status: before?.status || "planned" } });
  const g2 = (await call(jar, "/api/accounts-list")).json?.channels?.find((c) => c.key === "threads");
  rec("④ 채널 threads planned→active → 고객 즉시 active → 복구", t1.json?.ok === true && g1?.status === "active" && t2.json?.ok === true && g2?.status === (before?.status || "planned"), `${before?.status} → ${g1?.status} → ${g2?.status}`);
} catch (e) { rec("예외", false, String(e?.stack || e).slice(0, 200)); }
finally {
  /* ⑥ 정리 */
  try {
    if (TID) for (const t of ["tickets", "invoices", "coin_orders", "coin_ledger", "runner_jobs", "notifications", "audit_logs"]) { try { await s.unsafe(`DELETE FROM ${t} WHERE tenant_id = $1`, [TID]); } catch { /* */ } }
    if (opId) await s`DELETE FROM operators WHERE id = ${opId} AND email LIKE 'c-live-op-%'`;
    rec("⑥ 정리(테스트 테넌트 돈·CS·알림·감사 행 · 임시 operator 삭제)", true, `tenant ${TID} operator ${opId}`);
  } catch (e) { rec("정리", false, String(e.message)); }
  await s.end();
  const fails = results.filter((r) => r.ok === "FAIL").length;
  console.log(`\nC6-R4 라이브 · ${BASE}\n${"─".repeat(120)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : "✗"} ${r.step.padEnd(52)} ${String(r.note).slice(0, 90)}`);
  console.log(`${"─".repeat(120)}\nPASS ${results.length - fails} · FAIL ${fails}`);
  mkdirSync("_verify", { recursive: true }); const out = `_verify/live-c6r4-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ base: BASE, email: EMAIL, results }, null, 2)); console.log(`→ ${out}`);
  process.exit(fails ? 1 : 0);
}
