/**
 * scripts/verify-ops-screen-fields.mjs — 🔴 **«응답에 있나»가 아니라 «화면이 그릴 수 있나»**로 잰다
 *   (B · 2026-09-21 · 메인 트리거 ⑵)
 *
 *   ══ 왜 이 자인가 ══
 *   서버가 `{ tenantId: 778, pieceId: 91, accountId: 231 }` 을 준다고 화면이 그려지는 게 아니다.
 *   그러면 A 는 **«테넌트 778 의 글 91 을 내릴까요?»** 라고 쓸 수밖에 없고, 그건 CLAUDE §3 이 금지한
 *   시스템 용어다. 더 나쁜 건 그 화면이 **되돌릴 수 없는 단추**(계정 연결 해제 · 서비스 정지)를 달고 있다는 것 —
 *   운영자가 **누구 것인지 모르고** 누르게 된다.
 *
 *   ⇒ 규칙 하나: **id 를 내보내는 자리에는 그 id 의 «이름»을 같이 내보낸다.**
 *      `tenantId` ↔ `tenantName` · `accountId` ↔ `accountHandle` · `pieceId` ↔ `pieceTitle`
 *
 *   ══ 재는 것 ══
 *     ① 짝    — 위 규칙. 응답을 짓는 자리마다 id 옆에 이름이 있나
 *     ② 문    — A 가 부를 문이 실제로 열려 있나(GET/POST 까지 · 405 로 막혀 있지 않나)
 *     ③ 권한  — 운영 문 **전수** `requireAdmin`(로그인 문 `ops-auth` 만 예외 — 거기서 로그인을 한다)
 *     ④ 감사  — 되돌릴 수 없는 동작에 `writeAudit` 이 high 이상으로 붙나
 *     ⑤ 정직  — 키가 없을 때 **스텁도 조용한 성공도 아니게** 말하나 · 화면이 **미리** 알 수 있나
 *
 *   ══ 🔴 과녁을 제품 밖에 두지 않는다 ══
 *   «그 글자가 없어야 한다»로 적지 않았다. 전부 «있나»다 — 부정형은 과녁이 사라지면 공짜로 참이 된다.
 *
 *   `--mutants` = 제품 사본에 변이를 넣고 이 자를 다시 돌려 **내가 정말 무는지** 본다.
 *   종료코드: 0 = 다 됐다 · 1 = 빈 칸이 있다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = process.cwd();
const read = (f) => { const p = path.join(ROOT, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const TD = "netlify/functions/ops-takedown.ts", PX = "netlify/functions/ops-proxies.ts";
const RV = "netlify/functions/revenue.ts", LTD = "lib/takedown.ts", LPX = "lib/proxies.ts";
const FILES = [TD, PX, RV, LTD, LPX];

const fails = [], notes = [];
const ok  = (ax, m) => notes.push(`  ✓ ${ax} ${m}`);
const bad = (ax, m) => { notes.push(`  ✗ ${ax} ${m}`); fails.push(`${ax} ${m}`); };
const unk = (ax, m) => { notes.push(`  ⊘ ${ax} 못 쟀음 — ${m}`); fails.push(`${ax} 못 쟀음`); };

const T = {}; for (const f of FILES) T[f] = read(f);
const missing = FILES.filter((f) => T[f] === null);
if (missing.length) { console.error(`⊘ 못 쟀어요 — ${missing.join(", ")} 가 없다.`); process.exit(2); }

/* ───────────── ① 짝 — id 옆에 이름이 있나 ─────────────
   🔴 «같은 응답 덩이 안에» 있는지까지 본다. 파일 어딘가에 `tenantName` 이 있다고 그 목록이 그려지는 게 아니다.
      그래서 덩이를 **글자 범위로 잘라** 그 안에서만 찾는다(범위를 안 자르면 이 축은 공짜로 초록이 된다). */
function inRange(text, startNeedle, span, needle) {
  const i = text.indexOf(startNeedle);
  return i >= 0 && text.slice(i, i + span).includes(needle);
}
notes.push("■ ① 짝 — id 를 주는 자리에 그 id 의 «이름»이 같이 오나(«테넌트 778» 금지 · CLAUDE §3)");
/* 🔴 과녁은 **값을 싣는 자리**다 — 처음엔 `"tenantName:"` 로 찾다가 `dueNotices` 의 **반환 타입 선언**
   (`Promise<{ …; tenantName: string; … }>`)을 짚어, 값을 통째로 빼도 초록이 나왔다(변이가 잡았다).
   ⇒ 전부 `이름: String(…` 같은 **대입 모양**으로 적는다. 타입은 화면에 안 나간다. */
const PAIRS = [
  ["내리기 목록: 테넌트 이름",   TD, "notices: rows.map", 1600, "tenantName: String(r.tenant_name"],
  ["내리기 목록: 글 제목",       TD, "notices: rows.map", 1600, "pieceTitle: String(r.piece_title"],
  ["내리기 목록: 계정 이름",     TD, "notices: rows.map", 1600, "accountHandle: r.account_handle"],
  ["내리기 목록: 기한",          TD, "notices: rows.map", 1600, "dueAt: utcDate(r.due_at)"],
  ["내리기 상세: 테넌트 이름",   TD, "ok: true, notice: {", 1800, "tenantName: String(r.tenant_name"],
  ["내리기 상세: 글 제목",       TD, "ok: true, notice: {", 1800, "pieceTitle: String(r.piece_title"],
  ["내리기 상세: 계정 이름",     TD, "ok: true, notice: {", 1800, "accountHandle: r.account_handle"],
  ["내리기 상세: 지금까지 한 일", TD, "ok: true, notice: {", 2600, "trail: trail.map("],
  ["운영 대기열: 테넌트 이름",   LTD, "export async function dueNotices", 1600, "tenantName: String(r.tenant_name"],
  ["운영 대기열: 글 제목",       LTD, "export async function dueNotices", 1600, "title: String(r.piece_title"],
  ["운영 대기열: 며칠 지났나",   LTD, "export async function dueNotices", 1600, "overdueDays: due ?"],
  ["멈춘 계정: 테넌트 이름",     LPX, "accounts: rows.map", 700, "tenantName: String(r.tenant_name"],
  ["멈춘 계정: 계정 이름",       LPX, "accounts: rows.map", 700, "handle: String(r.handle"],
  ["기다리는 계정: 이름",        LPX, "waiting: waiting.map", 700, "tenantName: String(r.tenant_name"],
  ["기다리는 계정: 계정 이름",   LPX, "waiting: waiting.map", 700, "handle: String(r.handle"],
  ["프록시 목록: 쓰는 계정 이름", PX, "assignedTo:", 200, "handle: String(r.account_handle"],
];
for (const [name, f, start, span, needle] of PAIRS) (inRange(T[f], start, span, needle) ? ok : bad)("①", name);

/* ───────────── ② 문 — A 가 부를 문이 실제로 열려 있나 ───────────── */
notes.push("■ ② 문 — A 가 부를 여섯 문이 열려 있나(경로 등록 + 그 메서드까지)");
const DOORS = [
  ["/api/ops-takedowns (GET 목록)",   TD, /path: \[[^\]]*"\/api\/ops-takedowns"/,       /ops-takedowns"\)\) \{\s*\n\s*if \(req\.method !== "GET"/],
  ["/api/ops-takedown (GET 단건)",    TD, /path: \[[^\]]*"\/api\/ops-takedown"/,        /ops-takedown"\) && req\.method === "GET"/],
  ["/api/ops-takedown-action (POST)", TD, /path: \[[^\]]*"\/api\/ops-takedown-action"/, /ops-takedown-action"\)\)/],
  ["/api/ops-proxies (GET)",          PX, /path: \[[^\]]*"\/api\/ops-proxies"/,         /if \(req\.method === "GET"\)/],
  ["/api/ops-proxy-assign (POST)",    PX, /path: \[[^\]]*"\/api\/ops-proxy-assign"/,    /ops-proxy-assign"\)\)/],
  ["/api/revenue-oauth-start",        RV, /path: \[[^\]]*"\/api\/revenue-oauth-start"/, /revenue-oauth-start"\)\)/],
];
for (const [name, f, pathRe, bodyRe] of DOORS) {
  if (!pathRe.test(T[f])) bad("②", `${name} — 경로가 등록되지 않았다(누락 시 404 · CLAUDE §4.2)`);
  else if (!bodyRe.test(T[f])) bad("②", `${name} — 경로는 있는데 그 메서드를 받는 갈래가 없다`);
  else ok("②", name);
}

/* ───────────── ③ 권한 — 운영 문 전수 ───────────── */
notes.push("■ ③ 권한 — 운영 문 전수 `requireAdmin`");
const opsFiles = readdirSync(path.join(ROOT, "netlify", "functions")).filter((f) => /^ops-.*\.ts$/.test(f));
if (!opsFiles.length) unk("③", "netlify/functions 에 ops-*.ts 가 없다");
else {
  // `ops-auth.ts` 는 **로그인 문**이라 예외다 — 거기서 운영자가 로그인한다(있어야 할 예외를 «빠진 것»으로 세지 않는다).
  const naked = opsFiles.filter((f) => f !== "ops-auth.ts" && !readFileSync(path.join(ROOT, "netlify", "functions", f), "utf8").includes("requireAdmin"));
  if (naked.length) bad("③", `문 지킴이가 없는 운영 문 ${naked.length}종 — ${naked.join(", ")}`);
  else ok("③", `ops-*.ts ${opsFiles.length}종 중 ${opsFiles.length - 1}종이 requireAdmin(로그인 문 ops-auth 만 예외)`);
  (/requireAdmin\(req, \["admin", "super_admin"\]\)/.test(T[TD]) ? ok : bad)("③", "내리기 문은 admin 이상");
  (/requireAdmin\(req, \["admin", "super_admin"\]\)/.test(T[PX]) ? ok : bad)("③", "프록시 문은 admin 이상");
  (/requireAdmin\(req, \["super_admin"\]\)/.test(T[PX]) ? ok : bad)("③", "🔴 IP 등록은 super_admin(계정 신원을 바꾸는 일)");
}

/* ───────────── ④ 감사 — 되돌릴 수 없는 동작 ───────────── */
notes.push("■ ④ 감사 — 되돌릴 수 없는 동작이 감사에 남나(high 이상)");
const AUDITS = [
  ["접수",             LTD, /action: "takedown_received"[\s\S]{0,200}riskLevel: "high"|riskLevel: "high"[\s\S]{0,200}action: "takedown_received"/],
  ["🔴 계정 연결 해제", LTD, /action: "takedown_disconnect"[\s\S]{0,200}riskLevel: "high"/],
  ["🔴 서비스 정지",    LTD, /action: "takedown_suspend"[\s\S]{0,200}riskLevel: "critical"/],
  ["종결·기각",        LTD, /action: "takedown_resolved"[\s\S]{0,200}riskLevel: "high"/],
  ["IP 등록",          PX,  /action: "ops_proxy_add"[\s\S]{0,300}riskLevel: "high"/],
  ["IP 배정",          PX,  /action: "ops_proxy_assign"[\s\S]{0,200}riskLevel: "medium"/],
  ["IP 해제",          PX,  /action: "ops_proxy_release"[\s\S]{0,200}riskLevel: "medium"/],
  ["수익 연결",        RV,  /action: "revenue_source_connect"/],
];
for (const [name, f, re] of AUDITS) (re.test(T[f]) ? ok : bad)("④", name);

/* ───────────── ⑤ 정직 — 키가 없을 때 ───────────── */
notes.push("■ ⑤ 정직 — 키가 없을 때 «아직»이라고 말하나(스텁 금지 · 조용한 성공 금지)");
(/step: "provider_not_configured"/.test(T[RV]) ? ok : bad)("⑤", "`provider_not_configured` 를 그대로 준다");
(/if \(!to\) \{[\s\S]{0,900}provider_not_configured/.test(T[RV]) ? ok : bad)("⑤", "동의 URL 을 못 만들면 **리다이렉트로 안 넘어간다**(조용한 성공 0)");
(/notready=/.test(T[RV]) ? ok : bad)("⑤", "🔴 브라우저 이동이면 화면으로 돌려보낸다(날 JSON 막다른 길 금지 · §4.8)");
(/oauthReady: googleAppConfigured\(\)/.test(T[RV]) ? ok : bad)("⑤", "🔴 화면이 **미리** 안다(§7.5 connectable — 눌러야 아는 단추 금지)");

/* ───────────── 찍기 ───────────── */
console.log("─".repeat(100));
console.log(`화면이 그릴 수 있나 — 축 ${notes.filter((l) => /^  [✓✗⊘]/.test(l)).length}개 · 빈 칸 ${fails.length}`);
for (const l of notes) console.log(l);
console.log("─".repeat(100));
if (!process.argv.includes("--mutants")) process.exit(fails.length ? 1 : 0);

/* ═════════ 🔴 변이 — 내가 정말 무는가(제품 무접촉 · 사본에서만) ═════════ */
const SELF = path.join(ROOT, "scripts", "verify-ops-screen-fields.mjs");
function runIn(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-of-"));
  try {
    const box = {}; for (const f of FILES) box[f] = T[f];
    const before = JSON.stringify(box);
    if (transform) transform(box);
    const changed = JSON.stringify(box) !== before;
    for (const f of FILES) { mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); writeFileSync(path.join(dir, f), box[f]); }
    // ③축은 폴더를 훑으므로 사본에도 ops-*.ts 가 있어야 한다 — 원본 폴더를 통째로 옮겨 둔다.
    const fnDir = path.join(ROOT, "netlify", "functions");
    for (const f of readdirSync(fnDir).filter((x) => /^ops-.*\.ts$/.test(x))) {
      const rel = `netlify/functions/${f}`;
      if (!(rel in box)) writeFileSync(path.join(dir, rel), readFileSync(path.join(fnDir, f), "utf8"));
    }
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [SELF], { cwd: dir, encoding: "utf8" }); }
    catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    return { code, out, changed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n■ 🔴 변이 — 내가 정말 무는가(대조군을 먼저 · AC-161)");
const ctrl = runIn(null);
if (ctrl.code !== 0) { console.log("  ⊘ 못 쟀음 — 대조군(맨 판)이 이미 빨갛다. 변이 탓을 말할 수 없다."); process.exit(2); }
console.log("  ✓ 대조군(맨 판) 초록");
const MUT = [
  ["목록에서 글 제목을 뺀다",       (b) => { b[TD] = b[TD].replace(/\n\s*pieceTitle: String\(r\.piece_title[^\n]*\n/, "\n"); }, "①"],
  ["대기열에서 테넌트 이름을 뺀다", (b) => { b[LTD] = b[LTD].replace(/tenantName: String\(r\.tenant_name \?\? ""\),/, ""); }, "①"],
  ["단건 GET 을 닫는다",            (b) => { b[TD] = b[TD].replace('path.endsWith("/ops-takedown") && req.method === "GET"', "false"); }, "②"],
  ["정지 감사를 low 로 내린다",     (b) => { b[LTD] = b[LTD].replace('action: "takedown_suspend", actorType: "operator", actorId: operatorId, ip: ip ?? null, riskLevel: "critical"', 'action: "takedown_suspend", actorType: "operator", actorId: operatorId, ip: ip ?? null, riskLevel: "low"'); }, "④"],
  ["IP 등록을 admin 에게 연다",     (b) => { b[PX] = b[PX].replace('requireAdmin(req, ["super_admin"])', 'requireAdmin(req, ["admin"])'); }, "③"],
  ["키 없을 때 조용히 넘긴다",      (b) => { b[RV] = b[RV].replace(/step: "provider_not_configured"/g, 'step: "ok"'); }, "⑤"],
  ["화면이 미리 알 길을 막는다",    (b) => { b[RV] = b[RV].replace("oauthReady: googleAppConfigured()", "manualOnly: true"); }, "⑤"],
];
let silent = 0;
for (const [name, tf, axis] of MUT) {
  const r = runIn(tf);
  if (!r.changed) { console.log(`  ⊘ ${name} — 🔴 **변이가 안 먹었다**(과녁 글자가 바뀐 듯). 통과로 세지 않는다.`); silent++; continue; }
  const cried = r.code !== 0 && new RegExp(`✗ ${axis}`).test(r.out);
  if (cried) console.log(`  ✓ ${name} → ${axis}축이 운다`);
  else { console.log(`  ✗ ${name} → 🔴 **안 운다**(종료 ${r.code}) — 이 자가 그 자리를 못 본다`); silent++; }
}
console.log("─".repeat(100));
console.log(silent ? `🔴 변이 ${silent}종이 안 울었다 — 자를 고쳐야 한다` : `✓ 변이 ${MUT.length}종이 모두 제 축을 울렸다`);
process.exit(fails.length || silent ? 1 : 0);
