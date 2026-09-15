// scripts/verify-api-surface.mjs — 🔴 **AC-48 전수 diff(상시 하니스)**: «화면이 부르는 API» − «서버가 여는 API» = 0.
//   사용: node scripts/verify-api-surface.mjs            (빨강 1건이라도 있으면 종료코드 1)
//         node scripts/verify-api-surface.mjs --json     (기계용)
//
//   왜: 2026-09-15 메인이 `support.html` 의 `/api/upload` 를 이 방법으로 잡았다 — **화면은 부르는데 서버에 그 경로가 없으면
//       사용자에겐 «눌러도 아무 일도 안 일어남»으로 보인다**(404 는 조용하다). tsc 도, 화면 스샷도, API 하니스도 이걸 못 잡는다:
//       그 셋은 «있는 것»만 본다. 없는 것을 찾으려면 **두 집합을 통째로 빼 봐야** 한다.
//   🔴 이 하니스는 서버·DB 를 켜지 않는다(정적) — 그래서 CI·매 라운드 첫 단계로 돌릴 수 있다.
import { readFileSync, readdirSync, statSync } from "node:fs";

const JSON_OUT = process.argv.includes("--json");
const results = [];
const rec = (step, ok, note = "", detail) => { results.push({ step, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note, detail }); return !!ok; };

function walk(dir, exts, out = []) {
  let entries = []; try { entries = readdirSync(dir); } catch { return out; }
  for (const f of entries) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = `${dir}/${f}`;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => f.endsWith(e))) out.push(p);
  }
  return out;
}

/* ───────── ① 화면이 부르는 것 ─────────
   `UI.api("/api/x")` · `OPS.api('/api/x')` · fetch(`/api/x?a=${b}`) · location.href = "/api/x"
   따옴표 3종 + 템플릿 리터럴. 쿼리(`?…`)와 보간(`${…}`)은 떼고 경로만 남긴다. */
/* 🔴 «부르는 자리»만 센다 — `path.startsWith("/api/ops")` 같은 **검사용 문자열**을 호출로 세면 영원히 빨갛다(내가 밟았다).
   호출 = `UI.api(` · `OPS.api(` · `fetch(` · `location.href =` · `action=` 바로 뒤에 오는 경로 문자열. */
const CALL_RE = /(?:UI\.api|OPS\.api|fetch|location\.href\s*=|action\s*=)\s*\(?\s*["'`](\/api\/[^"'`\s)]+)["'`]/g;
function screenCalls() {
  const files = [...walk("public", [".html", ".js"])];
  const map = new Map();       // path → Set<file:line>
  const dynamic = [];          // 경로가 런타임에 만들어지는 자리(정적으로는 못 가른다)
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(CALL_RE)) {
        const raw = m[1];
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

/* ───────── ② 서버가 여는 것 ─────────
   `export const config = { path: "/api/x" }` · `{ path: ["/api/x", "/api/y"] }`(여러 줄 포함) */
/** `export const config = …;` **그 문장만** 잘라 낸다(세미콜론까지). */
function configBlock(text, i) { const end = text.indexOf(";", i); return text.slice(i, end > 0 ? end + 1 : i + 400); }
function serverPaths() {
  const files = walk("netlify/functions", [".ts", ".mts", ".js", ".mjs"]);
  const map = new Map();       // path → file
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const i = text.indexOf("export const config");
    if (i < 0) continue;
    // config 블록만 잘라 본다(뒤에 오는 다른 문자열을 경로로 세지 않게)
    const seg = configBlock(text, i);   // 🔴 고정 창(1200자)은 뒤 주석의 «/api/…» 를 경로로 세어 가짜 충돌을 만든다 — 그 문장만 본다
    for (const m of seg.matchAll(/["'`](\/api\/[^"'`\s,\]]+)["'`]/g)) map.set(m[1], f);
  }
  return map;
}

const { map: calls, dynamic } = screenCalls();
const served = serverPaths();

/* ───────── 진단 ───────── */
const missing = [...calls.keys()].filter((p) => !served.has(p)).sort();
rec("🔴 화면이 부르는데 **서버에 없는** API = 0(있으면 눌러도 아무 일이 안 일어난다)", missing.length === 0,
  missing.length ? missing.map((p) => `${p} ← ${[...calls.get(p)].slice(0, 2).join(", ")}`).join(" | ") : `화면 호출 ${calls.size}종 · 서버 ${served.size}종`,
  missing.map((p) => ({ path: p, from: [...calls.get(p)] })));

const unused = [...served.keys()].filter((p) => !calls.has(p)).sort();
rec("서버에만 있고 화면이 안 부르는 API(러너·크론·내부용이면 정상)", unused.length === 0 ? true : "WARN",
  unused.length ? `${unused.length}종: ${unused.slice(0, 8).join(" ")}${unused.length > 8 ? " …" : ""}` : "0종", unused);

rec("경로를 런타임에 조립하는 자리(정적으로 못 가른다 · 손으로 확인)", dynamic.length === 0 ? true : "WARN",
  dynamic.length ? dynamic.slice(0, 6).map((d) => `${d.path} @${d.where}`).join(" | ") : "0곳", dynamic);

// 같은 경로를 두 함수가 여는 경우(라우팅 충돌 — 마지막에 로드된 쪽이 먹는다)
const dupes = new Map();
for (const f of walk("netlify/functions", [".ts", ".mts"])) {
  const text = readFileSync(f, "utf8");
  const i = text.indexOf("export const config"); if (i < 0) continue;
  const seg = configBlock(text, i);
  for (const m of seg.matchAll(/["'`](\/api\/[^"'`\s,\]]+)["'`]/g)) {
    if (!dupes.has(m[1])) dupes.set(m[1], new Set());
    dupes.get(m[1]).add(f);
  }
}
const collided = [...dupes].filter(([, fs]) => fs.size > 1);
rec("한 경로를 두 함수가 열지 않는다(라우팅 충돌 0)", collided.length === 0,
  collided.length ? collided.map(([p, fs]) => `${p} ← ${[...fs].join(" + ")}`).join(" | ") : `${dupes.size}종 전부 단일`);

if (JSON_OUT) { console.log(JSON.stringify({ at: new Date().toISOString(), calls: [...calls.keys()].sort(), served: [...served.keys()].sort(), results }, null, 2)); }
else {
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nAPI 표면 전수 diff(AC-48) · ${new Date().toISOString()}\n${"─".repeat(120)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 58)} ${w(r.note, 58)}`);
  console.log(`${"─".repeat(120)}\n화면 호출 ${calls.size}종 · 서버 공개 ${served.size}종 · 없는 것 ${missing.length} · 안 부르는 것 ${unused.length}`);
}
process.exit(results.some((r) => r.ok === "FAIL") ? 1 : 0);
