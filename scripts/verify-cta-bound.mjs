/**
 * scripts/verify-cta-bound.mjs — 🔴 «검수 화면의 단추가 **눌렀을 때 서버로 가나**» (첫 발행 고장 ① · 2026-09-20).
 *
 *   왜 생겼나: 첫 실발행 뒤 `awaiting_manual`(올리다 멈춘 글) 화면에 **손님이 할 수 있는 일이 하나도 없었다.**
 *   배지에 «확인 필요»만 뜨고 단추도, 까닭도 없었다 — 서버는 `failReason` 을 **실어 보내고 있었는데** 화면이 안 읽었다.
 *   첫 발행이 한 번 실패하면(러너 로그인 전이라 흔하다) 그 글은 거기서 갇힌다.
 *
 *   🔴 **«버튼이 그려졌나»로 재면 지금도 초록이다**(AC-113 «자가 안 보는 자리»).
 *      이 자는 **상태마다 «무엇이 뜨고, 그게 손에 닿나»**를 센다 — 그린 자리와 **손 붙이는 자리가 짝인가**까지.
 *
 *   🔴 **이 자는 자기가 무엇을 셌는지 말한다.**
 *
 *   쓰기: node scripts/verify-cta-bound.mjs
 */
import { readFileSync } from "node:fs";

const fails = [];
const notes = [];
const decomment = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, a) => a + " ".repeat(m.length - a.length));

const TPL = "public/app/_tpl.txt";
const GEN = "public/app/piece.html";
const tpl = decomment(readFileSync(TPL, "utf8"));
const gen = decomment(readFileSync(GEN, "utf8"));
/* piece.html 절만 떼어 본다 — `_tpl.txt` 는 화면 35개가 한 파일이라 통째로 세면 남의 단추를 센다. */
const seg = (() => { const i = tpl.indexOf("=== piece.html"); const j = tpl.indexOf("\n=== ", i + 10); return i < 0 ? "" : tpl.slice(i, j < 0 ? tpl.length : j); })();
notes.push(`센 것: 정본에서 \`piece.html\` 절만 떼어 본다 — ${seg.length}자 (${seg ? "찾음" : "🔴 못 찾음"})`);
if (!seg) fails.push("🔴 `_tpl.txt` 에서 `=== piece.html` 절을 못 찾았다 — 이 자가 과녁을 잃었다(양성 대조 실패).");

/* ── ① 🔴 정적 마크업에 **손 없는 단추**가 박혀 있지 않나 ── */
const staticCta = (gen.match(/<div class="cta" id="cta"[^>]*>([\s\S]*?)<\/div>/) || [])[1] ?? null;
const staticBtns = staticCta === null ? null : [...staticCta.matchAll(/id="([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
notes.push(`센 것: 생성물 \`${GEN}\` 의 정적 \`#cta\` 안에 미리 박힌 단추 = ${staticBtns === null ? "(#cta 를 못 찾음)" : JSON.stringify(staticBtns)}`);
if (staticBtns === null) fails.push("🔴 생성물에서 `#cta` 를 못 찾았다(양성 대조 실패).");
else if (staticBtns.length) fails.push(`🔴 정적 \`#cta\` 에 단추가 미리 박혀 있다(${staticBtns.join(", ")}) — \`render()\` 가 멈추면 **손이 안 붙은 단추**가 그대로 보인다.`);

/* ── ② 🔴 그리는 자리마다 **손 붙이는 자리가 짝인가** ──
   `cta.innerHTML = …#아이디…` 를 쓴 갈래는 같은 갈래 안에서 그 아이디에 onclick 을 붙이는 함수를 불러야 한다. */
const BINDERS = { approve: "bindCta", save: "bindCta", regen: "bindCta", pubNow: "bindNow" };
const lines = seg.split(/\r?\n/);

/* 🔴 **도우미 함수 안에 든 단추까지 펼쳐서 본다.** 처음엔 그 줄의 `id="…"` 만 셌는데, `nowBtn()` 은 단추를
   **함수 안에서** 만들기 때문에 그 줄엔 id 가 없다 ⇒ «손이 필요 없는 갈래»로 새어 나갔다.
   그러면 `bindNow()` 를 떼어도 이 자가 안 운다 — **내가 잡으려는 바로 그 고장**을 못 보는 것이다(AC-113).
   ⇒ `xxxBtn()` 류 호출을 그 함수 본문으로 바꿔 놓고 센다. */
const helpers = new Map();
for (const m of seg.matchAll(/const (\w*[Bb]tn)\s*=\s*\(\)\s*=>\s*(`[^`]*`|[^;\n]+);/g)) helpers.set(m[1], m[2]);
notes.push(`센 것: 단추를 만드는 도우미 함수 = ${JSON.stringify([...helpers.keys()])} (이 안의 단추도 펼쳐서 센다)`);
const expand = (l) => { let s = l; for (const [fn, body] of helpers) s = s.split(fn + "()").join(body); return s; };

const ctaLines = lines.map((l, i) => ({ l, n: i + 1 })).filter((x) => /cta\.innerHTML\s*=/.test(x.l));
notes.push(`센 것: 정본에서 \`cta.innerHTML = …\` 를 쓰는 갈래 = ${ctaLines.length}곳`);
if (!ctaLines.length) fails.push("🔴 `cta.innerHTML` 을 쓰는 곳이 없다 — 이 자가 헛돌고 있다(양성 대조 실패).");
let bound = 0; const inert = [];
for (const { l, n } of ctaLines) {
  const full = expand(l);
  const ids = [...full.matchAll(/id="([a-zA-Z0-9_]+)"/g)].map((m) => m[1]).filter((id) => BINDERS[id]);
  if (!ids.length) {
    /* 손이 필요 없는 갈래인지 **왜 그런지까지** 적는다 — «아무 id 도 없다»는 이유가 될 수 없다(위에서 한 번 속았다). */
    const why = /<a\s/.test(full) ? "링크(<a>)" : /disabled/.test(full) ? "꺼진 단추" : "🔴 까닭 모름";
    inert.push(`${n}줄(${why})`);
    if (why.startsWith("🔴")) fails.push(`🔴 ${TPL}:${n} — 단추를 그리는데 **손을 붙이지도, 링크도, 꺼짐도 아니다.** 눌러도 아무 일도 안 날 수 있다: ${l.trim().slice(0, 110)}`);
    continue;
  }
  const need = [...new Set(ids.map((id) => BINDERS[id]))];
  const missing = need.filter((fn) => !new RegExp("\\b" + fn + "\\(\\)").test(l));
  if (missing.length) fails.push(`🔴 ${TPL}:${n} — \`${ids.join("·")}\` 를 그려 놓고 **손을 안 붙인다**(\`${missing.join("·")}\` 호출 없음). 눌러도 아무 일도 안 난다.`);
  else bound++;
}
notes.push(`센 것: 그 ${ctaLines.length}곳 중 — 손을 붙인 갈래 ${bound}곳 · 손이 필요 없는 갈래 ${inert.length}곳 [${inert.join(" · ")}]`);

/* ── ③ 🔴 **막다른 골목이 없나** — 상태마다 할 수 있는 일이 있나 ── */
const HAVE_TO_SAY = [
  { st: "awaiting_manual", 왜: "올리다 멈춘 글 — 첫 발행이 실패하면 여기 갇힌다(2026-09-20 실제로 갇혔다)" },
  { st: "failed", 왜: "만들거나 올리지 못한 글" },
  { st: "publishing", 왜: "올리는 중 — 누를 건 없어도 말은 해 줘야 한다" },
];
for (const h of HAVE_TO_SAY) {
  const inChain = new RegExp(`(STUCK_ST|NOW_OK)[\\s\\S]{0,120}includes\\(P\\.status\\)|P\\.status === "${h.st}"`).test(seg);
  const inList = new RegExp(`STUCK_ST\\s*=\\s*\\[[^\\]]*"${h.st}"`).test(seg) || new RegExp(`P\\.status === "${h.st}"`).test(seg);
  const ok = inList || (h.st === "publishing" && /P\.status === "publishing"/.test(seg));
  notes.push(`센 것: **${h.st}** 갈래가 있나 = ${ok} (${h.왜})`);
  if (!ok) fails.push(`🔴 \`${h.st}\` 에 아무 갈래가 없다 — 그 상태의 손님은 **빈 화면에 갇힌다**(${h.왜}).`);
  void inChain;
}
/* 막힌 글에는 **까닭**과 **다음 수**가 둘 다 있어야 한다.
   🔴 `seg` 통째로 «failReason 이 있나»를 보면 **다른 갈래(영상 generating/failed)의 것까지 세어** 통과한다 —
      까닭을 지운 변이에 안 울어서 알았다(AC-112: 변이를 의심했더니 이번엔 자가 성겼다).
      ⇒ **막힌 글을 그리는 함수 안**만 본다. */
const stuckFn = (seg.match(/function stuckSay\(\)[\s\S]*?\n\}/) || [""])[0];
notes.push(`센 것: 막힌 글 문구를 만드는 \`stuckSay()\` 를 찾았나 = ${!!stuckFn} (${stuckFn.length}자)`);
if (!stuckFn) fails.push("🔴 `stuckSay()` 를 못 찾았다 — 막힌 글에 할 말을 만드는 자리가 없다(양성 대조 실패).");
const saysWhy = /P\.failReason/.test(stuckFn);
const hasWay = /posts\.html\?status=awaiting_manual/.test(seg);
notes.push(`센 것: **\`stuckSay()\` 안에서** 까닭(서버 \`failReason\`)을 쓰나 = ${saysWhy} · **다음 수**(직접 올리는 길)로 보내나 = ${hasWay}`);
if (!saysWhy) fails.push("🔴 서버가 보낸 `failReason` 을 화면이 안 쓴다 — «확인 필요»만 뜨고 **무엇을 확인해야 하는지** 말하지 않는다.");
if (!hasWay) fails.push("🔴 막힌 글에서 «직접 올리는 길»(`posts.html?status=awaiting_manual`)로 보내지 않는다 — 막다른 골목이다(§9-③).");

/* ── ③-b 🔴 **화면이 «고칠 수 있다»고 보는 상태가 서버 «승인해 준다»와 같은가** ──
   상태 전수 훑기에서 나온 둘째 고장: 손님이 고치면 서버가 `edited` 로 바꾸는데 화면은 `in_review` 만 봐서
   **그 순간 «이대로 발행 예약»이 사라졌다.** «서버는 되는데 화면이 안 되는» 자리는 §9 가 내린 게이트다. */
const approveTs = decomment(readFileSync("lib/content-approve.ts", "utf8"));
const srvReview = (approveTs.match(/REVIEW_PIECE_STATUSES[^=]*=\s*\[([^\]]*)\]/) || [, ""])[1].replace(/\s/g, "");
const uiEditable = (seg.match(/EDITABLE_ST\s*=\s*\[([^\]]*)\]/) || [, ""])[1].replace(/\s/g, "");
notes.push(`센 것: 서버가 승인해 주는 상태 \`REVIEW_PIECE_STATUSES\` [${srvReview}] ↔ 화면이 고칠 수 있다고 보는 \`EDITABLE_ST\` [${uiEditable}]`);
if (!uiEditable) fails.push("🔴 화면에 `EDITABLE_ST` 가 없다 — `in_review` 하나만 보면 **고친 글(`edited`)에서 발행 단추가 사라진다**.");
else if (!srvReview) fails.push("🔴 `lib/content-approve.ts` 의 `REVIEW_PIECE_STATUSES` 를 못 찾았다(양성 대조 실패).");
else {
  const srv = srvReview.split(",").map((x) => x.replace(/"/g, "")).filter(Boolean);
  const ui2 = uiEditable.split(",").map((x) => x.replace(/"/g, "")).filter(Boolean);
  const gone = srv.filter((x) => !ui2.includes(x));
  if (gone.length) fails.push(`🔴 서버는 [${gone.join(", ")}] 도 승인해 주는데 화면은 안 보여 준다 — 그 상태의 손님은 **발행 단추를 잃는다**.`);
}

/* ── ④ 정본 ↔ 생성물(AC-105) ── */
/* 🔴 «STUCK_ST 라는 글자가 생성물에 있나»로 보면 **내용이 달라도 통과한다** —
   정본과 생성물의 목록을 다르게 만든 변이에 안 울어서 좁혔다. **값을 견준다.** */
const stList = (s) => (s.match(/STUCK_ST\s*=\s*\[([^\]]*)\]/) || [, ""])[1].replace(/\s/g, "");
const tplSt = stList(seg), genSt = stList(gen);
const genWay = /posts\.html\?status=awaiting_manual/.test(gen);
const genSay = /function stuckSay\(\)[\s\S]*?P\.failReason/.test(gen);
notes.push(`센 것: 정본↔생성물 — \`STUCK_ST\` 정본 [${tplSt}] ↔ 생성물 [${genSt}] · 생성물에 다음 수 ${genWay} · 생성물의 \`stuckSay()\` 가 까닭을 쓰나 ${genSay}`);
if (!genSt) fails.push("🔴 생성물에 `STUCK_ST` 가 없다 — `node scripts/build-pages.mjs` 를 안 돌렸다(AC-105).");
else if (tplSt !== genSt) fails.push(`🔴 \`_tpl.txt\` 와 \`piece.html\` 의 \`STUCK_ST\` 가 다르다(정본 [${tplSt}] ≠ 생성물 [${genSt}]) — build-pages 를 안 돌렸다(AC-105).`);
if (!genWay || !genSay) fails.push("🔴 생성물에 막힌 글 처치가 덜 들어갔다 — build-pages 를 다시 돌려라(AC-105).");

/* ── 보고 ── */
console.log("검수 화면 단추가 손에 닿나(첫 발행 고장 ① · 2026-09-20) · " + new Date().toISOString());
console.log("─".repeat(108));
console.log("■ 🔴 이 자가 **무엇을 셌나** — «그려졌나»가 아니라 «**그린 자리마다 손이 붙었나 · 상태마다 갈 길이 있나**»");
for (const n of notes) console.log("   · " + n);
console.log("");
if (fails.length) { console.log("■ 실패"); for (const f of fails) console.log("   " + f); }
else console.log("■ 통과 — 정적 단추 0개, 그린 단추마다 손이 붙었고, 막힌 글에 까닭과 다음 수가 있다.");
console.log("─".repeat(108));
console.log(`PASS ${fails.length ? 0 : notes.length} · FAIL ${fails.length}`);
process.exit(fails.length ? 1 : 0);
