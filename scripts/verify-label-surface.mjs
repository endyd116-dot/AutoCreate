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
/* DDL 은 **전부** 읽는다 — 새 표(account_slots 등)의 열거값도 자동으로 어휘가 된다(0001 만 읽으면 새 표가 WARN 으로 뜬다) */
const ddl = walk("drizzle", [".sql"]).sort().map(read).join(String.fromCharCode(10));
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
/* 🔴 위 두 줄은 «모의 ⊂ 서버»만 본다 — **서버에 축이 생겨도 화면이 안 그리면 조용하다**(2026-09-15: structure_repeat·ad_pointing 이 그렇게 지나갔다).
   영상 축엔 이미 같은 검사가 있었는데 글 축엔 없었다. 🔴 새 축은 «화면에 한 번이라도 보이나»까지가 완료다(CLAUDE §4.8). */
const gtUnseen = minus(new Set(gtSrv.keys()), new Set(gtMock.keys()));
rec("서버에만 있고 모의가 한 번도 안 보여 주는 글 검사 축", gtUnseen.length === 0 ? true : "WARN", gtUnseen.join(" ") || "0개", gtUnseen);

/* ③ 막는 축 목록 — 화면이 이 목록으로 «고쳐야 하는 것»과 «알려 주는 것»을 가른다. 서버와 다르면 둘 중 하나가 거짓말이 된다. */
const approveTs = read("lib/content-approve.ts");
/* 이름 **뒤에서부터** 대괄호를 찾는다 — 이름 안의 `string[]` 을 목록으로 잘못 집지 않게. */
/* 🔴 «못 찾았다»(null)와 «비어 있다»([])를 가른다 — R8 §9 로 `HARD_GATE_KEYS` 가 **빈 배열**이 되는데,
   둘을 같이 «0개»로 읽으면 하니스가 «서버를 못 읽었다»로 빨개진다(비어 있는 게 정답인 날이 온다). */
const bracketList = (text, name) => { const i = text.indexOf(name); if (i < 0) return null; const s = text.indexOf("[", i + name.length), e = text.indexOf("]", s);
  return s < 0 || e < 0 ? [] : [...text.slice(s, e).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]); };
const hardSrv = bracketList(approveTs, "HARD_GATE_KEYS: readonly string[] =");
const hardUi = bracketList(uiJs, "UI.GATE_HARD =");
const hardSame = hardSrv !== null && hardUi !== null && hardSrv.join(",") === hardUi.join(",");
rec("🔴 «예약을 막는 축» 목록이 서버와 같다", hardSame,
  hardSrv === null ? "서버에서 HARD_GATE_KEYS 를 못 읽었다" : hardUi === null ? "화면에서 UI.GATE_HARD 를 못 읽었다"
    : hardSame ? (hardSrv.length ? `${hardSrv.length}축` : "0축 — 막는 축이 없다(§9)") : `서버 «${hardSrv.join(" ") || "없음"}» ≠ 화면 «${hardUi.join(" ") || "없음"}»`, { hardSrv, hardUi });

/* ④ 대가 고지 — 문장 하나가 달라도 «고객이 볼 문구»가 달라진다(법 문구라 더 그렇다) */
const discTs = read("lib/disclosure.ts");
const dtSrv = objectMap(discTs, "DISCLOSURE_TEXT") || new Map();
const dtUi = objectMap(uiJs, "UI.DISCLOSURE_TEXT") || new Map();
const dtKeys = ["coupang", "generic", "sponsoredBody", "giftBody"];   // 화면이 쓰는 4문장(배지·짧은 라벨은 영상 쪽)
const dtDiff = dtKeys.filter((k) => dtSrv.get(k) !== dtUi.get(k));
rec("🔴 대가 고지 문장이 서버와 글자까지 같다(화면)", dtSrv.size > 0 && dtDiff.length === 0, dtDiff.join(" ") || `${dtKeys.length}문장`, dtDiff);
const dtMockMiss = dtKeys.filter((k) => k !== "generic" && !mockJs.includes(dtSrv.get(k) ?? "\u0000"));
rec("대가 고지 문장이 모의에도 그대로 있다", dtMockMiss.length === 0 ? true : "WARN", dtMockMiss.join(" ") || "같음", dtMockMiss);
const clSrv = objectMap(discTs, "COMPENSATION_LABEL") || new Map();
const clUi = objectMap(uiJs, "UI.COMP_LABEL") || new Map();
const clDiff = [...clSrv].filter(([k, v]) => clUi.get(k) !== v).map(([k]) => k);
rec("🔴 대가 종류 이름이 서버와 같다", clSrv.size > 0 && clDiff.length === 0, clDiff.join(" ") || `${clSrv.size}종`, clDiff);

/* ⑤ 주제군·수익 목적 — 서버엔 **값만** 있고 한국말은 화면이 정본이다. 값이 서버 타입과 어긋나면 화면이 빈칸을 그린다. */
const wcTs = read("lib/writing-contracts.ts");
const unionOf = (name) => new Set([...((wcTs.match(new RegExp(`export type ${name} =([^;]*);`))?.[1] ?? "").matchAll(/"([a-z_]+)"/g))].map((m) => m[1]));
const groupSrv = unionOf("TopicGroup"), goalSrv = unionOf("RevenueGoal");
const groupUi = new Set((objectMap(uiJs, "UI.GROUP_LABEL") || new Map()).keys());
const goalUi = new Set((objectMap(uiJs, "UI.GOAL_LABEL") || new Map()).keys());
const gMiss = [...minus(groupSrv, groupUi), ...minus(goalSrv, goalUi)];
rec("주제군·수익 목적 — 서버 값에 화면 낱말이 다 있다", gMiss.length === 0, gMiss.join(" ") || `${groupSrv.size}+${goalSrv.size}종`, gMiss);

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
/* «a(설명) | b | c(설명)» 처럼 괄호 설명이 끼어도 값만 뜬다 — 주석을 사람이 읽기 좋게 써도 어휘가 빠지지 않게 */
for (const line of ddl.split("\n")) {
  const cm = line.includes("--") ? line.slice(line.indexOf("--") + 2) : "";
  if (!cm.includes("|")) continue;
  const parts = cm.split("|").map((x) => (x.match(/[a-z_]{3,}/) || [""])[0]).filter(Boolean);
  if (parts.length >= 2) for (const v of parts) ddlVocab.add(v);
}
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

/* ───────── ⑥ 매체 «기준일» 안내(서버 DAY_BASIS_NOTE ↔ 모의) ─────────
   왜: 애드센스·유튜브는 **미국 시간 기준**으로 하루를 센다. 우리는 날짜를 옮기지 않고 화면이 그 사실을 한 줄로 밝히는데,
   그 한 줄을 모의가 제 말로 지어내면 또 «고객이 볼 문장»과 달라진다(AC-52 와 같은 사고). */
const typesTs = read("lib/revenue/types.ts");
const dbSrv = objectMap(typesTs, "DAY_BASIS_NOTE") || new Map();
const dbMock = objectMap(mockJs, "DAY_BASIS_NOTE") || new Map();
const dbDiff = [...dbSrv].filter(([k, v]) => dbMock.get(k) !== v).map(([k]) => k);
const dbExtra = minus(new Set(dbMock.keys()), new Set(dbSrv.keys()));
rec("🔴 매체 기준일 안내 — 모의 문구가 서버와 글자까지 같다", dbSrv.size > 0 && dbDiff.length === 0 && dbExtra.length === 0,
  [...dbDiff, ...dbExtra].join(" ") || `서버 ${dbSrv.size}종`, [...dbDiff, ...dbExtra]);

/* ───────── ⑦ 🔴 **숫자**도 서버가 정본이다(C · R8-A §4 · 2026-09-15) ─────────
   왜 늘렸나: 이 하니스는 여태 **낱말만** 봤다. 그런데 R8-A 에서 화면이 «기준 70% 미만» 이라 말하는데
   서버 정본 `STRUCTURE_OVERLAP_MAX` 는 **0.75** 인 것이 나왔다 — 라벨은 글자까지 같은데 **숫자가 달랐다.**
   고객은 그 숫자를 보고 «내 글은 안 걸리겠네» 를 판단한다. 틀린 숫자는 틀린 라벨과 똑같이 거짓말이다.
   규약: 서버 상수를 이름으로 떠서, 화면·모의가 그 규칙을 **말하는 자리**의 숫자와 맞춘다.
   🔴 본문 예시 숫자(«10분 담그기» 같은 글감)는 규칙이 아니므로 대상이 아니다 — 규칙을 말하는 문구만 고른다. */
const printTs = read("lib/structure-print.ts");
const num = (text, re) => { const m = text.match(re); return m ? Number(m[1]) : null; };

const NUMS = [
  {
    what: "골격 겹침 기준(structure_repeat)",
    server: num(printTs, /STRUCTURE_OVERLAP_MAX\s*=\s*([0-9.]+)/),
    scale: 100, unit: "%",
    screen: (() => { const m = (uiJs + mockJs).match(/기준\s*([0-9]+)\s*%\s*미만/); return m ? Number(m[1]) : null; })(),
    where: "public/js/mock.js «기준 N% 미만»",
  },
  {
    what: "자막 최대 줄 수(caption_lines)",
    server: num(judgeTs, /CAPTION_MAX_LINES\s*=\s*([0-9]+)/),
    scale: 1, unit: "줄",
    screen: (() => { const m = (uiJs + mockJs).match(/자막\s*([0-9]+)\s*줄/); return m ? Number(m[1]) : null; })(),
    where: "public/js/mock.js «자막 N줄»",
  },
  {
    what: "제휴 링크 상한(affiliate_count)",
    server: num(gateTs, /제휴 링크\s*([0-9]+)개 이하/) ?? num(approveTs, /links\s*<=\s*([0-9]+)/),
    scale: 1, unit: "개",
    screen: (() => { const m = (uiJs + mockJs).match(/제휴 링크\s*([0-9]+)\s*개/); return m ? Number(m[1]) : null; })(),
    where: "public/js/mock.js «제휴 링크 N개»",
  },
];
for (const n of NUMS) {
  if (n.server === null) { rec(`⑦ 숫자 — ${n.what}(서버 상수를 못 떴다)`, "WARN", "정규식이 서버 상수를 못 찾았다 — 상수 이름이 바뀌었나"); continue; }
  if (n.screen === null) { rec(`⑦ 숫자 — ${n.what}(화면이 아직 안 말한다)`, "WARN", `서버 ${n.server * n.scale}${n.unit} · 화면에 그 문구 없음`); continue; }
  const want = Math.round(n.server * n.scale * 1000) / 1000;
  rec(`🔴 ⑦ 숫자 — ${n.what} 가 서버와 같다`, want === n.screen,
    `서버 ${want}${n.unit} ↔ 화면 ${n.screen}${n.unit}${want === n.screen ? "" : `  ⇒ 고칠 곳은 ${n.where}`}`);
}

/* ───────── ⑧-b 🔴 **코인 값**(서버 COIN_TABLE ↔ 화면 미리보기 표) ─────────
   왜: 2026-09-15 사장님 승인으로 **글 1편이 7코인 → 1코인**이 됐다. 화면은 «1 + 사진 장수»로 세고 있어서 **7배를 불러 주고 있었다**.
   돈은 낱말보다 더 티 나는 거짓말이다. 게다가 운영센터가 단가를 바꿀 수 있게 됐으니(B ea980a3) 화면에 박은 숫자는 그날로 썩는다.
   🔴 미리보기 표는 **서버 표에서 복사**하고 여기서 견준다. 실제 차감은 언제나 서버 응답(`coinCost`)이다. */
const coinTs = read("lib/coin-table.ts");
const coinSrv = objectMap(coinTs, "COIN_TABLE: Record<CoinItem, number> =") || new Map();
const coinSrvNum = new Map([...(coinTs.match(/COIN_TABLE: Record<CoinItem, number> = \{([\s\S]*?)\}/)?.[1] ?? "").matchAll(/([a-z_0-9]+)\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
const coinUi = new Map([...(uiJs.match(/UI\.COIN = \{([^}]*)\}/)?.[1] ?? "").matchAll(/([a-z_0-9]+)\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
const coinDiff = [...coinUi].filter(([k, v]) => coinSrvNum.get(k) !== v).map(([k, v]) => `${k}: 화면 ${v} ≠ 서버 ${coinSrvNum.get(k) ?? "없음"}`);
rec("🔴 코인 값이 서버 표와 같다(화면 미리보기)", coinSrvNum.size > 0 && coinUi.size > 0 && coinDiff.length === 0,
  coinDiff.join(" | ") || `${coinUi.size}종 · 글 ${coinSrvNum.get("blog")}코인`, coinDiff);

/* ───────── ⑧ 광고 붙이는 «길»(서버 adsWayOf·adsRemovable ↔ 화면 표) ─────────
   왜: 채널마다 길이 다르고(우리가 직접 / 내 PC 가 / 아직 없음), **티스토리는 뗄 수 없다**(러너가 읽기만 한다).
   화면이 이 표를 잘못 들고 있으면 **눌러도 아무 일이 안 나는 단추**가 생긴다 — 없는 되돌리기를 약속하는 것이 가장 나쁘다.
   🔴 서버에 채널이 하나 늘면 화면 표가 조용히 낡는다 — 그래서 여기서 통째로 견준다. */
const adsTs = read("lib/ads-connect.ts");
const wayFn = adsTs.slice(Math.max(0, adsTs.indexOf("export function adsWayOf")), adsTs.indexOf("export function adsRemovable"));
const waySrv = new Map([...wayFn.matchAll(/case "([a-z_]+)":\s*return "([a-z_]+)"/g)].map((m) => [m[1], m[2]]));
const wayUi = objectMap(uiJs, "UI.ADS_WAY") || new Map();
const wayDiff = [...new Set([...waySrv.keys(), ...wayUi.keys()])].filter((k) => waySrv.get(k) !== wayUi.get(k))
  .map((k) => `${k}: 서버 «${waySrv.get(k) ?? "없음"}» ≠ 화면 «${wayUi.get(k) ?? "없음"}»`);
rec("🔴 광고 붙이는 길(채널→방법)이 서버와 같다", waySrv.size > 0 && wayDiff.length === 0, wayDiff.join(" | ") || `${waySrv.size}채널`, wayDiff);
/* 함수 **한 개**만 떠서 본다 — 다음 `\n}` 까지(파일 뒤쪽 감사 문자열까지 긁어오면 목록이 엉뚱해진다) */
const rmAt = adsTs.indexOf("export function adsRemovable");
const rmFn = rmAt < 0 ? "" : adsTs.slice(rmAt, adsTs.indexOf("\n}", rmAt));
const rmSrv = [...new Set([...rmFn.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))].sort();
const rmUi = bracketList(uiJs, "UI.ADS_REMOVABLE =").sort();
rec("🔴 «뗄 수 있는 길» 목록이 서버와 같다(티스토리는 못 뗀다)", rmSrv.length > 0 && rmSrv.join(",") === rmUi.join(","),
  rmSrv.join(",") === rmUi.join(",") ? `${rmSrv.length}가지` : `서버 «${rmSrv.join(" ")}» ≠ 화면 «${rmUi.join(" ")}»`, { rmSrv, rmUi });

/* ───────── 출력 ───────── */
if (JSON_OUT) console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
else {
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\n라벨 표면 전수 diff(AC-52) · ${new Date().toISOString()}\n${"─".repeat(124)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 58)} ${w(r.note, 62)}`);
  console.log(`${"─".repeat(124)}\n정본 = 서버(lib/video/judge.ts · lib/ai-tell-gate.ts · lib/revenue/types.ts · lib/disclosure.ts · lib/content-approve.ts · drizzle · notifyOnce) · 다르면 고칠 곳은 public/js/{ui,mock}.js`);
}
process.exit(results.some((r) => r.ok === "FAIL") ? 1 : 0);
