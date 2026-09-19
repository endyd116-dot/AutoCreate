// scripts/verify-api-surface.mjs — 🔴 **AC-48 전수 diff(상시 하니스)**: «화면이 부르는 API» − «서버가 여는 API» = 0.
//   사용: node scripts/verify-api-surface.mjs            (빨강 1건이라도 있으면 종료코드 1)
//         node scripts/verify-api-surface.mjs --json     (기계용)
//
//   왜: 2026-09-15 메인이 `support.html` 의 `/api/upload` 를 이 방법으로 잡았다 — **화면은 부르는데 서버에 그 경로가 없으면
//       사용자에겐 «눌러도 아무 일도 안 일어남»으로 보인다**(404 는 조용하다). tsc 도, 화면 스샷도, API 하니스도 이걸 못 잡는다:
//       그 셋은 «있는 것»만 본다. 없는 것을 찾으려면 **두 집합을 통째로 빼 봐야** 한다.
//   🔴 이 하니스는 서버·DB 를 켜지 않는다(정적) — 그래서 CI·매 라운드 첫 단계로 돌릴 수 있다.
//
//   ══════════════════════════════════════════════════════════════════════════════════════════════
//   🔴 2026-09-20 — **이 자가 킬 스위치를 놓쳤다.** 그날 고친 것 셋(C · 첫 발행 다음 판)
//   ══════════════════════════════════════════════════════════════════════════════════════════════
//   ① 🔴 **자가 화면 호출 7종을 통째로 못 보고 있었다.**
//      옛 정규식의 경로 부분이 `[^"'`\s)]+` 라 **닫는 괄호를 금지**했다. 그런데 화면은 이렇게 부른다:
//          UI.api(`/api/slots-list?from=${ymd(d0)}&to=${ymd(d1)}`)
//      `${ymd(d0)}` 안에 `)` 가 있어 **매치 자체가 실패**한다 ⇒ 그 호출은 «부른 것»으로도, «동적 경로»로도 안 세어졌다.
//      **그냥 사라졌다.** 실측: 화면 호출 172종 → **179종**. 사라졌던 일곱:
//        `invoices` · `ops-tickets` · `share-card` · `slots-list` · `stock-search` · `subscription-quote` · `team-invite-info`
//      🔴 이건 △ 만 부풀린 게 아니다 — **①축(«화면이 부르는데 서버에 없는 API»)도 그 일곱을 안 봤다.**
//      ⇒ 여는 따옴표와 **같은 종류의 닫는 따옴표**까지를 경로로 본다(그 사이 아무 글자나 허용).
//
//   ② 🔴 **찍는 모양이 사실을 감췄다.** △ 줄이 `unused.slice(0, 8)` 로 자르고 다시 `.slice(0, 58)` 로 잘려서
//      **44종 중 화면에 보이는 것이 셋**이었다. 그 안에 «영상 돈 멈춤 스위치가 화면에 없다»가 있었는데 **아무도 안 읽었다.**
//      🔴 CLAUDE §9 의 «또렷하게 말한다»는 **우리 자에게도** 걸린다 — 자가 «44종»이라 말하면 **44종을 다 찍어야** 한다.
//      ⇒ 이 자는 이제 **아무것도 자르지 않는다.** 무리별로 줄을 나눠 찍고, **사람이 세어야 할 것을 자가 세어** 준다.
//
//   ③ 🔴 **△ 를 판정으로 올렸다 — 다만 «화면이 안 부른다»가 아니라 «아무도 안 부른다»로.**
//      «화면이 안 부른다»는 37종이고 대부분 정상이다(러너·크론·자기호출) — 그걸 빨강으로 만들면 아무도 안 본다(AC-95).
//      **누가 부르는지 코드에서 찾아** 무리로 가르고, 🔴 **리포 어디에서도 안 부르는 것**만 판정한다.
//      그중에도 «바깥이 부른다»(OAuth 돌아오기·웹훅·SSO·감시)는 코드로 증명할 수 없다 ⇒ `docs/rules/api-callers.json` 에
//      **까닭과 함께 적어 둔 것만** 통과. **안 적힌 orphan 이 새로 생기면 그날 빨강이다** — 킬 스위치가 그날 잡혔을 자리다.
//      🔴 **이미 있는 것을 조용히 통과시키는 목록이 아니다**: 등록된 것도 무리별 개수를 매번 찍고, «화면이 없다»로 적힌 것은
//      **«아직 못 만든 기능»으로 따로 센다**(그 수가 줄지 않으면 그것도 신호다).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";

const JSON_OUT = process.argv.includes("--json");
const results = [];
const rec = (step, ok, note = "", detail) => { results.push({ step, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note, detail }); return !!ok; };

function walk(dir, exts, out = []) {
  let entries = []; try { entries = readdirSync(dir); } catch { return out; }
  for (const f of entries) {
    if (f === "node_modules" || f.startsWith(".") || f === "_shots") continue;
    const p = `${dir}/${f}`;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => f.endsWith(e))) out.push(p);
  }
  return out;
}
/** 주석을 걷는다(AC-109 ①) — 주석 속 경로를 «부른다»로 세면 안 된다. */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/^\s*\*.*$/gm, " ");

/* ───────── ① 화면이 부르는 것 ─────────
   🔴 여는 따옴표와 **같은 종류의 닫는 따옴표**까지를 경로로 본다 — 그 사이엔 `${ymd(d0)}` 처럼 괄호가 들어와도 된다. */
const CALL_RE = /(?:UI\.api|OPS\.api|fetch|location\.href\s*=|action\s*=)\s*\(?\s*(["'`])(\/api\/(?:(?!\1)[\s\S])*?)\1/g;
function screenCalls() {
  const files = [...walk("public", [".html", ".js"])];
  const map = new Map();       // path → Set<file:line>
  const dynamic = [];          // 경로의 **앞부분**이 런타임에 만들어지는 자리(정적으로는 못 가른다)
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(CALL_RE)) {
        const raw = m[2];
        const path = raw.split("?")[0].split("#")[0];
        const where = `${f}:${i + 1}`;
        if (path.includes("${")) { dynamic.push({ path: raw, where }); continue; }
        if (!map.has(path)) map.set(path, new Set());
        map.get(path).add(where);
      }
    });
  }
  return { map, dynamic };
}

/* ───────── ② 서버가 여는 것 ───────── */
function configBlock(text, i) { const end = text.indexOf(";", i); return text.slice(i, end > 0 ? end + 1 : i + 400); }
function serverPaths() {
  const files = walk("netlify/functions", [".ts", ".mts", ".js", ".mjs"]);
  const map = new Map();       // path → file
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const i = text.indexOf("export const config");
    if (i < 0) continue;
    const seg = configBlock(text, i);   // 🔴 고정 창은 뒤 주석의 «/api/…» 를 경로로 세어 가짜 충돌을 만든다 — 그 문장만 본다
    for (const m of seg.matchAll(/["'`](\/api\/[^"'`\s,\]]+)["'`]/g)) map.set(m[1], f);
  }
  return map;
}

/* ───────── ③ 🔴 «그 밖에 누가 부르나» — 코드에서 찾는다 ─────────
   🔴 `scripts/**` 는 **부르는 쪽으로 안 센다** — 자가 부른다고 제품에 길이 있는 게 아니다. */
function mentions(dirs, exts) {
  const m = new Map();
  for (const f of dirs.flatMap((d) => walk(d, exts))) {
    let t = decomment(readFileSync(f, "utf8"));
    const i = t.indexOf("export const config");
    if (i >= 0) { const b = configBlock(t, i); t = t.slice(0, i) + " ".repeat(b.length) + t.slice(i + b.length); }
    for (const x of t.matchAll(/\/api\/[a-zA-Z0-9\-/]+/g)) { if (!m.has(x[0])) m.set(x[0], new Set()); m.get(x[0]).add(f); }
  }
  return m;
}

const { map: calls, dynamic } = screenCalls();
const served = serverPaths();
const runnerM = mentions(["runner"], [".mjs", ".js", ".ts"]);
const serverM = mentions(["lib", "netlify"], [".ts", ".mts", ".js", ".mjs"]);
const toml = existsSync("netlify.toml") ? readFileSync("netlify.toml", "utf8") : "";
/** 🔴 background 함수는 **서버가 저를 부르는 문**이다 — 손 목록이 아니라 «`INTERNAL_SECRET` 을 요구하나»로 가른다. */
const selfCalled = new Set();
for (const [p, f] of served) { try { if (/INTERNAL_SECRET/.test(readFileSync(f, "utf8"))) selfCalled.add(p); } catch { /* 없으면 만다 */ } }

/* ───────── 진단 ───────── */
const missing = [...calls.keys()].filter((p) => !served.has(p)).sort();
rec("🔴 화면이 부르는데 **서버에 없는** API = 0(있으면 눌러도 아무 일이 안 일어난다)", missing.length === 0,
  missing.length ? `${missing.length}종` : `화면 호출 ${calls.size}종 · 서버 ${served.size}종`,
  missing.map((p) => ({ path: p, from: [...calls.get(p)] })));

/* 화면이 안 부르는 것을 **누가 부르나**로 가른다 */
const unused = [...served.keys()].filter((p) => !calls.has(p)).sort();
const WHO = { "러너가 부른다": [], "서버가 저를 부른다(background · INTERNAL_SECRET)": [], "서버·크론이 부른다": [], "netlify.toml 에 있다": [], "🔴 리포 어디에서도 안 부른다": [] };
const orphans = [];
for (const p of unused) {
  const self = served.get(p);
  const run = [...(runnerM.get(p) ?? [])];
  const srv = [...(serverM.get(p) ?? [])].filter((f) => f !== self);
  if (run.length) WHO["러너가 부른다"].push(`${p}  ← ${run.slice(0, 2).join(" ")}`);
  else if (selfCalled.has(p)) WHO["서버가 저를 부른다(background · INTERNAL_SECRET)"].push(p);
  else if (srv.length) WHO["서버·크론이 부른다"].push(`${p}  ← ${srv.slice(0, 2).join(" ")}`);
  else if (toml.includes(p.replace("/api/", ""))) WHO["netlify.toml 에 있다"].push(p);
  else { WHO["🔴 리포 어디에서도 안 부른다"].push(p); orphans.push(p); }
}
rec("서버에만 있고 화면이 안 부르는 API(러너·크론·내부용이면 정상)", unused.length === 0 ? true : "WARN",
  `${unused.length}종 — 무리별로 아래에 **전부** 찍는다(자르지 않는다)`, unused);

/* 🔴 판정 — 등록 안 된 orphan */
const REG_PATH = "docs/rules/api-callers.json";
let reg = null, regErr = "";
try { reg = JSON.parse(readFileSync(REG_PATH, "utf8")); } catch (e) { regErr = String(e?.message ?? e).slice(0, 80); }
const declared = new Map();      // path → { 갈래, 까닭 }
if (reg) for (const [kind, rows] of Object.entries(reg)) {
  if (kind.startsWith("_") || typeof rows !== "object") continue;
  for (const [p, why] of Object.entries(rows)) declared.set(p, { kind, why });
}
const undeclared = orphans.filter((p) => !declared.has(p));
const stale = [...declared.keys()].filter((p) => !orphans.includes(p)).sort();   // 이제 부르는데 목록에 남아 있다

rec(`🔴 **아무도 안 부르는데 \`${REG_PATH}\` 에 까닭이 안 적힌 API = 0**`, !reg ? false : undeclared.length === 0,
  !reg ? `🔴 목록을 못 읽었다(${regErr}) — 이 축을 판정할 수 없다` : undeclared.length ? `${undeclared.length}종` : `아무도 안 부르는 ${orphans.length}종 전부 까닭이 적혀 있다`,
  undeclared);
rec(`\`${REG_PATH}\` 에 적혔는데 **이제는 부르는** 줄 = 0(낡은 등록은 지운다)`, stale.length === 0, stale.length ? `${stale.length}종` : "0종", stale);

rec("경로를 런타임에 조립하는 자리(정적으로 못 가른다 · 손으로 확인)", dynamic.length === 0 ? true : "WARN",
  `${dynamic.length}곳`, dynamic);

// 같은 경로를 두 함수가 여는 경우(라우팅 충돌 — 마지막에 로드된 쪽이 먹는다)
const dupes = new Map();
for (const f of walk("netlify/functions", [".ts", ".mts"])) {
  const text = readFileSync(f, "utf8");
  const i = text.indexOf("export const config"); if (i < 0) continue;
  for (const m of configBlock(text, i).matchAll(/["'`](\/api\/[^"'`\s,\]]+)["'`]/g)) {
    if (!dupes.has(m[1])) dupes.set(m[1], new Set());
    dupes.get(m[1]).add(f);
  }
}
const collided = [...dupes].filter(([, fs]) => fs.size > 1);
rec("한 경로를 두 함수가 열지 않는다(라우팅 충돌 0)", collided.length === 0,
  collided.length ? `${collided.length}종` : `${dupes.size}종 전부 단일`, collided.map(([p, fs]) => ({ path: p, files: [...fs] })));

/* ───────── ⓪ 🔴 자기 찌르기 — «자가 제 눈을 믿을 만한가» ───────── */
const probes = [];
{
  /* ⓪a 옛 정규식이 놓치던 모양을 자가 지금은 보는가 */
  const sample = 'const s = await UI.api(`/api/zz-probe?from=${ymd(d0)}&to=${ymd(d1)}`);';
  const got = [...sample.matchAll(CALL_RE)].map((m) => m[2].split("?")[0]);
  probes.push({ n: "⓪a 보간 안에 괄호가 든 호출(`${ymd(d0)}`)을 본다", ok: got.includes("/api/zz-probe"), note: `본 것: ${JSON.stringify(got)}` });
  /* ⓪b 주석 속 경로를 «부른다»로 세지 않는다 */
  const m2 = mentionsOf("/* 이 함수는 /api/zz-comment 를 부른다 */\nconst x = 1;");
  probes.push({ n: "⓪b **주석 속** 경로를 «부른다»로 안 센다(AC-109 ①)", ok: !m2.includes("/api/zz-comment"), note: `본 것: ${JSON.stringify(m2)}` });
  /* ⓪c 🔴 **판정이 정말 무는가** — 등록된 줄 하나를 사본에서 빼 보고 «안 적힘»이 1 로 늘어야 한다.
     («지어낸 경로가 목록에 없다»는 언제나 참이라 아무것도 안 재는 단언이다 — AC-121 의 부정형 함정. 그래서 이렇게 바꿨다.) */
  if (orphans.length) {
    const victim = orphans.find((p) => declared.has(p));
    const shrunk = new Map(declared); shrunk.delete(victim);
    const n = orphans.filter((p) => !shrunk.has(p)).length;
    probes.push({ n: "⓪c 등록된 줄 하나를 빼면 «안 적힘»이 **정확히 하나 늘어난다**", ok: !!victim && n === undeclared.length + 1, note: `«${victim}» 을 빼니 ${undeclared.length} → ${n}` });
  } else {
    probes.push({ n: "⓪c 등록된 줄 하나를 빼면 «안 적힘»이 하나 늘어난다", ok: false, note: "⊘ orphan 이 0종이라 **이 판정을 못 쟀다**(AC-9 — 통과가 아니다)" });
  }
  /* ⓪d 🔴 **«N종»이라 말하고 N줄을 찍는가** — 이 자가 2026-09-20 에 저지른 바로 그 병을 스스로 잰다. */
  const grouped = Object.values(WHO).reduce((a, v) => a + v.length, 0);
  probes.push({ n: "⓪d 🔴 «N종»이라 말한 것을 **N줄 다 찍는다**(2026-09-20 에 44 중 3만 찍었다)", ok: grouped === unused.length, note: `무리에 담긴 줄 ${grouped} = 센 수 ${unused.length}` });
  /* ⓪e 🔴 **자르는 버릇이 돌아오지 않았나** — 이 파일 안에 `.slice(0, ` 로 목록을 자르는 자리가 있나. */
  const selfSrc = readFileSync("scripts/verify-api-surface.mjs", "utf8");
  const cuts = [...decomment(selfSrc).matchAll(/\b(?:unused|orphans|undeclared|stale|missing|dynamic)\s*\.slice\(/g)].map((m) => m[0]);
  probes.push({ n: "⓪e 🔴 목록을 **자르는 자리가 없다**(그 버릇이 이 사고를 냈다)", ok: cuts.length === 0, note: cuts.length ? `🔴 ${cuts.length}곳: ${cuts.join(" ")}` : "0곳" });
}
function mentionsOf(src) {
  const t = decomment(src);
  return [...t.matchAll(/\/api\/[a-zA-Z0-9\-/]+/g)].map((x) => x[0]);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ at: new Date().toISOString(), calls: [...calls.keys()].sort(), served: [...served.keys()].sort(), orphans, undeclared, stale, results }, null, 2));
} else {
  console.log(`\nAPI 표면 전수 diff(AC-48) · ${new Date().toISOString()}`);
  console.log("─".repeat(120));
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${r.step}\n      ${r.note}`);

  /* 🔴 **여기서부터가 2026-09-20 의 교훈** — 아무것도 자르지 않는다. 무리마다 개수를 자가 센다. */
  console.log(`\n■ 화면이 안 부르는 ${unused.length}종 — **누가 부르나**로 갈랐다(🔴 scripts/** 는 부르는 쪽으로 안 센다)`);
  let shown = 0;
  for (const [k, v] of Object.entries(WHO)) {
    if (!v.length) continue;
    console.log(`\n  ${k} — ${v.length}종`);
    for (const x of v) { console.log(`     · ${x}`); shown++; }
  }
  console.log(`\n  ✓ 찍은 줄 ${shown} = 센 수 ${unused.length}  — 🔴 이 두 수가 다르면 **이 자가 또 감추고 있는 것**이다`);
  if (shown !== unused.length) console.log("  🔴 다르다! 위 목록이 사실을 다 안 말한다.");

  if (orphans.length) {
    const byKind = {};
    for (const p of orphans) { const d = declared.get(p); (byKind[d ? d.kind : "🔴 안 적힘"] ??= []).push(p); }
    console.log(`\n■ 🔴 아무도 안 부르는 ${orphans.length}종 — \`${REG_PATH}\` 의 갈래별`);
    for (const [k, v] of Object.entries(byKind)) {
      console.log(`\n  ${k} — ${v.length}종`);
      for (const p of v) console.log(`     · ${p}${declared.get(p) ? `  — ${declared.get(p).why}` : ""}`);
    }
    const noScreen = byKind["화면이 없다(아직 못 만든 기능)"] ?? [];
    if (noScreen.length) console.log(`\n  🔴 그중 **«화면이 없다» ${noScreen.length}종** — 이 수가 줄지 않으면 그것도 신호다(적어 뒀다고 없어지지 않는다).`);
  }
  if (stale.length) { console.log(`\n■ 🔴 낡은 등록 ${stale.length}종 — 이제 부르는데 목록에 남아 있다(지워라)`); for (const p of stale) console.log(`     · ${p}`); }
  if (missing.length) { console.log(`\n■ 🔴 화면이 부르는데 서버에 없는 ${missing.length}종`); for (const p of missing) console.log(`     · ${p} ← ${[...calls.get(p)].join(", ")}`); }
  if (dynamic.length) { console.log(`\n■ △ 경로를 런타임에 조립하는 ${dynamic.length}곳`); for (const d of dynamic) console.log(`     · ${d.path} @${d.where}`); }

  console.log(`\n⓪ 자기 찌르기 — 🔴 «자가 제 눈을 믿을 만한가»`);
  for (const p of probes) console.log(`  ${p.ok ? "✓" : "✗"} ${p.n}  — ${p.note}`);

  console.log("─".repeat(120));
  console.log(`화면 호출 ${calls.size}종 · 서버 공개 ${served.size}종 · 없는 것 ${missing.length} · 화면이 안 부르는 것 ${unused.length} · **아무도 안 부르는 것 ${orphans.length}**(안 적힌 것 ${undeclared.length})`);
}
const probeBad = probes.filter((p) => !p.ok).length;
process.exit(results.some((r) => r.ok === "FAIL") || probeBad ? 1 : 0);
