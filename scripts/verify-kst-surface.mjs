/**
 * scripts/verify-kst-surface.mjs — 🔴 **설계 §13.5 «검증 항목(C)» 을 진짜로 돌린다**(C · R8 마감 · 2026-09-16).
 *   사용: node scripts/verify-kst-surface.mjs
 *
 *   ══ 왜 이 파일이 필요한가 ══
 *   `verify-r8-audit64.mjs` 의 D 묶음은 «기기 시간대»를 **낱말 정규식**(`/deviceTz|resolvedOptions\(\)\.timeZone/`)으로 쟀다.
 *   그건 «그 낱말이 소스에 있나»이지 «**기기 시간대를 바꿔도 같은 시각이 보이나**»가 아니다 — 대용물이다(AC-70).
 *   그리고 우리 규약은 정반대다: 화면은 `Asia/Seoul` 을 **고정**하므로 `resolvedOptions().timeZone` 을 읽는 코드는
 *   **있으면 오히려 냄새**다. 없는 것을 «미개발»로 세고 있었다(AC-75).
 *
 *   설계 `docs/DESIGN.md:1134` 의 검증 항목 그대로:
 *     ① 기기 시간대를 UTC·America/New_York 로 바꿔 화면을 열어도 표시 시각이 동일한가
 *     ② `timeZone` 없는 `toLocale*` 0건   ③ `datetime-local` 0건   ④ 07:30 → `publish_at` UTC 22:30(전날)
 *   ⇒ ①은 **진짜 프로세스를 다른 TZ 로 띄워 같은 함수를 부른다**(AC-70 «같은 함수·같은 가공·같은 입력»).
 *
 *   🔴 대상은 **우리가 만든 화면 코드만**이다 — `node_modules` 의 남의 코드는 우리 규약이 아니다.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const FAIL = [];
const OK = [];
const note = (pass, label, detail) => (pass ? OK : FAIL).push(`${label} — ${detail}`);

/* ══ ① 기기 시간대를 바꿔도 같은 글자가 나오나 ══
   자식 프로세스를 TZ 만 바꿔 띄우고, **진짜 `public/js/ui.js`** 를 읽어 `UI.timeKST` 등을 부른다.
   🔴 내가 포맷터를 베껴 적으면 그건 내 사본을 재는 것이다(AC-70) — 파일을 그대로 eval 한다. */
const CHILD = [
  'const fs = require("node:fs");',
  "globalThis.window = globalThis;",
  'globalThis.document = { querySelector: () => null, querySelectorAll: () => [], addEventListener(){},',
  '  documentElement:{ style:{ setProperty(){} }, classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } } },',
  '  body:{ classList:{ add(){}, remove(){} }, appendChild(){}, style:{} },',
  '  createElement: () => ({ style:{}, classList:{ add(){}, remove(){} }, appendChild(){}, setAttribute(){}, remove(){} }) };',
  "globalThis.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };",
  "globalThis.fetch = async () => ({ status: 200, json: async () => ({}) });",
  'globalThis.navigator = { userAgent: "node", vibrate(){} };',
  "globalThis.matchMedia = () => ({ matches:false, addEventListener(){}, addListener(){} });",
  'globalThis.location = { href:"http://x/app/home.html", pathname:"/app/home.html", search:"", hash:"", origin:"http://x", replace(){}, assign(){}, reload(){} };',
  "globalThis.history = { replaceState(){}, pushState(){} };",
  "globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);",
  'try { eval(fs.readFileSync("public/js/ui.js","utf8")); }',
  'catch (e) { console.log(JSON.stringify({ err: String((e && e.message) || e) })); process.exit(0); }',
  'try { eval(fs.readFileSync("public/js/ops.js","utf8")); } catch (e) { /* ops 없어도 된다 */ }',
  "const U = globalThis.UI || {};",
  "const O = globalThis.OPS || globalThis.O || {};",
  "// 표본 = KST 경계를 넘나드는 값(UTC 22:30 = KST 익일 07:30 · UTC 15:00 = KST 자정) + 'Z' 없는 DB 모양",
  'const S = ["2026-03-14T22:30:00Z","2026-03-14T15:00:00Z","2026-07-01T00:00:00Z","2026-12-31T16:05:00Z","2026-03-14 22:30:00"];',
  'const out = { tz: process.env.TZ || "(none)", resolved: Intl.DateTimeFormat().resolvedOptions().timeZone,',
  '  timeKST: S.map((s) => (U.timeKST ? U.timeKST(s) : "NOFN")),',
  '  dateKST: S.map((s) => (U.dateKST ? U.dateKST(s) : "NOFN")),',
  '  opsDt:   S.map((s) => (O.dt ? O.dt(s) : "NOFN")) };',
  "console.log(JSON.stringify(out));",
].join("\n");

const runTz = (tz) => {
  const raw = execFileSync(process.execPath, ["-e", CHILD], { env: { ...process.env, TZ: tz }, encoding: "utf8", cwd: process.cwd() });
  return JSON.parse(raw.trim().split("\n").pop());
};
const TZS = ["Asia/Seoul", "UTC", "America/New_York", "Pacific/Kiritimati"];
let base = null;
for (const tz of TZS) {
  let r;
  try { r = runTz(tz); } catch (e) { note(false, `①기기 시간대 ${tz}`, `프로세스가 못 떴다: ${String(e.message).slice(0, 120)}`); continue; }
  if (r.err) { note(false, `①기기 시간대 ${tz}`, `ui.js 로드 실패: ${r.err}`); continue; }
  const missing = [...r.timeKST, ...r.dateKST, ...r.opsDt].filter((v) => v === "NOFN");
  if (missing.length) { note(false, `①기기 시간대 ${tz}`, "포맷터를 못 찾았다(UI.timeKST/UI.dateKST/O.dt)"); continue; }
  if (!base) { base = r; note(true, `①기기 시간대 ${tz}(기준)`, `timeKST=[${r.timeKST.join(" ")}] · opsDt=[${r.opsDt.join(" ")}]`); continue; }
  const same = JSON.stringify([r.timeKST, r.dateKST, r.opsDt]) === JSON.stringify([base.timeKST, base.dateKST, base.opsDt]);
  note(same, `①기기 시간대 ${tz}`, same
    ? `기준(Asia/Seoul)과 글자까지 동일 · 이 프로세스가 실제로 해석한 TZ=${r.resolved}`
    : `🔴 다르다 — 기준 ${JSON.stringify([base.timeKST, base.dateKST, base.opsDt])} ≠ ${JSON.stringify([r.timeKST, r.dateKST, r.opsDt])}`);
}

/* ══ ②③ 우리 화면 코드 전수 ══ */
const walk = (dir, acc = []) => {
  for (const nm of readdirSync(dir)) {
    if (nm === "node_modules" || nm.startsWith(".")) continue;
    const p = path.join(dir, nm);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(html|js)$/.test(nm)) acc.push(p);
  }
  return acc;
};
const files = existsSync("public") ? walk("public") : [];
/* 주석 안의 예시·금지 문구를 세면 우리가 «하지 마라»라고 적어 둔 줄이 위반으로 잡힌다(노이즈로 죽는다 · AC-74 의 교훈).
   🔴 **줄 수를 보존한다** — 지워 버리면 뒤 줄 번호가 통째로 밀려 엉뚱한 줄을 지목한다(내가 첫 판에서 그랬다). */
const blankOut = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .split("\n").map((ln) => (/^\s*(\/\/|\*)/.test(ln) ? "" : ln)).join("\n");
const badLocale = [];
const badInput = [];
for (const f of files) {
  const src = blankOut(readFileSync(f, "utf8"));
  /* 🔴 **호출 단위**로 본다 — «이 파일 어딘가에 timeZone 이 있다»로 재면 한 곳만 맞아도 통과한다(AC-69 의 사촌).
     🔴 그리고 **날짜만 대상이다.** `(1234).toLocaleString()` 은 돈·개수 포맷이라 시간대와 무관하다.
        첫 판에서 «숫자처럼 생긴 이름»을 빼는 쪽으로 짰다가 `maxRefundKrw` 넷을 위반으로 찍었다 —
        **이름을 추측하면 이름이 바뀔 때마다 틀린다.** ⇒ 물음을 뒤집는다:
          · `toLocaleDateString`·`toLocaleTimeString` = **언제나 날짜**  → timeZone 없으면 위반
          · `toLocaleString` = 애매 → **날짜로 보이는 수신자일 때만** 위반(Date·d·dt·…At·utc(…)) */
  const re = /([\w$\].)]+)\s*\.\s*toLocale(String|DateString|TimeString)\s*\(([^;]{0,240})/g;
  let m;
  while ((m = re.exec(src))) {
    const [, recv, kind, arg] = m;
    if (/timeZone/.test(arg)) continue;
    const dateish = kind !== "String" || /(^|[.\]])(d|dt|date|now|when|Date\(\)?)$|At$|utc\(|Date\(/i.test(recv);
    if (!dateish) continue;
    badLocale.push(`${f}:${src.slice(0, m.index).split("\n").length} (${recv}.toLocale${kind})`);
  }
  if (/type\s*=\s*["']datetime-local["']/.test(src)) badInput.push(f);
}
note(badLocale.length === 0, "②timeZone 없는 toLocale*(날짜)",
  badLocale.length ? `🔴 ${badLocale.length}건 — ${badLocale.slice(0, 8).join(", ")}` : `우리 화면 ${files.length}개 전수 0건`);
note(badInput.length === 0, "③datetime-local",
  badInput.length ? `🔴 ${badInput.length}건 — ${badInput.join(", ")}` : "0건(시간 칩을 쓴다)");

/* ══ ④ 업무 시각을 KST 로 판정하나 — 파일을 **지목**해서 본다(전역 grep 은 엉뚱한 파일에 걸린다) ══ */
const SLOTMAKERS = ["lib/cron/slot-plan.ts", "lib/slots.ts", "lib/cron/base.ts", "lib/schedule.ts", "lib/cron/director-auto.ts"].filter(existsSync);
const kstHit = SLOTMAKERS.filter((p) => /Asia\/Seoul|kstTodayStartUtc|kstHour|kstWeekStartUtc|kstDateStr/.test(readFileSync(p, "utf8")));
note(kstHit.length > 0, "④업무 시각을 KST 로 판정",
  kstHit.length ? `${kstHit.join(", ")} 가 KST 소도구/AT TIME ZONE 을 쓴다` : `🔴 슬롯 만드는 파일(${SLOTMAKERS.join(",")})에 KST 해석 0건`);

console.log(`\nKST 표기 규약 — 설계 §13.5 «검증 항목(C)» 실행 · ${new Date().toISOString()}\n${"─".repeat(124)}`);
for (const l of OK) console.log(`  ✓ ${l}`);
for (const l of FAIL) console.log(`  ✗ ${l}`);
console.log(`${"─".repeat(124)}\nPASS ${OK.length} · FAIL ${FAIL.length}`);
process.exit(FAIL.length ? 1 : 0);
