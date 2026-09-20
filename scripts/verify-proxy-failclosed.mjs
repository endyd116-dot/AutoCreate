/**
 * scripts/verify-proxy-failclosed.mjs — 🔴 **프록시 fail-closed 가 진짜 무나**(DESIGN §7.3b · B 2026-09-21)
 *
 *   ══ 왜 이 자인가 ══
 *   설계는 «배정된 프록시가 없거나 죽으면 **잡을 멈춘다** · 우리 IP 로 절대 폴백하지 않는다»고 적어 뒀는데,
 *   2026-09-21 에 재 보니 **절반만 물고 있었다**:
 *     · 물었다 — 프록시가 붙어 있고 **나가는 IP 가 다를 때**(러너가 `errorKind:"proxy"` 로 멈춘다)
 *     · 🔴 **안 물었다** — 아예 **배정이 없을 때**. 러너의 `if (account.proxyUrl)` 가 검사 자체를 건너뛰어
 *       관리형 기기(=우리 서버)가 **우리 IP 로 그대로 내보내고 있었다.** 이 기능이 막으려던 바로 그 상태다.
 *     · 🔴 **안 물었다** — 프록시가 `down` 일 때. 서버가 러너 보고를 받고 `status='down'` 으로 내려 놓고선
 *       **다음 claim 이 그 down 을 안 봤다**(`p_status` 를 SELECT 만 하고 안 썼다). 자기가 내리고 자기가 무시했다.
 *
 *   ⚠️ **이건 CLAUDE §9 의 «게이트»가 아니다** — 고객 글에 대한 우리 판단이 아니라 **«없는 길»**이다.
 *      전용 IP 가 없으면 그 길로 나갈 방법이 없다. 그래서 §9 가 요구하는 것은 «막지 마라»가 아니라 **«말해 줘라»**이고,
 *      이 자의 ③축이 그걸 잰다(멈춘 것이 **보이나**).
 *
 *   ══ 재는 것 ══
 *     ① 판정표 — 제품의 `proxyFailClosed` 를 **실제로 돌려** 8가지 경우가 설계대로 갈리나
 *     ② 사슬  — 그 판정이 `claimJobs` 에 **물려** 있나(기기 종류를 넘기나 · 멈추면 잡을 되돌리나)
 *     ③ 보임  — 멈춘 것이 `ops-proxies` 로 **나오나** · 이름까지 나오나(«계정 231» 금지 · CLAUDE §3)
 *     ④ 러너  — «걸었다»가 아니라 «그 IP 로 나간다»를 실측하나(§7.3b 출구 IP 확인)
 *
 *   ══ 🔴 부정형 단언을 안 쓴다 ══
 *   «그 말이 없어야 한다»는 과녁이 사라지면 **공짜로 참**이 된다. 여기 단언은 전부 «있나»로만 적었고,
 *   ①축은 **제품 함수를 실제로 돌린 값**으로 잰다(글자 대조가 아니다).
 *
 *   ══ 🔴 스스로 변이를 넣는다 ══
 *   `--mutants` 로 돌리면 제품 소스 사본에 변이 7종을 넣고 **이 자를 다시 돌려** 축이 우는지 본다.
 *   대조군(맨 판)을 먼저 돌려 «원래 초록»임을 확인한 뒤에만 «변이 탓»이라고 말한다(AC-161).
 *
 *   종료코드: 0 = 다 물었다 · 1 = 안 무는 곳이 있다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = process.cwd();
const read = (f) => { const p = path.join(ROOT, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const JOBS = "lib/runner-jobs.ts", PROX = "lib/proxies.ts", OPS = "netlify/functions/ops-proxies.ts", CORE = "runner/core.mjs";

const fails = [], notes = [];
const ok  = (ax, m) => notes.push(`  ✓ ${ax} ${m}`);
const bad = (ax, m) => { notes.push(`  ✗ ${ax} ${m}`); fails.push(`${ax} ${m}`); };
const unk = (ax, m) => { notes.push(`  ⊘ ${ax} 못 쟀음 — ${m}`); fails.push(`${ax} 못 쟀음`); };

const src = read(JOBS);
if (!src) { console.error("⊘ 못 쟀어요 — lib/runner-jobs.ts 가 없다."); process.exit(2); }

/* ───────────────── ① 판정표 — 제품 함수를 **실제로 돌린다** ─────────────────
   🔴 글자 대조가 아니라 실행이다. `proxyFailClosed` 는 바깥을 안 보는 순수 함수라
      소스에서 떼어다 그대로 돌릴 수 있다(그러라고 순수하게 짰다 — 과녁을 제품 밖이 아니라 **제품 그대로** 두려고). */
function loadDecider(text) {
  const i = text.indexOf("export function proxyFailClosed");
  if (i < 0) return { err: "제품에 `proxyFailClosed` 가 없다" };
  /* 🔴 본문이 시작하는 중괄호를 찾는다 — 처음엔 `indexOf("{", ")")` 로 잡았다가 **반환 타입의 중괄호**
     (`): { stop: false } | …`)를 떠냈다. 그러면 `new Function` 이 «아무것도 안 하는 함수»가 되고
     판정표 전부가 «간다»로 나오면서, 하필 «간다»를 기대한 두 줄만 **우연히 초록**이 된다.
     ⇒ 본문 중괄호는 **줄 끝에 오는 것**이라 `{` 다음이 줄바꿈인 자리를 찾는다(타입 중괄호는 뒤에 칸이 온다). */
  const m = /\{\r?\n/.exec(text.slice(i));
  if (!m) return { err: "본문 시작 중괄호를 못 찾았다" };
  const open = i + m.index;
  let d = 0, end = -1;
  for (let k = open; k < text.length; k++) {
    if (text[k] === "{") d++;
    else if (text[k] === "}") { d--; if (d === 0) { end = k; break; } }
  }
  if (end < 0) return { err: "본문 끝을 못 찾았다" };
  try { return { fn: new Function("inp", text.slice(open + 1, end)) }; }
  catch (e) { return { err: `본문을 못 돌렸다: ${String(e?.message ?? e).slice(0, 90)}` }; }
}

const base = { deviceKind: "managed", proxyId: null, proxyStatus: null, proxyExpiresAt: null, legacyProxyUrl: false, decrypted: false };
const PAST = new Date(Date.now() - 86400000), FUT = new Date(Date.now() + 86400000);
const TABLE = [
  ["관리형 + 배정 0 → 멈춘다(no_proxy)",         { ...base },                                                                          "no_proxy"],
  ["관리형 + 옛 평문 칸 있음 → 간다",             { ...base, legacyProxyUrl: true },                                                     null],
  ["🔴 내 PC 러너 + 배정 0 → 간다(고객 자기 IP)", { ...base, deviceKind: "own" },                                                        null],
  ["관리형 + 살아 있는 프록시 → 간다",            { ...base, proxyId: 5, proxyStatus: "active", proxyExpiresAt: FUT, decrypted: true },   null],
  ["관리형 + status=down → 멈춘다",               { ...base, proxyId: 5, proxyStatus: "down", decrypted: true },                         "proxy_down"],
  ["관리형 + status=expired → 멈춘다",            { ...base, proxyId: 5, proxyStatus: "expired", decrypted: true },                      "proxy_expired"],
  ["관리형 + 기간 지난 프록시 → 멈춘다",          { ...base, proxyId: 5, proxyStatus: "active", proxyExpiresAt: PAST, decrypted: true },  "proxy_expired"],
  ["관리형 + 복호화 실패 → 멈춘다",               { ...base, proxyId: 5, proxyStatus: "active", proxyExpiresAt: FUT, decrypted: false },  "proxy_decrypt_failed"],
];

notes.push("■ ① 판정표 — 제품의 `proxyFailClosed` 를 실제로 돌린다");
const dec = loadDecider(src);
if (dec.err) unk("①", dec.err);
else for (const [name, inp, want] of TABLE) {
  let got;
  try { got = dec.fn(inp); } catch (e) { bad("①", `${name} — 돌다 죽었다: ${String(e?.message ?? e).slice(0, 80)}`); continue; }
  const gotReason = got?.stop ? String(got.reason ?? "") : null;
  if (gotReason === want) ok("①", name);
  else bad("①", `${name} — 기대 ${want ?? "가야 한다"} · 나온 것 ${gotReason ?? "간다"}`);
}

/* ───────────────── ② 사슬 — 판정이 제품에 물려 있나 ───────────────── */
notes.push("■ ② 사슬 — 그 판정이 claim 에 물려 있나");
const chain = [
  ["claim 이 기기 종류를 넘긴다", /loadAccountForRunner\([^)]*device\.kind/s],
  ["판정을 부른다",               /proxyFailClosed\(\{/],
  ["멈추면 잡을 내주지 않는다",   /if \(fc\.stop\) return \{ ok: false, stop: fc\.reason \}/],
  ["claim 이 멈춤을 받아 낸다",   /if \(!loaded\.ok && "stop" in loaded\)/],
  ["잡을 큐로 되돌린다",          /UPDATE runner_jobs SET status = 'queued'[\s\S]{0,240}error_kind = \$\{loaded\.stop\}/],
  ["되풀이를 큐로 누른다",        /due_at = NOW\(\) \+ INTERVAL '10 minutes'/],
  ["감사에 남긴다(high)",         /action: "proxy_fail_closed"[\s\S]{0,140}riskLevel: "high"|riskLevel: "high"[\s\S]{0,140}action: "proxy_fail_closed"/],
  ["고객에게 알린다",             /INSERT INTO notifications[\s\S]{0,240}PROXY_STOP_MESSAGE\[loaded\.stop\]/],
  ["알림을 하루 1건으로 누른다",  /NOT EXISTS \(SELECT 1 FROM notifications[\s\S]{0,200}24 hours/],
];
for (const [name, re] of chain) (re.test(src) ? ok : bad)("②", name);

/* ───────────────── ③ 보임 — 멈춘 것이 화면으로 나오나 ───────────────── */
notes.push("■ ③ 보임 — 멈춘 것이 운영 화면으로 나오나(§9 «말해 주기»)");
const prox = read(PROX), ops = read(OPS);
if (!prox || !ops) unk("③", `${!prox ? PROX : OPS} 가 없다`);
else {
  const seen = [
    ["집계가 있다",               prox, /export async function proxyStopped/],
    ["멈춤 표식으로 센다",        prox, /error_kind IN \('no_proxy', 'proxy_down', 'proxy_expired', 'proxy_decrypt_failed'\)/],
    ["🔴 계정 이름까지 준다",     prox, /handle: String\(r\.handle/],
    ["🔴 테넌트 이름까지 준다",   prox, /tenantName: String\(r\.tenant_name/],
    ["아직 안 돌아 본 쪽도 센다", prox, /account_slots WHERE status = 'waiting_ip'/],
    ["운영 응답이 그걸 싣는다",   ops,  /stopped: await proxyStopped\(\)/],
  ];
  for (const [name, text, re] of seen) (re.test(text) ? ok : bad)("③", name);
}

/* ───────────────── ④ 러너 쪽 — 배정된 IP 는 실측으로 대조하나 ─────────────────
   🔴 서버가 관리형에 프록시 없는 잡을 안 주게 된 뒤에도, **설정만 믿지 않는다**(§7.3b «출구 IP 확인»)는 살아 있어야 한다. */
notes.push("■ ④ 러너 — «걸었다»가 아니라 «그 IP 로 나간다»를 재나");
const core = read(CORE);
if (!core) unk("④", "runner/core.mjs 가 없다");
else {
  (/const ip = await exitIp\(ctx\)/.test(core) ? ok : bad)("④", "잡 시작에 나가는 IP 를 실제로 조회한다");
  (/errorKind: "proxy"/.test(core) ? ok : bad)("④", "기대와 다르면 멈추고 `proxy` 로 보고한다");
  (/if \(!ip\) \{[\s\S]{0,140}그대로 진행/.test(core) ? ok : bad)("④", "🔴 «못 읽었다»를 «틀렸다»로 바꾸지 않는다(AC-9 3값)");
}

/* ───────────────── 찍기 ───────────────── */
console.log("─".repeat(100));
console.log(`프록시 fail-closed — 축 ${notes.filter((l) => /^  [✓✗⊘]/.test(l)).length}개 · 어긋난 곳 ${fails.length}`);
for (const l of notes) console.log(l);
console.log("─".repeat(100));
if (!process.argv.includes("--mutants")) process.exit(fails.length ? 1 : 0);

/* ═════════════════ 🔴 변이 — 이 자가 정말 무는지 내가 나를 잰다 ═════════════════
   제품 파일을 **건드리지 않는다**. 사본을 임시 폴더에 두고 그 폴더를 작업 폴더로 삼아 이 자를 다시 돌린다. */
const FILES = [JOBS, PROX, OPS, CORE];
const SELF = path.join(ROOT, "scripts", "verify-proxy-failclosed.mjs");

function runIn(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-fc-"));
  try {
    const box = {};
    for (const f of FILES) { const t = read(f); if (t === null) return { err: `${f} 없음` }; box[f] = t; }
    const before = JSON.stringify(box);
    if (transform) transform(box);
    const changed = JSON.stringify(box) !== before;
    for (const f of FILES) { mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); writeFileSync(path.join(dir, f), box[f]); }
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [SELF], { cwd: dir, encoding: "utf8" }); }
    catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    return { code, out, changed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n■ 🔴 변이 — 내가 정말 무는가(대조군을 먼저 돌린다 · AC-161)");
const ctrl = runIn(null);
if (ctrl.err) { console.log(`  ⊘ 못 쟀음 — ${ctrl.err}`); process.exit(2); }
if (ctrl.code !== 0) { console.log("  ⊘ 못 쟀음 — 대조군(맨 판)이 이미 빨갛다. 변이 탓을 말할 수 없다."); process.exit(2); }
console.log("  ✓ 대조군(맨 판) 초록 — 이제 변이가 울리는지 본다");

const MUT = [
  ["관리형 판정을 뒤집는다",         (b) => { b[JOBS] = b[JOBS].replace('if (String(inp.deviceKind ?? "") !== "managed") return { stop: false };', 'if (String(inp.deviceKind ?? "") === "managed") return { stop: false };'); }, "①"],
  ["«배정 0» 을 통과시킨다",         (b) => { b[JOBS] = b[JOBS].replace('return { stop: true, reason: "no_proxy" };', "return { stop: false };"); }, "①"],
  ["죽은 프록시를 통과시킨다",       (b) => { b[JOBS] = b[JOBS].replace('if (st !== "active") return { stop: true, reason: "proxy_down" };', ""); }, "①"],
  ["claim 이 기기 종류를 안 넘긴다", (b) => { b[JOBS] = b[JOBS].replace(", deviceCaps, device.kind)", ", deviceCaps)"); }, "②"],
  ["멈춰도 잡을 그냥 내준다",        (b) => { b[JOBS] = b[JOBS].replace("if (fc.stop) return { ok: false, stop: fc.reason };", ""); }, "②"],
  ["멈춘 것을 화면에 안 싣는다",     (b) => { b[OPS] = b[OPS].replace("stopped: await proxyStopped(),", ""); }, "③"],
  ["이름 없이 id 만 준다",           (b) => { b[PROX] = b[PROX].replace(/tenantName: String\(r\.tenant_name \?\? ""\),/, ""); }, "③"],
];
let silent = 0;
for (const [name, tf, axis] of MUT) {
  const r = runIn(tf);
  if (!r.changed) { console.log(`  ⊘ ${name} — 🔴 **변이가 안 먹었다**(과녁 글자가 바뀐 것 같다). 통과로 세지 않는다.`); silent++; continue; }
  const cried = r.code !== 0 && new RegExp(`✗ ${axis}`).test(r.out);
  if (cried) console.log(`  ✓ ${name} → ${axis}축이 운다`);
  else { console.log(`  ✗ ${name} → 🔴 **안 운다**(종료 ${r.code}) — 이 자가 그 자리를 못 보고 있다`); silent++; }
}
console.log("─".repeat(100));
console.log(silent ? `🔴 변이 ${silent}종이 안 울었다 — 자를 고쳐야 한다` : `✓ 변이 ${MUT.length}종이 모두 제 축을 울렸다`);
process.exit(fails.length || silent ? 1 : 0);
