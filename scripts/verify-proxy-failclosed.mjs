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
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.cwd();
const read = (f) => { const p = path.join(ROOT, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
/* 🔴 [2026-09-22 · AC-193] **주석이 코드의 알리바이가 된다**(B2 가 오늘 넷째 꼴로 짚었다).
   덩이를 정확히 잡아도 **그 안 주석에 과녁 낱말이 있으면** 코드를 지워도 그대로 통과한다 — AC-59 의 사촌인데
   이번엔 **주석이 검사를 통과시켜 주는** 쪽이다. 이 자는 여태 **원문을 그대로** 읽고 있었다.
   ⇒ ①②③(«그 코드가 있나»)은 **주석을 걷고** 본다.
   ⚠️ ④(러너)만 **원문으로 남긴다** — 두 가지 까닭이고 둘 다 `code-only.mjs` 머리말이 경고한 자리다:
      ① `runner/core.mjs` 엔 `https?:\/\/` 꼴 정규식이 있어 걷으면 **그 줄이 통째로 사라진다**
      ② ④의 셋째 축은 `if (!ip) { … 그대로 진행` 으로 **주석을 일부러 읽는다**(«못 읽었다»를 «틀렸다»로 안 바꾼다는 뜻이
         그 자리엔 주석으로 적혀 있다). 걷으면 **맞는 제품이 빨개진다.**
      🔴 «일부러 원문»과 «안 걷어서 원문»은 다르다 — 앞엣것만 남긴다. */
const readCode = (f) => { const t = read(f); return t === null ? null : codeOnly(t); };
const JOBS = "lib/runner-jobs.ts", PROX = "lib/proxies.ts", OPS = "netlify/functions/ops-proxies.ts", CORE = "runner/core.mjs";

const fails = [], notes = [];
const ok  = (ax, m) => notes.push(`  ✓ ${ax} ${m}`);
const bad = (ax, m) => { notes.push(`  ✗ ${ax} ${m}`); fails.push(`${ax} ${m}`); };
const unk = (ax, m) => { notes.push(`  ⊘ ${ax} 못 쟀음 — ${m}`); fails.push(`${ax} 못 쟀음`); };

const src = readCode(JOBS);
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
const prox = readCode(PROX), ops = readCode(OPS);
if (!prox || !ops) unk("③", `${!prox ? PROX : OPS} 가 없다`);
else {
  /* 🔴 **덩이별로 잘라서 본다.** 파일 어딘가에 `tenantName` 이 한 번 있다고 그 목록이 그려지는 게 아니다 —
     한 덩이에서 지워도 **다른 덩이를 보고** 초록이 나온다(변이가 그걸 잡았다: 이름을 한 곳에서 빼도 안 울었다).
     그래서 시작 글자에서 정해진 길이만큼만 잘라 그 안에서 찾는다. */
  /* 🔴 길이로 자르면 **옆 덩이까지 샌다** — 700자를 줬더니 «멈춘 계정» 창이 «기다리는 계정» 블록을 먹어서,
     앞 덩이에서 이름을 빼도 뒤 덩이의 이름을 보고 초록이 났다(변이가 두 번째로 잡았다).
     ⇒ **끝 글자로 자른다.** 덩이의 경계를 말로 적으면 줄이 늘어도 창이 안 샌다. */
  /* 🔴 [2026-09-22 · AC-193] **끝 글자를 못 찾으면 «못 쟀다»다 — 900자로 넓히지 않는다.**
     여기 `i + 900` 폴백이 남아 있었다. 바로 위 주석이 「700자를 줬더니 옆 덩이까지 샜다」고 적어 두고도
     **못 찾았을 때의 길**에 그 700자가 900자로 이름만 바꿔 남아 있었던 것이다.
     B2 가 오늘 같은 결의 함정을 넘겨 줬다(C 의 `guardNear` 가 화살표 함수에서 몸통을 **파일 전체**로 잡아 영원히 초록).
     🔴 넓어진 창은 **조용히 통과시킨다.** 못 찾았으면 **못 찾았다고 말한다**(AC-141 ② · 통과로 쓰지 않는다).
     ⇒ `null` 을 내고 부르는 쪽이 `unk`(못 쟀음)로 적는다 — «없다»(false·빨강)와도 구별한다. */
  const inBlock = (text, start, end, re) => {
    const i = text.indexOf(start); if (i < 0) return null;
    const j = text.indexOf(end, i + start.length);
    if (j <= 0) return null;                 // 끝을 못 찾았다 = 우리가 덩이를 잘못 잡은 것이다
    return re.test(text.slice(i, j));
  };
  const seen = [
    ["집계가 있다",               prox, /export async function proxyStopped/],
    ["멈춤 표식으로 센다",        prox, /error_kind IN \('no_proxy', 'proxy_down', 'proxy_expired', 'proxy_decrypt_failed'\)/],
    /* «아직 한 번도 안 돌아 본 계정» — 수뿐 아니라 **누구인지**까지 봐야 재고가 왔을 때 붙일 상대를 고른다.
       🔴 처음엔 `account_slots WHERE status` 로 적었다가, ⑵ 에서 그 질의에 JOIN 이 붙자 과녁이 빗나갔다
          (자가 제 일을 해서 빨개졌다). 과녁을 **결과 모양**(`waiting:` 을 싣나)으로 옮긴다 — 질의는 또 바뀐다. */
    ["아직 안 돌아 본 쪽도 센다", prox, /'waiting_ip'/],
    ["그게 누구인지까지 준다",    prox, /waiting: waiting\.map\(/],
    ["운영 응답이 그걸 싣는다",   ops,  /stopped: await proxyStopped\(\)/],
    /* 🔴 **세는 자리가 서버인가**(2026-09-22 · AC-192 · A 의 주문 ①②).
       전에는 화면이 `proxies[]` 를 훑어 «IP 가 멈춘 계정»을 셌는데, 그 목록엔 서버가 `LIMIT 200` 이 걸려 있어
       **200을 넘으면 조용히 덜 셌다.** 그리고 «IP 가 아예 없는 계정»은 아예 셀 길이 없었다(응답에 IP 쪽만 있었다).
       ⇒ 한도 없는 집계를 서버가 준다. 과녁은 **칸 이름**(화면이 읽는 것)과 **한도가 없다**는 두 가지다. */
    ["🔴 IP 없는 계정을 서버가 센다",   prox, /AS no_proxy/],
    ["🔴 IP 가 죽은 계정을 서버가 센다", prox, /AS stalled/],
    ["🔴 그 셈에 `LIMIT` 이 안 걸려 있다", prox, /FROM accounts a WHERE \$\{tid \? sql`a\.tenant_id = \$\{tid\}` : sql`TRUE`\}/],
    /* 🔴 «플랜에 딸린 계정»까지 세면 **겁주는 숫자**가 된다 — 그 계정은 원래 전용 IP 가 없다.
       전용 IP 슬롯(`status='active'`)만 본다 · 옛 평문 칸도 IP 로 친다(`proxyFailClosed` 와 같은 눈). */
    ["🔴 «없다»를 슬롯 기준으로만 말한다", prox, /FROM account_slots s WHERE s\.account_id = a\.id AND s\.status = 'active'/],
    ["🔴 옛 평문 칸도 IP 로 친다",        prox, /a\.proxy_url IS NULL OR a\.proxy_url = ''/],
  ];
  for (const [name, text, re] of seen) (re.test(text) ? ok : bad)("③", name);
  // 이름은 **두 덩이 각각에서** 본다(멈춘 계정 / 기다리는 계정 — 어느 쪽이 비어도 그 목록은 숫자가 된다).
  const NAMED = [
    ["멈춘 계정: 테넌트 이름",    "accounts: rows.map",   "waitingSlots:", /tenantName: String\(r\.tenant_name/],
    ["멈춘 계정: 계정 이름",      "accounts: rows.map",   "waitingSlots:", /handle: String\(r\.handle/],
    ["기다리는 계정: 테넌트 이름", "waiting: waiting.map", "  };",       /tenantName: String\(r\.tenant_name/],
    ["기다리는 계정: 계정 이름",   "waiting: waiting.map", "  };",       /handle: String\(r\.handle/],
  ];
  /* 🔴 **셋을 가른다** — 있다(✓) · 없다(✗) · **덩이를 못 잡았다(⊘)**. 셋째를 둘째에 섞으면 «자가 깨진 것»이
     «제품이 틀린 것»으로 보이고, 첫째에 섞으면 **조용한 초록**이 된다. 둘 다 오늘 값을 치른 병이다. */
  for (const [name, start, end, re] of NAMED) {
    const r = inBlock(prox, start, end, re);
    if (r === null) unk("③", `${name} — 덩이의 시작·끝(«${start}» … «${end}»)을 못 잡았다. 넓혀서 답하지 않는다`);
    else (r ? ok : bad)("③", name);
  }
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
  ["멈춘 계정에서 이름을 뺀다",      (b) => { b[PROX] = b[PROX].replace(/(accounts: rows\.map[\s\S]{0,700}?)tenantName: String\(r\.tenant_name \?\? ""\),/, "$1"); }, "③"],
  ["기다리는 계정에서 이름을 뺀다",  (b) => { b[PROX] = b[PROX].replace(/(waiting: waiting\.map[\s\S]{0,700}?)tenantName: String\(r\.tenant_name \?\? ""\),/, "$1"); }, "③"],
  /* 🔴 2026-09-22 — A 의 주문 ①② 로 새로 붙인 집계. 떼 보고 우는지까지가 만든 것이다. */
  ["🔴 IP 없는 계정 셈을 뗀다",      (b) => { b[PROX] = b[PROX].replace("AS no_proxy", "AS zz_gone"); }, "③"],
  ["🔴 IP 죽은 계정 셈을 뗀다",      (b) => { b[PROX] = b[PROX].replace("AS stalled", "AS zz_gone2"); }, "③"],
  ["🔴 «없다»를 슬롯 안 보고 말한다", (b) => { b[PROX] = b[PROX].replace("FROM account_slots s WHERE s.account_id = a.id AND s.status = 'active'", "FROM account_slots s WHERE s.account_id = a.id"); }, "③"],
  ["🔴 옛 평문 칸을 IP 로 안 친다",   (b) => { b[PROX] = b[PROX].replace("a.proxy_url IS NULL OR a.proxy_url = ''", "TRUE"); }, "③"],
  /* 🔴 **넷째 꼴 — 주석이 코드의 알리바이가 된다**(B2 2026-09-22 · AC-193).
     덩이를 정확히 잡아도 **그 안 주석에 과녁 낱말이 있으면** 코드를 지워도 통과한다.
     ⇒ **코드는 지우고 낱말만 주석에 남기는** 변이를 넣는다. 주석을 안 걷는 자는 여기서 **조용히 초록**이다. */
  ["🔴 코드는 지우고 낱말만 주석에 남긴다", (b) => {
    b[PROX] = b[PROX].replace("AS no_proxy", "AS zz_alibi /* AS no_proxy */");
  }, "③"],
];
/* 🔴 **덩이를 못 잡았을 때 — «넓혀서 답하지 않고 «못 쟀다»로 적나»**(2026-09-22 · AC-193).
   여기엔 `i + 900` 폴백이 있었다(끝 글자를 못 찾으면 900자를 덩이로 쳤다). 넓어진 창은 **조용히 통과시킨다.**
   ⇒ 덩이의 **끝 표식을 지워** 그때 `⊘ 못 쟀음` 이 나오는지 본다. 이건 축이 «✗»로 우는 게 아니라 «⊘»로 적혀야 맞다. */
const CANT_MEASURE = [
  ["덩이의 끝 표식이 사라진다", (b) => { b[PROX] = b[PROX].replace("waitingSlots: waiting.length,", "wsCount: waiting.length,"); }],
];
let silent = 0;
for (const [name, tf, axis] of MUT) {
  const r = runIn(tf);
  if (!r.changed) { console.log(`  ⊘ ${name} — 🔴 **변이가 안 먹었다**(과녁 글자가 바뀐 것 같다). 통과로 세지 않는다.`); silent++; continue; }
  const cried = r.code !== 0 && new RegExp(`✗ ${axis}`).test(r.out);
  if (cried) console.log(`  ✓ ${name} → ${axis}축이 운다`);
  else { console.log(`  ✗ ${name} → 🔴 **안 운다**(종료 ${r.code}) — 이 자가 그 자리를 못 보고 있다`); silent++; }
}
console.log("\n■ 🔴 덩이를 못 잡았을 때 — **넓히지 않고 «못 쟀다»로 적나**(⊘ 가 나와야 한다 · ✓ 면 조용한 초록이다)");
let widened = 0;
for (const [name, tf] of CANT_MEASURE) {
  const r = runIn(tf);
  if (!r.changed) { console.log(`  ⊘ ${name} — 🔴 **변이가 안 먹었다**. 통과로 세지 않는다.`); widened++; continue; }
  if (/⊘ ③ 못 쟀음/.test(r.out)) console.log(`  ✓ ${name} → «못 쟀음»으로 적는다`);
  else { console.log(`  ✗ ${name} → 🔴 **종료 ${r.code} 인데 «못 쟀음»이 없다** — 창을 넓혀 답한 것이다`); widened++; }
}
console.log("─".repeat(100));
console.log(silent ? `🔴 변이 ${silent}종이 안 울었다 — 자를 고쳐야 한다` : `✓ 변이 ${MUT.length}종이 모두 제 축을 울렸다`);
console.log(widened ? `🔴 «못 잡았을 때» ${widened}종이 넓혀서 답했다 — 자를 고쳐야 한다` : `✓ «못 잡았을 때» ${CANT_MEASURE.length}종 모두 «못 쟀음»으로 적는다`);
process.exit(fails.length || silent || widened ? 1 : 0);
