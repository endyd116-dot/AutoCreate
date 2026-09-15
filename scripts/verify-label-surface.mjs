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
/* 🔴 [2026-09-16 메인] **주석을 걷어 낸 본문** — 서버 정본을 «이름으로 찾아 읽는» 줄들이 주석에 먼저 걸린다.
   실제로 났다: `lib/coin-table.ts` 20행 주석의 «`COIN_TIERS[k].coins` 는 여기서 파생한다» 한 줄 때문에
   `/COIN_TIERS[^=]*=\s*\{/` 가 **엉뚱한 블록**(영상 이름표)을 집어 «0등급»이 나왔다 — 제품은 멀쩡한데 **자가 못 본 것**이다.
   ⇒ 서버 소스를 **구조로 읽는 자리**는 이걸 쓴다(화면·모의 쪽은 원문 그대로 봐도 된다 — 거긴 낱말을 세는 게 목적이다).
   🔴 형제 하니스 `verify-r8-audit64.mjs`·`verify-r8-deadends.mjs` 가 이미 같은 일을 한다(AC-82 · 자가 여러 벌이면 안 된다). */
const readCode = (p) => read(p)
  .replace(/[/][*][\s\S]*?[*][/]/g, " ")
  .replace(/(^|[^:])[/][/].*/g, "$1 ");   // . 은 줄바꿈을 안 먹는다 — 역슬래시를 아예 안 쓴다(AC-100)
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
/* [R8-A2] 🔴 영상 쪽 «막는 축»도 같이 잰다 — 글은 `HARD_GATE_KEYS = []` 로 0개가 됐지만, 영상은 **깨진 물건 둘**(`judgeBlockers` 의 `BROKEN`)이 남아 있다.
   화면(`UI.JUDGE_BLOCK`)은 그 둘을 보고 «다시 만들면 돼요»와 «그대로 올릴 수 있어요»를 가른다 — 두 목록이 갈리면 **멀쩡한 영상을 버리라고 말한다.** */
const jbSrv = bracketList(approveTs, 'const BROKEN = new Set(');
const jbUi = bracketList(uiJs, "UI.JUDGE_BLOCK =");
const jbSame = jbSrv !== null && jbUi !== null && [...jbSrv].sort().join(",") === [...jbUi].sort().join(",");
rec("🔴 영상 «깨진 물건» 목록이 서버와 같다(그것만 막는다)", jbSame,
  jbSrv === null ? "서버에서 judgeBlockers 의 BROKEN 을 못 읽었다" : jbUi === null ? "화면에서 UI.JUDGE_BLOCK 을 못 읽었다"
    : jbSame ? `${jbSrv.length}축 — ${jbSrv.join(" ")}` : `서버 «${jbSrv.join(" ") || "없음"}» ≠ 화면 «${jbUi.join(" ") || "없음"}»`, { jbSrv, jbUi });
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
/* «a(설명) | b | c(설명)» 처럼 괄호 설명이 끼어도 값만 뜬다 — 주석을 사람이 읽기 좋게 써도 어휘가 빠지지 않게.
   🔴 [R8-A2 수리] 한 칸에 **값이 둘** 있는 주석(«open(접수) → customer_removed(고객이 내림) | …» · takedown_notices)에서
      앞의 하나만 떠서 `customer_removed` 가 «모의가 지어낸 값»으로 WARN 이 났다. 칸마다 **전부** 뜬다. */
for (const line of ddl.split("\n")) {
  const cm = line.includes("--") ? line.slice(line.indexOf("--") + 2) : "";
  if (!cm.includes("|")) continue;
  const parts = cm.split("|").map((x) => x.match(/[a-z_]{3,}/g) || []).filter((x) => x.length);
  if (parts.length >= 2) for (const vs of parts) for (const v of vs) ddlVocab.add(v);
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
/* 🔴 이 regex 는 `kind:` 라는 **이름만** 보기 때문에 알림과 상관없는 칸(사진 출처 kind · 수치 주장 kind)까지 집는다 —
   [R8-A2] 그 둘을 허용 목록에 적는다(lib/photo-source.ts PhotoSourceKind · lib/fact-claims.ts ClaimKind). */
const mockKindUnknown = minus(mockKind, new Set([...srvNotify, ...srvTodo, ...known, ...ddlVocab, "post", "shorts", "video", "own", "managed", "coin", "subscription", "tax_invoice", "cash_receipt", "srt", "thumb", "notice", "incident",
  "customer", "stock", "money", "percent", "year", "count", "structural"]));
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
const coinTs = readCode("lib/coin-table.ts");   // 🔴 주석에 걸리면 엉뚱한 블록을 읽는다(위 readCode 주석)
const coinSrv = objectMap(coinTs, "COIN_TABLE: Record<CoinItem, number> =") || new Map();
const coinSrvNum = new Map([...(coinTs.match(/COIN_TABLE: Record<CoinItem, number> = \{([\s\S]*?)\}/)?.[1] ?? "").matchAll(/([a-z_0-9]+)\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
const coinUi = new Map([...(uiJs.match(/UI\.COIN = \{([^}]*)\}/)?.[1] ?? "").matchAll(/([a-z_0-9]+)\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
const coinDiff = [...coinUi].filter(([k, v]) => coinSrvNum.get(k) !== v).map(([k, v]) => `${k}: 화면 ${v} ≠ 서버 ${coinSrvNum.get(k) ?? "없음"}`);
rec("🔴 코인 값이 서버 표와 같다(화면 미리보기)", coinSrvNum.size > 0 && coinUi.size > 0 && coinDiff.length === 0,
  coinDiff.join(" | ") || `${coinUi.size}종 · 글 ${coinSrvNum.get("blog")}코인`, coinDiff);

/* ───────── ⑧-c 🔴 **코인 등급 표**(서버 COIN_TIERS ↔ 모의 TIERS ↔ 화면 UI.TIER_LABEL) — [R9R10-A · 2026-09-16] ─────────
   왜: 사장님이 «간단히 1 · 보통 2 · 프리미엄 3»을 정하셨고 «최소»라는 말은 쓰지 말라 하셨다. 라벨·코인·설명 문장(say)이 세 곳에 있다 —
   정본은 서버 `lib/coin-table.ts COIN_TIERS`(B 채택 · docs/active/2026-09-16-R9R10-AB-keys.md §11). 모의는 accounts-list.tiers 로 실어 주고 화면은 셈 없이 그린다(AC-74).
   🔴 B 가 머지되기 전엔 서버 표가 없다 — 그때는 △(경고)로 두고, 표가 생기면 **글자·숫자까지** 대조한다. */
{
  const pickTier = (txt) => new Map([...txt.matchAll(/(simple|standard|premium)\b[^{]*\{([^}]*)\}/g)].map((m) => [m[1], {
    label: (m[2].match(/label:\s*"([^"]*)"/) || [])[1], coinsRaw: ((m[2].match(/coins:\s*([^,}]+)/) || [])[1] || "").trim(), coins: Number((m[2].match(/coins:\s*(\d+)/) || [])[1]), say: (m[2].match(/say:\s*"([^"]*)"/) || [])[1] }]));
  const srvBlock = coinTs.match(/COIN_TIERS[^=]*=\s*\{([\s\S]*?)\n\}/);
  const mockBlock = mockJs.match(/const TIERS = \[([\s\S]*?)\];/);
  const tierMock = new Map([...(mockBlock?.[1] ?? "").matchAll(/key:\s*"(simple|standard|premium)"([^}]*)\}/g)].map((m) => [m[1], {
    label: (m[2].match(/label:\s*"([^"]*)"/) || [])[1], coins: Number((m[2].match(/coins:\s*(\d+)/) || [])[1]), say: (m[2].match(/say:\s*"([^"]*)"/) || [])[1] }]));
  const tierUi = objectMap(uiJs, "UI.TIER_LABEL =") || new Map();
  const WANT = { simple: "간단히", standard: "보통", premium: "프리미엄" };   // 사장님 확정 낱말 — 서버가 아직 없을 때도 이 셋은 지킨다
  const bad0 = Object.entries(WANT).filter(([k, v]) => tierUi.get(k) !== v || (tierMock.get(k) || {}).label !== v).map(([k, v]) => `${k}: 화면 «${tierUi.get(k) ?? "없음"}» · 모의 «${(tierMock.get(k) || {}).label ?? "없음"}» ≠ «${v}»`);
  rec("🔴 ⑧-c 등급 이름 셋(간단히·보통·프리미엄)이 화면·모의에 그대로 있다", tierMock.size === 3 && tierUi.size === 3 && bad0.length === 0, bad0.join(" | ") || "3등급", bad0);
  const minWord = [...(mockBlock?.[1] ?? ""), ...(uiJs.match(/UI\.TIER_LABEL = \{[^}]*\}/)?.[0] ?? "")].join("").includes("최소");
  rec("🔴 ⑧-c 등급 이름에 «최소»가 없다(사장님)", !minWord, minWord ? "«최소» 가 등급 표에 있다 — 고른 고객이 «내 글은 최소구나» 한다" : "없음");
  if (!srvBlock) rec("⑧-c 등급 표 — 서버 COIN_TIERS 를 아직 못 읽었다(B 머지 전)", "WARN", `모의 ${tierMock.size}등급 · 화면 라벨 ${tierUi.size}개 — 머지 뒤 이 줄이 글자·코인·문장 대조로 바뀐다`);
  else {
    /* 🔴 [2026-09-16 메인] B 가 등급 코인을 **숫자로 안 적고** `COIN_TABLE.post_simple` 로 파생시켰다(«값 두 벌 금지» — 옳은 설계다).
       그런데 이 자는 숫자 리터럴만 읽어 **NaN** 이 났다. ⇒ 참조를 **풀어서** 읽는다. 자가 제품의 좋은 설계를 벌하면 안 된다. */
    const deref = (v) => { const m = String(v).match(/COIN_TABLE[.]([a-z_0-9]+)/); return m ? coinSrvNum.get(m[1]) : Number(v); };
    const srv = new Map([...pickTier(srvBlock[1])].map(([k, v]) => [k, { ...v, coins: deref(v.coinsRaw ?? v.coins) }])); const diffs = [];
    for (const [k, v] of srv) { const m = tierMock.get(k);
      if (!m) { diffs.push(`${k}: 모의 없음`); continue; }
      if (m.label !== v.label) diffs.push(`${k}: 모의 라벨 «${m.label}» ≠ 서버 «${v.label}»`);
      if (m.coins !== v.coins) diffs.push(`${k}: 모의 ${m.coins}코인 ≠ 서버 ${v.coins}코인`);
      if (v.say && m.say !== v.say) diffs.push(`${k}: 모의 문장 ≠ 서버 «${v.say}»`);
      if (tierUi.get(k) !== v.label) diffs.push(`${k}: 화면 라벨 «${tierUi.get(k) ?? "없음"}» ≠ 서버 «${v.label}»`); }
    rec("🔴 ⑧-c 등급 표(라벨·코인·문장)가 서버 COIN_TIERS 와 같다", srv.size === 3 && diffs.length === 0, diffs.slice(0, 4).join(" | ") || `${srv.size}등급 · ${[...srv].map(([k, v]) => `${v.label} ${v.coins}`).join(" · ")}`, diffs);
  }
  /* 서식·블록 이름표 — 서버 MARK_LABEL(B) 이 정본. formatUnused[].label 은 서버가 실어 주지만, 화면의 예비 맵(UI.MARK_LABEL)이 같은 낱말을 쓰는지 본다. */
  const markSrv = objectMap(serverText, "MARK_LABEL") || new Map();
  const markUi = objectMap(uiJs, "UI.MARK_LABEL =") || new Map();
  if (!markSrv.size) rec("⑧-d 서식 이름표 — 서버 MARK_LABEL 을 아직 못 읽었다(B 머지 전)", "WARN", `화면 예비 맵 ${markUi.size}개`);
  else { const md = [...markSrv].filter(([k, v]) => markUi.has(k) && markUi.get(k) !== v).map(([k, v]) => `${k}: 화면 «${markUi.get(k)}» ≠ 서버 «${v}»`);
    rec("🔴 ⑧-d 서식 이름표가 서버 MARK_LABEL 과 같다(겹치는 키)", md.length === 0, md.slice(0, 4).join(" | ") || `서버 ${markSrv.size}개 · 겹침 ${[...markSrv.keys()].filter((k) => markUi.has(k)).length}개`, md); }
}

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

/* ───────── ㉗ 🔴 **내 AI 키가 안 될 때의 사유 셋**(서버 BYO_ERROR_TEXT ↔ 화면 ↔ 모의) ─────────
   왜: 목록(`GET /api/ai-keys`)은 `lastErrorKind` 만 주고 **문장은 안 준다**. 그래서 문장이 화면 쪽에 한 벌 더 생겼다.
   이 셋은 «오류»가 아니라 **고객이 할 일이 서로 다른 셋**이다(키를 다시 복사 / 기다린다 / API 를 켠다).
   서버가 문구를 고쳤는데 화면이 옛 문장을 말하면 고객은 **엉뚱한 일을 한다** — 코인표(⑧-b)와 같은 이유로 여기서 견준다.
   🔴 꽂을 때의 실패 문장은 서버가 그때그때 보내 준다(`error`) — 화면은 그걸 그대로 쓴다. 여기서 재는 건 **목록 쪽** 한 벌이다. */
const byoSrv = objectMap(read("lib/ai-key-byo.ts"), "BYO_ERROR_TEXT: Record<ByoErrorKind, string> =") || new Map();
const byoUi = objectMap(uiJs, "UI.BYO_ERROR_TEXT =") || new Map();
const byoMock = objectMap(mockJs, "const BYO_ERROR_TEXT =") || new Map();
const byoDiff = [...byoSrv].filter(([k, v]) => byoUi.get(k) !== v).map(([k, v]) => `${k}: 화면 «${byoUi.get(k) ?? "없음"}» ≠ 서버 «${v}»`);
const byoExtra = [...byoUi].filter(([k]) => !byoSrv.has(k)).map(([k]) => `화면에만 «${k}»`);
rec("🔴 AI 키 실패 사유 셋이 서버와 글자까지 같다(화면)", byoSrv.size === 3 && byoDiff.length === 0 && byoExtra.length === 0,
  [...byoDiff, ...byoExtra].join(" | ") || `${byoSrv.size}갈래(${[...byoSrv.keys()].join("·")})`, [...byoDiff, ...byoExtra]);
const byoMockDiff = [...byoSrv].filter(([k, v]) => byoMock.get(k) !== v).map(([k]) => k);
rec("AI 키 실패 사유 셋이 모의에도 그대로 있다", byoMockDiff.length === 0 ? true : "WARN", byoMockDiff.join(" ") || "같음", byoMockDiff);
/* ───────── ⑨ 🔴 **시스템 용어가 시트 안에 숨어 있지 않나**(정적) ─────────
   왜: 화면 감사(scratchpad/shot.mjs)는 **열려 있는 화면만** 본다 — 바텀시트 안 문구는 열어야 보인다.
   2026-09-15 실측: 계정 연결 시트가 «발행할 때만 **러너**가 열어요»라고 말하고 있었다(고객 금지어 · §13.0 «러너»→«내 PC 프로그램»).
   그래서 **만들어진 화면 파일의 글자**를 통째로 훑는다 — 열리든 안 열리든 잡힌다.
   🔴 주석·API 경로(`/api/runner-list`·`runnerOn`)는 뺀다 — 코드가 그 낱말을 쓰는 것은 금지가 아니다(고객이 읽는 글자만 본다). */
const CUSTOMER_BANNED = ["러너", "테넌트", "잡 상태"];
/* 🔴 약관·방침은 뺀다 — 거기서는 «내 PC 프로그램»(러너) 처럼 **한 번 정의하는 것**이 오히려 맞다(법 문서의 용어 정의).
   운영센터도 뺀다(§13.0b 운영 콘솔 예외 — 운영자는 그 낱말로 일한다). 고객이 **쓰면서 읽는 화면**만 본다. */
const LEGAL = ["terms.html", "privacy.html", "paid-terms.html"];
const pageFiles = [...walk("public/app", [".html"]), ...walk("public", [".html"]).filter((p) => !p.includes("/ops/") && !p.includes("/app/"))]
  .filter((p) => !LEGAL.includes(p.split("/").pop()));
const wordHits = [];
for (const f of pageFiles) {
  /* 🔴 여러 줄 주석은 **줄 수를 지키며** 지운다 — 줄마다 «/*» 만 보면 이어지는 줄이 코드로 잘못 읽힌다(줄 번호가 어긋나면 못 찾는다) */
  const txt = read(f).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  txt.split("\n").forEach((line, i) => {
    const code = line.split("//")[0];
    for (const w of CUSTOMER_BANNED) {
      let at = -1;
      while ((at = code.indexOf(w, at + 1)) >= 0) {
        const before = code[at - 1] ?? " ", after = code[at + w.length] ?? " ";
        if (/[A-Za-z\-_/]/.test(before) || /[A-Za-z\-_/]/.test(after)) continue;   // runner-list·runnerOn 같은 이름은 뺀다
        wordHits.push(`${f.split("/").pop()}:${i + 1} «${w}» — ${code.slice(Math.max(0, at - 24), at + 24).trim()}`);
      }
    }
  });
}
rec("🔴 시트 안까지 — 고객 화면에 시스템 용어 0", wordHits.length === 0, wordHits.slice(0, 3).join(" | ") || `${pageFiles.length}장 훑음`, wordHits);

/* ───────── 출력 ───────── */
if (JSON_OUT) console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
else {
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\n라벨 표면 전수 diff(AC-52) · ${new Date().toISOString()}\n${"─".repeat(124)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.step, 58)} ${w(r.note, 62)}`);
  console.log(`${"─".repeat(124)}\n정본 = 서버(lib/video/judge.ts · lib/ai-tell-gate.ts · lib/revenue/types.ts · lib/disclosure.ts · lib/content-approve.ts · drizzle · notifyOnce) · 다르면 고칠 곳은 public/js/{ui,mock}.js`);
}
process.exit(results.some((r) => r.ok === "FAIL") ? 1 : 0);
