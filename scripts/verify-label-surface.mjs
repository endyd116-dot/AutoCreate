// scripts/verify-label-surface.mjs — 🔴 **AC-52 라벨 표면 diff(상시 하니스)**: «모의·화면이 쓰는 낱말» − «서버가 실제로 보내는 낱말» = 0.
//   사용: node scripts/verify-label-surface.mjs           (빨강 1건이라도 있으면 종료코드 1)
//         node scripts/verify-label-surface.mjs --json    (기계용)
//
//   왜: 2026-09-15 여정 점검에서 **모의의 심사 축 9개 중 7개가 서버에 없는 키**였고, 글 게이트 라벨은 통과형(«문단 시작이 다양함»)이
//       아니라 명사형(«문단 시작 반복»)이라 ✓ 와 붙으면 **뜻이 반대로** 읽혔다. 우리가 시안·스샷·시연에서 검수한 문구가
//       고객이 볼 문구가 아니었다는 뜻이다(PITFALLS AC-52). 화면 스샷도, 왕복 테스트도 이걸 못 잡는다 — **둘 다 모의를 보기 때문**이다.
//       그래서 두 집합을 통째로 빼 본다: 서버 소스(정본) ↔ public/js/ui.js·mock.js.
//   🔴 정적이다(서버·DB 안 켠다). 🔴 정본은 **언제나 서버** — 다르면 고칠 곳은 화면·모의다.
import { readFileSync, readdirSync, statSync } from "node:fs";

const JSON_OUT = process.argv.includes("--json");
const results = [];
const rec = (step, ok, note = "", detail) => { results.push({ step, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note, detail }); return !!ok; };
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const walk = (dir, exts, out = []) => {
  let entries = []; try { entries = readdirSync(dir); } catch { return out; }
  for (const f of entries) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) walk(p, exts, out); else if (exts.some((e) => f.endsWith(e))) out.push(p);
  }
  return out;
};

/** `NAME = { key: "값", … }` 한 벌을 통째로 떠서 Map 으로. 값이 배열이면 [0] 이 색, [1] 이 글자(UI 관례). */
function objectMap(text, name, { pair = false } = {}) {
  const i = text.indexOf(name); if (i < 0) return null;
  const s = text.indexOf("{", i); if (s < 0) return null;
  let depth = 0, e = s;
  for (; e < text.length; e++) { const c = text[e]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } }
  const body = text.slice(s + 1, e);
  const map = new Map();
  const re = pair
    ? /([A-Za-z_][A-Za-z_0-9]*)\s*:\s*\[\s*"[^"]*"\s*,\s*"([^"]*)"/g      // key: ["색", "글자"]
    : /([A-Za-z_][A-Za-z_0-9]*)\s*:\s*"([^"]*)"/g;                          // key: "글자"
  for (const m of body.matchAll(re)) map.set(m[1], m[2]);
  return map;
}
/** 객체의 **키만** 뜬다(값이 SVG·함수라 글자를 못 뜰 때). */
function keysOf(text, name) {
  const i = text.indexOf(name); if (i < 0) return new Set();
  const s = text.indexOf("{", i); let depth = 0, e = s;
  for (; e < text.length; e++) { const c = text[e]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } }
  return new Set([...text.slice(s + 1, e).matchAll(/(?:^|[,{\n])\s*([A-Za-z_][A-Za-z_0-9]*)\s*:/g)].map((m) => m[1]));
}
/** `[["key", "글자"], …]` 목록(모의 관례). */
function tupleList(text, name) {
  const i = text.indexOf(name); if (i < 0) return null;
  const s = text.indexOf("[", i), e = text.indexOf("];", s);
  if (s < 0 || e < 0) return null;
  const map = new Map();
  for (const m of text.slice(s, e).matchAll(/\["([a-z_0-9]+)"\s*,\s*"([^"]*)"\]/g)) map.set(m[1], m[2]);
  return map;
}
const setOf = (re, text, g = 1) => { const s = new Set(); for (const m of text.matchAll(re)) s.add(m[g]); return s; };
const minus = (a, b) => [...a].filter((x) => !b.has(x)).sort();

/* ───────── 소스 ───────── */
const judgeTs = read("lib/video/judge.ts");
const gateTs = read("lib/ai-tell-gate.ts");
const uiJs = read("public/js/ui.js");
const mockJs = read("public/js/mock.js");
const homeTs = read("netlify/functions/home-summary.ts");
const ddl = read("drizzle/0001-init.sql");
const serverFiles = [...walk("lib", [".ts"]), ...walk("netlify/functions", [".ts", ".mts"])];
const serverText = serverFiles.map(read).join("\n");

/* ───────── ① 영상 심사 축(서버 AXIS_LABEL ↔ 모의 JUDGE_AXES) ───────── */
const axSrv = objectMap(judgeTs, "AXIS_LABEL") || new Map();
const axMock = tupleList(mockJs, "JUDGE_AXES") || new Map();
const axMissing = minus(new Set(axMock.keys()), new Set(axSrv.keys()));          // 모의에만 있는 = 서버에 없는 가짜 축
const axUnseen = minus(new Set(axSrv.keys()), new Set(axMock.keys()));           // 서버에만 있는 = 화면에서 한 번도 못 본 축
const axLabelDiff = [...axMock].filter(([k, v]) => axSrv.has(k) && axSrv.get(k) !== v).map(([k, v]) => `${k}: 모의 «${v}» ≠ 서버 «${axSrv.get(k)}»`);
rec("🔴 영상 심사 축 — 모의 키 − 서버 키 = 0", axMissing.length === 0, axMissing.length ? axMissing.join(" ") : `서버 ${axSrv.size}축 · 모의 ${axMock.size}축`, axMissing);
rec("🔴 영상 심사 축 — 라벨 글자가 서버와 같다", axLabelDiff.length === 0, axLabelDiff.slice(0, 4).join(" | ") || "같음", axLabelDiff);
rec("서버에만 있고 모의가 한 번도 안 보여 주는 심사 축", axUnseen.length === 0 ? true : "WARN", axUnseen.join(" ") || "0개", axUnseen);

/* ───────── ② 글 발행 전 검사(서버 GATE_LABEL ↔ 모의 checks) ───────── */
const gtSrv = objectMap(gateTs, "GATE_LABEL") || new Map();
const gtMock = new Map();
for (const m of mockJs.matchAll(/\{\s*key:\s*"([a-z_0-9]+)",\s*label:\s*"([^"]*)"/g)) gtMock.set(m[1], m[2]);
const gtMissing = minus(new Set(gtMock.keys()), new Set(gtSrv.keys()));
const gtLabelDiff = [...gtMock].filter(([k, v]) => gtSrv.has(k) && gtSrv.get(k) !== v).map(([k, v]) => `${k}: 모의 «${v}» ≠ 서버 «${gtSrv.get(k)}»`);
rec("🔴 글 검사 — 모의 키 − 서버 키 = 0", gtMissing.length === 0, gtMissing.join(" ") || `서버 ${gtSrv.size}칸 · 모의 ${gtMock.size}칸`, gtMissing);
rec("🔴 글 검사 — 라벨 글자가 서버와 같다(통과형 문장)", gtLabelDiff.length === 0, gtLabelDiff.slice(0, 4).join(" | ") || "같음", gtLabelDiff);

/* ───────── ③ 상태 어휘 — 서버가 쓰는 값에 화면 낱말이 다 있나(없으면 영문이 그대로 뜬다) ───────── */
const ddlEnum = (table, col) => {
  const i = ddl.indexOf(`CREATE TABLE ${table}`); if (i < 0) return new Set();
  const seg = ddl.slice(i, ddl.indexOf(");", i));
  const line = seg.split("\n").find((l) => new RegExp(`^\\s*${col}\\s`).test(l)) || "";
  const cm = line.split("--")[1] || "";
  return new Set(cm.split("|").map((x) => x.trim()).filter((x) => /^[a-z_]{3,}$/.test(x)));
};
const writes = (table) => setOf(new RegExp(`UPDATE ${table} SET[^;]{0,400}?status = '([a-z_]+)'`, "g"), serverText);
const slotSrv = new Set([...ddlEnum("slots", "status"), ...writes("slots")]);
const pieceSrv = new Set([...ddlEnum("pieces", "status"), ...writes("pieces")]);
const uiSlot = objectMap(uiJs, "UI.SLOT_STATUS", { pair: true }) || new Map();
const uiPiece = objectMap(uiJs, "UI.PIECE_STATUS", { pair: true }) || new Map();
const uiPost = objectMap(uiJs, "UI.POST_STATUS", { pair: true }) || new Map();
const slotNoWord = minus(slotSrv, new Set(uiSlot.keys()));
const pieceNoWord = minus(pieceSrv, new Set(uiPiece.keys()));
rec("🔴 슬롯 상태 — 서버가 쓰는 값에 화면 낱말이 다 있다", slotNoWord.length === 0, slotNoWord.join(" ") || `서버 ${slotSrv.size}종 · 화면 ${uiSlot.size}종`, slotNoWord);
rec("🔴 글 상태 — 서버가 쓰는 값에 화면 낱말이 다 있다", pieceNoWord.length === 0, pieceNoWord.join(" ") || `서버 ${pieceSrv.size}종 · 화면 ${uiPiece.size}종`, pieceNoWord);

/* 모의가 지어낸 상태(서버에 없는 값)도 잡는다 — 모의만의 세계가 생기지 않게 */
const mockSlotStatus = setOf(/status:\s*"([a-z_]+)"/g, mockJs);
/* 서버 어휘의 «우주» = DDL 주석에 적힌 모든 열거값(-- a|b|c) + 코드가 쓰는 상태 — 표마다 손으로 적지 않는다 */
const ddlVocab = new Set();
for (const m of ddl.matchAll(/--\s*([a-z_]+(?:\|[a-z_]+)+)/g)) for (const v of m[1].split("|")) ddlVocab.add(v.trim());
const mockSlotUnknown = minus(mockSlotStatus, new Set([...slotSrv, ...pieceSrv, ...uiPost.keys(), ...ddlVocab, "not_configured", "none", "progress", "done", "queued", "running", "connected", "error", "requested"]));
rec("모의가 쓰는 상태 값이 서버 어휘 안에 있다", mockSlotUnknown.length === 0 ? true : "WARN", mockSlotUnknown.join(" ") || "전부 서버 어휘", mockSlotUnknown);

/* ───────── ④ 알림 kind · 홈 해야 할 일 kind — 화면에 아이콘·링크가 있나 ───────── */
const uiKind = keysOf(uiJs, "UI.KIND =");   // 값이 SVG 문자열(작은따옴표)이라 키만 뜬다
const uiAlias = objectMap(uiJs, "UI.KIND_ALIAS") || new Map();
const known = new Set([...uiKind, ...uiAlias.keys()]);
const srvNotify = new Set([...setOf(/notifyOnce\([^,]*,\s*"([a-z_0-9]+)"/g, serverText), ...setOf(/INSERT INTO notifications[^;]{0,300}?\$\{"([a-z_0-9]+)"\}/g, serverText)]);
const srvTodo = setOf(/todo\.push\(\{\s*kind:\s*"([a-z_0-9]+)"/g, homeTs);
const notifyNoIcon = minus(srvNotify, known);
const todoNoIcon = minus(srvTodo, known);
rec("알림 kind — 서버가 보내는 것에 화면 아이콘이 다 있다", notifyNoIcon.length === 0, notifyNoIcon.join(" ") || `서버 ${srvNotify.size}종`, notifyNoIcon);
rec("홈 해야 할 일 kind — 화면 아이콘이 다 있다", todoNoIcon.length === 0, todoNoIcon.join(" ") || `서버 ${srvTodo.size}종`, todoNoIcon);

/* ───────── ⑤ 모의 알림·todo kind 도 서버 어휘 안인지 ───────── */
const mockKind = setOf(/kind:\s*"([a-z_0-9]+)"/g, mockJs);
const mockKindUnknown = minus(mockKind, new Set([...srvNotify, ...srvTodo, ...known, ...ddlVocab, "post", "shorts", "video", "own", "managed", "coin", "subscription", "tax_invoice", "cash_receipt", "srt", "thumb", "notice", "incident"]));
rec("모의 알림·해야 할 일 kind 가 서버 어휘 안에 있다", mockKindUnknown.length === 0 ? true : "WARN", mockKindUnknown.join(" ") || "전부 서버 어휘", mockKindUnknown);

/* ───────── 출력 ───────── */
if (JSON_OUT) console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
else {
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\n라벨 표면 전수 diff(AC-52) · ${new Date().toISOString()}\n${"─".repeat(124)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 58)} ${w(r.note, 62)}`);
  console.log(`${"─".repeat(124)}\n정본 = 서버(lib/video/judge.ts · lib/ai-tell-gate.ts · drizzle · notifyOnce) · 다르면 고칠 곳은 public/js/{ui,mock}.js`);
}
process.exit(results.some((r) => r.ok === "FAIL") ? 1 : 0);
