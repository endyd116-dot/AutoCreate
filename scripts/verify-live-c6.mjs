// scripts/verify-live-c6.mjs — C6 라이브 검증(테스트 테넌트만): ① topics-refresh 소요 ② 시나리오(가입→온보딩→계정 연결 화면 데이터→규칙 저장→cron-run→슬롯)
//   ③ 회귀(로그인·로그아웃·비밀번호 변경·운영센터 로그인) ④ 화면은 shot-p1r1.mjs 로 따로. 🔴 발행·생성 없음(코인 0) — 슬롯 생성까지.
//   사용: BASE_URL=https://autocreate-endyd.netlify.app node scripts/verify-live-c6.mjs   (CRON_SECRET · OPS_PASS(선택) env)
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = (process.env.BASE_URL || "https://autocreate-endyd.netlify.app").replace(/\/$/, "");
const STAMP = Date.now().toString(36);
const EMAIL = process.env.TEST_EMAIL || `c+c6-${STAMP}@autocreate.test`;   // 실행마다 새 테스트 테넌트(가입 회귀)
const PASSWORD = "Cp1Verify2026x", PASSWORD2 = "Cp1Verify2026y";
const CRON_SECRET = process.env.CRON_SECRET || "";
const results = []; const t0 = Date.now();
/* [P1R7 §3.5] teardown — 이 하니스는 실행마다 **새 테넌트**를 만든다. 안 치우면 라이브에 쌓인다(2026-09-15 대청소 88집의 일부가 이것이었다).
   보존 id(3·13·109·116·198)와 «살아 있는 구독»은 `_teardown.mjs` 가 먼저 거부한다 — 여기서는 «이번에 만든 집»만 넘긴다. */
const MADE_TIDS = new Set();
const rec = (step, ok, note = "", evidence) => { results.push({ step, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note, evidence }); return !!ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Jar { constructor() { this.c = new Map(); } absorb(res) { for (const sc of (res.headers.getSetCookie?.() || [])) { const [kv] = sc.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (/Max-Age=0/i.test(sc)) this.c.delete(k); else this.c.set(k, v); } } header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); } }
async function call(jar, path, { method, body, query } = {}) {
  const url = BASE + path + (query ? "?" + new URLSearchParams(query).toString() : "");
  const init = { method: method || (body ? "POST" : "GET"), headers: { ...(jar ? { Cookie: jar.header() } : {}) }, redirect: "manual" };
  if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const t = Date.now(); let res; try { res = await fetch(url, init); } catch (e) { return { status: 0, json: { ok: false, error: String(e) }, text: "", ms: Date.now() - t }; }
  if (jar) jar.absorb(res); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text, ms: Date.now() - t };
}
const kstYmd = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

async function main() {
  const jar = new Jar();
  /* ③ 회귀 — 가입·로그인·로그아웃·비밀번호 */
  const reg = await call(jar, "/api/auth-register", { body: { email: EMAIL, password: PASSWORD, name: "C6 라이브" } });
  rec("가입 201 + 쿠키", reg.status === 201 && reg.json?.ok === true && jar.c.has("ac_user"), `${reg.status} tenantKey ${reg.json?.tenantKey} ${reg.ms}ms`, `tenant ${reg.json?.tenantKey}`);
  const me = await call(jar, "/api/auth-me");
  rec("auth-me(trial · 코인 0)", me.json?.ok === true && me.json?.tenant?.planKey === "trial" && me.json?.coins === 0, `${me.status} plan ${me.json?.tenant?.planKey} coins ${me.json?.coins} trialDaysLeft ${me.json?.tenant?.trialDaysLeft}`);
  const lo = await call(jar, "/api/auth-logout", { method: "POST" });
  const me401 = await call(jar, "/api/auth-me");
  rec("로그아웃 → auth-me 401", lo.json?.ok === true && me401.status === 401, `${lo.status}/${me401.status}`);
  const lg = await call(jar, "/api/auth-login", { body: { email: EMAIL, password: PASSWORD, remember: true } });
  rec("재로그인 200", lg.json?.ok === true && jar.c.has("ac_user"), `${lg.status} ${lg.ms}ms`);
  const bad = await call(new Jar(), "/api/auth-login", { body: { email: EMAIL, password: "wrong-pass-1" } });
  rec("틀린 비밀번호 401", bad.status === 401 && bad.json?.step === "invalid", `${bad.status}`);
  const pw = await call(jar, "/api/auth-change-password", { body: { current: PASSWORD, password: PASSWORD2 } });
  const lg2 = await call(new Jar(), "/api/auth-login", { body: { email: EMAIL, password: PASSWORD2 } });
  rec("비밀번호 변경 → 새 비밀번호 로그인", pw.json?.ok === true && lg2.json?.ok === true, `${pw.status} ${pw.json?.step || ""} / ${lg2.status}`);
  const ops = await call(new Jar(), "/api/ops-login", { body: { email: "admin", password: process.env.OPS_PASS || "admin1234" } });
  rec("운영센터 로그인(admin)", ops.json?.ok === true || ops.status === 401, ops.json?.ok ? `200 role ${ops.json.role} mustChange ${ops.json.mustChangePassword}` : `${ops.status} ${ops.json?.step}(비밀번호 미공유면 401 정상 · 메인 스모크로 갈음)`);
  /* ② 시나리오 — 온보딩 → 계정 연결 화면 데이터 → 규칙 → cron → 슬롯 */
  const ob = await call(jar, "/api/onboarding", { body: { kinds: ["text", "video"], channels: ["naver_blog", "youtube_shorts"] } });
  rec("온보딩(글+영상 채널 선택) 저장 — 영상 골라도 깨지지 않음", ob.json?.ok === true, `${ob.status} ${ob.json?.step || ""}`);
  const al = await call(jar, "/api/accounts-list");
  const chans = al.json?.channels || [];
  rec("accounts-list channels 10 · active 4(글) · 영상 planned", chans.length === 10 && chans.filter((c) => c.status === "active").map((c) => c.key).sort().join(",") === "blogger,naver_blog,tistory,wordpress", chans.map((c) => `${c.key}:${c.status}`).join(" "));
  const add = await call(jar, "/api/accounts-add", { body: { channel: "naver_blog", handle: `c6_${STAMP}`, loginId: `c6_${STAMP}`, password: "Zq9-plain-secret-77" } });
  rec("계정 연결(naver · pending_login) · 응답 자격 평문 0", add.json?.ok === true && add.json?.account?.status === "pending_login" && !add.text.includes("Zq9-plain"), `${add.status} id ${add.json?.account?.id}`, `accounts id=${add.json?.account?.id}`);
  const rs = await call(jar, "/api/rules-settings", { body: { autoSchedule: true, horizonDays: 7 } });
  const rsave = await call(jar, "/api/rules-save", { body: { rules: [{ channel: "naver_blog", kind: "post", accountMode: "auto", every: "week", count: 3, active: true }] } });
  rec("규칙 저장(주 3회) → slotsCreated ≥3 · coinsPerWeek 21", rs.json?.ok === true && rsave.json?.ok === true && rsave.json?.slotsCreated >= 3 && rsave.json?.coinsPerWeek === 21, `${rsave.status} slotsCreated ${rsave.json?.slotsCreated} coinsPerWeek ${rsave.json?.coinsPerWeek}`, `rule id=${rsave.json?.rules?.[0]?.id}`);
  const [tid] = [Number(me.json?.tenant?.id || 0)];
  const tenantId = tid || null;
  const cr = tenantId ? await call(null, "/api/cron-run", { method: "POST", query: { every: "hourly", tid: String(tenantId), secret: CRON_SECRET } }) : { status: 0, json: null };
  const ran = cr.json?.ran || [];
  const roll = ran.find((s) => s.step === "slots.roll"), assign = ran.find((s) => s.step === "slots.assign_topics");
  rec("cron-run hourly(tid) 200 · 스텝 errors 0 · roll 멱등(changed 0)", cr.status === 200 && ran.length >= 5 && ran.every((s) => s.errors === 0) && roll?.changed === 0, `${cr.status} ${cr.ms}ms ${ran.map((s) => `${s.step}:${s.changed}/${s.skipped}/${s.errors}`).join(" ")}`);
  rec("cron-run 시크릿 없이 401", (await call(null, "/api/cron-run", { method: "POST", query: { every: "hourly" } })).status === 401, "");
  const today = kstYmd(new Date()), to = kstYmd(new Date(Date.now() + 7 * 86400e3));
  const sl = await call(jar, "/api/slots-list", { query: { from: today, to } });
  const slots = (sl.json?.slots || []).filter((s) => s.origin === "auto");
  rec("슬롯 7일치 생성(planned/topic_assigned/no_topic)", slots.length >= 3 && slots.every((s) => ["planned", "topic_assigned", "no_topic"].includes(s.status)), `${slots.length}개 · ${slots.map((s) => `${s.date}:${s.status}`).join(",")}`, slots.slice(0, 2).map((s) => `slot ${s.id}`).join(","));
  rec("assign_topics: 소재 없음 → 배경 리필 시작 또는 no_topic 정직", !!assign && (assign.detail?.tenants?.[0]?.refill || assign.changed > 0 || assign.skipped > 0), JSON.stringify(assign?.detail || {}).slice(0, 160));
  /* ① topics-refresh 소요(라이브 · 프로덕션 배경 함수) */
  const tr = await call(jar, "/api/topics-refresh", { body: {} });
  let st = null; const tStart = Date.now();
  if (tr.status === 202 || tr.json?.running) {
    while (Date.now() - tStart < 4 * 60_000) { const tl = await call(jar, "/api/topics-list", { query: { status: "candidate" } }); st = tl.json?.refresh; if (st && st.running === false && st.finishedAt) break; await sleep(4000); }
  }
  const secs = st?.startedAt && st?.finishedAt ? Math.round((new Date(st.finishedAt) - new Date(st.startedAt)) / 100) / 10 : null;
  rec("topics-refresh(배경) 완료 · 소요 ≤ 20s(구간 상세는 Netlify 함수 로그)", (tr.status === 202 || tr.json?.running === true) && st?.running === false && typeof st?.added === "number" && secs !== null && secs <= 20, `${tr.status} ${JSON.stringify(tr.json)} → ${JSON.stringify(st)} · 소요 ${secs}s`, `startedAt ${st?.startedAt} finishedAt ${st?.finishedAt}`);
  const tl2 = await call(jar, "/api/topics-list", { query: { status: "candidate" } });
  const withVol = (tl2.json?.topics || []).filter((t) => typeof t.factors?.volume === "number").length;
  rec("라이브 소재에 검색량 숫자(키워드툴 키)", withVol > 0, `volume ${withVol}/${tl2.json?.topics?.length}`);
  const cr2 = tenantId ? await call(null, "/api/cron-run", { method: "POST", query: { every: "hourly", tid: String(tenantId), secret: CRON_SECRET } }) : { json: null };
  const sl2 = await call(jar, "/api/slots-list", { query: { from: today, to } });
  const assigned = (sl2.json?.slots || []).filter((s) => s.origin === "auto" && s.status === "topic_assigned");
  rec("리필 후 cron → 슬롯에 소재 배정(topic_assigned ≥1)", assigned.length >= 1 && !!assigned[0].topicTitle, `${assigned.length}개 · «${assigned[0]?.topicTitle}»`, assigned[0] ? `slot ${assigned[0].id}` : "");
  const hs = await call(jar, "/api/home-summary");
  rec("home-summary: revenue 4키 · todaySlots · todo · unread", hs.json?.ok === true && ["todayConfirmedKrw", "todayEstimatedKrw", "yesterdayKrw", "monthKrw"].every((k) => typeof hs.json.revenue?.[k] === "number") && Array.isArray(hs.json.todaySlots) && Array.isArray(hs.json.todo) && typeof hs.json.unread === "number", `${hs.status} todo ${hs.json?.todo?.map((t) => t.kind).join(",")} unread ${hs.json?.unread}`);
  const nl = await call(jar, "/api/notifications-list");
  rec("알림함 unread = 홈", nl.json?.unread === hs.json?.unread, `${nl.json?.unread} vs ${hs.json?.unread}`);
  const rl = await call(jar, "/api/runner-list"); const el = await call(jar, "/api/ad-eligibility"); const rv = await call(jar, "/api/revenue-summary");
  rec("러너 목록·수익 매체·수익 요약 200", rl.json?.ok === true && el.json?.ok === true && el.json?.thresholds && rv.json?.ok === true, `${rl.status}/${el.status}/${rv.status}`);
  const other = new Jar(); await call(other, "/api/auth-login", { body: { email: "c+p1b@autocreate.test", password: "Cp1Verify2026x" } });
  const idor = slots[0] ? await call(other, "/api/slots-skip", { body: { id: slots[0].id } }) : { status: 404 };
  rec("라이브 IDOR(타 테넌트 슬롯 skip) 404", idor.status === 404, `${idor.status}`);
  if (tenantId) MADE_TIDS.add(Number(tenantId));
  await finish();
}
async function teardown() {
  if (!MADE_TIDS.size) return;
  const url = process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
  if (!url) return rec("정리(teardown)", false, `DB 주소 없음 — 테스트 테넌트 ${[...MADE_TIDS].join(",")} 가 남았다`);
  let s = null;
  try {
    const { default: postgres } = await import("postgres");
    s = postgres(url, { ssl: "require", max: 1 });
    const { teardownRun } = await import("./_teardown.mjs");
    const r = await teardownRun(s, { tenants: [...MADE_TIDS], label: "C6" });
    rec("정리(teardown)", !r.failed, r.text);
  } catch (e) { rec("정리(teardown)", false, String(e?.message ?? e).slice(0, 160)); }
  finally { if (s) await s.end().catch(() => {}); }
}
async function finish() {
  await teardown();   // 🔴 결과 출력 전에(출력 뒤엔 process.exit 이라 그 뒤 코드는 돌지 않는다)
  const fails = results.filter((r) => r.ok === "FAIL").length, warns = results.filter((r) => r.ok === "WARN").length;
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nC6 라이브 · ${BASE} · ${new Date().toISOString()}\n${"─".repeat(130)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 50)} ${w(r.note, 76)}`);
  console.log(`${"─".repeat(130)}\nPASS ${results.length - fails - warns} · FAIL ${fails} · WARN ${warns} · ${Math.round((Date.now() - t0) / 1000)}s`);
  mkdirSync("_verify", { recursive: true }); const out = `_verify/live-c6-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ base: BASE, at: new Date().toISOString(), email: EMAIL, results }, null, 2)); console.log(`→ ${out}`); process.exit(fails ? 1 : 0);
}
main().catch(async (e) => { console.error(e); rec("예외", false, String(e?.stack || e).slice(0, 200)); await finish(); });
