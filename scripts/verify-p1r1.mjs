// scripts/verify-p1r1.mjs — P1R1 계약 §10 시나리오 1 을 API 순서대로 자동 실행하고 응답 키를 계약(§1~§7)과 대조하는 하니스(C2).
//   사용: node scripts/verify-p1r1.mjs                        (BASE_URL 기본 http://localhost:8899)
//         BASE_URL=https://autocreate-endyd.netlify.app node scripts/verify-p1r1.mjs
//   env: TEST_EMAIL(c+p1@autocreate.test) · TEST_PASSWORD · TEST_EMAIL2(IDOR 용 두 번째 테넌트) · OPS_USER/OPS_PASS(코인 지급 · 없으면 로컬 .env 의 DB 로 직접 grant)
//        GEN_TIMEOUT_MS(기본 10분) · SKIP_GEN=1(생성 대기 생략 — 하니스 자체 점검용)
//   출력: 표(stdout) + _verify/p1r1-<ts>.json.  ❌ 초록 = 증거 아님(PITFALLS #9) — 실물(원장 행·이미지·화면)로 되짚는다.
//   🔴 라이브 실행은 테스트 테넌트만(PITFALLS #8). 실고객 이메일로 돌리지 마라.
//   정본 = 계약서 v1.1(2026-09-14 · C1 감사 반영) — 엄격 모드: status=generating 허용 · stage 필수 · GateKey 12 순서 고정 · approve step:"gate" · ScheduleSettings 8키 · AccountRow §7.1 전필드.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const BASE = (process.env.BASE_URL || "http://localhost:8899").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL || "c+p1@autocreate.test";
const EMAIL2 = process.env.TEST_EMAIL2 || "c+p1b@autocreate.test";
const PASSWORD = process.env.TEST_PASSWORD || "Cp1Verify2026x";
const CRED_PASSWORD = "Zq9-plain-secret-77";          // 계정 자격 평문 — 응답 본문 어디에도 나오면 안 된다
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 10 * 60 * 1000);
const IS_LIVE = /^https:/.test(BASE);

/* ───────── 결과 수집 ───────── */
const results = [];              // { step, ok, note, evidence }
const bodies = [];               // 모든 응답 본문(평문 검사용)
const t0 = Date.now();
function rec(step, ok, note = "", evidence = undefined) { results.push({ step, ok: ok ? "PASS" : "FAIL", note, evidence }); return ok; }
function warn(step, note, evidence) { results.push({ step, ok: "WARN", note, evidence }); }

/* ───────── 쿠키 항아리 + fetch ───────── */
class Jar {
  constructor() { this.c = new Map(); }
  absorb(res) { const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : []; for (const sc of list) { const [kv] = sc.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(); const v = kv.slice(i + 1).trim(); if (/Max-Age=0/i.test(sc)) this.c.delete(k); else this.c.set(k, v); } }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
}
async function call(jar, path, { method, body, query } = {}) {
  const url = BASE + path + (query ? "?" + new URLSearchParams(query).toString() : "");
  const init = { method: method || (body ? "POST" : "GET"), headers: { Cookie: jar.header() }, redirect: "manual" };
  if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  let res; try { res = await fetch(url, init); } catch (e) { return { status: 0, json: { ok: false, error: String(e) }, text: "" }; }
  jar.absorb(res);
  const text = await res.text(); bodies.push({ path, text });
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}

/* ───────── 계약 모양 검사 ─────────
   spec = { key: "type" | "type?" }  type ∈ string number boolean object array any null|string … ("a|b" 는 둘 중 하나)
   누락 = FAIL · 타입 불일치 = FAIL · 계약 외 여분 키 = WARN(«없으면 키 생략» 규칙은 null 값 = WARN) */
function typeOf(v) { return v === null ? "null" : Array.isArray(v) ? "array" : typeof v; }
function checkShape(step, obj, spec, { allowExtra = false } = {}) {
  const missing = [], bad = [], nulls = [];
  if (!obj || typeof obj !== "object") return rec(step, false, "객체가 아님", obj);
  for (const [k, t] of Object.entries(spec)) {
    const opt = t.endsWith("?"); const types = t.replace(/\?$/, "").split("|");
    if (!(k in obj)) { if (!opt) missing.push(k); continue; }
    if (obj[k] === null) { if (opt) nulls.push(k); else if (!types.includes("null")) bad.push(`${k}=null`); continue; }
    if (!types.includes("any") && !types.includes(typeOf(obj[k]))) bad.push(`${k}:${typeOf(obj[k])}≠${types.join("|")}`);
  }
  const extra = allowExtra ? [] : Object.keys(obj).filter((k) => !(k in spec));
  const ok = !missing.length && !bad.length;
  const notes = [missing.length && `누락 ${missing.join(",")}`, bad.length && `타입 ${bad.join(",")}`].filter(Boolean).join(" · ");
  rec(step, ok, notes || "키·타입 일치");
  if (extra.length) warn(step + " 여분키", `계약 외 키: ${extra.join(",")}`);
  if (nulls.length) warn(step + " null", `«없으면 키 생략» 위반 후보(null 실림): ${nulls.join(",")}`);
  return ok;
}
const S = {
  account: { id: "number", channel: "string", handle: "string", displayName: "string|null", avatar: "null", status: "string", healthScore: "number", postsToday: "number", dailyCap: "number", minGapMin: "number", goldenHours: "array?", lastPostAt: "string?", lastErrorKind: "string?", groupId: "number?", personaId: "number?", proxyUrl: "string?", browserProfileKey: "string", hasCreds: "boolean", monetize: "object" },
  channel: { key: "string", label: "string", category: "string", publishVia: "string", status: "string", connectMethod: "string", configured: "boolean" },
  topic: { id: "number", title: "string", angle: "string|null?", channelHint: "string|null?", score: "number", status: "string", factors: "object", expiresAt: "string" },
  factors: { volume: "number?", growthPct: "number?", competition: "string?", intent: "string", pain: "number?", seasonal: "string?", performance: "number?" },
  brief: { id: "number", topicId: "number", goal: "string", mode: "string", coinCost: "number", coinsLeft: "number", reasons: "array", pieces: "array" },
  pieceSpec: { key: "string", channel: "string", accountId: "number|null", accountHandle: "string|null", format: "string", emotionKey: "string", composition: "string", lengthHint: "object", images: "object", monetize: "object", schedule: "object", coinCost: "number" },
  confirm: { ok: "boolean", briefId: "number", pieceIds: "array", coinsCharged: "number", coinsLeft: "number" },
  pieceRow: { id: "number", channel: "string", accountHandle: "string|null", kind: "string", format: "string|null", title: "string|null", status: "string", stage: "string", scheduledFor: "string?", publishedAt: "string?", externalUrl: "string?", coverUrl: "string?", gateOk: "boolean", failReason: "string?", createdAt: "string" },
  pieceDetailExtra: { bodyHtml: "string", blocks: "array", images: "array", meta: "object", gate: "object", topicTitle: "string|null", regenCount: "number" },
  gate: { ok: "boolean", checks: "array", rewritten: "boolean" },
  gateCheck: { key: "string", label: "string", pass: "boolean", detail: "string?" },
  rulesList: { ok: "boolean", rules: "array", settings: "object", coinsPerWeek: "number", maxRules: "number|null" },
  settings: { autoSchedule: "boolean", horizonDays: "number", topicLeadDays: "number", produceLeadDays: "number", produceHour: "string", reviewPolicy: "string", bestTimeMode: "string", weeklyCoinCap: "number|null", quietDays: "array" },
  rule: { id: "number", channel: "string", kind: "string", accountMode: "string", accountId: "number?", every: "string", count: "number", weekdays: "array?", preferredHour: "number?", formatHint: "string?", active: "boolean" },
  slot: { id: "number", date: "string", channel: "string", kind: "string", accountId: "number?", accountHandle: "string?", status: "string", publishAt: "string?", reviewDeadline: "string?", topicTitle: "string?", pieceId: "number?", origin: "string" },
  coins: { ok: "boolean", balance: "number", included: "number", purchased: "number", recent: "array" },
};
const GATE_KEYS = ["cliche", "para_repeat", "bullet_ratio", "sentence_variance", "translationese", "superlative", "persona", "visual_min", "disclosure", "banned_words", "similarity", "affiliate_count"];
const STAGES = ["writing", "images", "checking", "done", "failed"];
const ALLOWED = { pieceStatus: ["generating", "draft", "in_review", "approved", "scheduled", "publishing", "published", "awaiting_manual", "failed", "rejected"], accStatus: ["active", "cooldown", "limited", "suspended", "disconnected", "pending_login"], block: ["hook", "para", "h2", "h3", "quote", "list", "checklist", "table", "image", "divider", "tip", "faq", "hashtags", "disclosure", "adsense", "toc", "summary", "affiliate"] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────── 0. 가입/로그인 ───────── */
async function signIn(jar, email) {
  let r = await call(jar, "/api/auth-login", { body: { email, password: PASSWORD, remember: true } });
  if (r.status === 401) r = await call(jar, "/api/auth-register", { body: { email, password: PASSWORD, name: "C검증" } });
  const me = await call(jar, "/api/auth-me");
  rec(`login ${email}`, r.json?.ok === true && me.json?.ok === true, `status ${r.status} · me ${me.status}`, me.json?.tenant?.planKey);
  return me.json;
}

/* ───────── 코인 지급(운영센터 API 또는 로컬 DB) ───────── */
async function grantCoins(tenantKey, coins) {
  if (process.env.OPS_USER && process.env.OPS_PASS) {
    const oj = new Jar();
    const lg = await call(oj, "/api/ops-login", { body: { email: process.env.OPS_USER, password: process.env.OPS_PASS } });
    if (!lg.json?.ok) return rec("coins grant(ops)", false, `ops-login ${lg.status} ${lg.json?.step || ""}`);
    const ts = await call(oj, "/api/ops-tenants", { query: { q: EMAIL } });
    const t = (ts.json?.tenants || []).find((x) => x.ownerEmail === EMAIL) || (ts.json?.tenants || [])[0];
    if (!t) return rec("coins grant(ops)", false, "ops-tenants 에서 테스트 테넌트 못 찾음");
    const g = await call(oj, "/api/ops-coins-grant", { body: { id: t.id, coins, reason: "C2 하니스" } });
    return rec("coins grant(ops)", g.json?.ok === true, `tenant ${t.id} +${coins} → balance ${g.json?.balance ?? g.json?.coins ?? "?"}`, `ops-coins-grant tenant=${t.id}`);
  }
  if (IS_LIVE) return rec("coins grant", false, "라이브 코인 부족 — 메인에 «지급 요청»(운영센터 ops-coins-grant · 테넌트 id 3) 후 재실행");
  const url = process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
  if (!url) return rec("coins grant(db)", false, "NETLIFY_DATABASE_URL 없음");
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { ssl: "require", max: 1 });
  try {
    const [t] = await sql`SELECT id FROM tenants WHERE key = ${tenantKey}`;
    const ref = `c2:${Date.now()}`;
    const [row] = await sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason) VALUES (${t.id}, 'grant', 'included', ${coins}, ${ref}, 'C2 하니스') RETURNING id`;
    return rec("coins grant(db)", true, `tenant ${t.id} +${coins}`, `coin_ledger id=${row.id}`);
  } finally { await sql.end(); }
}

/* ───────── 메인 시나리오 ───────── */
async function main() {
  const jar = new Jar(), jar2 = new Jar();
  const me = await signIn(jar, EMAIL);
  if (!me?.ok) return finish();
  const tenantKey = me.tenant?.key;

  // 코인 30 (잔액이 이미 ≥30 이면 생략)
  let bal = await call(jar, "/api/coins-balance");
  checkShape("coins-balance 모양", bal.json, S.coins);
  if ((bal.json?.balance ?? 0) < 30) { await grantCoins(tenantKey, 30); bal = await call(jar, "/api/coins-balance"); }
  rec("coins ≥ 30", (bal.json?.balance ?? 0) >= 30, `balance ${bal.json?.balance}`);

  // 계정 2개
  let al = await call(jar, "/api/accounts-list");
  rec("accounts-list ok", al.json?.ok === true && Array.isArray(al.json?.accounts) && Array.isArray(al.json?.channels), `status ${al.status}`);
  if (al.json?.channels?.[0]) checkShape("channels[] 모양", al.json.channels[0], S.channel);
  rec("channels 10키", (al.json?.channels || []).length === 10, `${(al.json?.channels || []).length}개`);
  const ids = {};
  for (const [channel, handle] of [["naver_blog", "c_p1_naver"], ["tistory", "c_p1_tistory"]]) {
    const r = await call(jar, "/api/accounts-add", { body: { channel, handle, loginId: handle, password: CRED_PASSWORD, displayName: `C검증 ${channel}` } });
    if (r.json?.ok) { rec(`accounts-add ${channel}`, r.json.account?.status === "pending_login", `id ${r.json.account?.id} status ${r.json.account?.status}(session=pending_login)`, `accounts id=${r.json.account?.id}`); checkShape("accounts-add AccountRow", r.json.account, S.account); ids[channel] = r.json.account?.id; }
    else if (r.json?.step === "duplicate") { rec(`accounts-add ${channel}`, true, "이미 있음(duplicate) → 재사용"); }
    else rec(`accounts-add ${channel}`, false, `${r.status} ${r.json?.step} ${r.json?.error}`);
  }
  const hp = await call(jar, "/api/accounts-add", { body: { channel: "tistory", handle: "coupang_best_deal", loginId: "x", password: CRED_PASSWORD } });
  rec("핸들 «쿠팡» 거부(handle_policy)", hp.json?.ok === false && hp.json?.step === "handle_policy", `${hp.status} ${hp.json?.step || "ok?!"}`);
  const hp2 = await call(jar, "/api/accounts-add", { body: { channel: "tistory", handle: "쿠팡추천왕", loginId: "x", password: CRED_PASSWORD } });
  rec("핸들 «쿠팡»(한글) 거부", hp2.json?.ok === false && hp2.json?.step === "handle_policy", `${hp2.status} ${hp2.json?.step || "ok?!"}`);
  al = await call(jar, "/api/accounts-list");
  const accs = al.json?.accounts || [];
  for (const ch of ["naver_blog", "tistory"]) { const a = accs.find((x) => x.channel === ch); if (a) ids[ch] = a.id; }
  rec("accounts 2개 목록", !!(ids.naver_blog && ids.tistory), `naver ${ids.naver_blog} · tistory ${ids.tistory}`);
  if (accs[0]) { checkShape("accounts[] 모양", accs[0], S.account); rec("account.hasCreds", accs.every((a) => a.hasCreds === true), ""); rec("account.status 어휘", accs.every((a) => ALLOWED.accStatus.includes(a.status)), accs.map((a) => a.status).join(",")); }
  // 계정 상세 갱신(§7.1 필드)
  if (ids.naver_blog) {
    const u = await call(jar, "/api/accounts-update", { body: { id: ids.naver_blog, dailyCap: 2, minGapMin: 180, goldenHours: [7, 12, 21], monetize: { adpostMediaId: "m-test" } } });
    rec("accounts-update", u.json?.ok === true && u.json?.account?.monetize?.adpost === true && typeof u.json?.account?.monetize?.coupang === "boolean", `${u.status} ${u.json?.step || ""} monetize=${JSON.stringify(u.json?.account?.monetize)}`);
  }
  // 페르소나
  const pl = await call(jar, "/api/personas-list"); rec("personas-list", pl.json?.ok === true && Array.isArray(pl.json?.personas), `${pl.status}`);
  const ps = await call(jar, "/api/personas-save", { body: { name: "C검증 페르소나", profile: { region: "수도권", family: "1인 가구", job: "직장인", tone: "친근", interests: ["살림"], banned: ["최고"], signature: "" } } });
  rec("personas-save", ps.json?.ok === true && ps.json?.persona?.id > 0, `${ps.status} ${ps.json?.step || ""}`);
  // OAuth 채널 = 준비 중(키 없음) 정직 응답
  const oa = await call(jar, "/api/accounts-oauth-start", { body: { channel: "blogger" } });
  rec("oauth-start blogger", (oa.json?.ok === true && typeof oa.json.url === "string") || oa.json?.step === "provider_not_configured", `${oa.status} ${oa.json?.step || "url"}`);

  // 소재
  let tl = await call(jar, "/api/topics-list", { query: { status: "candidate" } });
  rec("topics-list ok", tl.json?.ok === true && Array.isArray(tl.json?.topics), `${tl.status}`);
  const tr = await call(jar, "/api/topics-refresh", { body: {} });
  rec("topics-refresh", tr.json?.ok === true || tr.json?.step === "rate_limit", `${tr.status} added=${tr.json?.added ?? "-"} ${tr.json?.step || ""}`);
  tl = await call(jar, "/api/topics-list", { query: { status: "candidate" } });
  const topics = tl.json?.topics || [];
  rec("topics ≥ 1", topics.length >= 1, `${topics.length}개`);
  if (topics[0]) { checkShape("Topic 모양", topics[0], S.topic); checkShape("Topic.factors 모양", topics[0].factors, S.factors); }
  const withVol = topics.filter((t) => typeof t.factors?.volume === "number");
  rec("검색량 숫자 존재", withVol.length > 0, `volume 있는 소재 ${withVol.length}/${topics.length}(키 없으면 graceful — 라이브에서 0이면 결함)`);
  rec("앵글 금칙(최고·1위)", !topics.some((t) => /최고|1위|100%/.test(`${t.title} ${t.angle || ""}`)), "");
  const topic = withVol[0] || topics[0];
  if (!topic) return finish();

  // 디렉터
  const dp = await call(jar, "/api/director-propose", { body: { topicId: topic.id } });
  rec("director-propose", dp.json?.ok === true, `${dp.status} ${dp.json?.step || ""} ${dp.json?.error || ""}`, `brief id=${dp.json?.brief?.id}`);
  const brief = dp.json?.brief;
  if (!brief) return finish();
  checkShape("Brief 모양", brief, S.brief);
  if (brief.pieces[0]) { checkShape("PieceSpec 모양", brief.pieces[0], S.pieceSpec); checkShape("PieceSpec.images", brief.pieces[0].images, { count: "number", style: "string", heroNeeded: "boolean" }); checkShape("PieceSpec.schedule", brief.pieces[0].schedule, { at: "string", slotReason: "string" }); checkShape("PieceSpec.monetize", brief.pieces[0].monetize, { affiliate: "object|null", adDisclosure: "boolean" }); }
  rec("계정 배정", brief.pieces.length >= 1 && brief.pieces.every((p) => p.accountId && p.accountHandle), brief.pieces.map((p) => `${p.channel}@${p.accountHandle}`).join(" · "));
  rec("코인 합 = Σpiece", brief.coinCost === brief.pieces.reduce((s, p) => s + (p.coinCost || 0), 0), `coinCost ${brief.coinCost}`);
  rec("reasons 3줄", Array.isArray(brief.reasons) && brief.reasons.length >= 3, `${brief.reasons?.length}줄`);
  rec("일정 미래", brief.pieces.every((p) => new Date(p.schedule?.at) > new Date()), brief.pieces.map((p) => p.schedule?.at).join(","));

  // 확정 (코인 1회) + 재확정(재차감 0)
  const b0 = (await call(jar, "/api/coins-balance")).json;
  const dc = await call(jar, "/api/director-confirm", { body: { briefId: brief.id } });
  rec("director-confirm", [200, 202].includes(dc.status) && dc.json?.ok === true, `${dc.status} ${dc.json?.step || ""} ${dc.json?.error || ""}`, `pieceIds ${JSON.stringify(dc.json?.pieceIds)}`);
  if (!dc.json?.ok) return finish();
  checkShape("confirm 모양", dc.json, S.confirm);
  const b1 = (await call(jar, "/api/coins-balance")).json;
  rec("코인 차감 = coinsCharged", b0.balance - b1.balance === dc.json.coinsCharged && dc.json.coinsCharged === brief.coinCost, `${b0.balance}→${b1.balance} charged ${dc.json.coinsCharged} (brief ${brief.coinCost})`);
  const consume1 = (b1.recent || []).filter((r) => r.kind === "consume").length;
  const dc2 = await call(jar, "/api/director-confirm", { body: { briefId: brief.id } });
  const b2 = (await call(jar, "/api/coins-balance")).json;
  const consume2 = (b2.recent || []).filter((r) => r.kind === "consume").length;
  rec("재확정 재차감 0 (멱등)", b2.balance === b1.balance && consume2 === consume1, `2회차 ${dc2.status} ${dc2.json?.step || "ok"} charged=${dc2.json?.coinsCharged ?? "-"} · balance ${b1.balance}→${b2.balance} · consume행 ${consume1}→${consume2}`);
  const pieceIds = dc.json.pieceIds || [];

  // 생성 완료 대기
  let piece = null;
  if (process.env.SKIP_GEN) warn("생성 대기", "SKIP_GEN=1 로 생략");
  else {
    const deadline = Date.now() + GEN_TIMEOUT; let last = ""; const stageLog = [];
    while (Date.now() < deadline) {
      let pl2 = await call(jar, "/api/pieces-list", { query: { status: "generating" } });
      if (pl2.status === 400 || pl2.json?.ok !== true) { rec("pieces-list?status=generating", false, `${pl2.status} ${pl2.json?.step || ""}`); pl2 = await call(jar, "/api/pieces-list", { query: { status: "all" } }); }
      const mine = (pl2.json?.pieces || []).filter((p) => pieceIds.includes(p.id));
      const gen = mine.filter((p) => p.status === "generating");
      last = mine.map((p) => `${p.id}:${p.status}${p.stage ? "/" + p.stage : ""}`).join(" "); for (const p of gen) if (p.stage) stageLog.push(p.stage);
      if (mine.length && !gen.length) break;
      if (!mine.length) { const all = await call(jar, "/api/pieces-list", { query: { status: "all" } }); const m2 = (all.json?.pieces || []).filter((p) => pieceIds.includes(p.id)); last = m2.map((p) => `${p.id}:${p.status}`).join(" "); if (m2.length && !m2.some((p) => p.status === "generating")) break; }
      await sleep(5000);
    }
    const all = await call(jar, "/api/pieces-list", { query: { status: "all" } });
    const mine = (all.json?.pieces || []).filter((p) => pieceIds.includes(p.id));
    if (mine[0]) checkShape("PieceRow 모양", mine[0], S.pieceRow);
    rec("piece.status 어휘", mine.every((p) => ALLOWED.pieceStatus.includes(p.status)), last);
    rec("piece.stage 어휘·정합", mine.every((p) => STAGES.includes(p.stage) && (p.status !== "in_review" || p.stage === "done") && (p.status !== "failed" || p.stage === "failed")), mine.map((p) => `${p.status}/${p.stage}`).join(" "));
    const stagesSeen = [...new Set(stageLog)]; if (stagesSeen.length >= 2) rec("stage 전이 관측", true, stagesSeen.join("→")); else warn("stage 전이 관측", `폴링 중 ${stagesSeen.join("→") || "없음"} — 전이 못 봄(빠른 생성이면 정상)`);
    const review = mine.filter((p) => p.status === "in_review");
    rec("생성 완료 → in_review", review.length === pieceIds.length, `${review.length}/${pieceIds.length} · ${last} · ${Math.round((Date.now() - t0) / 1000)}s`, review.map((p) => `piece id=${p.id}`).join(","));
    for (const f of mine.filter((p) => p.status === "failed")) { const d = await call(jar, "/api/pieces-get", { query: { id: f.id } }); warn(`piece ${f.id} failed`, String(d.json?.piece?.meta?.failReason || "").slice(0, 200)); }
    piece = review[0] || mine[0];
  }
  if (!piece) return finish();

  // 상세 · 게이트 · 고지 · 이미지
  const pg = await call(jar, "/api/pieces-get", { query: { id: piece.id } });
  rec("pieces-get", pg.json?.ok === true && pg.json?.piece?.id === piece.id, `${pg.status}`);
  const P = pg.json?.piece || {};
  checkShape("PieceDetail 모양", P, { ...S.pieceRow, ...S.pieceDetailExtra }, { allowExtra: false });
  checkShape("GateReport 모양", P.gate, S.gate);
  if (P.gate?.checks?.[0]) checkShape("GateCheck 모양", P.gate.checks[0], S.gateCheck);
  const keys = (P.gate?.checks || []).map((c) => c.key);
  rec("GateKey 12 순서 고정", JSON.stringify(keys) === JSON.stringify(GATE_KEYS), keys.join(",") || "checks 없음");
  rec("AI티 8검사 존재", GATE_KEYS.slice(0, 8).every((k) => keys.includes(k)), GATE_KEYS.slice(0, 8).filter((k) => !keys.includes(k)).join(",") || "8/8");
  rec("게이트 실패 항목 사람말 detail", (P.gate?.checks || []).filter((c) => !c.pass).every((c) => c.detail), (P.gate?.checks || []).filter((c) => !c.pass).map((c) => c.key).join(",") || "전부 통과");
  rec("블록 타입 어휘", (P.blocks || []).every((b) => ALLOWED.block.includes(b.type)), [...new Set((P.blocks || []).map((b) => b.type))].join(","));
  rec("본문 있음", typeof P.bodyHtml === "string" && P.bodyHtml.length > 500 && typeof P.title === "string" && P.title.length > 0, `title «${P.title}» · body ${P.bodyHtml?.length}자 · blocks ${P.blocks?.length}`);
  const aff = !!P.meta?.affiliate || P.blocks?.some((b) => b.type === "affiliate");
  if (aff || P.meta?.disclosure) rec("고지 첫 블록", P.blocks?.[0]?.type === "disclosure" && /쿠팡 파트너스 활동의 일환으로|제휴 링크가 포함/.test(P.blocks[0]?.text || ""), `blocks[0]=${P.blocks?.[0]?.type} · «${String(P.blocks?.[0]?.text || "").slice(0, 40)}»`);
  else warn("고지 첫 블록", "제휴 없는 piece 라 고지 검사 대상 아님(다른 piece 로 되짚기)");
  const imgs = P.images || [];
  rec("이미지 N장", imgs.length >= 1, `${imgs.length}장`);
  let ok200 = 0;
  for (const im of imgs) { const u = im.url?.startsWith("http") ? im.url : BASE + im.url; const r = await fetch(u, { method: "GET" }).catch(() => null); if (r && r.status === 200) ok200++; }
  rec("이미지 URL 200", imgs.length > 0 && ok200 === imgs.length, `${ok200}/${imgs.length}`, imgs[0]?.url);
  rec("이미지 캡션", imgs.every((i) => typeof i.caption === "string" && i.caption.length > 0), "");
  rec("피스 채널 = 계정 채널", P.channel === piece.channel, "");

  // 홈 todo(검수) — approve 전
  const hs = await call(jar, "/api/home-summary");
  rec("홈 todo kind:review", (hs.json?.todo || []).some((t) => t.kind === "review"), (hs.json?.todo || []).map((t) => `${t.kind}→${t.link}`).join(" "));
  rec("홈 review 링크 → pieces.html", (hs.json?.todo || []).filter((t) => t.kind === "review").every((t) => t.link === "/app/pieces.html"), "(C1 #8)");

  // 수정 저장 → 게이트 재검사
  const pu = await call(jar, "/api/pieces-update", { body: { id: piece.id, title: `${P.title} (수정)` } });
  rec("pieces-update", pu.json?.ok === true && pu.json?.gate && Array.isArray(pu.json.gate.checks) && typeof pu.json.bodyHtml === "string", `${pu.status} ${pu.json?.step || ""} bodyHtml ${typeof pu.json?.bodyHtml}`);
  // 고지 삭제 시도 → 서버가 다시 넣는가
  if (P.blocks?.[0]?.type === "disclosure") {
    const stripped = P.bodyHtml.replace(/<[^>]*disclosure[^>]*>[\s\S]*?<\/[a-z]+>/i, "");
    const pu2 = await call(jar, "/api/pieces-update", { body: { id: piece.id, bodyHtml: stripped } });
    const pg2 = await call(jar, "/api/pieces-get", { query: { id: piece.id } });
    rec("고지 삭제 → 재삽입", /쿠팡 파트너스 활동의 일환으로|제휴 링크가 포함/.test(pg2.json?.piece?.bodyHtml || "") && /파트너스|제휴 링크/.test(pu2.json?.bodyHtml || ""), `update ${pu2.status} · 응답 bodyHtml 고지 ${/파트너스|제휴 링크/.test(pu2.json?.bodyHtml || "") ? "있음" : "없음"} · 저장본 ${/파트너스|제휴 링크/.test(pg2.json?.piece?.bodyHtml || "") ? "있음" : "없음"}`);
  }

  // 승인
  const pa = await call(jar, "/api/pieces-approve", { body: { id: piece.id } });
  rec("pieces-approve → scheduled", pa.json?.ok === true && pa.json?.status === "scheduled" && typeof pa.json?.scheduledFor === "string", `${pa.status} ${pa.json?.step || ""} ${pa.json?.error || ""}`, `piece id=${piece.id} scheduledFor=${pa.json?.scheduledFor}`);
  if (pa.json?.ok === false) rec("approve ✗ 모양(step gate + gate)", pa.json.step === "gate" && Array.isArray(pa.json.gate?.checks), (pa.json.gate?.checks || []).filter((c) => !c.pass).map((c) => c.key).join(",") || "gate 없음");

  // 편성 규칙(주 3회) → 슬롯 7일치 · 멱등
  const rl = await call(jar, "/api/rules-list");
  checkShape("rules-list 모양", rl.json, S.rulesList); if (rl.json?.settings) checkShape("settings 모양(변수 8)", rl.json.settings, S.settings);
  const rs = await call(jar, "/api/rules-save", { body: { rules: [{ channel: "naver_blog", kind: "post", accountMode: "auto", every: "week", count: 3, active: true }] } });
  const activeRules = (rs.json?.rules || []).filter((r) => r.active);   // 비활성(지난 라운드) 규칙도 목록에 실린다 — 화면(A)도 active 만 그린다
  rec("rules-save 주3회", rs.json?.ok === true && activeRules.length === 1 && rs.json?.coinsPerWeek > 0, `${rs.status} ${rs.json?.step || ""} coinsPerWeek ${rs.json?.coinsPerWeek} slotsCreated ${rs.json?.slotsCreated}`, `rule id=${rs.json?.rules?.[0]?.id}`);
  if (rs.json?.rules?.[0]) checkShape("Rule 모양", rs.json.rules[0], S.rule);
  rec("coinsPerWeek = 3×(1+6)", rs.json?.coinsPerWeek === 21, `${rs.json?.coinsPerWeek}(네이버 기본 이미지 6 가정)`);
  const rs2 = await call(jar, "/api/rules-save", { body: { rules: rs.json?.rules?.map(({ id, channel, kind, accountMode, every, count, active }) => ({ id, channel, kind, accountMode, every, count, active })) || [] } });
  rec("rules-save 멱등(slotsCreated 0)", rs2.json?.ok === true && rs2.json?.slotsCreated === 0, `slotsCreated ${rs2.json?.slotsCreated}`);
  const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const from = kst(new Date()), to = kst(new Date(Date.now() + 7 * 86400e3));
  const sl = await call(jar, "/api/slots-list", { query: { from, to } });
  const slots = sl.json?.slots || [];
  if (slots[0]) checkShape("Slot 모양", slots[0], S.slot);
  const planned = slots.filter((s) => s.origin === "auto" && s.channel === "naver_blog" && s.status !== "skipped");   // 건너뛴 슬롯은 편성이 아니다
  rec("슬롯 7일치(주3회 → ≥3)", planned.length >= 3 && planned.length <= 4, `${from}~${to} auto ${planned.length}개 · 전체 ${slots.length}`, planned.map((s) => `${s.date}${s.publishAt ? "@" + s.publishAt : ""}`).join(","));
  const dates = planned.map((s) => s.date); rec("슬롯 날짜 중복 0(활성 규칙 1개 기준)", new Set(dates).size === dates.length, dates.join(","));
  const stuckList = (all.json?.pieces || []).filter((x) => x.status === "generating" && Date.now() - new Date(x.createdAt).getTime() > 20 * 60 * 1000);
  rec("생성중에 멈춘 글 0(20분 초과)", stuckList.length === 0, stuckList.map((x) => x.id + ":" + x.stage).join(",") || "없음");
  rec("수동 슬롯(origin manual) 존재", slots.some((s) => s.origin === "manual" && s.pieceId === piece.id), "");
  const quiet = planned[1]?.date;
  const st = await call(jar, "/api/rules-settings", { body: { produceLeadDays: 3, reviewPolicy: "silence_approves", topicLeadDays: 7, produceHour: "06:00", bestTimeMode: "auto", weeklyCoinCap: null, quietDays: quiet ? [quiet] : [], horizonDays: 14 } });
  rec("rules-settings(8키 왕복)", st.json?.ok === true && st.json?.settings?.produceLeadDays === 3 && st.json?.settings?.produceHour === "06:00" && Array.isArray(st.json?.settings?.quietDays), `${st.status} ${st.json?.step || ""}`);
  if (st.json?.settings) checkShape("rules-settings 응답 ScheduleSettings", st.json.settings, S.settings);
  const ts2 = await call(jar, "/api/tenant-settings", { body: { autoSchedule: true } });
  const rl2 = await call(jar, "/api/rules-list");
  rec("두 경로 한 jsonb(tenant-settings↔rules-list)", ts2.json?.ok === true && rl2.json?.settings?.autoSchedule === true && rl2.json?.settings?.produceHour === "06:00", `autoSchedule ${rl2.json?.settings?.autoSchedule} produceHour ${rl2.json?.settings?.produceHour}`);
  if (quiet) { const rs3 = await call(jar, "/api/rules-save", { body: { rules: rs.json?.rules?.map(({ id, channel, kind, accountMode, every, count, active }) => ({ id, channel, kind, accountMode, every, count, active })) || [] } }); const sl3 = await call(jar, "/api/slots-list", { query: { from, to } }); const onQuiet = (sl3.json?.slots || []).filter((s) => s.origin === "auto" && s.date === quiet && s.status !== "skipped"); warn("quietDays 재롤(기존 슬롯 처리는 설계 미정)", `quiet ${quiet} 슬롯 ${onQuiet.length}개 · 재저장 slotsCreated ${rs3.json?.slotsCreated}`); }
  const hs2 = await call(jar, "/api/home-summary");
  rec("홈 todaySlots 배열", Array.isArray(hs2.json?.todaySlots), `오늘 ${hs2.json?.todaySlots?.length}건`);
  if (slots.some((s) => s.date === from)) rec("홈 오늘 편성 반영", (hs2.json?.todaySlots || []).length >= 1, "");
  else warn("홈 오늘 편성 반영", "오늘 날짜 슬롯 없음(요일 분산) — 판정 보류");
  if (planned[0]) { const sk = await call(jar, "/api/slots-skip", { body: { id: planned[0].id } }); rec("slots-skip", sk.json?.ok === true, `${sk.status}`); }

  // 보안: 타 테넌트 IDOR
  await signIn(jar2, EMAIL2);
  const x1 = await call(jar2, "/api/pieces-get", { query: { id: piece.id } });
  rec("IDOR pieces-get 타 테넌트", [403, 404].includes(x1.status) || x1.json?.ok === false, `${x1.status} ${x1.json?.step || ""}`);
  const x2 = await call(jar2, "/api/accounts-remove", { body: { id: ids.naver_blog } });
  const still = (await call(jar, "/api/accounts-list")).json?.accounts?.some((a) => a.id === ids.naver_blog);
  rec("IDOR accounts-remove 타 테넌트", ([403, 404].includes(x2.status) || x2.json?.ok === false) && still === true, `${x2.status} · 원래 계정 ${still ? "유지" : "삭제됨!"}`);
  const x3 = await call(jar2, "/api/pieces-approve", { body: { id: piece.id } });
  rec("IDOR pieces-approve 타 테넌트", x3.json?.ok !== true, `${x3.status}`);

  finish();
}

function finish() {
  // 자격 평문 0 — 모든 응답 본문에서 비밀번호 값·password 키(요청 아님) 검색
  const leak = bodies.filter((b) => b.text.includes(CRED_PASSWORD));
  rec("자격 평문 0(응답 본문)", leak.length === 0, leak.length ? leak.map((b) => b.path).join(",") : `${bodies.length}개 응답 검사`);
  const pwKey = bodies.filter((b) => /"password"\s*:/.test(b.text) || /"appPassword"\s*:/.test(b.text));
  rec("password 키 0(응답 본문)", pwKey.length === 0, pwKey.length ? pwKey.map((b) => b.path).join(",") : "");
  const fails = results.filter((r) => r.ok === "FAIL").length, warns = results.filter((r) => r.ok === "WARN").length;
  const w = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
  console.log(`\nP1R1 C2 하니스 · ${BASE} · ${new Date().toISOString()}\n${"─".repeat(120)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 34)} ${w(r.note, 70)} ${r.evidence ? "| " + String(r.evidence).slice(0, 60) : ""}`);
  console.log(`${"─".repeat(120)}\nPASS ${results.length - fails - warns} · FAIL ${fails} · WARN ${warns} · ${Math.round((Date.now() - t0) / 1000)}s`);
  mkdirSync("_verify", { recursive: true });
  const out = `_verify/p1r1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ base: BASE, at: new Date().toISOString(), email: EMAIL, results }, null, 2));
  console.log(`→ ${out}`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); rec("하니스 예외", false, String(e?.stack || e)); finish(); });
