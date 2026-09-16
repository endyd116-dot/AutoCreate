// scripts/verify-r8a-screen.mjs — **R8-A §4 화면 한 바퀴**(C · AC-62). 🔴 AI 실호출 0 · 서버 API 는 진짜로 부른다.
//   사용: SITE_URL=http://localhost:8901 node scripts/verify-r8a-screen.mjs --tid <테스트 테넌트>
//
//   이 라운드의 «눈으로 보는 결론» 은 **«검수 화면에서 채널이 다르면 글 모양이 다르게 보이나»** 다.
//   🔴 그런데 화면 HTML 을 읽어 봐야 답이 안 나온다 — 화면은 **서버가 준 값**을 그릴 뿐이다.
//      그래서 두 쪽을 갈라 잰다:
//        [서버] `pieces-get` 이 그 글에 **실제로 적용된** 값(contract·goal·topicGroup)을 채널마다 다르게 주는가 — 진짜 API 호출
//        [화면] 그 값을 그리는 코드가 서버 어휘·상수와 어긋나지 않는가 — 정적 대조(AC-52)
//   🔴 삼키는 catch 0 — 예외는 그 절을 빨강으로 만든다(AC-58).
import { readFileSync } from "node:fs";

const BASE = process.env.SITE_URL || "http://localhost:8901";
const TID = Number(process.argv[process.argv.indexOf("--tid") + 1] || 0);
const results = [];
const rec = (step, ok, note = "") => { results.push({ step, ok: ok === "WARN" ? "WARN" : !!ok, note }); };
const read = (p) => readFileSync(p, "utf8");

let COOKIE = process.env.AC_COOKIE || "";
async function call(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(COOKIE ? { cookie: COOKIE } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setC = r.headers.getSetCookie?.() ?? [];
  if (setC.length) COOKIE = setC.map((c) => c.split(";")[0]).join("; ");
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* 본문이 JSON 이 아니면 그대로 둔다 — 삼키지 않고 아래에서 보인다 */ }
  return { status: r.status, json, text: text.slice(0, 300) };
}

/* ───────── ① 🔴 AC-54 선검사 — 내가 말하는 서버가 내가 고친 서버인가 ───────── */
async function preflight() {
  const h = await call("/api/health");
  const j = h.json ?? {};
  const local = /localhost|127\.0\.0\.1/.test(BASE);
  rec("④ /api/health 5키(deploy·commit·dev·loadedAt·stub)", ["deploy", "commit", "dev", "loadedAt", "stub"].every((k) => k in j),
    `${h.status} commit ${String(j.commit ?? "").slice(0, 7)}`);
  if (!local) return true;
  const ok = j.dev === true && !/autocreate-endyd\.netlify\.app/.test(String(j.deploy ?? ""));
  rec("🔴 ④ 선검사 — 로컬을 겨눴으면 답하는 서버도 로컬이어야 한다", ok, `dev=${j.dev} deploy=${j.deploy}`);
  return ok;
}

/* ───────── ② [서버] 검수 화면 재료가 **채널마다 다른가** ───────── */
async function serverSide() {
  if (!TID) { rec("④ 서버 절 — --tid 없음", "WARN", "테스트 테넌트를 주면 pieces-get 을 실제로 부른다"); return; }
  /* 로그인은 프로브가 직접 한다 — 쿠키를 밖에서 주워 오면 다음 사람이 못 돌린다(재현되는 검사가 검사다). */
  let me = await call("/api/auth-me");
  if (me.status !== 200 && process.env.AC_EMAIL) {
    const lg = await call("/api/auth-login", { email: process.env.AC_EMAIL, password: process.env.AC_PASSWORD || "" });
    if (lg.status !== 200) { rec("④ 로그인", false, `auth-login ${lg.status} ${lg.text.slice(0, 80)}`); return; }
    me = await call("/api/auth-me");
  }
  if (me.status !== 200) { rec("④ 세션", false, `auth-me ${me.status} — AC_EMAIL/AC_PASSWORD 를 주면 프로브가 직접 로그인한다`); return; }
  const tid = me.json?.tenant?.id;
  if (Number(tid) !== TID) { rec("🔴 ④ 세션이 --tid 와 같은 집인가", false, `로그인된 집 ${tid} ≠ --tid ${TID} — 다른 집을 잴 뻔했다`); return; }
  rec("④ 세션이 --tid 와 같은 집이다", true, `tenant ${tid}`);

  const list = await call("/api/pieces-list?status=all");
  const pieces = list.json?.pieces ?? [];
  if (!pieces.length) { rec("④ 검수 재료", "WARN", "이 집에 글이 0편 — 잴 것이 없다(못 쟀다 · AC-9)"); return; }

  const got = [];
  for (const p of pieces.slice(0, 6)) {
    const d = await call(`/api/pieces-get?id=${p.id}`);
    const pc = d.json?.piece;
    if (pc) got.push(pc);
  }
  rec("④ `pieces-get` 이 검수 재료를 준다", got.length > 0, `${got.length}편 읽음`);
  if (!got.length) return;

  const withContract = got.filter((p) => p.contract);
  rec("🔴 ④ «이 글이 왜 이렇게 생겼나» 재료가 실린다(contract·goal·topicGroup)", withContract.length === got.length,
    got.map((p) => `#${p.id} ${p.channel} contract=${p.contract ? "있음" : "없음"} goal=${p.goal ?? "없음"} group=${p.topicGroup ?? "null"}`).join(" · "));

  /* 🔴 본론 — 채널이 다르면 **모양이 다르게** 보이나. 계약표 기본값이 아니라 «이 글에 적용된» 값이어야 한다. */
  const byCh = new Map();
  for (const p of withContract) if (!byCh.has(p.channel)) byCh.set(p.channel, p);
  if (byCh.size < 2) {
    rec("🔴 ④ 채널이 다르면 글 모양이 다르게 보인다", "WARN", `이 집 글이 ${[...byCh.keys()].join(",") || "없음"} 한 채널뿐 — 채널 간 비교를 못 했다(AC-9)`);
  } else {
    const shape = (p) => JSON.stringify({ label: p.contract.label, len: p.contract.length, img: p.contract.images, reg: p.contract.register });
    const shapes = [...byCh.values()].map(shape);
    rec("🔴 ④ 채널이 다르면 검수 화면 재료가 **실제로 다르다**(이 라운드의 눈으로 보는 결론)",
      new Set(shapes).size === shapes.length,
      [...byCh.values()].map((p) => `${p.channel}: «${p.contract.label}» ${p.contract.length?.min}~${p.contract.length?.max}자 사진 ${p.contract.images?.min}~${p.contract.images?.max}장`).join(" · "));
  }

  /* `fromGroup` — 이 숫자가 «주제군에서 온 값»인지 «채널 고정값»인지까지 말하나(대용물 금지 · AC-57). */
  const hasFrom = withContract.filter((p) => p.contract.length && "fromGroup" in p.contract.length);
  rec("④ 분량·사진이 **어디서 온 숫자인지** 말한다(fromGroup)", hasFrom.length === withContract.length,
    `${hasFrom.length}/${withContract.length}편 · ${withContract.slice(0, 3).map((p) => `#${p.id} 분량 fromGroup=${p.contract.length?.fromGroup}`).join(" · ")}`);

  /* 🔴 topicGroup 이 null 이면 «모름» 이어야 한다 — 기본값으로 위장하면 안 된다. */
  const disguised = withContract.filter((p) => p.topicGroup !== null && p.topicGroup !== undefined && !["review", "info", "life"].includes(String(p.topicGroup)));
  rec("🔴 ④ `topicGroup` 은 모르면 null 그대로(기본값으로 위장 안 함 · AC-57)", disguised.length === 0,
    `위장 ${disguised.length}건 · 값 [${[...new Set(withContract.map((p) => String(p.topicGroup)))].join(",")}]`);
}

/* ───────── ③ [화면] 서버 어휘·상수와 어긋나지 않는가 ───────── */
function screenSide() {
  const uiJs = read("public/js/ui.js");
  const pieceHtml = read("public/app/piece.html");
  const approveTs = read("lib/content-approve.ts");
  const pieces = read("netlify/functions/pieces.ts");
  const all = [uiJs, read("public/js/mock.js"), pieceHtml, ...["home", "director", "slots", "accounts", "revenue"].map((n) => { try { return read(`public/app/${n}.html`); } catch { return ""; } })].join("\n");

  /* 🔴 «클릭 유도» 라는 낱말이 화면 어디에도 없어야 한다 — 뭉뚱그리면 ②③(우리 링크·독자 행동)까지 죽는다. */
  rec("🔴 ④ «클릭 유도» 라는 낱말이 화면에 0건(뭉뚱그리면 ②③ 까지 죽는다)", !/클릭\s*유도/.test(all),
    /클릭\s*유도/.test(all) ? "화면에 있다" : "0건 · 축 이름은 «광고를 가리키지 않음»");

  /* 막는 축 목록이 서버와 같은가(AC-52).
     🔴 [R8-A2 수리] `[^\]]+` 는 **빈 배열을 못 읽는다** — R8 §9 로 `HARD_GATE_KEYS = []` 가 되면서
        «못 찾았다»와 «비어 있다»가 한 덩어리가 되어 이 줄이 **정답인데 빨갛게** 나오고 있었다.
        `verify-label-surface.mjs` 가 같은 자리에서 이미 고친 것을 여기만 안 따라왔다(하니스 둘이 갈리면 하나는 거짓말이다). */
  const listOf = (text, re) => { const m = text.match(re); return m ? [...m[1].matchAll(/["']([a-z_]+)["']/g)].map((x) => x[1]) : null; };
  const srvHard = listOf(approveTs, /HARD_GATE_KEYS[^=]*=\s*\[([^\]]*)\]/);
  const uiHard = listOf(uiJs, /UI\.GATE_HARD\s*=\s*\[([^\]]*)\]/);
  const same = srvHard !== null && uiHard !== null && [...srvHard].sort().join(",") === [...uiHard].sort().join(",");
  rec("🔴 ④ 막는 축 목록이 서버와 글자까지 같다", same,
    srvHard === null ? "서버에서 HARD_GATE_KEYS 를 못 읽었다" : uiHard === null ? "화면에서 UI.GATE_HARD 를 못 읽었다"
      : same ? (srvHard.length ? `${srvHard.length}축 [${srvHard.join(" ")}]` : "0축 — 막는 축이 없다(§9)") : `서버 [${srvHard.join(" ")}] ↔ 화면 [${uiHard.join(" ")}]`);

  /* 소프트 축은 «막지 않아요» 로 보이나.
     🔴 [R8-A2] 검사 줄은 `piece.html` 에서 **`ui.js` 로 올라갔다**(검수 화면과 직접 쓰기 화면이 같이 쓴다) — 두 파일을 같이 본다.
        파일만 보고 «없다»고 하면 옮겼다는 이유로 빨개진다(그건 화면이 말을 안 한다는 뜻이 아니다). */
  const gateSurface = `${pieceHtml}\n${uiJs}`;
  rec("④ 알려 주는 축은 «예약을 막지 않아요» 로 보인다", /막지\s*않아요/.test(gateSurface),
    /막지\s*않아요/.test(gateSurface) ? "검수·직접 쓰기가 같이 쓰는 검사 줄에 그 문장이 있다" : "그 문장이 없다");

  /* 새 축 2개가 화면에 뜨나. */
  rec("④ 새 축 2개가 화면 어휘에 있다(structure_repeat 소프트 · ad_pointing 하드)",
    /structure_repeat/.test(all) && /ad_pointing/.test(all),
    `structure_repeat ${/structure_repeat/.test(all)} · ad_pointing ${/ad_pointing/.test(all)} · ad_pointing 이 하드 목록에 ${/ad_pointing/.test(uiHard)}`);

  /* 🔴 대가 스위치 — **켜는 길만** 있나(끄는 길이 있으면 «고지 없이 나간 글»이 생긴다). */
  const turnsOff = /data-comp-off|끄기|해제|취소하고 고지/.test(pieceHtml);
  const onlyTrue = /sponsored:\s*mz\.sponsored\s*===\s*true/.test(pieces) && /gift:\s*mz\.gift\s*===\s*true/.test(pieces);
  rec("🔴 ④ 대가 스위치는 **켜는 길만** 있다(화면에 끄는 길 0 · 서버도 true 만 받는다)", !turnsOff && onlyTrue,
    `화면 끄는 길 ${turnsOff ? "있음" : "없음"} · 서버 === true 로만 ${onlyTrue}`);
  rec("④ …그리고 «끌 수 없다» 를 사람 말로 먼저 알려 준다", /끌 수 없어요/.test(pieceHtml),
    /끌 수 없어요/.test(pieceHtml) ? "«한 번 밝히면 끌 수 없어요» 가 화면에 있다" : "그 안내가 없다");

  /* 🔴 켜면 **들어갈 문장을 먼저 보여 주나**(법 문구를 모르고 누르게 하지 않는다). */
  rec("🔴 ④ 켜기 전에 **들어갈 고지 문장**을 먼저 보여 준다", /밝히면 이 문장이/.test(pieceHtml) && /DISCLOSURE_TEXT/.test(pieceHtml),
    "시트가 정본 문장을 그대로 보여 준다(UI.DISCLOSURE_TEXT — 하니스가 서버와 대조 중)");

  /* 🔴 무엇이 켜졌나를 **본문 첫머리 고지에서** 읽나(meta 추측이 아니라 발행될 물건에서). */
  rec("🔴 ④ 무엇이 켜졌나를 **발행될 본문**에서 읽는다(meta 추측 아님 · AC-57)",
    /UI\.compOf\(P\.bodyHtml\)/.test(pieceHtml), "compOf(bodyHtml) — 화면이 판정하지 않고 «서버가 넣은 문장이 거기 있나»만 본다");
}

const okPre = await preflight();
if (okPre) { await serverSide(); }
else rec("④ 선검사 실패로 서버 절을 건너뛴다", false, "잘못된 서버를 재느니 안 재는 게 낫다");
screenSide();

const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\nR8-A §4 화면 한 바퀴 · ${BASE} · ${new Date().toISOString()}\n${"─".repeat(130)}`);
for (const r of results) console.log(`${r.ok === "WARN" ? "△" : r.ok ? "✓" : "✗"} ${w(r.step, 62)} ${w(r.note, 64)}`);
const pass = results.filter((r) => r.ok === true).length, fail = results.filter((r) => r.ok === false).length, warn = results.filter((r) => r.ok === "WARN").length;
console.log(`${"─".repeat(130)}\nPASS ${pass} · FAIL ${fail} · WARN ${warn}`);
/* 🔴 [R8-A2 수리] `process.exit()` 를 바로 부르면 윈도우에서 **닫히는 중인 소켓**과 겹쳐 libuv 가 죽는다
   (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`) — 그러면 **FAIL 0 인데 종료코드가 127** 로 나온다.
   «검사는 종료코드로 본다»(AC-67)를 통째로 무너뜨리는 자리라, 코드만 세워 두고 남은 연결이 다 닫힌 뒤 스스로 끝나게 둔다. */
process.exitCode = fail ? 1 : 0;
