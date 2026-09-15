/**
 * scripts/verify-runner-format.mjs — 🔴 **«번짐» 변이 하니스**(R9-3 · 네이버 접속 0 · 브라우저 0).
 *   node scripts/verify-runner-format.mjs [--mutate=m1..m8|all]
 *
 * ══ 이 병은 **네 번째 판**이다 ══
 *   AM #799 색 · #800·#801 굵게 · 2026-08-20 밑줄 · 2026-09-15 빨강/가운데/기울임.
 *   그래서 축의 절반은 «고쳤나»가 아니라 **«옛 수리를 안 깨뜨렸나»**와 **«금지된 길로 고치지 않았나»**다.
 *
 * ══ 🔴 왜 변이가 있나 (AC-87) ══
 *   «빨강이 안 나오면 그 검사는 아무것도 못 잡는다.» 각 변이는 방어 한 겹을 빼고, 그때 **어느 축이 빨개져야 하는지**를
 *   같이 적는다. 변이를 걸었는데 전부 초록이면 **하니스가 고장난 것**이고, 그걸 모르면 이 파일은 장식이다.
 *   ⇒ `--mutate=all` 로 차례로 돌려 «전부 빨개지나»를 한 번에 본다.
 *
 * ══ 🔴 이 하니스가 **못 재는 것** — 그리고 그게 실제로 터졌다(2026-09-16) ══
 *   **contenteditable 에서 «실제로 번지는가»는 못 잰다.** 여기서 재는 것은 ①끊는 줄이 제자리에 있나(구조)
 *   ②상태기계가 실패를 «깨끗»으로 치지 않나(행동) ③판정 함수가 무엇을 세고 무엇을 안 세나(행동)다.
 *
 *   🔴 **이 한계가 «이론»이 아니라는 것을 같은 날 증명당했다.** 이 파일이 **55/0 초록 · 변이 6/6 빨강**일 때
 *      C 가 진짜 Chromium 으로 재 보니 **끊기가 통째로 무력했다** — 밑줄 마크 뒤 평문 3문단이 통문단 밑줄이었고,
 *      끊기를 아예 빼 봐도 **결과가 같았다**(= 아무 일도 안 하고 있었다).
 *      진범은 `fresh` 가 «마지막이 글이 아닐 때만» 새 칸을 만드는 함수였던 것이고,
 *      내 축들은 «`boundary()` 를 부르나»만 봤지 **«부르는 게 맞는 것이냐»**는 안 봤다.
 *      ⇒ 그때 더한 것이 **F-01e·F-01f·F-01g · m7**이다. 그리고 **굵게를 안 세던 것**(F-06d · m8)도 그때 드러났다.
 *   🔴 교훈 둘: ①**변이가 다 빨개져도 «내가 생각한 고장»만 찌른 것일 수 있다** — 남이 **다른 자로** 재 줘야 안다.
 *              ②사슬 검사는 싸고 넓게, **렌더 검사는 좁고 진짜로** — 둘 다 둔다(AC-87). 진짜 브라우저 쪽은 C 몫이다.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { makeDocument, getComputedStyle, para, textComponent, quotation, documentTitle, STYLE } from "./_lib/tiny-dom.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const P_BLEED = join(ROOT, "runner", "lib", "format-bleed.mjs");
const P_NAVER = join(ROOT, "runner", "channels", "naver-blog.mjs");
const P_PLAN = join(ROOT, "runner", "lib", "plan.mjs");
const TMP = join(ROOT, "runner", "tmp", "_fmt-mutate");

let SRC_BLEED = readFileSync(P_BLEED, "utf8");
let SRC_NAVER = readFileSync(P_NAVER, "utf8");
const SRC_PLAN = readFileSync(P_PLAN, "utf8");

/* ═══ 변이 — m1~m6 은 AM `verify-runner-format.mjs` 에 **1:1 대응**(자리는 우리 구조) · m7~m8 은 C 실측 뒤 추가 ═══ */
const MUTATIONS = {
  /* 🔴 m1 은 **조각 경로의 끊기**를 뺀다 — 바로 앞 문단에서 색을 칠한 다음에 이어 치는 자리라 번짐이 제일 크게 난다.
     ⚠️ 첫판에 나는 여기를 `if (false) await typeParts(op)` 로 끊었는데 **변이가 초록으로 지나갔다** —
        축들이 «boundary 가 있나»를 보고 있었고 그건 그대로였기 때문이다. 변이를 안 돌려 봤으면 그 축을 믿을 뻔했다(AC-87). */
  m1: { file: "naver", from: "    await boundary();\n    for (const p of parts) {", to: "    /* removed */\n    for (const p of parts) {",
    expect: "F-01 (칠한 뒤 다음 조각·다음 문단을 안 끊는 판 = 사장님이 보신 그 판)" },
  m2: { file: "naver", from: '  markFormatDirty(fmt, `${kind} 적용`);', to: "  /* removed */",
    expect: "F-02a (칠한 뒤 «더럽다»를 안 적는 병 — 빨강 번짐의 출발점)" },
  m3: { file: "naver", from: '          markFormatDirty(fmt, "인용구(색·정렬·기울임)");', to: "          /* removed */",
    expect: "F-02b (인용 뒤 «더럽다»를 안 적는 병 — 가운데·기울임 번짐)" },
  m4: { file: "bleed", from: "  if (ok) { state.dirty = false; state.breaks++; }", to: "  state.dirty = false; if (ok) state.breaks++;",
    expect: "F-03b (새 칸 만들기 실패를 «깨끗»으로 치는 조용한 실패 — 이 병이 네 번 돌아온 경로)" },
  m5: { file: "bleed", from: "  const stop = bleed.pct >= FORMAT_BLEED_MAX_PCT;", to: "  const stop = false;",
    expect: "F-08 (자기검사가 세기만 하고 안 막는 병)" },
  m6: { file: "bleed", from: '    .filter((p) => !p.closest(".se-quotation")', to: '    .filter((p) => (true || !p.closest(".se-quotation"))',
    expect: "F-06 (인용을 세어 정상 글도 발행이 막히는 거짓 양성)" },
  /* 🔴 m7·m8 은 **C 가 진짜 Chromium 으로 잡아 준 뒤에 생긴 축**이다(2026-09-16).
     내 첫 판은 m1~m6 이 전부 빨개지는 걸 보고 «전부 통과»를 믿었는데, **그때 제품은 통째로 고장나 있었다** —
     변이 여섯이 다 «내가 생각한 고장»만 찔렀기 때문이다. 남이 다른 자로 재 주지 않았으면 못 찾았다. */
  m7: { file: "naver", from: "  const fresh = () => freshTextBlock(page, ctx);", to: "  const fresh = () => moveCaretToEnd(page, ctx, missed);",
    expect: "F-01e (끊기가 «마지막이 글이면 아무것도 안 하는» 함수를 쓴다 = C 가 찾은 그 고장 그대로)" },
  m8: { file: "bleed", from: "    const bold = !looksHeading && (all(wgt) || (spans.length === 0 && wgt(p)));", to: "    const bold = false;",
    expect: "F-06d (굵게를 안 세어 AM #800·#801 판을 통째로 놓친다)" },
};

const argMut = (process.argv.find((a) => a.startsWith("--mutate=")) || "").split("=")[1] || "";

/* `--mutate=all` — 여섯을 차례로 **자식 프로세스로** 돌려 «여섯 다 빨개지나»를 한 번에 본다.
   🔴 한 프로세스에서 돌리면 앞 변이가 모듈 캐시에 남아 다음 판정을 오염시킨다. */
if (argMut === "all") {
  const rows = [];
  for (const k of Object.keys(MUTATIONS)) {
    let code = 0, out = "";
    try { out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--mutate=${k}`], { encoding: "utf8" }); }
    catch (e) { code = e.status ?? 1; out = String(e.stdout ?? ""); }
    const failLines = out.split("\n").filter((l) => l.includes("  ✘ "));
    rows.push({ k, red: code !== 0, n: failLines.length, axes: failLines.map((l) => l.trim().split(" ")[1]).join(","), expect: MUTATIONS[k].expect });
  }
  console.log("\n══ 변이 대조(«이 방어를 빼면 빨개지나») ══");
  for (const r of rows) console.log(`  ${r.red ? "🔴 빨강" : "⚪ 초록"}  ${r.k}  실패축 ${r.n}개 [${r.axes}]  ← ${r.expect}`);
  const silent = rows.filter((r) => !r.red);
  if (silent.length) {
    console.log(`\n🔴 변이 ${silent.map((r) => r.k).join("·")} 이(가) **빨개지지 않았다** — 그 축은 아무것도 못 잡는다(AC-87).`);
    process.exit(1);
  }
  console.log("\n✅ 변이 전부 빨개졌다 — 이제 «전부 통과»를 믿어도 된다(단, 이 자가 보는 범위 안에서만 · 위 머리말 참조).");
  process.exit(0);
}

if (argMut) {
  const m = MUTATIONS[argMut];
  if (!m) { console.error("모르는 변이: " + argMut); process.exit(2); }
  const src = m.file === "bleed" ? SRC_BLEED : SRC_NAVER;
  if (src.indexOf(m.from) < 0) { console.error(`🔴 변이 ${argMut}: 심을 자리를 못 찾았다 — ${m.from.slice(0, 70)}`); process.exit(3); }
  if (src.split(m.from).length > 2) { console.error(`🔴 변이 ${argMut}: 심을 자리가 여러 곳이다 — 축이 모호해진다`); process.exit(3); }
  if (m.file === "bleed") SRC_BLEED = SRC_BLEED.split(m.from).join(m.to);
  else SRC_NAVER = SRC_NAVER.split(m.from).join(m.to);
  console.log(`\n⚠️ 변이 ${argMut} 적용 — 빨개져야 할 축: ${m.expect}`);
}

/**
 * 🔴 **주석을 코드로 세지 마라.** 「금지된 길을 안 쓴다」를 글자로 재는 축은 **그 금지를 설명하는 주석**에 걸린다 —
 *   첫판에 셋이 그렇게 빨개졌다(`getSelection` 은 「쓰지 마라」는 주석에 있었고, 제어문자는 「AM 은 이걸 쓴다」는 주석에 있었다).
 *   가짜 빨강은 가짜 초록만큼 나쁘다: **멀쩡한 것을 고치게 만든다**(AC-67 «거짓 false»의 친척).
 *   ⚠️ 문자열 안의 `//` 까지 가리지는 않는다 — «없어야 하는 것»을 재는 데만 쓴다(과하게 지워도 판정이 느슨해질 뿐 거짓 빨강은 안 난다).
 */
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let pass = 0, fail = 0;
const ok = (c, name, x) => {
  if (c) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + (x !== undefined ? " — " + String(x).slice(0, 300) : "")); }
};

/* 변이가 반영된 `format-bleed.mjs` 를 **실제로 import** 한다 — 글자 검사로는 `(true || …)` 같은 무력화를 못 본다. */
mkdirSync(TMP, { recursive: true });
const modPath = join(TMP, `fb-${argMut || "orig"}-${process.pid}.mjs`);
writeFileSync(modPath, SRC_BLEED);
const FB = await import(pathToFileURL(modPath).href);

/* ═══ ⓪ 🔴 자를 먼저 잰다 — 셈 DOM 이 «빨강을 빨강이라» 말하는가 ═══
   자를 안 재고 쓰면 아래 판정이 전부 무의미하다(AC-58: 검사의 삼킴은 판정 전체를 뒤집는다). */
console.log("\n[⓪ 셈 DOM 대조군 — 자가 제대로 재는가]");
{
  const doc = makeDocument([textComponent([
    para("빨강으로 통째로 물든 문단입니다", { spans: [STYLE.red] }),
    para("가운데로 정렬된 문단입니다", { p: STYLE.center }),
    para("기울임이 걸린 문단입니다", { spans: [STYLE.italic] }),
    para("밑줄이 걸린 문단입니다", { spans: [STYLE.underline] }),
    para("아무 서식도 없는 멀쩡한 문단입니다", { spans: [STYLE.plain] }),
  ])]);
  const r = FB.measureFormatBleedIn({ document: doc, getComputedStyle });
  ok(r.total === 5, "D-01 문단 5개를 다 찾았다(셀렉터가 맞다)", `총 ${r?.total}`);
  ok(r.red === 1 && r.center === 1 && r.italic === 1 && r.underline === 1,
    "D-02 🔴 네 가지를 **각각** 구분해 센다(한 축이 죽어 있으면 여기서 드러난다)",
    `빨강 ${r.red}·가운데 ${r.center}·기울임 ${r.italic}·밑줄 ${r.underline}`);
  ok(r.bad === 4 && r.pct === 80, "D-03 멀쩡한 문단은 안 센다(4/5 = 80%)", `${r.bad}/${r.total} = ${r.pct}%`);
  const clean = FB.measureFormatBleedIn({
    document: makeDocument([textComponent([para("멀쩡한 문단 하나입니다"), para("멀쩡한 문단 둘입니다")])]),
    getComputedStyle,
  });
  ok(clean.bad === 0 && clean.pct === 0, "D-04 대조군 짝 — 멀쩡한 글은 0%(항상 빨간 자가 아니다)", `${clean.bad}/${clean.total}`);
}

/* ═══ ① 문단 경계에서 서식 끊기 ═══ */
console.log("\n[① 문단 경계에서 서식 끊기]");
{
  const play = SRC_NAVER.slice(SRC_NAVER.indexOf("export async function playOps"), SRC_NAVER.indexOf("/** 발행 레이어의 태그란"));
  ok(/const boundary = \(\) => breakFormatBeforePara\(fmt, fresh\);/.test(play),
    "F-01 🔴 끊기가 **한 곳의 규칙**으로 올라왔다(AM 이 URL 전용 방어였던 것을 올린 그 자리)");
  const calls = (play.match(/await boundary\(\)/g) || []).length;
  ok(calls >= 4, "F-01b 문단이 서는 자리마다 부른다(평문·조각·소제목·인용 = 4곳 이상)", `${calls}곳`);
  ok(play.indexOf("await boundary();") < play.indexOf("await page.keyboard.insertText(p.t)"),
    "F-01c 끊기는 문단을 쓰기 **전**이다(뒤에 부르면 이미 물든 다음이다)");
  ok(/await boundary\(\);\s+for \(const p of parts\)/.test(play.replace(/\n/g, "\n")),
    "F-01d 조각 경로(typeParts)가 끊기를 지나서 시작한다");

  /* ═══ 🔴 F-01e — **이 축이 없어서 끊기가 통째로 무력했다**(2026-09-16 C 가 진짜 Chromium 으로 잡았다) ═══
   *
   *   내 첫 판은 «`boundary()` 를 부르나»만 봤고 **부르는 것이 무엇을 하는지**는 안 봤다. 그래서 55/0 초록인 채로
   *   밑줄 마크 뒤 평문 3문단이 **통문단 밑줄**로 나가고 있었다.
   *   진범: `fresh` 를 `moveCaretToEnd` 로 뒀는데 그 함수는 «마지막이 글이 **아닐 때만**» 새 칸을 만든다.
   *   서식을 칠한 직후엔 **마지막이 언제나 글**이라 그 분기에 영영 못 들어간다 — 남은 경로(문단 클릭+End)는
   *   인라인 span 안에 캐럿을 둬 **서식을 그대로 잇는다.** AM 은 **조건 없이** 누른다. 그 한 줄 차이였다.
   *   🔴 교훈: «부르나»(F-01)와 «**부르는 게 맞는 것이냐**»(F-01e)는 다른 축이다. 앞만 재면 이름만 맞고 뜻이 틀린다. */
  ok(/const fresh = \(\) => freshTextBlock\(page, ctx\);/.test(play),
    "F-01e 🔴 끊기가 **무조건 새 칸을 만드는** 함수를 쓴다(`moveCaretToEnd` 는 «마지막이 글이 아닐 때만» 만든다 — 칠한 직후엔 절대 안 걸린다)",
    (play.match(/const fresh = [^\n]+/) ?? ["(못 찾음)"])[0]);
  const fb = SRC_NAVER.slice(SRC_NAVER.indexOf("async function freshTextBlock("), SRC_NAVER.indexOf("async function moveCaretToEnd"));
  ok(!/lastIsText/.test(fb),
    "F-01f 🔴 그 함수에 **«이미 글이면 건너뛴다» 조건이 없다**(조건을 다시 넣는 순간 이 병이 그대로 돌아온다)");
  ok(/const before = await compCount\(ctx\);/.test(fb) && /<= before\) return false;/.test(fb),
    "F-01g 🔴 «눌렀다»가 아니라 **«생겼다»로 판정한다** — 종전 `breaks` 는 클릭 성공을 세서 `breaks:4·breakFails:0` 인데 **새 칸은 0개**였다(숫자가 거짓말했다)");

  const applyFn = SRC_NAVER.slice(SRC_NAVER.indexOf("async function applyMark("), SRC_NAVER.indexOf("async function attachImage"));
  ok(/markFormatDirty\(fmt, `\$\{kind\} 적용`\);/.test(applyFn),
    "F-02a 🔴 **칠한 직후**에 표시한다(AM 옛 주석 「칠한 뒤엔 물들 데가 없다」는 틀렸다 — 루프가 다음 조각을 계속 친다)");
  ok(/markFormatDirty\(fmt, "인용구\(색·정렬·기울임\)"\);/.test(SRC_NAVER),
    "F-02b 인용 뒤에 표시한다(인용은 그 자체가 색·가운데·기울임이다)");
  ok(SRC_NAVER.indexOf('markFormatDirty(fmt, `${kind} 적용`);') > SRC_NAVER.indexOf('await page.keyboard.press("ArrowRight")'),
    "F-02c 표시는 **선택 해제 뒤**다(해제도 캐럿을 건드린다 — 못 켰어도 깨끗하다는 보장이 없다)");
}

/* ═══ ② 🔴 상태기계 — 실패를 «깨끗»으로 치지 않나(행동으로 잰다) ═══ */
console.log("\n[② 상태기계 — 행동으로]");
{
  const st = FB.createFormatState();
  ok(st.dirty === false && st.breaks === 0, "F-03 새 상태는 깨끗하다");
  let called = 0;
  const okFresh = async () => { called++; return true; };
  const badFresh = async () => { called++; return false; };

  await FB.breakFormatBeforePara(st, okFresh);
  ok(called === 0, "F-03a 🔴 깨끗하면 **아무 일도 안 한다**(왕복 0 · 무회귀 — 안 그러면 글마다 빈 칸이 쌓인다)", `호출 ${called}`);

  FB.markFormatDirty(st, "색");
  await FB.breakFormatBeforePara(st, badFresh);
  ok(st.dirty === true,
    "F-03b 🔴 새 칸 만들기가 **실패하면 플래그를 유지**한다(«시도했으니 깨끗»이 이 병이 네 번 돌아온 경로)",
    `dirty=${st.dirty} breakFails=${st.breakFails}`);
  ok(st.breakFails === 1 && st.breaks === 0, "F-03c 실패를 **센다**(조용히 넘어가지 않는다)", `breaks=${st.breaks} fails=${st.breakFails}`);

  await FB.breakFormatBeforePara(st, okFresh);
  ok(st.dirty === false && st.breaks === 1, "F-03d 다음 문단에서 **다시 시도해** 성공하면 깨끗해진다", `dirty=${st.dirty} breaks=${st.breaks}`);

  const a = FB.createFormatState(); const b = FB.createFormatState();
  FB.markFormatDirty(a, "색");
  ok(b.dirty === false,
    "F-03e 🔴 상태가 **잡마다 따로**다(AM 은 모듈 전역이라 앞 글의 «더럽다»가 다음 글로 샌다 — 그러면 검사가 거짓말한다)");
}

/* ═══ ③ 🔴 금지된 길 — 캐럿을 눈감고 토글하지 않았나 ═══ */
console.log("\n[③ 금지된 길 — 캐럿을 눈감고 토글하지 않았나]");
{
  ok(!/Control\+u/i.test(SRC_NAVER),
    "F-04 Ctrl+U(밑줄 토글) 0 — 켜졌는지 못 읽으니 «끄기»가 «켜기»가 될 수 있다(AM 자신의 금지)");
  ok(!/keyboard\.press\("Control\+[biu]"\)/.test(codeOnly(SRC_BLEED)) && !/getSelection/.test(codeOnly(SRC_BLEED)),
    "F-04b 🔴 끊기 파일이 키보드 토글도 getSelection 도 **안 쓴다** — 새 칸으로만 끊는다");
  const applyFn = SRC_NAVER.slice(SRC_NAVER.indexOf("async function applyMark("), SRC_NAVER.indexOf("async function attachImage"));
  ok(/Shift\+ArrowLeft/.test(applyFn) && /press\("ArrowRight"\)/.test(applyFn),
    "F-04c 서식은 **선택 범위에** 먹인다(치고 되짚어 잡기 — 캐럿 토글이 아니다)");
  ok(/tailMatches\(ctx, expect\)/.test(applyFn) && /return "caret_drift"/.test(applyFn),
    "F-04d 🔴 칠하기 **전에** 무엇을 잡았는지 확인하고, 어긋나면 **안 칠하고 물러난다**(AM #736 — 잘못 칠하면 문단이 갈린다)");
  ok(/aria-label/.test(SRC_NAVER) && /getComputedStyle\(e\)\.backgroundColor/.test(SRC_NAVER),
    "F-04e 팔레트는 **실제 칠해진 색**으로 고른다(AM 은 aria-label 에 헥사가 있다고 믿다 하루를 버렸다)");
}

/* ═══ ④ 발행 전 자기검사 ═══ */
console.log("\n[④ 발행 전 자기검사]");
{
  ok(/const FORMAT_BLEED_MAX_PCT = Number\(process\.env\.RUNNER_FORMAT_BLEED_MAX_PCT \|\| 30\);/.test(SRC_BLEED),
    "F-07 임계값은 **상수 한 곳**(환경변수로만 흔든다)");
  /* ⚠️ 그냥 세면 **환경변수 이름이 상수명을 부분문자열로 품어** 하나 더 세어진다(이름이 이름을 삼킨다).
     앞에 식별자 글자가 없을 때만 센다. */
  const uses = (codeOnly(SRC_BLEED).match(/(^|[^A-Z_])FORMAT_BLEED_MAX_PCT/gm) || []).length;
  ok(uses === 3, "F-07b 그 상수를 쓰는 자리는 정의 1 + 판정 1 + 메시지 1(숫자를 코드에 흩지 않았다)", `${uses}곳`);

  /* 🔴 F-06 은 **행동으로** 잰다 — 글자 검사로는 `(true || !p.closest(...))` 같은 무력화를 못 본다(AM 이 m6 에서 새어 나갔다). */
  const doc = makeDocument([
    documentTitle([para("제목입니다 여기는 안 셉니다", { p: STYLE.center, spans: [STYLE.red] })]),
    textComponent([para("첫 문단입니다 정상입니다"), para("둘째 문단입니다 정상입니다"), para("셋째 문단입니다 정상입니다")]),
    quotation([para("뽑아 세운 한 문장입니다", { p: { ...STYLE.center, ...STYLE.italic }, spans: [STYLE.red] })]),
  ]);
  const q = FB.measureFormatBleedIn({ document: doc, getComputedStyle });
  ok(q.total === 3 && q.bad === 0,
    "F-06 🔴 인용·제목은 **안 센다**(인용은 원래 가운데·기울임이라 세면 정상 글도 막힌다 = 이 검사를 무용지물로 만드는 가장 쉬운 길)",
    `총 ${q.total} · 걸림 ${q.bad}`);

  const partial = FB.measureFormatBleedIn({
    document: makeDocument([textComponent([para("이 문단은 일부만 빨갛습니다 나머지는 검정입니다", { spans: [STYLE.red, STYLE.black] })])]),
    getComputedStyle,
  });
  ok(partial.bad === 0,
    "F-06b 🔴 문단이 **통째로** 물들었을 때만 1표(부분 강조는 정상 — 우리 글의 의도다)", `걸림 ${partial.bad}`);

  const gray = FB.measureFormatBleedIn({
    document: makeDocument([textComponent([para("회색 글씨 문단입니다", { spans: [{ color: "rgb(120, 120, 120)" }] })])]),
    getComputedStyle,
  });
  ok(gray.red === 0, "F-06c 색은 «빨강 계열»만(검정·회색은 정상)", `빨강 ${gray.red}`);

  /* ═══ 🔴 F-06d — **굵게도 센다**(2026-09-16 C 지적으로 더했다) ═══
     AM #800·#801 이 바로 **굵게 번짐**이었는데 내 첫 판은 빨강·가운데·기울임·밑줄만 세어,
     value/bold 마크만 있는 글이 **통째로 굵게 나가도 0%** 였다 — 가장 흔한 판을 못 보는 자였다. */
  const boldBled = FB.measureFormatBleedIn({
    document: makeDocument([textComponent([
      para("여기부터 통째로 굵습니다", { spans: [{ fontWeight: "700", fontSize: "15px" }] }),
      para("여기는 멀쩡합니다", { spans: [{ fontWeight: "400", fontSize: "15px" }] }),
    ])]),
    getComputedStyle, headingSize: 19, bodySize: 15,
  });
  ok(boldBled.bold === 1 && boldBled.bad === 1,
    "F-06d 🔴 **통문단 굵게를 센다**(AM #800·#801 이 그 판이었다 — 안 세면 가장 흔한 번짐을 통째로 놓친다)",
    `굵게 ${boldBled.bold} · 걸림 ${boldBled.bad}/${boldBled.total}`);

  /* 🔴 대조군 짝 — **소제목은 원래 굵다.** 크기로 안 가르면 소제목 많은 글이 전부 «번졌다»가 되어 검사가 무용지물이 된다(AC-68). */
  const headings = FB.measureFormatBleedIn({
    document: makeDocument([textComponent([
      para("결론부터", { spans: [{ fontWeight: "700", fontSize: "19px" }] }),
      para("왜 줄었나", { spans: [{ fontWeight: "700", fontSize: "19px" }] }),
      para("본문입니다 멀쩡합니다", { spans: [{ fontWeight: "400", fontSize: "15px" }] }),
    ])]),
    getComputedStyle, headingSize: 19, bodySize: 15,
  });
  ok(headings.bold === 0 && headings.bad === 0,
    "F-06e 🔴 대조군 짝 — **소제목(굵게 + 소제목 크기)은 안 센다**(굵다고 다 번짐이면 정상 글이 전부 막힌다)",
    `굵게 ${headings.bold} · 걸림 ${headings.bad}/${headings.total}`);

  /* 판정 — 🔴 «세기»와 «멈추기»는 다른 층이다. */
  const bled = FB.measureFormatBleedIn({
    document: makeDocument([textComponent([
      para("여기부터 통째로 빨갛습니다", { spans: [STYLE.red] }),
      para("여기도 가운데로 쏠렸습니다", { p: STYLE.center }),
      para("여기는 멀쩡합니다"),
    ])]),
    getComputedStyle,
  });
  const vBad = FB.bleedVerdict(bled);
  ok(vBad.measured === true && vBad.stop === true, "F-08 🔴 임계를 넘으면 **멈춘다**(조용히 나가느니 멈추는 게 낫다)", `pct=${bled.pct} stop=${vBad.stop}`);
  ok(/예시 문단/.test(vBad.reason) && /«/.test(vBad.reason),
    "F-08b 멈춘 이유에 «n/m 문단» + 실제 문단 예시(다음 수리가 추측에서 시작하지 않게)");
  const vOk = FB.bleedVerdict(FB.measureFormatBleedIn({
    document: makeDocument([textComponent([para("정상 문단 하나"), para("정상 문단 둘"), para("정상 문단 셋")])]),
    getComputedStyle,
  }));
  ok(vOk.stop === false, "F-08c 대조군 짝 — 정상 글은 안 멈춘다(전부 거절은 막는 게 아니라 고장이다 · AC-68)");
  const vNull = FB.bleedVerdict(null);
  ok(vNull.measured === false && vNull.stop === false && /못 쟀/.test(vNull.line),
    "F-08d 🔴 **못 쟀으면 «못 쟀다»**(«깨끗»으로 바꾸지 않고 · 못 잰 것으로 막지도 않는다 — AC-92 · CLAUDE §9)");
}

/* ═══ ⑤ 발행 경로에 실제로 박혀 있나 ═══ */
console.log("\n[⑤ 발행 경로 — 「정의가 있나」가 아니라 「부르나」]");
{
  const run = SRC_NAVER.slice(SRC_NAVER.indexOf("export async function run({"));
  ok(/const bleed = await measureFormatBleed\(ed, \{ headingSize:/.test(run),
    "F-09 발행 버튼을 누르기 **전에** 잰다 — 🔴 그리고 **소제목 크기를 같이 넘긴다**(안 넘기면 굵게 판정이 소제목을 번짐으로 센다)");
  ok(run.indexOf("measureFormatBleed(ed)") < run.indexOf("publishNow(page, ed"), "F-09b 잰 뒤에 발행한다(순서)");
  ok(run.indexOf("measureFormatBleed(ed)") < run.indexOf("if (dryRun)"),
    "F-09c 🔴 **임시저장(카나리)도 잰다** — 카나리가 «멀쩡하다»고 한 뒤 본 발행에서 터지면 카나리가 무슨 소용인가");
  ok(/throw BLOCK\("format_bleed"/.test(run), "F-09d 멈출 때 **전용 사유**로 멈춘다(계정 잘못으로 분류되지 않게)");
  ok(/shot\(page, shotKey, "05-서식번짐-발행중단"/.test(run), "F-09e 멈춘 그 화면을 찍어 둔다");
  /* 🔴 AC-69 — «정의가 있나»가 아니라 «부르나». 서버까지 사슬이 이어졌는지 본다. */
  const jobs = readFileSync(join(ROOT, "lib", "runner-jobs.ts"), "utf8");
  ok(/errorKind\) === "format_bleed"/.test(jobs),
    "F-10 🔴 서버가 `format_bleed` 를 **안다**(모르면 «원인 미분류»로 떨어져 고객에게 엉뚱한 안내가 간다)");
  ok(/ourBug: true/.test(jobs.slice(jobs.indexOf('=== "format_bleed"'), jobs.indexOf('=== "format_bleed"') + 2200)),
    "F-10b 🔴 «우리 버그»로 적는다 — 계정 전이 0(고객에게 «다시 로그인하세요»는 거짓 안내다)");
  ok(/await applyFormatMarksToPiece\(tid, pieceId \?\? 0, okBody\.formatMarks\);/.test(jobs),
    "F-10c 🔴 서식 사실이 **piece 까지 간다**(만들어 놓고 아무도 안 부르면 그게 AC-69)");
  const core = readFileSync(join(ROOT, "runner", "core.mjs"), "utf8");
  ok((core.match(/formatMarks: out\.formatMarks/g) || []).length >= 2,
    "F-10d 러너 코어가 **발행·임시저장 둘 다** 실어 보낸다(한쪽만이면 카나리가 서식을 영영 못 본다)");
}

/* ═══ ⑥ 계획층 — 마크·상한·강등 ═══ */
console.log("\n[⑥ 계획층 — 뜻을 받고 상한을 먹인다]");
{
  const PLAN = await import(pathToFileURL(P_PLAN).href);
  ok(!/\\u0011|\\u0013|\\u0015/.test(codeOnly(SRC_PLAN)),
    "F-11 🔴 제어문자 마크를 **안 쓴다**(AM 은 본문에 \\u0011 을 섞는다 — AC-77 ③: 보이지 않는 글자가 git binary 판정까지 갔다)");

  const r = PLAN.planEditorOps({ blocks: [
    { type: "para", text: "전기요금이 3만 원 줄었습니다", marks: [{ s: 0, e: 4, kind: "line" }] },
    { type: "para", text: "주소는 https://example.com 입니다", marks: [{ s: 0, e: 2, kind: "value" }] },
    { type: "para", text: "범위가 엉뚱한 마크", marks: [{ s: 5, e: 99, kind: "value" }] },
    { type: "para", text: "여기 **굵게** 가 있습니다" },
    { type: "list", items: ["**첫째** 항목"] },
  ] });
  const why = (w) => r.stats.demoted.filter((d) => d.why === w).length;
  ok(why("url_para") === 1,
    "F-12 🔴 주소 문단은 강조를 **걷는다**(스마트에디터는 «서식 없는» 평문 URL 만 링크로 바꿔 준다 — AM #799~801 은 3건이 전부 클릭 불가로 나갔다)");
  ok(why("range_invalid") === 1, "F-12b 범위가 어긋난 마크는 **그 마크만** 버리고 적는다(조용히 안 버린다 · AC-9)");
  ok(why("block_unsupported") === 1, "F-12c 목록은 조각을 실을 칸이 없다 — 잃는 굵게를 **센다**");
  ok(r.ops.every((o) => !String(o.text ?? "").includes("**")),
    "F-13 🔴 `**굵게**` 가 **평문으로 새지 않는다**(종전엔 별표가 에디터에 그대로 타자됐다 — 굵게는 한 번도 시도된 적이 없었다)");
  const boldPart = r.ops.flatMap((o) => o.parts ?? []).find((p) => p.mark === "bold");
  ok(!!boldPart, "F-13b 그 `**굵게**` 가 **마크로 살아난다**(버리는 게 아니라 옮긴다)");

  /* 상한 — 넘치는 것은 평문으로 내려앉고 «왜»가 남는다. */
  const many = PLAN.planEditorOps({ blocks: Array.from({ length: 20 }, (_, i) => ({
    type: "para", text: `문단 ${i} 입니다 여기에 값이 있습니다`, marks: [{ s: 0, e: 4, kind: "value" }],
  })) });
  ok(many.stats.marks.kept.value === PLAN.MARK_BUDGET.valueMaxPerPost,
    "F-14 글당 상한을 먹인다(넘치면 강조가 아니라 도배다)", `남은 ${many.stats.marks.kept.value} / 상한 ${PLAN.MARK_BUDGET.valueMaxPerPost}`);
  ok(many.stats.marks.planned.value === 20 && many.stats.demoted.filter((d) => d.why === "budget").length === 8,
    "F-14b 🔴 planned 와 kept 를 **갈라서** 센다(한 숫자로 뭉치면 «상한 때문»인지 «못 냈는지» 못 가린다)",
    `planned ${many.stats.marks.planned.value} · 강등 ${many.stats.demoted.filter((d) => d.why === "budget").length}`);

  /* 🔴 대조군 짝 — 상한 **안**의 글은 하나도 안 깎인다(AC-68: 전부 거절은 막는 게 아니라 고장이다). */
  const few = PLAN.planEditorOps({ blocks: [
    { type: "para", text: "값이 하나 있는 문단입니다", marks: [{ s: 0, e: 2, kind: "value" }] },
    { type: "para", text: "밑줄이 하나 있는 문단입니다", marks: [{ s: 0, e: 3, kind: "underline" }] },
  ] });
  ok(few.stats.demoted.length === 0 && few.stats.marks.kept.value === 1 && few.stats.marks.kept.underline === 1,
    "F-14c 대조군 짝 — 상한 안의 글은 **하나도 안 깎인다**(통과해야 하는 케이스를 같이 잰다 · AC-68)",
    `강등 ${few.stats.demoted.length}`);

  /* ═══ 채널 표(R9-4) — 🔴 `null`(모른다)과 `false`(못 한다)는 **다른 사실**이다 ═══ */
  const mk = (caps) => PLAN.planEditorOps({
    formatCaps: caps,
    blocks: [{ type: "para", text: "밑줄이 있는 문단입니다", marks: [{ s: 0, e: 2, kind: "underline" }] }],
  });
  ok(mk({ underline: false }).stats.marks.kept.underline === 0
    && mk({ underline: false }).stats.demoted.some((d) => d.why === "channel_unsupported"),
    "F-15 채널 표가 **false** 면 안 낸다(그리고 «못 냈다»고 적는다)");
  ok(mk({ underline: null }).stats.marks.kept.underline === 1,
    "F-15b 🔴 표가 **null(모른다)이면 해 본다** — «아직 모른다»로 막지 않는다(CLAUDE §9) · «모른다»를 «못 한다»로 바꾸지 않는다(AC-92)");
  ok(mk(null).stats.marks.kept.underline === 1, "F-15c 표가 아예 없어도 해 본다(표가 없다고 안 내면 그것도 «모른다로 막기»다)");

  /* ═══ 🔴 기울임은 «못 낸다»가 아니라 «안 낸다» ═══ */
  const it = PLAN.planEditorOps({ blocks: [{ type: "para", text: "기울임이 있는 문단입니다", marks: [{ s: 0, e: 3, kind: "italic" }] }] });
  ok(it.stats.marks.planned.italic === 1 && it.stats.marks.kept.italic === 0
    && it.stats.demoted.some((d) => d.kind === "italic" && d.why === "channel_unsupported"),
    "F-16 🔴 기울임은 **어휘로는 받고 안 낸다** — 우리 자가검사가 기울임을 번짐 증상으로 세기 때문(켜면 계약의 두 부분이 싸운다)",
    JSON.stringify(it.stats.demoted));
  ok(!it.stats.demoted.some((d) => d.why === "range_invalid"),
    "F-16b 그리고 «모르는 마크»로 오해하지 않는다(어휘에 있으니 range_invalid 가 아니다 — 사유가 틀리면 다음 사람이 엉뚱한 데를 판다)");

  /* ═══ 🔴 «못 낸 서식»과 «못 낸 블록»을 안 섞는다 ═══ */
  const two = PLAN.planEditorOps({ blocks: [
    { type: "table", rows: [["구분", "금액"], ["지난달", "3만 원"]] },
    { type: "list", items: ["**첫째** 항목"] },
  ] });
  ok(two.stats.demoted.some((d) => d.kind === "table" && d.why === "no_editor_op")
    && two.stats.demoted.some((d) => d.kind === "bold" && d.why === "block_unsupported"),
    "F-17 🔴 «블록을 에디터 요소로 못 세웠다»(no_editor_op)와 «그 블록이 마크를 못 싣는다»(block_unsupported)를 **가른다** — 우리가 할 일이 다르다",
    JSON.stringify(two.stats.demoted));
}

rmSync(modPath, { force: true });
console.log(`\nverify-runner-format: ${pass}/${fail} (통과/실패)`);
process.exit(fail ? 1 : 0);
