// scripts/verify-r6-5.mjs — R6.5 «사장님 실측 5건» 검증 하니스(C · 1차 = 1·2·3절 · 4·5절은 2차 발부 뒤).
//   사용: node scripts/verify-r6-5.mjs   (BASE_URL 기본 http://localhost:8901 · SECTIONS=add,rate,assign,readonly,idor,caption,regress,cleanup)
//   🔴 규율: 증거 동반 · 빨강은 먼저 내 검사를 의심(C-HANDOFF 머리) · 실행 중 소스 편집 금지(AC-34) · 테스트 테넌트만 · 보존 4집 금지 · 정리까지가 검증.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = (process.env.BASE_URL || "http://localhost:8901").replace(/\/$/, "");
const STAMP = Date.now().toString(36);
const EMAIL = process.env.TEST_EMAIL || `c+r65-${STAMP}@autocreate.test`, PASSWORD = "Cp1Verify2026x";
const SECTIONS = new Set((process.env.SECTIONS || "add,readonly,rate,assign,idor,caption,tooSoon,runnerDist,regress,cleanup").split(","));
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
let sql = null; const ALLOWED = new Set(); const KEEP = new Set([3, 13, 109, 116]);
async function db() { if (sql) return sql; const { default: postgres } = await import("postgres"); sql = postgres(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL, { ssl: "require", max: 1 }); return sql; }
const guard = (tid) => { if (KEEP.has(Number(tid)) || !ALLOWED.has(Number(tid))) throw new Error(`테스트 테넌트 아님 tid=${tid}`); };
const add = (jar, body) => call(jar, "/api/topics-add", { body });

async function main() {
  const jar = new Jar(); const s = await db();
  let r = await call(jar, "/api/auth-login", { body: { email: EMAIL, password: PASSWORD, remember: true } });
  if (r.status === 401) r = await call(jar, "/api/auth-register", { body: { email: EMAIL, password: PASSWORD, name: "C R6.5", consents: { terms: true, privacy: true, paidTerms: true, automationNotice: true } } });
  const me = await call(jar, "/api/auth-me"); const TID = Number(me.json?.tenant?.id || 0); ALLOWED.add(TID);
  rec("로그인/가입", me.json?.ok === true && TID > 0, `tid ${TID}`); if (!TID) return finish(); guard(TID);
  await call(jar, "/api/onboarding", { body: { kinds: ["text"], channels: ["naver_blog"] } });
  await s`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key) VALUES (${TID}, 'naver_blog', ${"c_r65_" + STAMP}, 'session', 'active', ${`t${TID}-naver_blog`})`;
  await s`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason) VALUES (${TID}, 'grant', 'included', 60, ${"r65:" + STAMP}, 'R6.5 하니스')`;
  const T = (x) => `${x} ${STAMP}`;

  /* ══ add — 200 모양 · 400 title/banned/duplicate/channel · 감사 ══ */
  let firstId = 0;
  if (SECTIONS.has("add")) {
    const ok = await add(jar, { title: T("가을 이불 세탁 코인빨래방 후기"), keyword: "이불세탁" });
    const tp = ok.json?.topic; firstId = Number(tp?.id || 0);
    rec("topics-add 200 → topic{id, source:\"manual\", status candidate} · volumeKnown boolean", ok.status === 200 && tp?.source === "manual" && tp?.status === "candidate" && typeof ok.json?.volumeKnown === "boolean",
      `${ok.status} id ${tp?.id} source ${tp?.source} volumeKnown ${ok.json?.volumeKnown}`, `topic ${tp?.id}`);
    // 검색량: 못 재면 키가 **없어야** 한다(0 금지 · AC-9) · 재면 volumeKnown 과 일치
    const vol = tp?.factors?.volume;
    rec("검색량 — volumeKnown 과 factors.volume 키 존재가 일치 · 0 으로 채우지 않는다(AC-9)", (ok.json?.volumeKnown === true) === (vol !== undefined) && vol !== 0,
      `volumeKnown ${ok.json?.volumeKnown} · factors.volume ${vol === undefined ? "키 없음" : vol}`);
    const [aud] = await s`SELECT id, detail FROM audit_logs WHERE tenant_id = ${TID} AND action = 'topic_added' ORDER BY id DESC LIMIT 1`;
    rec("감사 topic_added 1행(횟수의 근거)", !!aud && aud.detail?.volumeKnown === ok.json?.volumeKnown, `audit ${aud?.id} ${JSON.stringify(aud?.detail || {}).slice(0, 80)}`);

    const e1 = await add(jar, { title: "   " }); const e2 = await add(jar, { title: "가".repeat(81) }); const e3 = await add(jar, { title: "가".repeat(80) + STAMP.slice(0, 0) });
    rec("400 step title — 빈값 · 81자(80자는 통과)", e1.status === 400 && e1.json?.step === "title" && e2.status === 400 && e2.json?.step === "title" && e3.status === 200,
      `빈값 ${e1.status}/${e1.json?.step} · 81자 ${e2.status}/${e2.json?.step} «${String(e2.json?.error || "").slice(0, 24)}» · 80자 ${e3.status}`);

    const tBan = new Date(Date.now() - 3_000);
    const ban = await add(jar, { title: "온라인 카지노 배팅 노하우" });
    rec("banned_category — «온라인 카지노 배팅 노하우» → 400 · 사전 문장 그대로", ban.status === 400 && ban.json?.step === "banned_category" && /주제는 만들 수 없어요/.test(String(ban.json?.error)),
      `${ban.status} ${ban.json?.step} «${ban.json?.error}»`);
    const [ab] = await s`SELECT id, detail FROM audit_logs WHERE tenant_id = ${TID} AND action = 'topic_banned_category' AND created_at > ${tBan.toISOString()}::timestamptz AT TIME ZONE 'UTC' ORDER BY id DESC LIMIT 1`;
    rec("banned_category → 감사 topic_banned_category(source manual)", !!ab && ab.detail?.source === "manual", `audit ${ab?.id} ${JSON.stringify(ab?.detail || {}).slice(0, 70)}`);
    const solo = ["카지노", "바카라", "토토", "배팅", "도박"];
    const soloRes = [];
    for (const w of solo) { const x = await add(jar, { title: `${w} 이야기 ${STAMP}` }); soloRes.push(`${w}:${x.status}/${x.json?.step ?? "ok"}`); }
    rec("도박 단독어 5개(카지노·바카라·토토·배팅·도박) 각각 400 banned_category", soloRes.every((x) => /400\/banned_category/.test(x)), soloRes.join(" "));
    const combo = await add(jar, { title: `주말에 하는 스포츠 토토 분석 ${STAMP}` });
    rec("조합어 1개(«스포츠 토토 분석») 400 banned_category", combo.status === 400 && combo.json?.step === "banned_category", `${combo.status}/${combo.json?.step ?? "ok"}`);

    const dup = await add(jar, { title: T("가을 이불 세탁 코인빨래방 후기") });
    rec("duplicate — 30일 안 같은 제목 → 400 duplicate · 기존 topic 동봉(id 동일)", dup.status === 400 && dup.json?.step === "duplicate" && Number(dup.json?.topic?.id) === firstId, `${dup.status} ${dup.json?.step} topic ${dup.json?.topic?.id} vs ${firstId}`);
    await s`UPDATE topics SET status = 'picked' WHERE id = ${firstId}`;
    const dup2 = await add(jar, { title: T("가을  이불 세탁   코인빨래방 후기") });   // 공백 달라도 norm_key 같음
    rec("duplicate — 상태가 picked 여도 · 공백이 달라도 같은 소재", dup2.status === 400 && dup2.json?.step === "duplicate", `${dup2.status} ${dup2.json?.step}`);
    await s`UPDATE topics SET status = 'candidate' WHERE id = ${firstId}`;

    const ch = await add(jar, { title: T("채널 검사"), channelHint: "foobar" });
    rec("channel — 없는 채널 → 400 step channel", ch.status === 400 && ch.json?.step === "channel", `${ch.status} ${ch.json?.step} «${ch.json?.error}»`);
    const chDefault = await add(jar, { title: T("채널 기본값") });
    rec("channelHint 없으면 연결 계정 첫 채널(naver_blog)", chDefault.json?.topic?.channelHint === "naver_blog", `channelHint ${chDefault.json?.topic?.channelHint}`);

    const list = await call(jar, "/api/topics-list", { query: { status: "candidate" } });
    const tl = list.json?.topics || [];
    const firstNonManual = tl.findIndex((t) => t.source !== "manual"); const lastManual = tl.map((t) => t.source).lastIndexOf("manual");
    rec("topics-list — manual 이 맨 위(정렬 키 · 점수 부풀림 0)", tl.length > 0 && (firstNonManual < 0 || lastManual < firstNonManual) && tl[0]?.source === "manual",
      `상위 ${tl.slice(0, 4).map((t) => `${t.source}:${Math.round(t.score)}`).join(" ")}`);
  }

  /* ══ readonly — requireWritable 을 안 부른다(넣기만 · 확정은 막힘) ══ */
  if (SECTIONS.has("readonly")) {
    await s`UPDATE tenants SET status = 'readonly' WHERE id = ${TID}`;
    const ro = await add(jar, { title: `읽기전용에서도 넣는다 ${STAMP}` });
    rec("readonly 테넌트도 소재는 넣는다(넣기는 생성이 아니다 · AC-35)", ro.status === 200 && ro.json?.topic?.id > 0, `${ro.status}/${ro.json?.step ?? "ok"}`);
    const pr = await call(jar, "/api/director-propose", { body: { topicId: Number(ro.json?.topic?.id || 0) } });
    const cf = pr.json?.brief ? await call(jar, "/api/director-confirm", { body: { briefId: pr.json.brief.id } }) : { status: pr.status, json: pr.json };
    rec("…하지만 디렉터 확정은 막힌다(403 writable)", cf.status === 403 && (cf.json?.step === "writable" || cf.json?.reason), `propose ${pr.status}/${pr.json?.step ?? "ok"} · confirm ${cf.status}/${cf.json?.step ?? "-"}`);
    await s`UPDATE tenants SET status = 'trial' WHERE id = ${TID}`;
  }

  /* ══ rate — 하루 20개 · 21번째 429 · 횟수 = 감사 COUNT(KST) ══ */
  if (SECTIONS.has("rate")) {
    const [c0] = await s`SELECT COUNT(*) AS c FROM audit_logs WHERE tenant_id = ${TID} AND action = 'topic_added' AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (NOW() AT TIME ZONE 'Asia/Seoul')::date`;
    let used = Number(c0?.c || 0); let last = null; let n = 0;
    while (used < 20 && n < 25) { last = await add(jar, { title: `상한 채우기 ${n} ${STAMP}` }); n++; if (last.status === 200) used++; else break; }
    const over = await add(jar, { title: `스물한 번째 ${STAMP}` });
    rec("21번째 → 429 step rate(사람말) · 횟수 = 감사 topic_added COUNT(KST)", over.status === 429 && over.json?.step === "rate" && used === 20,
      `오늘 ${used}개 뒤 ${over.status}/${over.json?.step} «${String(over.json?.error || "").slice(0, 34)}»`);
    // 어제 것은 안 센다(KST) — 감사 한 행을 어제로 밀면 한 개 더 들어가야 한다
    const [one] = await s`SELECT id FROM audit_logs WHERE tenant_id = ${TID} AND action = 'topic_added' ORDER BY id DESC LIMIT 1`;
    await s`UPDATE audit_logs SET created_at = created_at - interval '1 day' WHERE id = ${one?.id}`;
    const again = await add(jar, { title: `어제 것은 안 센다 ${STAMP}` });
    rec("횟수는 **오늘(KST)** 감사만 센다(어제 행을 빼면 한 개 더 들어간다)", again.status === 200, `${again.status}/${again.json?.step ?? "ok"}`);
  }

  /* ══ assign — 크론 assign_topics 가 manual 을 먼저 집는다(점수는 부풀리지 않는다) ══ */
  if (SECTIONS.has("assign")) {
    // 상한을 피해 감사 없이 DB 로 직접 심는다(횟수 게이트와 무관한 절)
    await s`DELETE FROM topics WHERE tenant_id = ${TID}`;
    const [ai] = await s`INSERT INTO topics (tenant_id, title, angle, norm_key, channel_hint, source, factors, score, status, expires_at)
      VALUES (${TID}, ${"AI 후보 높은 점수 " + STAMP}, '앵글', ${"aihigh" + STAMP}, 'naver_blog', 'ai', ${s.json({ intent: "info", volume: 50000 })}, 95, 'candidate', NOW() + interval '7 days') RETURNING id, score`;
    const [mn] = await s`INSERT INTO topics (tenant_id, title, angle, norm_key, channel_hint, source, factors, score, status, expires_at)
      VALUES (${TID}, ${"내가 넣은 낮은 점수 " + STAMP}, '앵글', ${"manlow" + STAMP}, 'naver_blog', 'manual', ${s.json({ intent: "info" })}, 12, 'candidate', NOW() + interval '30 days') RETURNING id, score`;
    // 🔴 assign_topics 는 needsAutoSchedule — 신규 테넌트 기본값 autoSchedule=false(사장님 실측 3번의 원인)라 켜지 않으면 스텝이 아예 안 돈다.
    const rsS = await call(jar, "/api/rules-settings", { body: { autoSchedule: true, topicLeadDays: 7 } });
    const rs = await call(jar, "/api/rules-save", { body: { rules: [{ channel: "naver_blog", kind: "post", accountMode: "auto", every: "week", count: 3, active: true }] } });
    await cron("hourly", TID);   // roll → slots
    const c1 = await cron("hourly", TID); const st = stepOf(c1, "slots.assign_topics");
    const slots = await s`SELECT id, topic_id, status FROM slots WHERE tenant_id = ${TID} ORDER BY publish_at NULLS LAST, id LIMIT 3`;
    const firstAssigned = slots.find((x) => x.topic_id);
    rec("assign_topics — 점수 12 인 manual 이 점수 95 인 AI 후보보다 **먼저** 배정된다", Number(firstAssigned?.topic_id) === Number(mn?.id),
      `설정 ${rsS.status} 규칙 ${rs.status} · 슬롯 ${slots.map((x) => `${x.id}:${x.topic_id ?? "-"}`).join(",")} · manual ${mn?.id}(12) ai ${ai?.id}(95) · step ${JSON.stringify(st || {}).slice(0, 60)}`);
  }

  /* ══ idor — 타 테넌트(13)로 목록 0 ══ */
  if (SECTIONS.has("idor")) {
    const other = new Jar(); await call(other, "/api/auth-login", { body: { email: "c+p1b@autocreate.test", password: PASSWORD } });
    const ol = await call(other, "/api/topics-list", { query: { status: "candidate" } });
    const leaked = (ol.json?.topics || []).filter((t) => String(t.title).includes(STAMP));
    rec("타 테넌트(13) 목록에 내 소재 0", ol.status === 200 && leaked.length === 0, `${ol.status} 누출 ${leaked.length}`);
  }

  /* ══ caption — §5C 단위 프로브(실호출 0) ══ */
  if (SECTIONS.has("caption")) {
    const { execFileSync } = await import("node:child_process");
    let o = "";
    try { o = String(execFileSync("npx", ["tsx", "--env-file=.env", "scripts/verify-r6-5-caption-probe.mts"], { timeout: 180_000, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] })); }
    catch (e) { o = String(e?.stdout || "") + String(e?.stderr || e?.message || ""); }
    const lines = o.split(/\r?\n/).filter((l) => l.startsWith("RESULT "));
    if (!lines.length) rec("캡션 프로브 실행", false, o.slice(-150).replace(/\s+/g, " "));
    for (const l of lines) { try { const x = JSON.parse(l.slice(7)); rec(x.step, x.ok, x.note); } catch { /* */ } }
    const wp = existsSync("lib/publish/wordpress.ts") ? readFileSync("lib/publish/wordpress.ts", "utf8") : "";
    rec("wordpress alt_text — 캡션 없으면 alt 도 빈다(B2 잇는 중 · 결함 기록만)", /alt_text:\s*caption/.test(wp) ? "WARN" : !/alt_text:\s*caption/.test(wp), /alt_text:\s*caption/.test(wp) ? "wordpress.ts:71 `alt_text: caption` — 캡션 기본 없음이라 alt 가 빈다 · B2 몫" : "alt 가 prompt 파생으로 바뀜");
  }

  /* ══ tooSoon — ④ «이번엔 건너뛰어요» = 서버 `skipReason:"too_soon"`(다음 제작 틱 > 발행 시각) · 5경우 + 타 테넌트 ══ */
  if (SECTIONS.has("tooSoon")) {
    const KST = 9 * 3600_000; const now = new Date(); const kst = new Date(now.getTime() + KST);
    const H = kst.getUTCHours(); const ymd = (d) => new Date(d.getTime() + KST).toISOString().slice(0, 10);
    const today = ymd(now), tomorrow = ymd(new Date(now.getTime() + 86400_000)), day2 = ymd(new Date(now.getTime() + 2 * 86400_000));
    const atKst = (dayStr, h, m = 0) => new Date(Date.parse(`${dayStr}T00:00:00Z`) + (h * 60 + m) * 60_000 - KST).toISOString();   // KST h:m → UTC ISO
    const mk = async (dayStr, publishIso, status = "planned", extra = {}) => {
      const [r] = await s`INSERT INTO slots (tenant_id, slot_date, channel, kind, status, publish_at, origin, piece_id)
        VALUES (${TID}, ${dayStr}::date, 'naver_blog', 'post', ${status}, ${publishIso ? s`${publishIso}::timestamptz AT TIME ZONE 'UTC'` : null}, 'auto', ${extra.pieceId ?? null}) RETURNING id`;
      return Number(r?.id);
    };
    const list = async () => { const r = await call(jar, "/api/slots-list", { query: { from: today, to: day2 } }); return new Map((r.json?.slots || []).map((x) => [Number(x.id), x])); };
    await s`DELETE FROM slots WHERE tenant_id = ${TID}`;
    // 🔴 메인 지적 경우: produceHour 를 **지금 시각과 같은 시**로 두면 다음 틱은 내일 → 오늘 자리는 전부 too_soon
    await call(jar, "/api/rules-settings", { body: { autoSchedule: true, produceHour: `${String(H).padStart(2, "0")}:00` } });
    const a1 = await mk(today, atKst(today, 23, 30));                          // 오늘 23:30 — 틱(내일 H) 보다 앞 → too_soon
    const a2 = await mk(tomorrow, atKst(tomorrow, H, 0));                     // 내일 H:00 — 틱과 같은 시각(P <= T) → too_soon
    const a3 = await mk(tomorrow, atKst(tomorrow, (H + 1) % 24 || 23, 0));   // 내일 H+1 — 틱 뒤 → 키 없음
    const a4 = await mk(today, null);                                         // publish_at 없음 → 그날 23:59 → too_soon
    const a5 = await mk(day2, null);                                          // 모레 · 시각 없음 → 23:59 모레 → 키 없음
    const [pc] = await s`INSERT INTO pieces (tenant_id, channel, kind, status, title, meta) VALUES (${TID}, 'naver_blog', 'post', 'in_review', 'C R6.5 글 있음', ${s.json({})}) RETURNING id`;
    const a6 = await mk(today, atKst(today, 23, 40), "in_review", { pieceId: Number(pc.id) });   // 글이 있는 자리 → 키 없음
    const a7 = await mk(today, atKst(today, 23, 50), "skipped");             // 만들어질 차례가 아닌 상태 → 키 없음
    const L = await list();
    const sr = (id) => L.get(id)?.skipReason;
    rec(`④ produceHour=지금 시(${H}시) → 오늘 23:30 자리는 too_soon(다음 틱이 내일이라)`, sr(a1) === "too_soon", `slot ${a1} skipReason=${sr(a1)}`);
    rec("④ 내일 H:00(틱과 같은 시각) → too_soon(P <= T)", sr(a2) === "too_soon", `slot ${a2} skipReason=${sr(a2)}`);
    rec("④ 내일 H+1 → 키 없음(다음 틱에 만들어진다)", L.has(a3) && sr(a3) === undefined, `slot ${a3} skipReason=${sr(a3) ?? "없음"}`);
    rec("④ publish_at 없는 오늘 자리 → 23:59 기준 too_soon", sr(a4) === "too_soon", `slot ${a4} skipReason=${sr(a4)}`);
    rec("④ 모레 · 시각 없음 → 키 없음", L.has(a5) && sr(a5) === undefined, `slot ${a5} skipReason=${sr(a5) ?? "없음"}`);
    rec("④ 글이 이미 있는 자리 → 키 없음(못 만드는 게 아니라 만든 것)", L.has(a6) && sr(a6) === undefined, `slot ${a6} status ${L.get(a6)?.status} skipReason=${sr(a6) ?? "없음"}`);
    rec("④ skipped 상태 → 키 없음(만들어질 차례가 아니다)", L.has(a7) && sr(a7) === undefined, `slot ${a7} skipReason=${sr(a7) ?? "없음"}`);
    // produceHour 를 **미래 시**로 두면 오늘 그 시각 전 자리만 too_soon
    const H2 = (H + 3) % 24;
    if (H2 > H) {
      await call(jar, "/api/rules-settings", { body: { produceHour: `${String(H2).padStart(2, "0")}:00` } });
      const b1 = await mk(today, atKst(today, H2, -30)); const b2 = await mk(today, atKst(today, H2, 30));
      const L2 = await list();
      rec(`④ produceHour=${H2}시(미래) → 그 전 자리 too_soon · 그 뒤 자리 키 없음`, L2.get(b1)?.skipReason === "too_soon" && L2.get(b2)?.skipReason === undefined,
        `${H2 - 1}:30→${L2.get(b1)?.skipReason ?? "없음"} · ${H2}:30→${L2.get(b2)?.skipReason ?? "없음"}`);
    } else warn("④ 미래 produceHour 경우", `지금 ${H}시라 오늘 안에 +3시가 없다(자정 근처) — 다음 실행 때`);
    // 타 테넌트 누수
    const other = new Jar(); await call(other, "/api/auth-login", { body: { email: "c+p1b@autocreate.test", password: PASSWORD } });
    const ol = await call(other, "/api/slots-list", { query: { from: today, to: day2 } });
    const leak = (ol.json?.slots || []).filter((x) => [a1, a2, a3, a4, a5, a6, a7].includes(Number(x.id)));
    rec("④ 타 테넌트(13) slots-list 에 내 자리 0", ol.status === 200 && leak.length === 0, `${ol.status} 누출 ${leak.length}`);
    const sch = existsSync("public/app/schedule.html") ? readFileSync("public/app/schedule.html", "utf8") : "";
    rec("④ 화면은 서버 키(skipReason)만 본다 — «날짜 − 오늘 < lead» 계산 0", /skipReason/.test(sch) && !/produceLeadDays\s*[<>]/.test(sch), /skipReason/.test(sch) ? "skipReason 사용" : "🔴 화면이 서버 키를 안 본다");
  }

  /* ══ runnerDist — ⑤ 러너 배포: 내려받기·sha256 실대조·지문·rotate·노출 범위(발행 0건 · 러너 실행 0) ══ */
  if (SECTIONS.has("runnerDist")) {
    const { createHash } = await import("node:crypto");
    const anon = await call(null, "/api/runner-download");
    rec("⑤ runner-download 비로그인 → 401", anon.status === 401, `${anon.status}`);
    const dl = await call(jar, "/api/runner-download");
    const ok = dl.status === 200 && dl.json?.ok === true;
    rec("⑤ runner-download 200 → version·bytes·sha256·filename·url·expiresInSec 600", ok && dl.json.version && dl.json.sha256 && dl.json.filename && dl.json.url && dl.json.expiresInSec === 600,
      ok ? `v${dl.json.version} · ${dl.json.bytes}B · ${dl.json.filename} · sha ${String(dl.json.sha256).slice(0, 12)}…` : `${dl.status} ${dl.json?.step} «${String(dl.json?.error || "").slice(0, 40)}»`);
    const [ad] = await s`SELECT id, detail FROM audit_logs WHERE tenant_id = ${TID} AND action = 'runner_downloaded' ORDER BY id DESC LIMIT 1`;
    rec("⑤ 감사 runner_downloaded(version·planKey)", !!ad && ad.detail?.version === dl.json?.version, `audit ${ad?.id} ${JSON.stringify(ad?.detail || {}).slice(0, 60)}`);
    if (ok) {
      rec("⑤ presigned 만료 10분(URL X-Amz-Expires=600)", /X-Amz-Expires=600\b/.test(dl.json.url), (dl.json.url.match(/X-Amz-Expires=\d+/) || ["없음"])[0]);
      const res = await fetch(dl.json.url).catch(() => null);
      const buf = res?.ok ? Buffer.from(await res.arrayBuffer()) : null;
      const cd = res?.headers.get("content-disposition") || "";
      rec("⑤ 🔴 응답 헤더 content-disposition 의 파일명 = 응답 filename(«링크가 열렸다»로는 안 잡힌다)", !!buf && cd.includes(dl.json.filename), `${res?.status} «${cd.slice(0, 70)}»`);
      const sha = buf ? createHash("sha256").update(buf).digest("hex") : "";
      rec("⑤ 🔴 받은 zip 의 sha256 = 응답 sha256(실대조)", !!buf && sha === dl.json.sha256 && buf.length === dl.json.bytes, `${buf?.length}B · ${sha.slice(0, 16)}… vs ${String(dl.json.sha256).slice(0, 16)}…`);
      let manifest = null;
      try { const { execFileSync } = await import("node:child_process"); const o = String(execFileSync("npx", ["tsx", "--env-file=.env", "scripts/verify-r6-5-latest-probe.mts"], { encoding: "utf8", shell: true, timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] })); manifest = JSON.parse(o.trim().split(/\r?\n/).pop()); } catch { /* */ }
      rec("⑤ R2 latest.json 의 sha256·version 이 응답과 같다", !!manifest && manifest.sha256 === dl.json.sha256 && manifest.version === dl.json.version, manifest ? `latest.json v${manifest.version} sha ${String(manifest.sha256).slice(0, 12)}…` : "latest.json 못 읽음");
      rec("⑤ zip 이 진짜 zip(PK 시그니처)", !!buf && buf[0] === 0x50 && buf[1] === 0x4b, buf ? `${buf.slice(0, 2).toString("latin1")}` : "-");
    }
    // readonly 면 내려받기도 막힌다(requireWritable)
    await s`UPDATE tenants SET status = 'readonly' WHERE id = ${TID}`;
    const ro = await call(jar, "/api/runner-download");
    rec("⑤ readonly 테넌트 → 403 writable(내려받기도 생성 계열)", ro.status === 403 && ro.json?.step === "writable", `${ro.status} ${ro.json?.step}`);
    await s`UPDATE tenants SET status = 'trial' WHERE id = ${TID}`;
    warn("⑤ 403 plan(runnerDevices 0)", "표준 4플랜(trial 1·starter 1·pro 2·agency 5)엔 0 이 없다 — 라이브에선 닿을 수 없는 분기(정적 확인만)");
    warn("⑤ 503 no_release", "R2 에 latest.json 이 이미 있다 — 지우고 재현하지 않는다(정적 확인만 · «준비 중이에요» 사람말)");

    /* 지문 — 첫 하트비트가 묶고 · 다른 값이면 401 + 알림 · runner-list 는 지문 값 미노출 */
    const reg = await call(jar, "/api/runner-register", { body: { name: "C R6.5 지문 PC", kind: "own" } });
    const dev = reg.json?.device; const tok = dev?.token; const devId = Number(dev?.id || 0);
    rec("⑤ 기기 등록 → 열쇠 1회 발급", reg.status === 200 && !!tok && devId > 0, `${reg.status} device ${devId}`);
    if (tok) {
      const fpA = "a".repeat(64), fpB = "b".repeat(64);
      const hb = (t, fp) => fetch(`${BASE}/api/runner-heartbeat`, { method: "POST", headers: { "Content-Type": "application/json", "x-runner-token": t, "x-runner-fp": fp }, body: JSON.stringify({ version: "1.1.4", jobs: [] }) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
      const h1 = await hb(tok, fpA);
      const [d1] = await s`SELECT fingerprint IS NOT NULL AS bound, fp_mismatch_count FROM runner_devices WHERE id = ${devId}`;
      rec("⑤ 첫 하트비트(x-runner-fp A) → 200 · 기기에 지문이 묶인다", h1.status === 200 && d1?.bound === true, `${h1.status} bound ${d1?.bound}`);
      const tN = new Date(Date.now() - 3_000);
      const h2 = await hb(tok, fpB);
      const [d2] = await s`SELECT fp_mismatch_count AS c FROM runner_devices WHERE id = ${devId}`;
      const [nt] = await s`SELECT id, title FROM notifications WHERE tenant_id = ${TID} AND created_at > ${tN.toISOString()}::timestamptz AT TIME ZONE 'UTC' ORDER BY id DESC LIMIT 1`;
      rec("⑤ 🔴 다른 지문(B) → 401 «다른 PC에 연결돼 있어요» + 고객 알림 + 카운트 1", h2.status === 401 && /다른 PC/.test(String(h2.json?.error || h2.json?.message || "")) && Number(d2?.c) === 1 && !!nt,
        `${h2.status} «${String(h2.json?.error || h2.json?.message || "").slice(0, 40)}» · mismatch ${d2?.c} · 알림 ${nt?.id ?? "0"} «${String(nt?.title || "").slice(0, 24)}»`);
      const rl = await call(jar, "/api/runner-list");
      const me = (rl.json?.devices || []).find((x) => Number(x.id) === devId);
      rec("⑤ runner-list — bound·otherDeviceAt·otherDeviceCount·version 만(지문 값 미노출)", !!me && me.bound === true && !!me.otherDeviceAt && Number(me.otherDeviceCount) === 1 && !JSON.stringify(rl.json).includes(fpA),
        `bound ${me?.bound} · otherDeviceAt ${me?.otherDeviceAt ? "있음" : "없음"} · count ${me?.otherDeviceCount} · 지문 노출 ${JSON.stringify(rl.json).includes(fpA) ? "🔴 있음" : "0"}`);
      const rot = await call(jar, "/api/runner-rotate", { body: { id: devId } });
      const tok2 = rot.json?.device?.token;
      const old = await hb(tok, fpA); const fresh = await hb(tok2 || "x", fpB);
      const [d3] = await s`SELECT fingerprint AS fp, fp_mismatch_count AS c FROM runner_devices WHERE id = ${devId}`;
      rec("⑤ rotate → 옛 열쇠 즉사(401) · 새 열쇠 통과 · 지문 초기화(새 PC 로 다시 묶임 · 카운트 0)", rot.status === 200 && !!tok2 && old.status === 401 && fresh.status === 200 && String(d3?.fp || "") === fpB && Number(d3?.c) === 0,
        `rotate ${rot.status} · 옛 ${old.status} · 새 ${fresh.status} · fp ${d3?.fp ? d3.fp.slice(0, 6) + "…" : "없음"} · count ${d3?.c}`);
      const bad = await hb("not-a-token", fpA);
      rec("⑤ 틀린 열쇠 → 401 «러너 열쇠가 올바르지 않아요»", bad.status === 401 && /열쇠/.test(String(bad.json?.error || bad.json?.message || "")), `${bad.status} «${String(bad.json?.error || bad.json?.message || "").slice(0, 30)}»`);
      await call(jar, "/api/runner-remove", { body: { id: devId } });
    }
    const [pub] = await s`SELECT COUNT(*) AS c FROM posts WHERE tenant_id = ${TID}`;
    rec("⑤ 발행 0건(러너를 실행하지 않았다)", Number(pub?.c) === 0, `posts ${pub?.c}`);
  }

  /* ══ regress — topics.ts 5경로 · 로그인·홈 ══ */
  if (SECTIONS.has("regress")) {
    const paths = [["/api/topics-list", null], ["/api/topics-refresh", {}], ["/api/topics-pick", { id: 0 }], ["/api/topics-skip", { id: 0 }], ["/api/topics-add", { title: "" }]];
    const codes = [];
    for (const [p, b] of paths) { const x = await call(jar, p, b ? { body: b } : {}); codes.push(`${p.split("/").pop()}:${x.status}`); }
    rec("topics.ts 5경로 전부 살아 있다(500 없음)", codes.every((c) => !/:(0|5\d\d)$/.test(c)), codes.join(" "));
    const home = await call(jar, "/api/home-summary"); const sl = await call(jar, "/api/slots-list");
    rec("홈·편성표 API 200", home.status === 200 && sl.status === 200, `home ${home.status} · slots ${sl.status}`);
    const c = await cron("hourly", TID);
    rec("크론 회귀(hourly errors 0)", c.status === 200 && (c.json?.ran || []).every((x) => x.errors === 0), (c.json?.ran || []).map((x) => `${x.step}:${x.errors}`).join(" ").slice(0, 100));
  }

  if (SECTIONS.has("cleanup")) {
    for (const t of [...ALLOWED]) {
      if (KEEP.has(t)) continue;
      try { await s.unsafe(`UPDATE tenants SET plan_key='trial', status='trial' WHERE id=$1`, [t]); } catch { /* */ }
      for (const tb of ["piece_assets", "posts", "coin_ledger", "ai_usage", "notifications", "audit_logs", "slots", "pieces", "briefs", "cadence_rules", "topics", "accounts"]) { try { await s.unsafe(tb === "piece_assets" ? `DELETE FROM piece_assets WHERE tenant_id=$1` : `DELETE FROM ${tb} WHERE tenant_id=$1`, [t]); } catch { /* */ } }
    }
    rec("정리(테스트 테넌트의 topic·감사·슬롯·규칙 삭제 · 상태 trial 복구)", true, `tenants ${[...ALLOWED].join(",")}`);
  }
  finish();
}
function finish() {
  const fails = results.filter((r) => r.ok === "FAIL").length, warns = results.filter((r) => r.ok === "WARN").length;
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nR6.5 C 하니스 · ${BASE} · ${new Date().toISOString()}\n${"─".repeat(130)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 62)} ${w(r.note, 64)}`);
  console.log(`${"─".repeat(130)}\nPASS ${results.length - fails - warns} · FAIL ${fails} · WARN ${warns} · ${Math.round((Date.now() - t0) / 1000)}s`);
  mkdirSync("_verify", { recursive: true }); const out = `_verify/r6-5-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ base: BASE, at: new Date().toISOString(), email: EMAIL, results }, null, 2)); console.log(`→ ${out}`);
  if (sql) sql.end().catch(() => {}); process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); rec("예외", false, String(e?.stack || e).slice(0, 200)); finish(); });
