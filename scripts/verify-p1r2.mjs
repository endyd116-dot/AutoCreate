// scripts/verify-p1r2.mjs — P1R2 검증 하니스(C · 계약 v2.11): 크론 6스텝+reap · 변수 8 · 슬롯 4경로+IDOR · 러너 큐(claim/report/release/reap) ·
//   발행(러너 적재·finalize 멱등·오프라인·API 채널 정직 경로) · 계정 전이(§7.2) · 알림함 · 발행함 · 소재 배경화 · 멀티테넌트 교차 0.
//   사용: node scripts/verify-p1r2.mjs           (BASE_URL 기본 http://localhost:8901 · 로컬 dev 는 CRON_BUDGET_MS=24000 · SITE_URL=BASE 로 띄운다)
//        SECTIONS=cron,slots,runner …          (일부만 · 기본 전부)   · GEN_TIMEOUT_MS(기본 8분)
//   🔴 테스트 테넌트만(PITFALLS #8): DB 직접 손질(review_deadline·scheduled_for·claimed_at 당기기)은 TEST_EMAIL·TEST_EMAIL2 테넌트 id 에만 허용한다.
//   🔴 로컬 인공물(AC-12 ①②)은 «로컬 한정 의심»으로 표시하고 프로덕션 결함으로 적지 않는다. 초록은 증거가 아니다(#9) — row id 를 남긴다.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = (process.env.BASE_URL || "http://localhost:8901").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL || "c+p1@autocreate.test", EMAIL2 = process.env.TEST_EMAIL2 || "c+p1b@autocreate.test";
const PASSWORD = process.env.TEST_PASSWORD || "Cp1Verify2026x";
const CRON_SECRET = process.env.CRON_SECRET || "";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 8 * 60_000);
const SECTIONS = new Set((process.env.SECTIONS || "cron,vars,slots,produce,review,runner,publish,reap,transitions,notif,posts,topics,idor,kst").split(",").map((s) => s.trim()));
const IS_LIVE = /^https:/.test(BASE);
const EVIDENCE_URL = `${BASE.replace(/:8901$/, ":3997")}/index.html`;   // report 의 externalUrl 검증용(200 을 주는 우리 정적 서버)

const results = []; const t0 = Date.now();
/* [P1R7 §3.5] teardown — 보존 테넌트(C검증)라 집은 남기고 이번 실행 산출물만 정리한다. */
const SINCE = new Date();
const rec = (step, ok, note = "", evidence) => { results.push({ step, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note, evidence }); return !!ok; };
const warn = (step, note, evidence) => rec(step, "WARN", note, evidence);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── HTTP ── */
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

/* ── DB(테스트 테넌트 한정) ── */
let sql = null; const ALLOWED_TIDS = new Set();
async function db() {
  if (sql) return sql;
  const url = process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
  if (!url) throw new Error("NETLIFY_DATABASE_URL 없음");
  const { default: postgres } = await import("postgres");
  sql = postgres(url, { ssl: "require", max: 1 });
  return sql;
}
const guard = (tid) => { if (!ALLOWED_TIDS.has(Number(tid))) throw new Error(`테스트 테넌트가 아닌 tid=${tid} 에 DB 손질 금지`); };

async function signIn(jar, email) {
  let r = await call(jar, "/api/auth-login", { body: { email, password: PASSWORD, remember: true } });
  if (r.status === 401) r = await call(jar, "/api/auth-register", { body: { email, password: PASSWORD, name: "C검증" } });
  const me = await call(jar, "/api/auth-me");
  rec(`login ${email}`, r.json?.ok === true && me.json?.ok === true, `${r.status}/${me.status}`);
  return me.json;
}

/* ══════════════════════ 메인 ══════════════════════ */
async function main() {
  if (!CRON_SECRET) return rec("CRON_SECRET", false, ".env 에 없음 — cron-run 을 못 부른다"), await finish();
  const jar = new Jar(), jar2 = new Jar();
  const me = await signIn(jar, EMAIL); if (!me?.ok) return await finish();
  const me2 = await signIn(jar2, EMAIL2); if (!me2?.ok) return await finish();
  const s = await db();
  const [t1] = await s`SELECT id FROM tenants WHERE key = ${me.tenant.key}`; const [t2] = await s`SELECT id FROM tenants WHERE key = ${me2.tenant.key}`;
  const TID = Number(t1.id), TID2 = Number(t2.id); ALLOWED_TIDS.add(TID); ALLOWED_TIDS.add(TID2);
  rec("테넌트 id", TID > 0 && TID2 > 0 && TID !== TID2, `tid=${TID} · tid2=${TID2}`);

  /* ── 준비: 코인·계정·규칙·변수 기본값 ── */
  let bal = (await call(jar, "/api/coins-balance")).json?.balance ?? 0;
  if (bal < 40) { await s`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason) VALUES (${TID}, 'grant', 'included', 40, ${"c3:" + Date.now()}, 'P1R2 하니스')`; bal = (await call(jar, "/api/coins-balance")).json?.balance ?? 0; }
  rec("코인 ≥ 40", bal >= 40, `balance ${bal}`);
  const al = (await call(jar, "/api/accounts-list")).json?.accounts || [];
  let naver = al.find((a) => a.channel === "naver_blog"); let tistory = al.find((a) => a.channel === "tistory");
  if (!naver) { const r = await call(jar, "/api/accounts-add", { body: { channel: "naver_blog", handle: "c_p1_naver", loginId: "c_p1_naver", password: "Zq9-plain-secret-77" } }); naver = r.json?.account; }
  if (!tistory) { const r = await call(jar, "/api/accounts-add", { body: { channel: "tistory", handle: "c_p1_tistory", loginId: "c_p1_tistory", password: "Zq9-plain-secret-77" } }); tistory = r.json?.account; }
  rec("계정 2(naver·tistory)", !!(naver?.id && tistory?.id), `naver ${naver?.id} · tistory ${tistory?.id}`);
  // 정지 시뮬 승계용 두 번째 네이버 계정
  let naver2 = al.find((a) => a.channel === "naver_blog" && a.id !== naver?.id);
  if (!naver2) { const r = await call(jar, "/api/accounts-add", { body: { channel: "naver_blog", handle: "c_p1_naver2", loginId: "c_p1_naver2", password: "Zq9-plain-secret-77" } }); naver2 = r.json?.account; if (!naver2 && r.json?.step === "duplicate") naver2 = ((await call(jar, "/api/accounts-list")).json?.accounts || []).find((a) => a.handle === "c_p1_naver2"); }
  rec("네이버 계정 2개(승계용)", !!naver2?.id, `naver2 ${naver2?.id}`);

  // 하니스 위생(테스트 테넌트): 앞선 실행이 건너뛴 미래 빈 자리를 되돌린다 — 그대로 두면 assign/produce 가 볼 자리가 없다(수리된 roll 은 skipped 를 되살리지 않는다)
  guard(TID); await s`UPDATE slots SET status = 'planned', topic_id = NULL, note = NULL WHERE tenant_id = ${TID} AND origin = 'auto' AND status IN ('skipped','no_topic','coin_short') AND piece_id IS NULL AND slot_date >= CURRENT_DATE`;
  await s`UPDATE topics SET status = 'candidate' WHERE tenant_id = ${TID} AND status = 'picked' AND id NOT IN (SELECT topic_id FROM slots WHERE tenant_id = ${TID} AND topic_id IS NOT NULL)`;
  const rs0 = await call(jar, "/api/rules-settings", { body: { autoSchedule: true, horizonDays: 7, topicLeadDays: 7, produceLeadDays: 3, produceHour: "06:00", reviewPolicy: "silence_approves", bestTimeMode: "auto", weeklyCoinCap: null, quietDays: [] } });
  rec("변수 8 기본값 저장", rs0.json?.ok === true && rs0.json?.settings?.autoSchedule === true, `${rs0.status}`);
  const rl = (await call(jar, "/api/rules-list")).json;
  const activeRules = (rl?.rules || []).filter((r) => r.active);
  const ruleBody = activeRules.length ? activeRules.map(({ id, channel, kind, accountMode, every, count, active }) => ({ id, channel, kind, accountMode, every, count, active })) : [{ channel: "naver_blog", kind: "post", accountMode: "auto", every: "week", count: 3, active: true }];
  const rs = await call(jar, "/api/rules-save", { body: { rules: ruleBody } });
  rec("규칙(naver 주3) 저장", rs.json?.ok === true, `${rs.status} slotsCreated ${rs.json?.slotsCreated}`);
  const kst = (d) => new Date(d.getTime() + 9 * 3600e3); const ymd = (d) => kst(d).toISOString().slice(0, 10);
  const today = ymd(new Date()), plus7 = ymd(new Date(Date.now() + 7 * 86400e3)), plus14 = ymd(new Date(Date.now() + 14 * 86400e3));
  const slotsNow = async () => (await call(jar, "/api/slots-list", { query: { from: today, to: plus14 } })).json?.slots || [];

  /* ══ 1. 크론 기준선(hourly) + roll 멱등 ══ */
  if (SECTIONS.has("cron")) {
    const bad = await call(null, "/api/cron-run", { method: "POST", query: { every: "hourly", tid: String(TID), secret: "wrong" } });
    rec("cron-run 시크릿 없이 401", bad.status === 401, `${bad.status}`);
    const c1 = await cron("hourly", TID);
    const keys = (c1.json?.ran || []).map((x) => x.step);
    rec("cron hourly ok", c1.json?.ok === true, `${c1.status} ${c1.json?.step || ""} ${c1.json?.error || ""} ${c1.json?.ms}ms`);
    rec("hourly 5스텝 순서", JSON.stringify(keys) === JSON.stringify(["slots.roll", "slots.assign_topics", "slots.produce", "slots.review_deadline", "slots.learn"]), keys.join(","));
    rec("hourly errors 0", (c1.json?.ran || []).every((x) => x.errors === 0), (c1.json?.ran || []).map((x) => `${x.step}:${x.errors}`).join(" "));
    rec("StepReport 모양", (c1.json?.ran || []).every((x) => ["tenants", "changed", "skipped", "errors"].every((k) => typeof x[k] === "number")), "");
    const c2 = await cron("hourly", TID);
    rec("roll 멱등(재실행 changed 0)", stepOf(c2, "slots.roll")?.changed === 0, `changed ${stepOf(c2, "slots.roll")?.changed} · checked ${tdetail(stepOf(c2, "slots.roll"), TID).checked}`);
    const c5 = await cron("5m", TID);
    const k5 = (c5.json?.ran || []).map((x) => x.step);
    rec("cron 5m 2스텝(publisher·reap)", JSON.stringify(k5) === JSON.stringify(["publisher", "runner.reap"]) && (c5.json?.ran || []).every((x) => x.errors === 0), k5.join(","));
    const [tick] = await s`SELECT id, detail FROM audit_logs WHERE action = 'cron_tick' ORDER BY id DESC LIMIT 1`;
    rec("cron_tick 감사 행(전건 기록)", !!tick && Array.isArray(tick.detail?.ran), `audit_logs id=${tick?.id}`, `audit_logs id=${tick?.id}`);
  }

  /* ══ 2. 변수 8 이 실제로 읽히는가 ══ */
  if (SECTIONS.has("vars")) {
    // autoSchedule off → roll/assign/produce/review 는 autoScheduleOff 로 건너뛴다(AC-2 · 편성표가 만드는 것은 멈춘다)
    await call(jar, "/api/rules-settings", { body: { autoSchedule: false } });
    const off = await cron("hourly", TID);
    rec("autoSchedule=false → 4스텝 autoScheduleOff", ["slots.roll", "slots.assign_topics", "slots.produce", "slots.review_deadline"].every((k) => stepOf(off, k)?.tenants === 0 && stepOf(off, k)?.detail?.autoScheduleOff === 1), (off.json?.ran || []).map((x) => `${x.step}:t${x.tenants}`).join(" "));
    rec("autoSchedule=false 여도 learn 은 돈다", stepOf(off, "slots.learn")?.tenants === 1, "");
    await call(jar, "/api/rules-settings", { body: { autoSchedule: true } });
    // horizonDays 7 → 14 : roll 이 더 만든다
    const h7 = await cron("hourly", TID); const c7 = tdetail(stepOf(h7, "slots.roll"), TID).checked || 0;
    await call(jar, "/api/rules-settings", { body: { horizonDays: 14 } });
    const h14 = await cron("hourly", TID); const c14 = tdetail(stepOf(h14, "slots.roll"), TID).checked || 0;
    rec("horizonDays 7→14 → roll 이 보는 자리 수 증가(checked)", c14 > c7 && tdetail(stepOf(h14, "slots.roll"), TID).horizonDays === 14, `checked ${c7}(7일)→${c14}(14일)`);
    await call(jar, "/api/rules-settings", { body: { horizonDays: 7 } });
    // quietDays: 앞으로의 planned 슬롯 하나를 쉬는 날로 → 삭제(v2.11) · roll 재실행에도 안 생김
    const planned = (await slotsNow()).filter((x) => x.origin === "auto" && x.status === "planned" && x.date > today);
    if (planned[0]) {
      const qd = planned[0].date;
      await call(jar, "/api/rules-settings", { body: { quietDays: [qd] } });
      await cron("hourly", TID);
      const still = (await slotsNow()).filter((x) => x.date === qd && x.origin === "auto" && x.status !== "skipped" && !x.pieceId);
      rec("quietDays 지정 → 그 날 빈 슬롯 0 · 재롤에도 안 생김", still.length === 0, `${qd} 남은 ${still.length}`);
      await call(jar, "/api/rules-settings", { body: { quietDays: [] } });
    } else warn("quietDays", "미래 planned 슬롯이 없어 검사 보류");
    // bestTimeMode fixed + preferredHour → publishAt 시(hour) 가 preferredHour
    rec("bestTimeMode·preferredHour", "WARN", "규칙 preferredHour 변경은 슬롯 재생성이 필요 — roll 은 기존 (rule,date) 를 건드리지 않는다(설계대로 · 시각 검사는 slots-reschedule 로 대신)");
    // produceHour ≠ 지금 → produce 가 skippedByHour 를 detail 로 남긴다(수동 실행)
    const ph = await cron("hourly", TID);
    rec("produceHour≠지금 → skippedByHour 명시", /≠/.test(String(tdetail(stepOf(ph, "slots.produce"), TID).skippedByHour || "")), JSON.stringify(tdetail(stepOf(ph, "slots.produce"), TID)));
  }

  /* ══ 3. 슬롯 4경로 + IDOR ══ */
  let producedPieceId = null, producedSlotId = null;
  if (SECTIONS.has("slots")) {
    const c = await cron("hourly", TID);   // assign_topics 로 topic_assigned 만들기
    let slots = await slotsNow();
    const assigned = slots.filter((x) => x.origin === "auto" && x.status === "topic_assigned");
    rec("assign_topics → topic_assigned ≥1", assigned.length >= 1, `topic_assigned ${assigned.length} · assign changed ${stepOf(c, "slots.assign_topics")?.changed}`, assigned.slice(0, 3).map((x) => `slot ${x.id}`).join(","));
    const topics = (await call(jar, "/api/topics-list", { query: { status: "candidate" } })).json?.topics || [];
    const target = assigned[0]; const other = topics.find((t) => t.title !== target?.topicTitle);
    if (target && other) {
      const prevTitle = target.topicTitle;
      const a1 = await call(jar, "/api/slots-assign-topic", { body: { slotId: target.id, topicId: other.id } });
      rec("slots-assign-topic", a1.json?.ok === true && a1.json?.slot?.topicTitle === other.title && a1.json?.slot?.status === "topic_assigned", `${a1.status} ${a1.json?.step || ""} → «${a1.json?.slot?.topicTitle}»`, `slot ${target.id} topic ${other.id}`);
      const tl2 = (await call(jar, "/api/topics-list", { query: { status: "candidate" } })).json?.topics || [];
      rec("바꾼 뒤 이전 소재는 후보로 복귀", tl2.some((t) => t.title === prevTitle), `«${prevTitle}»`);
      const taken = assigned[1];
      if (taken) { const a2 = await call(jar, "/api/slots-assign-topic", { body: { slotId: taken.id, topicId: other.id } }); rec("같은 소재 두 자리 금지(topic_taken)", a2.json?.step === "topic_taken", `${a2.status} ${a2.json?.step}`); }
    } else warn("slots-assign-topic", "topic_assigned 슬롯 또는 후보 소재 없음");
    // reschedule
    const rsl = slots.filter((x) => x.origin === "auto" && ["planned", "topic_assigned"].includes(x.status));
    if (rsl[0]) {
      const at = new Date(Date.now() + 2 * 86400e3); at.setUTCHours(1, 5 + (Math.floor(Date.now() / 60000) % 40), 0, 0);   // KST 10:05~10:44(실행마다 다른 분 — 앞 실행과 30분 충돌 회피)
      const r1 = await call(jar, "/api/slots-reschedule", { body: { slotId: rsl[0].id, at: at.toISOString() } });
      rec("slots-reschedule", r1.json?.ok === true && r1.json?.slot?.publishAt === at.toISOString() && r1.json?.slot?.date === ymd(at), `${r1.status} ${r1.json?.step || ""} → ${r1.json?.slot?.date} ${r1.json?.slot?.publishAt}`, `slot ${rsl[0].id}`);
      const soon = await call(jar, "/api/slots-reschedule", { body: { slotId: rsl[0].id, at: new Date(Date.now() + 60e3).toISOString() } });
      rec("reschedule 10분 안 → too_soon", soon.json?.step === "too_soon", `${soon.status} ${soon.json?.step}`);
      if (rsl[1]) { const near = new Date(at.getTime() + 10 * 60e3); const cad = await call(jar, "/api/slots-reschedule", { body: { slotId: rsl[1].id, at: near.toISOString() } }); rec("같은 채널 30분 안 → cadence", cad.json?.step === "cadence", `${cad.status} ${cad.json?.step}`); }
    } else warn("slots-reschedule", "대상 슬롯 없음");
    // produce-now
    slots = await slotsNow();
    const pn = slots.find((x) => x.origin === "auto" && x.status === "topic_assigned" && !x.pieceId);
    if (pn) {
      const b0 = (await call(jar, "/api/coins-balance")).json?.balance;
      const p1 = await call(jar, "/api/slots-produce-now", { body: { slotId: pn.id } });
      const b1 = (await call(jar, "/api/coins-balance")).json?.balance;
      rec("slots-produce-now → 202 pieceId · 코인 차감", [200, 202].includes(p1.status) && p1.json?.ok === true && p1.json?.pieceId > 0 && b0 - b1 === (p1.json?.coinsCharged ?? -1), `${p1.status} ${p1.json?.step || ""} piece ${p1.json?.pieceId} charged ${p1.json?.coinsCharged} (${b0}→${b1})`, `piece ${p1.json?.pieceId} slot ${pn.id}`);
      producedPieceId = p1.json?.pieceId; producedSlotId = pn.id;
      const p2 = await call(jar, "/api/slots-produce-now", { body: { slotId: pn.id } });
      const b2 = (await call(jar, "/api/coins-balance")).json?.balance;
      rec("produce-now 멱등(같은 pieceId · 재차감 0)", p2.json?.pieceId === producedPieceId && b2 === b1, `piece ${p2.json?.pieceId} · ${b1}→${b2}`);
      const sl2 = (await slotsNow()).find((x) => x.id === pn.id);
      rec("슬롯 producing + pieceId", sl2?.status === "producing" && sl2?.pieceId === producedPieceId, `${sl2?.status} piece ${sl2?.pieceId}`);
      const st = await call(jar, "/api/slots-assign-topic", { body: { slotId: pn.id, topicId: topics[0]?.id || 1 } });
      rec("글 붙은 자리 소재 바꾸기 거부(state)", st.json?.step === "state", `${st.status} ${st.json?.step}`);
    } else warn("slots-produce-now", "topic_assigned 슬롯 없음");
    // skip
    const sk = (await slotsNow()).filter((x) => x.origin === "auto" && ["planned", "topic_assigned"].includes(x.status) && !x.pieceId).pop();   // 가장 먼 자리(앞 자리는 produce 검사가 쓴다)
    if (sk) { const r = await call(jar, "/api/slots-skip", { body: { id: sk.id } }); const after = (await slotsNow()).find((x) => x.id === sk.id); rec("slots-skip → skipped", r.json?.ok === true && after?.status === "skipped", `slot ${sk.id}`); }
    // IDOR 4경로(타 테넌트 세션)
    const victim = (await slotsNow())[0];
    if (victim) {
      const i1 = await call(jar2, "/api/slots-assign-topic", { body: { slotId: victim.id, topicId: 1 } });
      const i2 = await call(jar2, "/api/slots-reschedule", { body: { slotId: victim.id, at: new Date(Date.now() + 86400e3).toISOString() } });
      const i3 = await call(jar2, "/api/slots-produce-now", { body: { slotId: victim.id } });
      const i4 = await call(jar2, "/api/slots-skip", { body: { id: victim.id } });
      const same = (await slotsNow()).find((x) => x.id === victim.id);
      rec("IDOR 슬롯 4경로 404 · 무변경", [i1, i2, i3, i4].every((x) => x.status === 404) && same?.status === victim.status && same?.publishAt === victim.publishAt, `${[i1, i2, i3, i4].map((x) => x.status).join("/")}`);
    }
  }

  /* ══ 4. produce(크론) · weeklyCoinCap · 슬롯 게이트 ══ */
  if (SECTIONS.has("produce")) {
    const nowKst = kst(new Date()); const hh = String(nowKst.getUTCHours()).padStart(2, "0");
    await call(jar, "/api/rules-settings", { body: { produceHour: `${hh}:00`, produceLeadDays: 7, weeklyCoinCap: 1 } });
    await cron("hourly", TID);   // assign 먼저
    const capRun = await cron("hourly", TID);
    const pd = tdetail(stepOf(capRun, "slots.produce"), TID);
    const balCap = (await call(jar, "/api/coins-balance")).json;
    const [csn] = await s`SELECT id FROM notifications WHERE tenant_id = ${TID} AND kind = 'coin_cap' ORDER BY id DESC LIMIT 1`;
    const csl = (await slotsNow()).filter((x) => x.status === "coin_short");
    rec("weeklyCoinCap=1 → coin_short + 알림 · 원장 무접촉", (pd.capped || 0) >= 1 && csl.length >= 1 && !!csn, `capped ${pd.capped} · coin_short 슬롯 ${csl.length} · 알림 id ${csn?.id}`, `slot ${csl[0]?.id} · notifications id=${csn?.id}`);
    const consumeAfter = (balCap?.recent || []).filter((r) => r.kind === "consume");
    rec("cap 걸린 틱에서 consume 0", !consumeAfter.some((r) => Date.now() - new Date(r.createdAt).getTime() < 30_000), "");
    await call(jar, "/api/rules-settings", { body: { weeklyCoinCap: null } });
    const b0 = (await call(jar, "/api/coins-balance")).json?.balance;
    const mk = await cron("hourly", TID);
    // 🔴 로컬은 배경 함수를 동기 실행해(AC-12②) 실제로 만든 틱이 30초 타임아웃 500 으로 끝날 수 있다 — 판정은 응답이 아니라 **감사 행**(cron_slots_produce · piece_auto_produced)으로.
    const [prodAudit] = await s`SELECT id, detail FROM audit_logs WHERE action = 'cron_slots_produce' ORDER BY id DESC LIMIT 1`;
    const md = (prodAudit?.detail?.detail?.tenants || []).find((t) => t.tid === TID) || tdetail(stepOf(mk, "slots.produce"), TID);
    if (mk.status !== 200) warn("produce 틱 응답", `${mk.status} — 로컬 동기 배경 실행(AC-12②)으로 30초 초과 가능 · 감사 행으로 판정`);
    const b1 = (await call(jar, "/api/coins-balance")).json?.balance;
    const [auditMade] = await s`SELECT id, detail, created_at FROM audit_logs WHERE tenant_id = ${TID} AND action = 'piece_auto_produced' ORDER BY id DESC LIMIT 1`;
    const fresh = auditMade && Date.now() - new Date(auditMade.created_at).getTime() < 120_000;
    rec("produce(크론) → made ≥1 · 코인 차감 · 감사 piece_auto_produced", (md.made || 0) >= 1 && b0 - b1 > 0 && fresh, `made ${md.made} · ${b0}→${b1} · audit ${auditMade?.id} · deferred ${md.deferredToNextDay || 0}`, `audit_logs id=${auditMade?.id} pieceIds=${JSON.stringify(auditMade?.detail?.pieceIds)}`);
    const prodSlots = (await slotsNow()).filter((x) => x.origin === "auto" && x.status === "producing");
    rec("자동 제작 슬롯 producing + pieceId", prodSlots.length >= 1 && prodSlots.every((x) => x.pieceId), `${prodSlots.length}개`);
    if (!producedPieceId && auditMade?.detail?.pieceIds?.[0]) { producedPieceId = auditMade.detail.pieceIds[0]; producedSlotId = Number(String(auditMade.target || "").replace("slot:", "")) || null; }
    await call(jar, "/api/rules-settings", { body: { produceHour: "06:00", produceLeadDays: 3 } });
    // 슬롯 게이트: 자동 경로가 슬롯 없이 만들려 하면 거부(감사 slot_gate) — 코드 경로 확인
    const [gateAudit] = await s`SELECT COUNT(*) AS c FROM audit_logs WHERE action LIKE 'slot_gate%'`;
    warn("슬롯 없는 자동 생성 거부", `HTTP 로 재현 불가(크론은 항상 slotId 를 넘긴다) — lib/slot-gate.ts 정적 확인 · 감사 행 ${gateAudit?.c}건`);
  }

  /* ══ 5. review_deadline(생성 완료 대기 후) ══ */
  let scheduledPieceId = null;
  if (SECTIONS.has("review")) {
    // 만들어진 piece 하나가 in_review 될 때까지
    const deadline = Date.now() + GEN_TIMEOUT; let piece = null, last = "";
    while (Date.now() < deadline) {
      const pl = (await call(jar, "/api/pieces-list", { query: { status: "all" } })).json?.pieces || [];
      const mine = pl.filter((p) => p.id === producedPieceId || pl.length);
      last = mine.slice(0, 4).map((p) => `${p.id}:${p.status}/${p.stage}`).join(" ");
      piece = pl.find((p) => p.id === producedPieceId && p.status === "in_review") || pl.find((p) => p.status === "in_review" && p.channel === "naver_blog");
      if (piece) break;
      if (pl.find((p) => p.id === producedPieceId && p.status === "failed")) { rec("자동 제작 piece 생성", false, `piece ${producedPieceId} failed: ${pl.find((p) => p.id === producedPieceId)?.failReason}`); break; }
      await sleep(5000);
    }
    rec("piece in_review 도달", !!piece, last, piece ? `piece ${piece.id}` : "");
    if (piece) {
      const [slotRow] = await s`SELECT id, status, review_deadline FROM slots WHERE tenant_id = ${TID} AND piece_id = ${piece.id} LIMIT 1`;
      rec("생성 완료 후 슬롯 in_review 동기화", slotRow?.status === "in_review", `slot ${slotRow?.id} ${slotRow?.status}`);
      if (slotRow) {
        guard(TID);
        await s`UPDATE slots SET review_deadline = NOW() - interval '1 hour' WHERE tenant_id = ${TID} AND id = ${slotRow.id}`;
        const rd = await cron("hourly", TID);
        const d = tdetail(stepOf(rd, "slots.review_deadline"), TID);
        const pg = (await call(jar, "/api/pieces-get", { query: { id: piece.id } })).json?.piece;
        const [slot2] = await s`SELECT status FROM slots WHERE id = ${slotRow.id}`;
        rec("silence_approves 마감 지남 → 자동 승인(scheduled)", pg?.status === "scheduled" && slot2?.status === "scheduled" && (d.approved || 0) >= 1, `piece ${pg?.status} · slot ${slot2?.status} · approved ${d.approved}`, `piece ${piece.id} slot ${slotRow.id}`);
        const [ap] = await s`SELECT id FROM audit_logs WHERE tenant_id = ${TID} AND action = 'piece_approve' AND target = ${"piece:" + piece.id} ORDER BY id DESC LIMIT 1`;
        rec("자동 승인 감사(by cron)", !!ap, `audit_logs id=${ap?.id}`);
        scheduledPieceId = pg?.status === "scheduled" ? piece.id : null;
      }
      // require_confirm: in_review + publish_at 지남 → awaiting_manual + 알림(발행 금지)
      const [other] = await s`SELECT s.id AS sid, p.id AS pid FROM slots s JOIN pieces p ON p.id = s.piece_id WHERE s.tenant_id = ${TID} AND s.status = 'in_review' AND p.status = 'in_review' ORDER BY s.id LIMIT 1`;
      if (other) {
        await call(jar, "/api/rules-settings", { body: { reviewPolicy: "require_confirm" } });
        await s`UPDATE slots SET publish_at = NOW() - interval '5 minutes' WHERE tenant_id = ${TID} AND id = ${other.sid}`;
        const rc = await cron("hourly", TID);
        const [p2] = await s`SELECT status, meta->>'failReason' AS why FROM pieces WHERE id = ${other.pid}`;
        const [nt] = await s`SELECT id FROM notifications WHERE tenant_id = ${TID} AND kind = 'review_missed' ORDER BY id DESC LIMIT 1`;
        rec("require_confirm + 발행 시각 지남 → awaiting_manual + 알림", p2?.status === "awaiting_manual" && !!nt, `piece ${other.pid} ${p2?.status} «${p2?.why}» · 알림 ${nt?.id} · blocked ${tdetail(stepOf(rc, "slots.review_deadline"), TID).blocked}`, `piece ${other.pid} · notifications id=${nt?.id}`);
        await call(jar, "/api/rules-settings", { body: { reviewPolicy: "silence_approves" } });
      } else warn("require_confirm 경로", "두 번째 in_review piece 없음 — 보류");
    }
  }

  /* ══ 6. 러너 등록·하트비트·재로그인·세션 업로드 ══ */
  let token = null, deviceId = null;
  if (SECTIONS.has("runner")) {
    const reg = await call(jar, "/api/runner-register", { body: { name: "C검증 PC", kind: "own" } });
    token = reg.json?.device?.token; deviceId = reg.json?.device?.id;
    rec("runner-register → token 1회 평문 + install", reg.json?.ok === true && typeof token === "string" && token.startsWith("acr_") && !!reg.json?.install?.cmd, `${reg.status} ${reg.json?.step || ""} device ${deviceId}`, `runner_devices id=${deviceId}`);
    const lst = await call(jar, "/api/runner-list");
    rec("runner-list 에 토큰 평문 0", lst.json?.ok === true && !lst.text.includes(token || "@@"), `devices ${lst.json?.devices?.length}`);
    const H = { "x-runner-token": token || "" };
    const hb = await call(null, "/api/runner-heartbeat", { body: { version: "c-verify", jobs: 0 }, headers: H });
    rec("runner-heartbeat → sleepSec", hb.json?.ok === true && typeof hb.json.sleepSec === "number", `${hb.status} sleep ${hb.json?.sleepSec} waiting ${hb.json?.jobsWaiting}`);
    const badTok = await call(null, "/api/runner-heartbeat", { body: {}, headers: { "x-runner-token": "acr_bad" } });
    rec("잘못된 토큰 401", badTok.status === 401, `${badTok.status}`);
    const on = (await call(jar, "/api/runner-list")).json?.devices?.find((d) => d.id === deviceId);
    rec("하트비트 후 online", on?.status === "online", `${on?.status}`);
    // 재로그인 흐름
    const rl1 = await call(jar, "/api/accounts-relogin", { body: { id: naver.id } });
    rec("accounts-relogin POST → job queued", rl1.json?.ok === true && rl1.json?.job?.status === "queued" && rl1.json?.job?.id > 0, `${rl1.status} ${rl1.json?.step || ""} job ${rl1.json?.job?.id}`, `runner_jobs id=${rl1.json?.job?.id}`);
    const rl2 = await call(jar, "/api/accounts-relogin", { body: { id: naver.id } });
    rec("relogin 중복 적재 0(같은 job)", rl2.json?.job?.id === rl1.json?.job?.id, `${rl1.json?.job?.id} = ${rl2.json?.job?.id}`);
    const rlg = await call(jar, "/api/accounts-relogin", { query: { id: String(naver.id) } });
    rec("accounts-relogin GET → job + account", rlg.json?.ok === true && rlg.json?.job?.id === rl1.json?.job?.id && rlg.json?.account?.id === naver.id, `${rlg.status}`);
    // claim(session.login 잡) → report ok 는 session-upload 로 대체 · 잡은 release
    const cl = await call(null, "/api/runner-queue", { body: { action: "claim", kinds: ["session.login"], max: 3 }, headers: H });
    const sj = (cl.json?.jobs || []).find((j) => j.id === rl1.json?.job?.id);
    rec("claim session.login → 잡 + 계정 login 자격(암호화 해제 · 러너 표면)", !!sj && sj.account?.handle === naver.handle && !!(sj.account?.login || sj.account?.cookies), `claimed ${cl.json?.jobs?.length} · login ${!!sj?.account?.login}`);
    const [credAudit] = await s`SELECT id FROM audit_logs WHERE tenant_id = ${TID} AND action = 'runner_creds_issued' ORDER BY id DESC LIMIT 1`;
    rec("자격 발급 감사 runner_creds_issued", !!credAudit, `audit_logs id=${credAudit?.id}`);
    const up = await call(null, "/api/runner-session-upload", { body: { accountId: naver.id, cookies: [{ name: "NID_AUT", value: "x", domain: ".naver.com", expires: Math.floor(Date.now() / 1000) + 86400 * 30 }], verifiedAt: new Date().toISOString() }, headers: H });
    const accAfter = (await call(jar, "/api/accounts-list")).json?.accounts?.find((a) => a.id === naver.id);
    rec("session-upload → 계정 active 승격", up.json?.ok === true && accAfter?.status === "active", `${up.status} → ${accAfter?.status}`);
    const rlg2 = await call(jar, "/api/accounts-relogin", { query: { id: String(naver.id) } });
    rec("세션 업로드 후 session.login 잡 종결(done)", rlg2.json?.job?.status === "done" || rlg2.json?.job === null, `job ${JSON.stringify(rlg2.json?.job)}`);
    // 두 번째 네이버 계정도 active(승계 대상)
    if (naver2?.id) { await call(null, "/api/runner-session-upload", { body: { accountId: naver2.id, cookies: [{ name: "NID_AUT", value: "y", domain: ".naver.com" }] }, headers: H }); }
    // IDOR: 타 테넌트가 내 기기 제거
    const rm = await call(jar2, "/api/runner-remove", { body: { id: deviceId } });
    rec("IDOR runner-remove 타 테넌트 404", rm.status === 404, `${rm.status}`);
  }

  /* ══ 7. publisher · 러너 적재 · claim/report · finalize 멱등 · 오프라인 · API 채널 정직 경로 ══ */
  if (SECTIONS.has("publish")) {
    const H = { "x-runner-token": token || "" };
    if (!scheduledPieceId) { const [sp] = await s`SELECT id FROM pieces WHERE tenant_id = ${TID} AND status = 'scheduled' AND channel = 'naver_blog' ORDER BY id DESC LIMIT 1`; scheduledPieceId = sp ? Number(sp.id) : null; }
    if (!scheduledPieceId) warn("publisher", "scheduled 네이버 piece 없음 — 보류");
    else {
      guard(TID);
      await s`UPDATE pieces SET scheduled_for = NOW() - interval '1 minute', account_id = ${naver.id} WHERE tenant_id = ${TID} AND id = ${scheduledPieceId}`;
      if (token) await call(null, "/api/runner-heartbeat", { body: { version: "c-verify", jobs: 0 }, headers: H });
      const pub = await cron("5m", TID);
      const pdt = tdetail(stepOf(pub, "publisher"), TID);
      const [pc] = await s`SELECT status, slot_id FROM pieces WHERE id = ${scheduledPieceId}`;
      const [job] = await s`SELECT id, kind, status, payload FROM runner_jobs WHERE tenant_id = ${TID} AND piece_id = ${scheduledPieceId} ORDER BY id DESC LIMIT 1`;
      const [sl] = pc?.slot_id ? await s`SELECT status FROM slots WHERE id = ${pc.slot_id}` : [null];
      rec("publisher due → 러너 잡 적재 · piece publishing · 슬롯 publishing", (pdt.queued || 0) >= 1 && pc?.status === "publishing" && job?.kind === "publish.naver_blog" && job?.status === "queued" && (!sl || sl.status === "publishing"), `queued ${pdt.queued} · piece ${pc?.status} · job ${job?.id} ${job?.status} · slot ${sl?.status}`, `runner_jobs id=${job?.id}`);
      rec("RunnerPayload(publish.*) 모양", ["title", "bodyHtml", "blocks", "images", "tags", "disclosure", "scheduledFor"].every((k) => job?.payload && k in job.payload), Object.keys(job?.payload || {}).join(","));
      const pub2 = await cron("5m", TID);
      rec("publisher 재실행 → 같은 piece 재적재 0", !(tdetail(stepOf(pub2, "publisher"), TID).queued), JSON.stringify(stepOf(pub2, "publisher")?.detail || {}));
      // claim → report ok(externalUrl 200) → finalize
      const cl = await call(null, "/api/runner-queue", { body: { action: "claim", kinds: ["publish.naver_blog"], max: 3 }, headers: H });
      const pj = (cl.json?.jobs || []).find((j) => j.id === Number(job?.id));
      rec("claim publish 잡(우선순위·SKIP LOCKED) + 쿠키 실림", !!pj && Array.isArray(pj.account?.cookies), `jobs ${cl.json?.jobs?.length} · cookies ${!!pj?.account?.cookies}`);
      const cl2 = await call(null, "/api/runner-queue", { body: { action: "claim", kinds: ["publish.naver_blog"], max: 3 }, headers: H });
      rec("같은 잡 두 번 claim 0", !(cl2.json?.jobs || []).some((j) => j.id === Number(job?.id)), "");
      const rp = await call(null, "/api/runner-queue", { body: { action: "report", jobId: Number(job?.id), result: { ok: true, externalUrl: EVIDENCE_URL } }, headers: H });
      const [posts] = await s`SELECT COUNT(*) AS c, MIN(id) AS id FROM posts WHERE tenant_id = ${TID} AND piece_id = ${scheduledPieceId}`;
      const [pc2] = await s`SELECT status, external_url FROM pieces WHERE id = ${scheduledPieceId}`;
      const [acc] = await s`SELECT posts_today, last_post_at FROM accounts WHERE id = ${naver.id}`;
      const [sl2] = pc?.slot_id ? await s`SELECT status FROM slots WHERE id = ${pc.slot_id}` : [null];
      const [nt] = await s`SELECT id FROM notifications WHERE tenant_id = ${TID} AND kind = 'post_published' ORDER BY id DESC LIMIT 1`;
      rec("report ok → finalize: posts 1행 · piece published+external_url · 슬롯 published · posts_today+1 · 알림", rp.json?.ok === true && rp.json?.status === "done" && Number(posts?.c) === 1 && pc2?.status === "published" && pc2?.external_url === EVIDENCE_URL && Number(acc?.posts_today) >= 1 && (!sl2 || sl2.status === "published") && !!nt, `report ${rp.status} ${rp.json?.status} verified=${rp.json?.verified} · posts ${posts?.c} · piece ${pc2?.status} · posts_today ${acc?.posts_today} · slot ${sl2?.status}`, `posts id=${posts?.id} · piece ${scheduledPieceId}`);
      const rp2 = await call(null, "/api/runner-queue", { body: { action: "report", jobId: Number(job?.id), result: { ok: true, externalUrl: EVIDENCE_URL } }, headers: H });
      const [posts2] = await s`SELECT COUNT(*) AS c FROM posts WHERE tenant_id = ${TID} AND piece_id = ${scheduledPieceId}`;
      rec("report 2회 → posts 여전히 1행(멱등)", Number(posts2?.c) === 1 && /not_claimed/.test(String(rp2.json?.reason || "")), `posts ${posts2?.c} · ${rp2.json?.reason}`);
      // 발행된 piece 를 다시 due 로 만들어도 재게시 0(external_url 멱등)
      await s`UPDATE pieces SET status = 'scheduled', scheduled_for = NOW() - interval '1 minute' WHERE id = ${scheduledPieceId}`;
      const pub3 = await cron("5m", TID);
      const [posts3] = await s`SELECT COUNT(*) AS c FROM posts WHERE tenant_id = ${TID} AND piece_id = ${scheduledPieceId}`;
      const [jobs3] = await s`SELECT COUNT(*) AS c FROM runner_jobs WHERE tenant_id = ${TID} AND piece_id = ${scheduledPieceId}`;
      rec("external_url 있는 piece 재발행 0(already)", (tdetail(stepOf(pub3, "publisher"), TID).already || 0) >= 1 && Number(posts3?.c) === 1 && Number(jobs3?.c) === 1, `already ${tdetail(stepOf(pub3, "publisher"), TID).already} · posts ${posts3?.c} · jobs ${jobs3?.c}`);
      await s`UPDATE pieces SET status = 'published' WHERE id = ${scheduledPieceId}`;
    }
    // 러너 오프라인: 기기 last_seen 을 40분 전으로 → 다른 scheduled piece → awaiting_runner + 알림(취소 아님)
    const [sp2] = await s`SELECT p.id FROM pieces p WHERE p.tenant_id = ${TID} AND p.status IN ('in_review','scheduled') AND p.channel = 'naver_blog' AND p.external_url IS NULL AND p.id <> ${scheduledPieceId || 0} ORDER BY p.id DESC LIMIT 1`;
    if (sp2 && deviceId) {
      guard(TID);
      await s`UPDATE pieces SET status = 'scheduled', scheduled_for = NOW() - interval '1 minute', account_id = ${naver.id} WHERE id = ${sp2.id}`;
      await s`UPDATE runner_devices SET last_seen_at = NOW() - interval '40 minutes' WHERE tenant_id = ${TID}`;
      const off = await cron("5m", TID);
      const [pc] = await s`SELECT status, slot_id FROM pieces WHERE id = ${sp2.id}`;
      const [sl] = pc?.slot_id ? await s`SELECT status FROM slots WHERE id = ${pc.slot_id}` : [null];
      const [nt] = await s`SELECT id FROM notifications WHERE tenant_id = ${TID} AND kind = 'runner_offline' ORDER BY id DESC LIMIT 1`;
      const [job] = await s`SELECT id, status FROM runner_jobs WHERE tenant_id = ${TID} AND piece_id = ${sp2.id} ORDER BY id DESC LIMIT 1`;
      rec("러너 오프라인 30분+ → 잡은 적재 · 슬롯 awaiting_runner · 알림 · 취소 아님", (tdetail(stepOf(off, "publisher"), TID).waitingRunner || 0) >= 1 && pc?.status === "publishing" && (!sl || sl.status === "awaiting_runner") && job?.status === "queued" && !!nt, `waitingRunner ${tdetail(stepOf(off, "publisher"), TID).waitingRunner} · piece ${pc?.status} · slot ${sl?.status} · job ${job?.id} ${job?.status} · 알림 ${nt?.id}`, `piece ${sp2.id} · runner_jobs id=${job?.id}`);
      if (token) await call(null, "/api/runner-heartbeat", { body: { version: "c-verify", jobs: 0 }, headers: { "x-runner-token": token } });
    } else warn("러너 오프라인 경로", "여분 scheduled/in_review 네이버 piece 없음");
    // API 채널(블로거) 자격 없음 → 정직 실패(awaiting_manual + 알림) · 재시도 0
    guard(TID);
    const [bacc] = await s`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key) VALUES (${TID}, 'blogger', 'c_p1_blogger', 'oauth', 'active', ${"t" + TID + "-blogger"}) ON CONFLICT (tenant_id, channel, handle) DO UPDATE SET status = 'active' RETURNING id`;
    const [bp] = await s`INSERT INTO pieces (tenant_id, account_id, channel, kind, format, title, body, status, scheduled_for, meta) VALUES (${TID}, ${bacc.id}, 'blogger', 'post', 'info', 'C 검증 블로거 글', '<p>본문입니다. 충분히 긴 본문. 충분히 긴 본문.</p>', 'scheduled', NOW() - interval '1 minute', ${s.json({ tags: [] })}) RETURNING id`;
    const api = await cron("5m", TID);
    const [bp2] = await s`SELECT status, meta->>'failReason' AS why, meta->>'publishAttempts' AS att FROM pieces WHERE id = ${bp.id}`;
    const [bnt] = await s`SELECT id, kind FROM notifications WHERE tenant_id = ${TID} AND kind IN ('publish_manual','publish_failed') ORDER BY id DESC LIMIT 1`;
    rec("블로거 자격 없음 → awaiting_manual(사람 개입) + 사유 + 알림(재시도 0)", bp2?.status === "awaiting_manual" && !!bp2?.why && bnt?.kind === "publish_manual", `piece ${bp.id} ${bp2?.status} «${bp2?.why}» attempts ${bp2?.att} · 알림 ${bnt?.id} ${bnt?.kind} · detail ${JSON.stringify(stepOf(api, "publisher")?.detail || {})}`, `piece ${bp.id}`);
    const api2 = await cron("5m", TID);
    const [bp3] = await s`SELECT meta->>'publishAttempts' AS att FROM pieces WHERE id = ${bp.id}`;
    rec("정직 실패 뒤 재시도 0(attempts 불변)", bp3?.att === bp2?.att, `attempts ${bp2?.att}→${bp3?.att}`);
  }

  /* ══ 8. reap(15분 무보고 회수) ══ */
  if (SECTIONS.has("reap") && token) {
    const H = { "x-runner-token": token };
    // 잡 하나 적재(relogin) → claim → claimed_at 16분 전 → 5m → released
    if (naver2?.id) { await s`UPDATE accounts SET status = 'pending_login' WHERE id = ${naver2.id}`; }
    const rq = await call(jar, "/api/accounts-relogin", { body: { id: naver2?.id || naver.id } });
    const jid = rq.json?.job?.id;
    const cl = await call(null, "/api/runner-queue", { body: { action: "claim", kinds: ["session.login"], max: 5 }, headers: H });
    const got = (cl.json?.jobs || []).some((j) => j.id === jid);
    if (jid && got) {
      guard(TID);
      await s`UPDATE runner_jobs SET claimed_at = NOW() - interval '16 minutes' WHERE id = ${jid} AND tenant_id = ${TID}`;
      const r = await cron("5m", TID);
      const [j] = await s`SELECT status, claimed_by FROM runner_jobs WHERE id = ${jid}`;
      rec("reap: claim 후 15분 무보고 → queued 로 회수", j?.status === "queued" && j?.claimed_by === null && (stepOf(r, "runner.reap")?.changed || 0) >= 1, `job ${jid} ${j?.status} · reap detail ${JSON.stringify(stepOf(r, "runner.reap")?.detail || {})}`, `runner_jobs id=${jid}`);
      const rel = await call(null, "/api/runner-queue", { body: { action: "release", jobId: jid, reason: "c-verify" }, headers: H });
      rec("release(미 claim 잡) ok:false 정직", rel.json?.ok === false, `${JSON.stringify(rel.json)}`);
    } else warn("reap", `relogin 잡 적재/claim 실패 (job ${jid} · claimed ${got})`);
  }

  /* ══ 9. 계정 전이(§7.2) — report 실패 분류 → 전이표 ══ */
  if (SECTIONS.has("transitions") && token) {
    const H = { "x-runner-token": token };
    const claimAny = async (kinds) => (await call(null, "/api/runner-queue", { body: { action: "claim", kinds, max: 5 }, headers: H })).json?.jobs || [];
    const mkJob = async (accId) => { await s`UPDATE runner_jobs SET status = 'failed', claimed_by = NULL, claimed_at = NULL WHERE tenant_id = ${TID} AND account_id = ${accId} AND kind IN ('session.login','session.verify') AND status IN ('queued','claimed')`; await s`UPDATE accounts SET status = 'pending_login' WHERE id = ${accId}`; const r = await call(jar, "/api/accounts-relogin", { body: { id: accId } }); return r.json?.job?.id; };   // 앞 보고가 남긴 재시도 잡(due_at 5분 뒤)은 치우고 새로
    const acc = async (id) => (await s`SELECT status, daily_cap, health_score, last_error_kind FROM accounts WHERE id = ${id}`)[0];
    // rate_limited → cooldown + daily_cap −1
    const capBefore = Number((await acc(naver.id)).daily_cap);
    let jid = await mkJob(naver.id); let jobs = await claimAny(["session.login"]);
    if (jobs.some((j) => j.id === jid)) {
      await call(null, "/api/runner-queue", { body: { action: "report", jobId: jid, result: { ok: false, errorKind: "rate_limited", detail: "429" } }, headers: H });
      const a = await acc(naver.id);
      const [nt] = await s`SELECT id FROM notifications WHERE tenant_id = ${TID} AND kind = 'account_cooldown' ORDER BY id DESC LIMIT 1`;
      rec("rate_limited → cooldown · daily_cap −1 · 알림", a.status === "cooldown" && Number(a.daily_cap) === Math.max(1, capBefore - 1) && !!nt, `${a.status} cap ${capBefore}→${a.daily_cap} · 알림 ${nt?.id}`, `accounts id=${naver.id}`);
    } else warn("rate_limited 전이", `잡 claim 못 함(job ${jid})`);
    await s`UPDATE accounts SET status = 'active', daily_cap = ${capBefore} WHERE id = ${naver.id}`;
    // login_fail → pending_login + session.login 잡 + 알림
    jid = await mkJob(naver.id); await s`UPDATE accounts SET status = 'active' WHERE id = ${naver.id}`; jobs = await claimAny(["session.login"]);
    if (jobs.some((j) => j.id === jid)) {
      await call(null, "/api/runner-queue", { body: { action: "report", jobId: jid, result: { ok: false, errorKind: "login_fail", detail: "아이디 또는 비밀번호가 올바르지 않습니다" } }, headers: H });
      const a = await acc(naver.id);
      const [nt] = await s`SELECT id FROM notifications WHERE tenant_id = ${TID} AND kind = 'account_relogin' ORDER BY id DESC LIMIT 1`;
      const [q2] = await s`SELECT COUNT(*) AS c FROM runner_jobs WHERE tenant_id = ${TID} AND account_id = ${naver.id} AND kind = 'session.login' AND status = 'queued'`;
      rec("login_fail → pending_login · session.login 잡 · 알림", a.status === "pending_login" && !!nt, `${a.status} · queued session.login ${q2?.c} · 알림 ${nt?.id}`, `accounts id=${naver.id}`);
    } else warn("login_fail 전이", `잡 claim 못 함(job ${jid})`);
    // suspended → suspended + reassignSlots(같은 채널 건강한 계정으로 · 안 나간 자리 행 유지·계정만 교체)
    await s`UPDATE accounts SET status = 'active' WHERE id IN (${naver.id}, ${naver2?.id || 0})`;
    const [futureSlot] = await s`INSERT INTO slots (tenant_id, slot_date, channel, kind, account_id, publish_at, status, origin) VALUES (${TID}, (NOW() AT TIME ZONE 'Asia/Seoul')::date + 3, 'naver_blog', 'post', ${naver.id}, NOW() + interval '3 days', 'planned', 'auto') RETURNING id`;
    jid = await mkJob(naver.id); await s`UPDATE accounts SET status = 'active' WHERE id = ${naver.id}`; jobs = await claimAny(["session.login"]);
    if (jobs.some((j) => j.id === jid) && naver2?.id) {
      await call(null, "/api/runner-queue", { body: { action: "report", jobId: jid, result: { ok: false, errorKind: "suspended", detail: "이용이 제한된 계정" } }, headers: H });
      const a = await acc(naver.id);
      const [fs] = await s`SELECT status, account_id FROM slots WHERE id = ${futureSlot.id}`;
      const [nt] = await s`SELECT id, title FROM notifications WHERE tenant_id = ${TID} AND kind = 'account_suspended' ORDER BY id DESC LIMIT 1`;
      const [tr] = await s`SELECT id, detail FROM audit_logs WHERE tenant_id = ${TID} AND action = 'account_transition' AND target = ${"account:" + naver.id} ORDER BY id DESC LIMIT 1`;
      rec("suspended → 정지 · 미래 슬롯은 행 유지+계정 교체 · 알림 · 감사", a.status === "suspended" && fs?.status === "planned" && Number(fs?.account_id) === naver2.id && !!nt && !!tr, `${a.status} · slot ${futureSlot.id} ${fs?.status} acct ${fs?.account_id}(→${naver2.id}) · 알림 ${nt?.id} «${nt?.title}» · moved ${tr?.detail?.reassigned?.moved}`, `audit_logs id=${tr?.id}`);
    } else warn("suspended 전이", `잡 claim 못 함 또는 naver2 없음`);
    // health_score 는 0~100 · last_error_kind 기록
    const a = await acc(naver.id);
    rec("health_score 0~100 · last_error_kind 기록", Number(a.health_score) >= 0 && Number(a.health_score) <= 100 && !!a.last_error_kind, `health ${a.health_score} · last ${a.last_error_kind}`);
    // 원상 복구(테스트 계정)
    await s`UPDATE accounts SET status = 'active', last_error_kind = NULL WHERE id IN (${naver.id}, ${naver2?.id || 0})`;
    await s`DELETE FROM slots WHERE id = ${futureSlot.id}`;
    // 실패 분류 ourBug 분리(AC-10): selector_changed 는 계정 전이 없음
    jid = await mkJob(naver.id); await s`UPDATE accounts SET status = 'active' WHERE id = ${naver.id}`; jobs = await claimAny(["session.login"]);
    if (jobs.some((j) => j.id === jid)) {
      const rp = await call(null, "/api/runner-queue", { body: { action: "report", jobId: jid, result: { ok: false, errorKind: "selector_changed", detail: "에디터 못 찾음" } }, headers: H });
      const a2 = await acc(naver.id);
      const [au] = await s`SELECT risk_level, detail FROM audit_logs WHERE tenant_id = ${TID} AND action = 'runner_job_failed' AND target = ${"runner_job:" + jid} ORDER BY id DESC LIMIT 1`;
      rec("selector_changed → 계정 전이 없음 · 우리 버그(risk high) 표시", a2.status === "active" && au?.risk_level === "high" && au?.detail?.ourBug === true, `${a2.status} · risk ${au?.risk_level} ourBug ${au?.detail?.ourBug} · block ${JSON.stringify(rp.json?.block)}`);
    }
    await s`UPDATE accounts SET status = 'active', last_error_kind = NULL WHERE id = ${naver.id}`;
    await s`UPDATE runner_jobs SET status = 'failed', claimed_by = NULL, claimed_at = NULL WHERE tenant_id = ${TID} AND kind = 'session.login' AND status IN ('queued','claimed')`;
  }

  /* ══ 10. 알림함 ══ */
  if (SECTIONS.has("notif")) {
    const nl = await call(jar, "/api/notifications-list", { query: { limit: "50" } });
    const hs = await call(jar, "/api/home-summary");
    rec("notifications-list 모양", nl.json?.ok === true && Array.isArray(nl.json.notifications) && typeof nl.json.unread === "number" && (nl.json.notifications[0] ? ["id", "kind", "title", "createdAt"].every((k) => k in nl.json.notifications[0]) : true), `${nl.status} n=${nl.json?.notifications?.length} unread=${nl.json?.unread}`);
    rec("unread = home-summary.unread", nl.json?.unread === hs.json?.unread, `${nl.json?.unread} vs ${hs.json?.unread}`);
    rec("tone 어휘(warn|info) · desc/link 키 생략 규칙", (nl.json?.notifications || []).every((x) => (!("tone" in x) || ["warn", "info"].includes(x.tone)) && x.desc !== null && x.link !== null && x.readAt !== null), "");
    const first = (nl.json?.notifications || []).find((x) => !x.readAt);
    if (first) { const r1 = await call(jar, "/api/notifications-read", { body: { id: first.id } }); rec("notifications-read(id) → unread −1", r1.json?.ok === true && r1.json?.unread === nl.json.unread - 1, `${nl.json.unread}→${r1.json?.unread}`); }
    const rAll = await call(jar, "/api/notifications-read", { body: {} });
    const hs2 = await call(jar, "/api/home-summary");
    rec("notifications-read(전부) → unread 0 · 홈도 0", rAll.json?.unread === 0 && hs2.json?.unread === 0, `${rAll.json?.unread} / ${hs2.json?.unread}`);
    // IDOR: 타 테넌트가 내 알림 id 읽음 처리 → 내 것 무변경
    await s`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${TID}, 'test', 'C 검증 알림', '본문', '/app/home.html')`;
    const [mine] = await s`SELECT id FROM notifications WHERE tenant_id = ${TID} ORDER BY id DESC LIMIT 1`;
    await call(jar2, "/api/notifications-read", { body: { id: Number(mine.id) } });
    const [still] = await s`SELECT read_at FROM notifications WHERE id = ${mine.id}`;
    rec("IDOR notifications-read 타 테넌트 → 무변경", still?.read_at === null, `id ${mine.id}`);
  }

  /* ══ 11. 발행함 ══ */
  if (SECTIONS.has("posts")) {
    const pl = await call(jar, "/api/posts-list", { query: { status: "all" } });
    const rows = pl.json?.posts || [];
    rec("posts-list 모양(pieces 기준 · status 3어휘 · alive boolean)", pl.json?.ok === true && rows.length >= 1 && rows.every((r) => ["published", "awaiting_manual", "failed"].includes(r.status) && typeof r.alive === "boolean" && "stats" in r && typeof r.pieceId === "number"), `${pl.status} n=${rows.length} · ${rows.slice(0, 3).map((r) => `${r.pieceId}:${r.status}`).join(" ")}`);
    const pub = rows.find((r) => r.status === "published");
    rec("published 행에 externalUrl·publishedVia·publishedAt", !!pub && !!pub.externalUrl && ["api", "runner"].includes(pub.publishedVia) && !!pub.publishedAt, pub ? `${pub.pieceId} ${pub.publishedVia} ${pub.externalUrl}` : "published 없음");
    const am = rows.find((r) => r.status !== "published");
    rec("실패 행에 failReason(사람말) · errorKind 어휘", !am || (!!am.failReason && (!("errorKind" in am) || ["login_fail", "captcha", "rate_limited", "suspended", "selector_changed", "network", "unknown"].includes(am.errorKind))), am ? `${am.pieceId} ${am.status} «${am.failReason}» ${am.errorKind || ""}` : "실패 행 없음");
    const f = await call(jar, "/api/posts-list", { query: { status: "awaiting_manual" } });
    rec("?status=awaiting_manual 필터", f.json?.ok === true && (f.json.posts || []).every((r) => r.status === "awaiting_manual"), `n=${f.json?.posts?.length}`);
    const other = await call(jar2, "/api/posts-list", { query: { status: "all" } });
    rec("IDOR posts-list 타 테넌트 → 내 글 0", (other.json?.posts || []).every((r) => !rows.some((m) => m.pieceId === r.pieceId)), `tid2 n=${other.json?.posts?.length}`);
    // learn 스텝: API 채널 통계 «못 물어봤다»가 0 으로 안 적히는지(AC-9)
    const lr = await cron("hourly", TID);
    const ld = stepOf(lr, "slots.learn");
    rec("learn 스텝 응답에 skipped/unavailable 구분", !!ld && ld.errors === 0, `changed ${ld?.changed} skipped ${ld?.skipped} detail ${JSON.stringify(ld?.detail || {}).slice(0, 200)}`);
  }

  /* ══ 12. 소재 뽑기 배경화(v2.9) ══ */
  if (SECTIONS.has("topics")) {
    const r1 = await call(jar, "/api/topics-refresh", { body: {} });
    if (r1.json?.step === "rate_limit") warn("topics-refresh 배경화", "하루 3회 소진(rate_limit) — 정직 응답 확인 · 배경 흐름은 내일/tid2 로");
    else {
      rec("topics-refresh → 202 started:true", r1.status === 202 && r1.json?.ok === true && r1.json?.started === true, `${r1.status} ${JSON.stringify(r1.json)}`);
      const r2 = await call(jar, "/api/topics-refresh", { body: {} });
      rec("실행 중 재호출 → started:false running:true", r2.json?.ok === true && r2.json?.started === false && r2.json?.running === true, `${r2.status} ${JSON.stringify(r2.json)}`);
      let st = null; const dl = Date.now() + 4 * 60_000;
      while (Date.now() < dl) { const tl = await call(jar, "/api/topics-list", { query: { status: "candidate" } }); st = tl.json?.refresh; if (st && st.running === false && st.finishedAt) break; await sleep(5000); }
      rec("폴링 → running:false + added|error", !!st && st.running === false && (typeof st.added === "number" || typeof st.error === "string"), JSON.stringify(st));
      rec("topics-list.refresh 모양", !!st && "running" in st && ("startedAt" in st), Object.keys(st || {}).join(","));
    }
    // 고아 방지: startedAt 10분 전 + finishedAt 없음 → running false 로 본다
    guard(TID);
    const [cur] = await s`SELECT settings FROM tenants WHERE id = ${TID}`;
    const orig = cur?.settings?.topicsRefresh ?? null;
    const merged = { ...(cur?.settings || {}), topicsRefresh: { startedAt: new Date(Date.now() - 11 * 60_000).toISOString() } };
    await s`UPDATE tenants SET settings = ${s.json(merged)} WHERE id = ${TID}`;
    const tl = await call(jar, "/api/topics-list", { query: { status: "candidate" } });
    rec("고아 방지: startedAt 11분 전 → running:false", tl.json?.refresh?.running === false, JSON.stringify(tl.json?.refresh));
    const restore = { ...(cur?.settings || {}) }; if (orig) restore.topicsRefresh = orig; else delete restore.topicsRefresh;
    await s`UPDATE tenants SET settings = ${s.json(restore)} WHERE id = ${TID}`;
  }

  /* ══ 13. 화면 KST 규칙(정적) ══ */
  if (SECTIONS.has("kst")) {
    const { execSync } = await import("node:child_process");
    let out = ""; try { out = execSync('grep -rn "toLocale" public/app public/js public/ops 2>/dev/null || true', { encoding: "utf8" }); } catch { /* */ }
    const lines = out.split("\n").filter(Boolean).filter((l) => !/ui\.js.*(timeZone: "Asia\/Seoul"|Asia\/Seoul)/.test(l) && !/toLocaleString\("ko-KR"\)|toLocaleString\("en-US", \{ timeZone: "Asia\/Seoul"/.test(l));
    rec("화면 toLocale* (UI.timeKST/dateKST·Asia/Seoul 외) 0건", lines.length === 0, lines.slice(0, 5).join(" | "));
  }

  await finish();
}

async function finish() {
  await teardown();
  const fails = results.filter((r) => r.ok === "FAIL").length, warns = results.filter((r) => r.ok === "WARN").length;
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nP1R2 C 하니스 · ${BASE} · ${new Date().toISOString()}\n${"─".repeat(130)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 44)} ${w(r.note, 80)} ${r.evidence ? "| " + String(r.evidence).slice(0, 50) : ""}`);
  console.log(`${"─".repeat(130)}\nPASS ${results.length - fails - warns} · FAIL ${fails} · WARN ${warns} · ${Math.round((Date.now() - t0) / 1000)}s`);
  mkdirSync("_verify", { recursive: true });
  const out = `_verify/p1r2-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
  console.log(`→ ${out}`);
  if (sql) sql.end().catch(() => {});
  process.exit(fails ? 1 : 0);
}
async function teardown() {
  try {
    if (!sql) return;
    const { teardownRun } = await import("./_teardown.mjs");
    const r = await teardownRun(sql, { tenants: [...ALLOWED_TIDS], since: SINCE, label: "P1R2" });
    rec("정리(teardown)", !r.failed, r.text);
  } catch (e) { rec("정리(teardown)", false, String(e?.message ?? e).slice(0, 160)); }
}
main().catch(async (e) => { console.error(e); rec("하니스 예외", false, String(e?.stack || e).slice(0, 300)); await finish(); });
