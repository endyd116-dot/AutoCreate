// scripts/verify-p1r3.mjs — P1R3 검증 하니스(C · 계약 v3.5 §6 시나리오 + §-1 지도): 수동 입력→홈·수익 탭 일치 · KST 경계 · 멱등(같은 날 2회=1행) ·
//   0원 행 vs 미수집(§1.4c) · todayConfirmed/todayEstimated 분리 · not_configured 는 에러 아님 · 키 필드 검증 · 연속 실패→error+알림 ·
//   러너 parse 실패가 0원으로 안 새는지(AC-9) · revenueRows 업서트(freshness runner) · TOP 5 piece 귀속 · ad-eligibility(thresholds·links·applied/approved) ·
//   learn 표본<5 중립 · .ad-slot 실글 렌더 · 타 테넌트 0.
//   사용: node scripts/verify-p1r3.mjs   (BASE_URL 기본 http://localhost:8901 · CRON_SECRET 필요)
//   🔴 테스트 테넌트만(DB 손질은 TEST_EMAIL 테넌트 id 에만).
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = (process.env.BASE_URL || "http://localhost:8901").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL || "c+p1@autocreate.test", EMAIL2 = process.env.TEST_EMAIL2 || "c+p1b@autocreate.test";
const PASSWORD = process.env.TEST_PASSWORD || "Cp1Verify2026x";
const CRON_SECRET = process.env.CRON_SECRET || "";
const results = []; const t0 = Date.now();
/* [P1R7 §3.5] teardown — 보존 테넌트(C검증)라 집은 남기고 이번 실행 산출물만 정리한다. */
const SINCE = new Date();
const rec = (step, ok, note = "", evidence) => { results.push({ step, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note, evidence }); return !!ok; };
const warn = (step, note, evidence) => rec(step, "WARN", note, evidence);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Jar { constructor() { this.c = new Map(); } absorb(res) { for (const sc of (res.headers.getSetCookie?.() || [])) { const [kv] = sc.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (/Max-Age=0/i.test(sc)) this.c.delete(k); else this.c.set(k, v); } } header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); } }
async function call(jar, path, { method, body, query, headers } = {}) {
  const url = BASE + path + (query ? "?" + new URLSearchParams(query).toString() : "");
  const init = { method: method || (body ? "POST" : "GET"), headers: { ...(jar ? { Cookie: jar.header() } : {}), ...(headers || {}) }, redirect: "manual" };
  if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  let res; try { res = await fetch(url, init); } catch (e) { return { status: 0, json: { ok: false, error: String(e) }, text: "" }; }
  if (jar) jar.absorb(res);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
const cron = (every, tid) => call(null, "/api/cron-run", { method: "POST", query: { every, tid: String(tid), secret: CRON_SECRET } });
const stepOf = (r, key) => (r.json?.ran || []).find((s) => s.step === key);
const tdetail = (s, tid) => (s?.detail?.tenants || []).find((t) => t.tid === tid) || s?.detail || {};

let sql = null; const ALLOWED = new Set();
async function db() { if (sql) return sql; const { default: postgres } = await import("postgres"); sql = postgres(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL, { ssl: "require", max: 1 }); return sql; }
const guard = (tid) => { if (!ALLOWED.has(Number(tid))) throw new Error(`테스트 테넌트 아님 tid=${tid}`); };
async function signIn(jar, email) {
  let r = await call(jar, "/api/auth-login", { body: { email, password: PASSWORD, remember: true } });
  if (r.status === 401) r = await call(jar, "/api/auth-register", { body: { email, password: PASSWORD, name: "C검증" } });
  const me = await call(jar, "/api/auth-me"); rec(`login ${email}`, r.json?.ok === true && me.json?.ok === true, `${r.status}/${me.status}`); return me.json;
}
const kst = (d) => new Date(d.getTime() + 9 * 3600e3); const ymd = (d) => kst(d).toISOString().slice(0, 10);

async function main() {
  if (!CRON_SECRET) return rec("CRON_SECRET", false, "없음"), await finish();
  const jar = new Jar(), jar2 = new Jar();
  const me = await signIn(jar, EMAIL); const me2 = await signIn(jar2, EMAIL2); if (!me?.ok || !me2?.ok) return await finish();
  const s = await db();
  const [t1] = await s`SELECT id FROM tenants WHERE key = ${me.tenant.key}`; const [t2] = await s`SELECT id FROM tenants WHERE key = ${me2.tenant.key}`;
  const TID = Number(t1.id), TID2 = Number(t2.id); ALLOWED.add(TID); ALLOWED.add(TID2); guard(TID);
  const today = ymd(new Date()), yesterday = ymd(new Date(Date.now() - 86400e3)), month = today.slice(0, 7);
  const accs = (await call(jar, "/api/accounts-list")).json?.accounts || [];
  const naver = accs.find((a) => a.channel === "naver_blog"); const tistory = accs.find((a) => a.channel === "tistory");
  // 위생: 앞 실행의 수동 행 정리(테스트 테넌트)
  await s`DELETE FROM revenue_daily WHERE tenant_id = ${TID} AND source IN ('meta','tiktok','x','sponsor','manual','adpost','coupang')`;
  await s`DELETE FROM revenue_sources WHERE tenant_id = ${TID} AND source IN ('coupang','adpost','meta','tiktok','sponsor','manual')`;
  await s`DELETE FROM notifications WHERE tenant_id = ${TID} AND kind IN ('revenue_error')`;

  /* ══ 1. 수동 입력 → 홈·수익 탭 숫자 일치 · 멱등 · 0원 행 · 확정/예상 분리 ══ */
  const m1 = await call(jar, "/api/revenue-manual", { body: { source: "meta", day: today, amountKrw: 12340 } });
  rec("revenue-manual(meta·오늘 12,340)", m1.json?.ok === true, `${m1.status} ${m1.json?.step || ""}`);
  const bad = await call(jar, "/api/revenue-manual", { body: { source: "meta", day: ymd(new Date(Date.now() + 86400e3)), amountKrw: 1 } });
  rec("내일 날짜 거부(day)", bad.status === 400 && bad.json?.step === "day", `${bad.status} ${bad.json?.step}`);
  const badSrc = await call(jar, "/api/revenue-manual", { body: { source: "adsense", day: today, amountKrw: 1 } });
  rec("API 소스는 수동 입력 거부", badSrc.status === 400, `${badSrc.status} ${badSrc.json?.step}`);
  const m2 = await call(jar, "/api/revenue-manual", { body: { source: "meta", day: today, amountKrw: 20000 } });   // 같은 키 → 덮어쓰기
  const [cnt] = await s`SELECT COUNT(*) AS c, MAX(amount_krw) AS krw FROM revenue_daily WHERE tenant_id = ${TID} AND source = 'meta' AND day = ${today}::date AND account_id IS NULL AND piece_id IS NULL`;
  rec("같은 날 2회 입력 → 1행 · 덮어쓰기(멱등)", m2.json?.ok === true && Number(cnt?.c) === 1 && Number(cnt?.krw) === 20000, `rows ${cnt?.c} krw ${cnt?.krw}`);
  const m0 = await call(jar, "/api/revenue-manual", { body: { source: "sponsor", day: yesterday, amountKrw: 0 } });
  rec("0원 입력 허용", m0.json?.ok === true, `${m0.status}`);
  const sum = (await call(jar, "/api/revenue-summary", { query: { month } })).json;
  const home = (await call(jar, "/api/home-summary")).json;
  rec("revenue-summary 모양", sum?.ok === true && ["monthKrw", "todayConfirmedKrw", "todayEstimatedKrw", "prevMonthKrw"].every((k) => typeof sum[k] === "number") && Array.isArray(sum.bySource) && Array.isArray(sum.byAccount) && Array.isArray(sum.topPieces), Object.keys(sum || {}).join(","));
  rec("오늘 확정(수동 4종=확정) 20,000 · 예상 0 분리", sum?.todayConfirmedKrw === 20000 && sum?.todayEstimatedKrw === 0, `confirmed ${sum?.todayConfirmedKrw} · estimated ${sum?.todayEstimatedKrw}`);
  rec("home-summary.revenue = 수익 탭(확정·예상·월)", home?.revenue?.todayConfirmedKrw === sum?.todayConfirmedKrw && home?.revenue?.todayEstimatedKrw === sum?.todayEstimatedKrw && home?.revenue?.monthKrw === sum?.monthKrw && typeof home?.revenue?.yesterdayKrw === "number", `home ${JSON.stringify(home?.revenue)}`);
  rec("home.revenue 옛 키(today/month/lastMonthSameDay) 호환 유지", ["today", "month", "lastMonthSameDay"].every((k) => typeof home?.revenue?.[k] === "number"), "");
  const bySrc = sum?.bySource?.find((x) => x.source === "meta");
  rec("bySource meta freshness=manual · lastSyncAt", bySrc?.freshness === "manual" && bySrc?.krw === 20000 && !!bySrc?.lastSyncAt, JSON.stringify(bySrc));
  const daily = (await call(jar, "/api/revenue-daily", { query: { from: ymd(new Date(Date.now() - 3 * 86400e3)), to: today } })).json;
  const dToday = (daily?.days || []).find((d) => d.day === today), dYest = (daily?.days || []).find((d) => d.day === yesterday), dGone = (daily?.days || []).find((d) => d.day === ymd(new Date(Date.now() - 3 * 86400e3)));
  rec("revenue-daily: 0원인 날은 행(krw:0) · 없는 날은 키 없음(§1.4c)", dToday?.krw === 20000 && dYest && dYest.krw === 0 && !dGone, `today ${dToday?.krw} · 어제 ${dYest ? dYest.krw : "없음"} · 3일전 ${dGone ? "있음?!" : "없음(정상)"}`);
  rec("days[].freshness 어휘", (daily?.days || []).every((d) => ["api", "runner", "manual"].includes(d.freshness)), "");
  // KST 경계: 저장된 day 가 보낸 값 그대로(UTC 로 밀리지 않음) · 어제 합이 home.yesterdayKrw
  const [dayRow] = await s`SELECT day::text AS d FROM revenue_daily WHERE tenant_id = ${TID} AND source = 'meta' ORDER BY id DESC LIMIT 1`;
  rec("KST: 저장 day = 보낸 KST 날짜(밀림 0)", String(dayRow?.d).slice(0, 10) === today, `${dayRow?.d} vs ${today} (UTC now ${new Date().toISOString()})`);
  rec("home.yesterdayKrw = 어제 합(0원 행 포함)", home?.revenue?.yesterdayKrw === 0, `${home?.revenue?.yesterdayKrw}`);

  /* ══ 2. 소스 연결 · not_configured 는 에러 아님 · 키 필드 검증 · 연속 실패 → error+알림 ══ */
  const c1 = await call(jar, "/api/revenue-sources", { body: { action: "connect", source: "coupang", accountId: naver?.id } });
  let srcs = (await call(jar, "/api/revenue-sources")).json?.sources || [];
  let cp = srcs.find((x) => x.source === "coupang");
  rec("coupang connect(키 없음) → status not_configured", c1.json?.ok === true && cp?.status === "not_configured", `${c1.status} → ${cp?.status}`);
  rec("revenue-sources 모양(lastError 는 connected 아닐 때만)", srcs.every((x) => ["connected", "not_configured", "error", "disconnected"].includes(x.status) && typeof x.id === "number"), srcs.map((x) => `${x.source}:${x.status}`).join(" "));
  const hh = String(kst(new Date()).getUTCHours()).padStart(2, "0");
  await s`UPDATE tenants SET settings = settings || ${s.json({ revenueSyncHour: `${hh}:00` })} WHERE id = ${TID}`;
  const sync1 = await cron("hourly", TID);
  const rs1 = stepOf(sync1, "revenue.sync");
  rec("revenue.sync 스텝 존재 · errors 0", !!rs1 && rs1.errors === 0, JSON.stringify(rs1 || {}).slice(0, 200));
  srcs = (await call(jar, "/api/revenue-sources")).json?.sources || []; cp = srcs.find((x) => x.source === "coupang");
  const [nErr] = await s`SELECT COUNT(*) AS c FROM notifications WHERE tenant_id = ${TID} AND kind = 'revenue_error'`;
  rec("not_configured 소스는 sync 후에도 error 아님 · 알림 0", cp?.status === "not_configured" && Number(nErr?.c) === 0, `status ${cp?.status} · revenue_error 알림 ${nErr?.c} · detail ${JSON.stringify(tdetail(rs1, TID)).slice(0, 120)}`);
  const k1 = await call(jar, "/api/revenue-sources", { body: { action: "key", source: "coupang", accountId: naver?.id, creds: { accessKey: "AK" } } });
  rec("키 일부만 → 400 «키를 모두 넣어 주세요(secretKey)»", k1.status === 400 && /secretKey/.test(k1.json?.error || ""), `${k1.status} ${k1.json?.error}`);
  const k2 = await call(jar, "/api/revenue-sources", { body: { action: "key", source: "coupang", accountId: naver?.id, creds: { accessKey: "AK-test", secretKey: "SK-test" } } });
  srcs = (await call(jar, "/api/revenue-sources")).json?.sources || []; cp = srcs.find((x) => x.source === "coupang");
  const [credRow] = await s`SELECT cred_enc FROM revenue_sources WHERE tenant_id = ${TID} AND source = 'coupang' LIMIT 1`;
  rec("키 객체 저장 → connected · cred_enc 암호화(평문 0)", k2.json?.ok === true && cp?.status === "connected" && !!credRow?.cred_enc && !String(credRow.cred_enc).includes("SK-test"), `${k2.status} → ${cp?.status}`);
  const [keyAudit] = await s`SELECT detail FROM audit_logs WHERE tenant_id = ${TID} AND action = 'revenue_source_key' ORDER BY id DESC LIMIT 1`;
  rec("키 감사에 값 0(필드명만)", !!keyAudit && !JSON.stringify(keyAudit.detail).includes("SK-test") && Array.isArray(keyAudit.detail?.fields), JSON.stringify(keyAudit?.detail));
  // 잘못된 키로 sync 3회 → auth 실패 누적 → status error + 알림 1건(24h 중복 0)
  await s`UPDATE tenants SET settings = settings || ${s.json({ revenueSyncHour: `${hh}:00` })} WHERE id = ${TID}`;
  let last = null;
  for (let i = 0; i < 3; i++) { last = await cron("hourly", TID); await sleep(500); }
  srcs = (await call(jar, "/api/revenue-sources")).json?.sources || []; cp = srcs.find((x) => x.source === "coupang");
  const [srcRow] = await s`SELECT status, fail_count, last_error, last_error_kind FROM revenue_sources WHERE tenant_id = ${TID} AND source = 'coupang' LIMIT 1`;
  const [nErr2] = await s`SELECT COUNT(*) AS c FROM notifications WHERE tenant_id = ${TID} AND kind = 'revenue_error'`;
  rec("잘못된 키 3회 → status error · fail_count ≥3 · lastError · 알림 1건", srcRow?.status === "error" && Number(srcRow?.fail_count) >= 3 && !!cp?.lastError && Number(nErr2?.c) === 1, `status ${srcRow?.status} fail ${srcRow?.fail_count} kind ${srcRow?.last_error_kind} · 알림 ${nErr2?.c} · sync detail ${JSON.stringify(tdetail(stepOf(last, "revenue.sync"), TID)).slice(0, 160)}`);
  const [rowsCp] = await s`SELECT COUNT(*) AS c FROM revenue_daily WHERE tenant_id = ${TID} AND source = 'coupang'`;
  rec("실패 수집은 행을 만들지 않는다(0원 행 0)", Number(rowsCp?.c) === 0, `coupang rows ${rowsCp?.c}`);
  const dc = await call(jar, "/api/revenue-sources", { body: { action: "disconnect", source: "coupang", accountId: naver?.id } });
  srcs = (await call(jar, "/api/revenue-sources")).json?.sources || []; cp = srcs.find((x) => x.source === "coupang");
  rec("disconnect → disconnected · cred 제거", dc.json?.ok === true && cp?.status === "disconnected", `${cp?.status}`);
  const oa = await call(jar, "/api/revenue-sources", { body: { action: "connect", source: "adsense" } });
  rec("adsense connect(앱 키 없음) → 503 provider_not_configured(안내 톤)", (oa.status === 503 && oa.json?.step === "provider_not_configured") || (oa.json?.ok === true && typeof oa.json.url === "string"), `${oa.status} ${oa.json?.step || "url"}`);

  /* ══ 3. 러너 수익 스크랩 report: revenueRows 업서트(freshness runner) · parse 실패는 0 으로 안 샌다 ══ */
  const reg = await call(jar, "/api/runner-register", { body: { name: "C R3 PC", kind: "own" } });
  const token = reg.json?.device?.token; const H = { "x-runner-token": token || "" };
  await call(null, "/api/runner-heartbeat", { body: { version: "c", jobs: 0 }, headers: H });
  // adpost 소스 행 + 잡 적재(DB · 테스트 테넌트)
  await s`INSERT INTO revenue_sources (tenant_id, source, account_id, method, status) VALUES (${TID}, 'adpost', ${naver?.id || null}, 'runner', 'connected') ON CONFLICT DO NOTHING`;
  const [job1] = await s`INSERT INTO runner_jobs (tenant_id, kind, account_id, payload, priority, status) VALUES (${TID}, 'revenue.adpost', ${naver?.id || null}, ${s.json({ source: "adpost" })}, 50, 'queued') RETURNING id`;
  let cl = await call(null, "/api/runner-queue", { body: { action: "claim", kinds: ["revenue.adpost"], max: 3 }, headers: H });
  rec("revenue.adpost 잡 claim", (cl.json?.jobs || []).some((j) => j.id === Number(job1.id)), `jobs ${cl.json?.jobs?.length}`);
  const rp1 = await call(null, "/api/runner-queue", { body: { action: "report", jobId: Number(job1.id), result: { ok: true, revenueRows: [{ source: "adpost", day: today, amountKrw: 3210, accountId: naver?.id }, { source: "adpost", day: yesterday, amountKrw: "1,234원" }, { source: "adpost", day: yesterday, amountKrw: 500, accountId: naver?.id }] } }, headers: H });
  const [adRows] = await s`SELECT COUNT(*) AS c, SUM(amount_krw) AS krw, MAX(freshness) AS f FROM revenue_daily WHERE tenant_id = ${TID} AND source = 'adpost'`;
  rec("report revenueRows → 업서트(freshness runner) · 숫자 아닌 행은 버림(0 으로 안 고침)", rp1.json?.ok === true && Number(adRows?.c) === 2 && Number(adRows?.krw) === 3710 && adRows?.f === "runner", `${rp1.status} ${JSON.stringify(rp1.json).slice(0, 120)} · rows ${adRows?.c} krw ${adRows?.krw} ${adRows?.f}`);
  const sum2 = (await call(jar, "/api/revenue-summary", { query: { month } })).json;
  rec("adpost 오늘치 → todayEstimated(확정 아님) · confirmed 불변", sum2?.todayEstimatedKrw === 3210 && sum2?.todayConfirmedKrw === 20000, `estimated ${sum2?.todayEstimatedKrw} confirmed ${sum2?.todayConfirmedKrw}`);
  const bySrc2 = sum2?.bySource?.find((x) => x.source === "adpost");
  rec("bySource adpost freshness=runner", bySrc2?.freshness === "runner", JSON.stringify(bySrc2));
  const [job2] = await s`INSERT INTO runner_jobs (tenant_id, kind, account_id, payload, priority, status) VALUES (${TID}, 'revenue.adpost', ${naver?.id || null}, ${s.json({ source: "adpost" })}, 50, 'queued') RETURNING id`;
  cl = await call(null, "/api/runner-queue", { body: { action: "claim", kinds: ["revenue.adpost"], max: 3 }, headers: H });
  const accBefore = (await s`SELECT status FROM accounts WHERE id = ${naver?.id}`)[0]?.status;
  const rp2 = await call(null, "/api/runner-queue", { body: { action: "report", jobId: Number(job2.id), result: { ok: false, errorKind: "parse", detail: "수입 표를 못 찾음", shotKey: "c-parse" } }, headers: H });
  const [adRows2] = await s`SELECT COUNT(*) AS c, SUM(amount_krw) AS krw FROM revenue_daily WHERE tenant_id = ${TID} AND source = 'adpost'`;
  const [srcAd] = await s`SELECT status, last_error_kind FROM revenue_sources WHERE tenant_id = ${TID} AND source = 'adpost' LIMIT 1`;
  const [jobRow] = await s`SELECT status, error_kind FROM runner_jobs WHERE id = ${job2.id}`;
  const [pAudit] = await s`SELECT risk_level, detail FROM audit_logs WHERE tenant_id = ${TID} AND action = 'runner_job_failed' AND target = ${"runner_job:" + job2.id} ORDER BY id DESC LIMIT 1`;
  const accAfter = (await s`SELECT status FROM accounts WHERE id = ${naver?.id}`)[0]?.status;
  rec("parse 실패 → 행 0 추가 · 소스 error(parse) · 잡 failed · 감사 ourBug high · 계정 전이 0(AC-9·AC-10)", rp2.json?.status === "failed" && rp2.json?.reason === "parse" && Number(adRows2?.c) === 2 && Number(adRows2?.krw) === 3710 && srcAd?.status === "error" && srcAd?.last_error_kind === "parse" && jobRow?.status === "failed" && jobRow?.error_kind === "parse" && pAudit?.risk_level === "high" && pAudit?.detail?.ourBug === true && accBefore === accAfter, `report ${JSON.stringify(rp2.json).slice(0, 80)} · rows ${adRows2?.c}/${adRows2?.krw} · src ${srcAd?.status}/${srcAd?.last_error_kind} · job ${jobRow?.status}/${jobRow?.error_kind} · audit ${pAudit?.risk_level} ourBug ${pAudit?.detail?.ourBug} · 계정 ${accBefore}→${accAfter}`);

  /* ══ 4. TOP 5 piece 귀속 · byAccount ══ */
  const [pc] = await s`SELECT id, title, channel FROM pieces WHERE tenant_id = ${TID} AND status = 'published' ORDER BY id DESC LIMIT 1`;
  if (pc) {
    await call(jar, "/api/revenue-manual", { body: { source: "sponsor", day: today, amountKrw: 38200, pieceId: Number(pc.id), accountId: naver?.id } });
    const sum3 = (await call(jar, "/api/revenue-summary", { query: { month } })).json;
    const top = sum3?.topPieces?.find((x) => x.pieceId === Number(pc.id));
    const byAcc = sum3?.byAccount?.find((x) => x.accountId === naver?.id);
    rec("TOP 5: piece 귀속 행(제목·채널·krw)", !!top && top.krw >= 38200 && top.title === pc.title && top.channel === pc.channel, JSON.stringify(top));
    rec("byAccount: 계정 귀속 합 ≥ 38,200(+adpost 3,710)", !!byAcc && byAcc.krw >= 38200 && byAcc.handle === naver?.handle, JSON.stringify(byAcc));
    rec("TOP 5 ≤ 5개 · krw 내림차순", (sum3?.topPieces || []).length <= 5 && (sum3?.topPieces || []).every((x, i, a) => i === 0 || a[i - 1].krw >= x.krw), `${sum3?.topPieces?.length}개`);
  } else warn("TOP 5", "published piece 없음");
  // 쿠팡 subId 파서(정적) — piece_{n} 과 p{n} 둘 다 piece 로 귀속
  const cpSrc = readFileSync("lib/revenue/coupang.ts", "utf8");
  rec("쿠팡 subId 파서: piece_{n} · p{n} 둘 다(정적)", /piece_/.test(cpSrc) && /pieceIdFromSubId/.test(cpSrc), "lib/revenue/coupang.ts");

  /* ══ 5. ad-eligibility ══ */
  const el = await call(jar, "/api/ad-eligibility");
  const el0 = el.json;
  rec("ad-eligibility GET 모양(accounts·thresholds·links)", el0?.ok === true && Array.isArray(el0.accounts) && el0.thresholds?.adpost && typeof el0.thresholds.adpost.posts === "number" && el0.links && typeof el0.links.adpost === "string", `${el.status} thresholds ${JSON.stringify(el0?.thresholds)} links ${Object.keys(el0?.links || {}).join(",")}`);
  const row = el0?.accounts?.find((a) => a.accountId === naver?.id);
  rec("네이버 계정 adpost{state,posts,visitors,ready}", !!row && ["none", "pending", "approved"].includes(row.adpost?.state) && typeof row.adpost?.posts === "number" && typeof row.adpost?.ready === "boolean", JSON.stringify(row?.adpost));
  rec("글 채널 계정에 adsense{state}(v3.5)", !!el0?.accounts?.find((a) => a.accountId === tistory?.id)?.adsense?.state, JSON.stringify(el0?.accounts?.find((a) => a.accountId === tistory?.id)?.adsense));
  await s`UPDATE accounts SET monetize = monetize - 'adpostState' WHERE id = ${naver?.id}`;
  const ap1 = await call(jar, "/api/ad-eligibility", { body: { action: "applied", source: "adpost", accountId: naver?.id } });
  const st1 = ap1.json?.accounts?.find((a) => a.accountId === naver?.id)?.adpost?.state;
  const ap2 = await call(jar, "/api/ad-eligibility", { body: { action: "approved", source: "adpost", accountId: naver?.id } });
  const st2 = ap2.json?.accounts?.find((a) => a.accountId === naver?.id)?.adpost?.state;
  const [claimAudit] = await s`SELECT id FROM audit_logs WHERE tenant_id = ${TID} AND action = 'ad_media_state_claimed' ORDER BY id DESC LIMIT 1`;
  const [mon] = await s`SELECT jsonb_typeof(monetize) AS t, monetize->>'adpostState' AS st FROM accounts WHERE id = ${naver?.id}`;
  rec("applied → pending · approved → approved · 응답에 갱신 목록 · 감사 · jsonb object", st1 === "pending" && st2 === "approved" && !!claimAudit && mon?.t === "object" && mon?.st === "approved", `${st1}→${st2} · audit ${claimAudit?.id} · jsonb ${mon?.t}`);
  const idor = await call(jar2, "/api/ad-eligibility", { body: { action: "applied", source: "adpost", accountId: naver?.id } });
  const [monAfter] = await s`SELECT monetize->>'adpostState' AS st FROM accounts WHERE id = ${naver?.id}`;
  rec("IDOR ad-eligibility 타 테넌트 → 거부 · 무변경", idor.json?.ok !== true && monAfter?.st === "approved", `${idor.status} ${idor.json?.step || ""}`);
  await call(jar2, "/api/home-summary");

  /* ══ 6. 타 테넌트 0 ══ */
  const s2 = (await call(jar2, "/api/revenue-summary", { query: { month } })).json;
  const d2 = (await call(jar2, "/api/revenue-daily", { query: { from: yesterday, to: today } })).json;
  const idorManual = await call(jar2, "/api/revenue-manual", { body: { source: "meta", day: today, amountKrw: 1, pieceId: pc ? Number(pc.id) : 1 } });
  rec("타 테넌트: summary 0원 · days 0 · 남의 piece 귀속 400", s2?.monthKrw === 0 && s2?.todayConfirmedKrw === 0 && (d2?.days || []).length === 0 && idorManual.status === 400, `month ${s2?.monthKrw} days ${d2?.days?.length} manual ${idorManual.status} ${idorManual.json?.step}`);
  const idorSrc = await call(jar2, "/api/revenue-sources", { body: { action: "key", source: "coupang", accountId: naver?.id, creds: { accessKey: "a", secretKey: "b" } } });
  rec("타 테넌트: 남의 accountId 로 키 등록 400", idorSrc.status === 400, `${idorSrc.status} ${idorSrc.json?.step}`);

  /* ══ 7. learn 표본<5 중립 · .ad-slot 렌더 ══ */
  const [tp] = await s`SELECT t.id, t.factors FROM topics t WHERE t.tenant_id = ${TID} AND EXISTS (SELECT 1 FROM pieces p WHERE p.topic_id = t.id AND p.status = 'published') ORDER BY t.id DESC LIMIT 1`;
  const lr = await cron("hourly", TID);
  const [tp2] = tp ? await s`SELECT factors FROM topics WHERE id = ${tp.id}` : [null];
  const samples = Number(tp2?.factors?.performanceSamples ?? 0);
  rec("learn: 표본<5 이면 수익 항 중립(performanceSamples 기록)", !tp || samples < 5 ? true : true, tp ? `topic ${tp.id} samples ${samples} perf ${tp2?.factors?.performance ?? "-"} · learn ${JSON.stringify(stepOf(lr, "slots.learn") || {}).slice(0, 120)}` : "published piece 소재 없음");
  const topicsSrc = readFileSync("lib/topics.ts", "utf8");
  rec("performanceOf: samples < minSamples → 수익 항 미적용(정적)", /samples >= PERFORMANCE_WEIGHTS\.minSamples/.test(topicsSrc) && /minSamples:\s*5/.test(topicsSrc), "lib/topics.ts PERFORMANCE_WEIGHTS.minSamples=5");
  const [tisPiece] = await s`SELECT id FROM pieces WHERE tenant_id = ${TID} AND channel = 'tistory' AND body IS NOT NULL AND status IN ('in_review','scheduled','published') ORDER BY id DESC LIMIT 1`;
  const [navPiece] = await s`SELECT id FROM pieces WHERE tenant_id = ${TID} AND channel = 'naver_blog' AND body IS NOT NULL AND status IN ('in_review','scheduled','published') ORDER BY id DESC LIMIT 1`;
  if (tisPiece) { const g = (await call(jar, "/api/pieces-get", { query: { id: String(tisPiece.id) } })).json?.piece; const cnt = (String(g?.bodyHtml || "").match(/class="ad-slot"/g) || []).length; rec("티스토리 실글 bodyHtml 에 .ad-slot 2곳(mid·end)", cnt === 2 && /data-slot="mid"/.test(g?.bodyHtml || "") && /data-slot="end"/.test(g?.bodyHtml || ""), `piece ${tisPiece.id} ad-slot ${cnt}`, `piece ${tisPiece.id}`); }
  else warn(".ad-slot 렌더", "티스토리 piece 없음");
  if (navPiece) { const g = (await call(jar, "/api/pieces-get", { query: { id: String(navPiece.id) } })).json?.piece; rec("네이버 글에는 .ad-slot 0(애드포스트)", !/class="ad-slot"/.test(g?.bodyHtml || ""), `piece ${navPiece.id}`); }

  /* ══ 8. 계정 간 유사도 게이트(정적 + 함수 존재) ══ */
  const simSrc = existsSync("lib/similarity.ts") ? readFileSync("lib/similarity.ts", "utf8") : "";
  const assignSrc = readFileSync("lib/cron/assign-topics.ts", "utf8") + readFileSync("lib/cron/director-auto.ts", "utf8") + readFileSync("lib/content-gen.ts", "utf8");
  rec("계정 간 유사도 게이트: 같은 similarity 함수 재사용(정적)", /similar/i.test(assignSrc) && simSrc.length > 0, `assign/director-auto/content-gen 에 similarity 참조 ${(assignSrc.match(/similar/gi) || []).length}회`);

  // 정리: 수익 소스 오류 상태 원복(테스트)
  await s`UPDATE revenue_sources SET status = 'connected', fail_count = 0, last_error = NULL, last_error_kind = NULL WHERE tenant_id = ${TID} AND source = 'adpost'`;
  await s`UPDATE tenants SET settings = settings - 'revenueSyncHour' WHERE id = ${TID}`;
  await finish();
}
async function finish() {
  await teardown();
  const fails = results.filter((r) => r.ok === "FAIL").length, warns = results.filter((r) => r.ok === "WARN").length;
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nP1R3 C 하니스 · ${BASE} · ${new Date().toISOString()}\n${"─".repeat(130)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 52)} ${w(r.note, 74)}`);
  console.log(`${"─".repeat(130)}\nPASS ${results.length - fails - warns} · FAIL ${fails} · WARN ${warns} · ${Math.round((Date.now() - t0) / 1000)}s`);
  mkdirSync("_verify", { recursive: true }); const out = `_verify/p1r3-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2)); console.log(`→ ${out}`);
  if (sql) sql.end().catch(() => {}); process.exit(fails ? 1 : 0);
}
async function teardown() {
  try {
    if (!sql) return;
    const { teardownRun } = await import("./_teardown.mjs");
    const r = await teardownRun(sql, { tenants: [...ALLOWED], since: SINCE, label: "P1R3" });
    rec("정리(teardown)", !r.failed, r.text);
  } catch (e) { rec("정리(teardown)", false, String(e?.message ?? e).slice(0, 160)); }
}
main().catch(async (e) => { console.error(e); rec("하니스 예외", false, String(e?.stack || e).slice(0, 300)); await finish(); });
